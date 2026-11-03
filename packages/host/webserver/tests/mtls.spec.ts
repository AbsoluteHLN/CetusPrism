/**
 * Mutual-TLS mode of the webserver, exercised through the real Loader
 * composition: a dependency-free ECDSA CA issues the server and client
 * certificates, then the tests observe the user-visible TLS surface —
 * authenticated requests succeed, certificate-less and revoked peers fail,
 * runtime revocation takes effect from the next handshake, and route
 * handlers can read the authenticated peer identity.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { get as httpsGet } from 'node:https'
import type { RequestOptions } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer, { peerCertificate } from '../src/index.ts'
import { createCa, issueCertificate } from '../../../../scripts/aeroidz/x509.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface Material {
  ca: ReturnType<typeof createCa>
  server: ReturnType<typeof issueCertificate>
  client: ReturnType<typeof issueCertificate>
  other: ReturnType<typeof issueCertificate>
  paths: { cert: string; key: string; ca: string }
}

/** Issue a fresh CA + certificates and write the server-side PEM files. */
async function makeMaterial(dnsNames: string[]): Promise<Material> {
  root = await mkdtemp(join(tmpdir(), 'dsh-webserver-mtls-'))
  const ca = createCa('Aeroidz Test Root CA')
  const server = issueCertificate(ca, { cn: 'aeroidz-server', days: 30, dnsNames, ips: ['127.0.0.1'] })
  const client = issueCertificate(ca, { cn: 'device-one', days: 7 })
  const other = issueCertificate(ca, { cn: 'device-two', days: 7 })
  const paths = {
    cert: join(root, 'server.cert.pem'),
    key: join(root, 'server.key.pem'),
    ca: join(root, 'ca.cert.pem'),
  }
  await writeFile(paths.cert, server.certPem)
  await writeFile(paths.key, server.keyPem)
  await writeFile(paths.ca, ca.certPem)
  return { ca, server, client, other, paths }
}

/** Boot the webserver through the Loader with mTLS configured. */
async function loadTlsComposition(material: Material, extra: string[] = []): Promise<Context> {
  const configPath = join(root!, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    '    tls:',
    `      cert: '${material.paths.cert.replace(/\\/g, '/')}'`,
    `      key: '${material.paths.key.replace(/\\/g, '/')}'`,
    `      ca: '${material.paths.ca.replace(/\\/g, '/')}'`,
    ...extra,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root!).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** One HTTPS request that must complete; resolves the status code. */
function request(port: number, ca: string, client?: { cert: string; key: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      hostname: 'localhost',
      port,
      path: '/',
      method: 'GET',
      ca,
      rejectUnauthorized: true,
      servername: 'localhost',
      // A fresh connection per request: revocation applies at handshake
      // time, and the pooled global agent would reuse the pre-revocation
      // connection.
      agent: false,
      ...client === undefined ? {} : { cert: client.cert, key: client.key },
    }
    const req = httpsGet(options, res => {
      res.resume()
      res.on('end', () => { resolve(res.statusCode ?? 0) })
    })
    req.on('error', reject)
    req.setTimeout(10_000, () => { req.destroy(new Error('request timed out')) })
  })
}

describe('webserver mutual TLS', () => {
  it('serves requests from certificate-authenticated peers and refuses anonymous ones', async () => {
    const material = await makeMaterial(['localhost'])
    const ctx = await loadTlsComposition(material)
    const port = ctx.webServer.port

    await expect(request(port, material.ca.certPem, { cert: material.client.certPem, key: material.client.keyPem }))
      .resolves.toBe(404)
    // No client certificate: the handshake itself must fail, fail closed.
    await expect(request(port, material.ca.certPem)).rejects.toThrow()
  })

  it('refuses peers whose certificate serial is revoked', async () => {
    const material = await makeMaterial(['localhost'])
    const ctx = await loadTlsComposition(material, [`      revokedSerials: ['${material.client.serialHex}']`])
    const port = ctx.webServer.port

    await expect(request(port, material.ca.certPem, { cert: material.client.certPem, key: material.client.keyPem }))
      .rejects.toThrow()
    // A non-revoked device still connects.
    await expect(request(port, material.ca.certPem, { cert: material.other.certPem, key: material.other.keyPem }))
      .resolves.toBe(404)
  })

  it('applies setRevokedSerials from the next handshake', async () => {
    const material = await makeMaterial(['localhost'])
    const ctx = await loadTlsComposition(material)
    const port = ctx.webServer.port
    const device = { cert: material.client.certPem, key: material.client.keyPem }

    await expect(request(port, material.ca.certPem, device)).resolves.toBe(404)
    ctx.webServer.setRevokedSerials([material.client.serialHex])
    expect(ctx.webServer.revokedSerials).toEqual([material.client.serialHex])
    await expect(request(port, material.ca.certPem, device)).rejects.toThrow()
  })

  it('exposes the authenticated peer identity to route handlers', async () => {
    const material = await makeMaterial(['localhost'])
    const ctx = await loadTlsComposition(material)
    const port = ctx.webServer.port
    let observed: string | undefined
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: '/whoami',
      handler: (req, res) => {
        observed = peerCertificate(req).subject.CN
        res.writeHead(200)
        res.end()
      },
    })

    await expect(request(port, material.ca.certPem, { cert: material.client.certPem, key: material.client.keyPem, }))
    // hit the route
    await new Promise<void>((resolve, reject) => {
      const req = httpsGet({
        hostname: 'localhost', port, path: '/whoami', method: 'GET',
        ca: material.ca.certPem, rejectUnauthorized: true, servername: 'localhost',
        cert: material.client.certPem, key: material.client.keyPem,
      }, res => { res.resume(); res.on('end', () => { resolve() }) })
      req.on('error', reject)
    })
    dispose()
    expect(observed).toBe('device-one')
  })
})
