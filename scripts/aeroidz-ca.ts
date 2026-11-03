/**
 * Aeroidz CA operations: offline certificate authority for the mTLS remote
 * link. One self-signed ECDSA root issues short-lived server and device
 * certificates; revocation appends to the JSON denylist the webserver reads
 * through `tls.revokedSerialsFile`.
 *
 * Usage:
 *   tsx scripts/aeroidz-ca.ts init-ca --dir <caDir> [--cn <name>]
 *   tsx scripts/aeroidz-ca.ts sign-server --dir <caDir> --host <dns> [--host <dns> ...] [--ip <ip> ...] --out <outDir> [--days 30]
 *   tsx scripts/aeroidz-ca.ts sign-client --dir <caDir> --cn <deviceName> --out <outDir> [--days 7]
 *   tsx scripts/aeroidz-ca.ts revoke --dir <caDir> --serial <hex>
 *   tsx scripts/aeroidz-ca.ts list-revoked --dir <caDir>
 */

import { createPrivateKey } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCa, issueCertificate, parsePemCertificates, cnOf, type CaMaterial } from './aeroidz/x509.ts'

const [command, ...rest] = process.argv.slice(2)

function argsOf(argv: string[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!
    if (!token.startsWith('--')) throw new Error(`unexpected argument "${token}"`)
    const key = token.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} requires a value`)
    const existing = out[key]
    out[key] = existing === undefined ? value : [...(Array.isArray(existing) ? existing : [existing]), value]
    index += 1
  }
  return out
}

function one(args: Record<string, string | string[]>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') throw new Error(`--${key} is required`)
  return value
}

function many(args: Record<string, string | string[]>, key: string): string[] {
  const value = args[key]
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** Reload persisted CA material; the certificate carries the issuer identity. */
async function loadCa(dir: string): Promise<CaMaterial> {
  const keyPem = await readFile(join(dir, 'ca.key.pem'), 'utf8')
  const certPem = await readFile(join(dir, 'ca.cert.pem'), 'utf8')
  const certDer = parsePemCertificates(certPem)[0]
  if (certDer === undefined) throw new Error('ca.cert.pem holds no certificate')
  return {
    key: createPrivateKey(keyPem),
    keyPem,
    certDer,
    certPem,
    cn: cnOf(certDer),
    serialHex: '',
  }
}

const revokedPath = (dir: string): string => join(dir, 'revoked-serials.json')

async function readRevoked(dir: string): Promise<string[]> {
  if (!existsSync(revokedPath(dir))) return []
  const parsed: unknown = JSON.parse(await readFile(revokedPath(dir), 'utf8'))
  if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== 'string')) {
    throw new Error('revoked-serials.json must be a JSON array of serial strings')
  }
  return parsed
}

async function main(): Promise<void> {
  switch (command) {
    case 'init-ca': {
      const args = argsOf(rest)
      const dir = one(args, 'dir')
      const cn = typeof args.cn === 'string' ? args.cn : 'Aeroidz Root CA'
      if (existsSync(join(dir, 'ca.key.pem'))) throw new Error(`CA already exists in ${dir}`)
      await mkdir(dir, { recursive: true })
      const ca = createCa(cn)
      await writeFile(join(dir, 'ca.key.pem'), ca.keyPem, { mode: 0o600 })
      await writeFile(join(dir, 'ca.cert.pem'), ca.certPem)
      await writeFile(revokedPath(dir), '[]\n')
      console.log(`CA initialized: ${dir}`)
      console.log(`CA certificate fingerprint (verify out-of-band before trusting):`)
      console.log(ca.certPem)
      return
    }
    case 'sign-server': {
      const args = argsOf(rest)
      const dir = one(args, 'dir')
      const out = one(args, 'out')
      const hosts = many(args, 'host')
      if (hosts.length === 0) throw new Error('at least one --host is required')
      const ips = many(args, 'ip')
      const days = args.days === undefined ? 30 : Number(one(args, 'days'))
      const ca = await loadCa(dir)
      const issued = issueCertificate(ca, {
        cn: hosts[0]!,
        days,
        dnsNames: hosts,
        ips,
      })
      await mkdir(out, { recursive: true })
      await writeFile(join(out, 'server.key.pem'), issued.keyPem, { mode: 0o600 })
      await writeFile(join(out, 'server.cert.pem'), issued.certPem)
      console.log(`server certificate issued (serial ${issued.serialHex}, ${String(days)} days) → ${out}`)
      return
    }
    case 'sign-client': {
      const args = argsOf(rest)
      const dir = one(args, 'dir')
      const out = one(args, 'out')
      const cn = one(args, 'cn')
      const days = args.days === undefined ? 7 : Number(one(args, 'days'))
      const ca = await loadCa(dir)
      const issued = issueCertificate(ca, { cn, days })
      await mkdir(out, { recursive: true })
      await writeFile(join(out, `${cn}.key.pem`), issued.keyPem, { mode: 0o600 })
      await writeFile(join(out, `${cn}.cert.pem`), issued.certPem)
      console.log(`client certificate issued (serial ${issued.serialHex}, ${String(days)} days) → ${out}`)
      console.log('deliver the two PEM files to the device over a trusted channel; the CA file never leaves the server')
      return
    }
    case 'revoke': {
      const args = argsOf(rest)
      const dir = one(args, 'dir')
      const serial = one(args, 'serial').toUpperCase().replace(/[^0-9A-F]/g, '')
      const revoked = await readRevoked(dir)
      if (!revoked.includes(serial)) revoked.push(serial)
      await writeFile(revokedPath(dir), `${JSON.stringify(revoked, null, 2)}\n`)
      console.log(`revoked ${serial}; ${String(revoked.length)} serial(s) denied`)
      return
    }
    case 'list-revoked': {
      const dir = one(argsOf(rest), 'dir')
      const revoked = await readRevoked(dir)
      for (const serial of revoked) console.log(serial)
      return
    }
    default:
      throw new Error(`unknown command "${command ?? ''}" (init-ca | sign-server | sign-client | revoke | list-revoked)`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
