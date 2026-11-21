import { expect, it, vi } from 'vitest'
import { PlatformAuthError, requestAccount, requestPlatform } from '../src/protocol.ts'

const signal = () => new AbortController().signal

it('reads a Platform account payload delivered under the plain envelope', async () => {
  const payload = { id: 'user', email: 'masked@example.test', id_profile: { name: 'User', picture: null } }
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ code: 0, msg: 'success', data: payload })))
  try {
    await expect(requestAccount('https://platform.deepseek.com', '/auth-api/v0/users/current',
      'fixture-token', signal(), {})).resolves.toEqual(payload)
  } finally { fetcher.mockRestore() }
})

it('reads a Platform account payload delivered under the business envelope', async () => {
  const payload = { id: 'user', email: 'masked@example.test' }
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: payload } })))
  try {
    await expect(requestAccount('https://platform.deepseek.com', '/auth-api/v0/users/current',
      'fixture-token', signal(), {})).resolves.toEqual(payload)
  } finally { fetcher.mockRestore() }
})

it('keeps reading the business envelope a DSH deployment returns', async () => {
  const payload = { authorize_url: 'https://platform.deepseek.com/dsh/authorize', authorize_id: 'attempt', expires_in: 600 }
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: payload } })))
  try {
    await expect(requestPlatform('https://platform.deepseek.com', 'auth_init', {}, signal(), {}))
      .resolves.toEqual(payload)
  } finally { fetcher.mockRestore() }
})

it('rejects a business envelope whose business code failed', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ code: 0, data: { biz_code: 17, biz_data: null } })))
  try {
    await expect(requestAccount('https://platform.deepseek.com', '/auth-api/v0/users/current',
      'fixture-token', signal(), {})).rejects.toBeInstanceOf(PlatformAuthError)
  } finally { fetcher.mockRestore() }
})

it('rejects a non-zero Platform code as a protocol failure', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ code: 50005, msg: 'PAYLOAD_SCHEMA_MISMATCH', data: null })))
  try {
    await expect(requestAccount('https://platform.deepseek.com', '/auth-api/v0/users/current',
      'fixture-token', signal(), {})).rejects.toThrow('account: protocol')
  } finally { fetcher.mockRestore() }
})
