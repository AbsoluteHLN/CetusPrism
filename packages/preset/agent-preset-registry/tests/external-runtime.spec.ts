/**
 * The external-runtime execution backend: ONE mode for Pi and ZCode.
 *
 * Both upstreams are installed from their own repositories and speak a
 * line-delimited JSON protocol over stdio, so they are one mode with two
 * adapters. These cases pin the parts that make that true: the upstream
 * descriptors point at the upstream's OWN entry points, the frame parser
 * normalizes both envelopes, and the locator reports an uninstalled runtime
 * honestly instead of hiding it.
 */

import { describe, expect, it } from 'vitest'
import { createExternalRuntimeProvider } from '../src/backend.ts'
import {
  compareVersions,
  EXTERNAL_RUNTIME_UPSTREAMS,
  formatRuntimeRequest,
  locateExternalRuntime,
  parseRuntimeFrame,
} from '../src/external-runtime.ts'

describe('external runtime upstreams', () => {
  it('points at each upstream\'s own repository and entry point', () => {
    expect(EXTERNAL_RUNTIME_UPSTREAMS.pi.repo).toBe('https://github.com/earendil-works/pi')
    expect(EXTERNAL_RUNTIME_UPSTREAMS.pi.command).toBe('pi')
    expect(EXTERNAL_RUNTIME_UPSTREAMS.pi.args).toEqual(['--mode', 'rpc', '--no-session'])
    expect(EXTERNAL_RUNTIME_UPSTREAMS.zcode.repo).toBe('https://github.com/zai-org/ZCode')
    expect(EXTERNAL_RUNTIME_UPSTREAMS.zcode.command).toBe('zcode')
    expect(EXTERNAL_RUNTIME_UPSTREAMS.zcode.args).toEqual(['app-server', '--stdio'])
  })

  it('gives both upstreams the same protocol shape', () => {
    // One JSON object per line, requests correlated by id, no handshake.
    expect(EXTERNAL_RUNTIME_UPSTREAMS.pi.framing).toBe('jsonl')
    expect(EXTERNAL_RUNTIME_UPSTREAMS.zcode.framing).toBe('ndjson')
  })
})

describe('parseRuntimeFrame', () => {
  it('reads a request frame', () => {
    expect(parseRuntimeFrame('{"id":1,"method":"session/create","params":{"cwd":"/work"}}'))
      .toEqual({ kind: 'request', id: 1, method: 'session/create', params: { cwd: '/work' } })
  })

  it('reads a notification frame', () => {
    expect(parseRuntimeFrame('{"method":"conversationFrame","params":{"wire":1}}'))
      .toEqual({ kind: 'notification', method: 'conversationFrame', params: { wire: 1 } })
  })

  it('reads a response frame', () => {
    expect(parseRuntimeFrame('{"id":"r-1","result":{"ok":true}}'))
      .toEqual({ kind: 'response', id: 'r-1', result: { ok: true } })
  })

  it('reads an error frame with its code', () => {
    expect(parseRuntimeFrame('{"id":7,"error":{"code":-32601,"message":"Method not found"}}'))
      .toEqual({ kind: 'error', id: 7, error: { code: -32601, message: 'Method not found' } })
  })

  it('reports a malformed line as a parse error instead of throwing', () => {
    expect(parseRuntimeFrame('{not json'))
      .toEqual({ kind: 'error', id: 'parse-error', error: { code: -32700, message: 'Parse error' } })
  })

  it('ignores an empty line', () => {
    expect(parseRuntimeFrame('   ')).toBeUndefined()
  })

  it('tolerates the non-numeric ids a runtime may answer with', () => {
    expect(parseRuntimeFrame('{"id":"parse-error","error":{"code":-32700,"message":"Parse error"}}'))
      .toEqual({ kind: 'error', id: 'parse-error', error: { code: -32700, message: 'Parse error' } })
  })
})

describe('formatRuntimeRequest', () => {
  it('writes one request per line', () => {
    const line = formatRuntimeRequest({ kind: 'request', id: 'r-1', method: 'runtime/capabilities' })
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual({ id: 'r-1', method: 'runtime/capabilities' })
  })
})

describe('compareVersions', () => {
  it('orders versions', () => {
    expect(compareVersions('1.4.0', '1.3.0')).toBeGreaterThan(0)
    expect(compareVersions('0.87.1', '1.4.0')).toBeLessThan(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  it('treats a missing segment as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })
})

describe('locateExternalRuntime', () => {
  it('reports an uninstalled runtime with the place to install it from', () => {
    const probe = locateExternalRuntime('pi', { command: 'cetusprism-no-such-runtime' })
    expect(probe.compatible).toBe(false)
    expect(probe.version).toBe('unknown')
    expect(probe.reason).toContain('not installed')
    expect(probe.source).toBe('https://github.com/earendil-works/pi')
  })

  it('refuses a runtime older than the supported floor', () => {
    const probe = locateExternalRuntime('zcode', {
      command: process.execPath,
      version: '0.0.1',
    })
    expect(probe.compatible).toBe(false)
    expect(probe.reason).toContain('older than the supported floor')
  })

  it('accepts a runtime that meets the floor', () => {
    const probe = locateExternalRuntime('pi', {
      command: process.execPath,
      version: '1.4.0',
    })
    expect(probe.compatible).toBe(true)
    expect(probe.version).toBe('1.4.0')
  })
})

describe('createExternalRuntimeProvider', () => {
  it('answers the catalog probe for an upstream', () => {
    const provider = createExternalRuntimeProvider('zcode', {
      command: 'cetusprism-no-such-runtime',
    })
    const probe = provider.describe()
    expect(provider.id).toBe('zcode')
    expect(probe.compatible).toBe(false)
    expect(probe.reason).toContain('not installed')
  })
})
