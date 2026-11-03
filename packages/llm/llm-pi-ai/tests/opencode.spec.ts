import { describe, expect, it } from 'vitest'
import {
  credentialEnvAliases, isOpenCodeProvider, openCodeNativeAuth, openCodeSessionProblem,
  OPENCODE_API_KEY_ENV, OPENCODE_GO_API_KEY_ENV,
} from '../src/opencode.ts'

describe('OpenCode provider support', () => {
  it('owns both Zen and Go routes', () => {
    expect(isOpenCodeProvider('opencode')).toBe(true)
    expect(isOpenCodeProvider('opencode-go')).toBe(true)
    expect(isOpenCodeProvider('anthropic')).toBe(false)
  })

  it('reports the provider-native credential variables for both routes', () => {
    expect(openCodeNativeAuth('opencode')).toEqual({
      env: [OPENCODE_API_KEY_ENV, OPENCODE_GO_API_KEY_ENV],
      oauth: false,
    })
    expect(openCodeNativeAuth('opencode-go')).toEqual({
      env: [OPENCODE_API_KEY_ENV, OPENCODE_GO_API_KEY_ENV],
      oauth: false,
    })
    expect(openCodeNativeAuth('anthropic')).toBeUndefined()
  })

  it('accepts the ecosystem alias only after the native name', () => {
    expect(credentialEnvAliases(OPENCODE_API_KEY_ENV)).toEqual([OPENCODE_GO_API_KEY_ENV])
    expect(credentialEnvAliases(OPENCODE_GO_API_KEY_ENV)).toEqual([])
    expect(credentialEnvAliases('ANTHROPIC_API_KEY')).toEqual([])
  })

  it('names the missing session before the gateway rejects the request', () => {
    expect(openCodeSessionProblem('opencode-go', undefined)).toContain('x-opencode-session')
    expect(openCodeSessionProblem('opencode-go', '')).toContain('x-opencode-session')
    expect(openCodeSessionProblem('opencode-go', 'ses_123')).toBeUndefined()
    expect(openCodeSessionProblem('anthropic', undefined)).toBeUndefined()
  })
})
