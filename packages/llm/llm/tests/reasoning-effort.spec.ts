import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  isSupportedReasoningEffort,
  LlmError,
  REASONING_EFFORT_LADDER,
  ReasoningEffortId,
  selectSupportedReasoningEffort,
} from '@deepseek-ai/dsh-llm'
import type { LlmReasoningEffortProbeResult } from '@deepseek-ai/dsh-llm'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  return ctx
}

/** Brand one level name the way an adapter does. */
function level(name: string): ReasoningEffortId {
  return ReasoningEffortId(name)
}

/** Capture the machine code one synchronous registration throws. */
function thrownCode(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return error instanceof LlmError ? error.code : ''
  }
  return ''
}

/** One probe reply for a model that takes three levels. */
function sampleResult(): LlmReasoningEffortProbeResult {
  return {
    accepted: ['low', 'medium', 'xhigh'],
    refused: [{ level: 'high', detail: 'Unexpected reasoning effort high' }],
    declared: ['low', 'medium', 'xhigh'],
    declaration: { off: null, low: 'low', medium: 'medium', xhigh: 'xhigh' },
    outcomes: [
      { level: 'low', accepted: true },
      { level: 'medium', accepted: true },
      { level: 'xhigh', accepted: true },
      { level: 'high', accepted: false, detail: 'Unexpected reasoning effort high' },
    ],
  }
}

describe('reasoning-effort ladder', () => {
  it('orders the canonical ladder from no reasoning to the highest tier', () => {
    expect(REASONING_EFFORT_LADDER).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('keeps a requested level the model supports', () => {
    expect(selectSupportedReasoningEffort([level('low'), level('high')], level('high'))).toBe(level('high'))
    expect(selectSupportedReasoningEffort([level('off')], level('off'))).toBe(level('off'))
  })

  it('lowers a request to the nearest supported level that is not below it', () => {
    // `high` is not offered, so `xhigh` is the nearest level the model has
    // that is not below the request.
    expect(selectSupportedReasoningEffort([level('low'), level('xhigh')], level('high'))).toBe(level('xhigh'))
    // A level between the request and the next one wins over the farther one.
    expect(selectSupportedReasoningEffort([level('low'), level('medium'), level('xhigh')], level('minimal')))
      .toBe(level('low'))
  })

  it('falls back to the highest supported level when nothing is at or above the request', () => {
    expect(selectSupportedReasoningEffort([level('off'), level('low'), level('medium')], level('high')))
      .toBe(level('medium'))
    expect(selectSupportedReasoningEffort([level('low'), level('medium')], level('max'))).toBe(level('medium'))
  })

  it('falls back to the highest supported level for a request it cannot place', () => {
    // `ultra` is not a ladder level, so nothing can be compared with it.
    expect(selectSupportedReasoningEffort([level('low'), level('high')], level('ultra'))).toBe(level('high'))
  })

  it('has nothing to offer a model that supports no level at all', () => {
    expect(selectSupportedReasoningEffort([], level('high'))).toBeUndefined()
  })

  it('matches a custom level exactly but never compares it by position', () => {
    // The model takes `ultra`, so the request for it is answered as asked.
    expect(selectSupportedReasoningEffort([level('ultra'), level('low')], level('ultra'))).toBe(level('ultra'))
    // Nothing says where `ultra` sits, so a request for another level is
    // answered from the ladder levels alone.
    expect(selectSupportedReasoningEffort([level('ultra'), level('low'), level('high')], level('medium')))
      .toBe(level('high'))
    // A model whose only level is off the ladder offers no ladder level.
    expect(selectSupportedReasoningEffort([level('ultra')], level('high'))).toBeUndefined()
  })

  it('answers the same whichever order the supported levels arrive in', () => {
    expect(selectSupportedReasoningEffort([level('high'), level('low')], level('medium')))
      .toBe(selectSupportedReasoningEffort([level('low'), level('high')], level('medium')))
    expect(selectSupportedReasoningEffort([level('medium'), level('off')], level('high')))
      .toBe(selectSupportedReasoningEffort([level('off'), level('medium')], level('high')))
  })

  it('reports exact membership without ever lowering the request', () => {
    expect(isSupportedReasoningEffort([level('low'), level('high')], level('high'))).toBe(true)
    expect(isSupportedReasoningEffort([level('low'), level('high')], level('medium'))).toBe(false)
    expect(isSupportedReasoningEffort([], level('low'))).toBe(false)
    expect(isSupportedReasoningEffort([level('ultra')], level('ultra'))).toBe(true)
  })
})

describe('reasoning-effort probe registry', () => {
  it('serves one draft per settings namespace and disposes with its fiber', async () => {
    const ctx = await setup()
    const probe = vi.fn(() => Promise.resolve(sampleResult()))

    const dispose = ctx.llm.registerReasoningEffortProbe('llm-example', probe)
    await expect(ctx.llm.probeReasoningEfforts('llm-example', {
      model: 'csu/Qwen3.8-Flash-Next',
      baseURL: 'https://gateway.example/v1',
    })).resolves.toEqual(sampleResult())
    expect(probe).toHaveBeenCalledWith({
      model: 'csu/Qwen3.8-Flash-Next',
      baseURL: 'https://gateway.example/v1',
    })

    // Disposal is observed through the offer itself, which is the only thing
    // the registration ever produced.
    dispose()
    await expect(ctx.llm.probeReasoningEfforts('llm-example', { model: 'qwen' }))
      .rejects.toMatchObject({ code: 'NO_PROBE' })
  })

  it('refuses an unnamed namespace and a second registration of the same one', async () => {
    const ctx = await setup()
    const probe = (): Promise<LlmReasoningEffortProbeResult> => Promise.resolve(sampleResult())

    expect(thrownCode(() => ctx.llm.registerReasoningEffortProbe('', probe))).toBe('INVALID_PROBE')
    ctx.llm.registerReasoningEffortProbe('llm-example', probe)
    expect(thrownCode(() => ctx.llm.registerReasoningEffortProbe('llm-example', probe)))
      .toBe('DUPLICATE_DISCOVERY')
    // The refused second registration left the first one serving.
    await expect(ctx.llm.probeReasoningEfforts('llm-example', { model: 'qwen' })).resolves.toEqual(sampleResult())
  })

  it('refuses a namespace nothing serves and a draft that names nothing', async () => {
    const ctx = await setup()
    ctx.llm.registerReasoningEffortProbe('llm-example', () => Promise.resolve(sampleResult()))

    await expect(ctx.llm.probeReasoningEfforts('llm-absent', { model: 'qwen' }))
      .rejects.toMatchObject({ code: 'NO_PROBE' })
    await expect(ctx.llm.probeReasoningEfforts('llm-example', { model: '' }))
      .rejects.toMatchObject({ code: 'INVALID_PROBE' })
    await expect(ctx.llm.probeReasoningEfforts('llm-example', { model: '', baseURL: '' }))
      .rejects.toMatchObject({ code: 'INVALID_PROBE' })
    // Naming an endpoint alone is enough: a listing can name the model back.
    await expect(ctx.llm.probeReasoningEfforts('llm-example', { model: '', baseURL: 'https://gateway.example/v1' }))
      .resolves.toEqual(sampleResult())
  })

  it('detaches the probed result and pins the level that omits the parameter', async () => {
    const ctx = await setup()
    ctx.llm.registerReasoningEffortProbe('llm-example', () => Promise.resolve({
      accepted: ['low', 'low', ''],
      refused: [
        { level: 'high', detail: 'Unexpected reasoning effort high' },
        { level: '', detail: 'noise' },
      ],
      declared: ['low', 'medium'],
      declaration: { off: 'off', low: 'low', medium: '', high: 'high' },
      outcomes: [
        { level: 'low', accepted: true },
        { level: 'high', accepted: false, detail: 'Unexpected reasoning effort high' },
        { level: '', accepted: false },
      ],
    }))

    const probed = await ctx.llm.probeReasoningEfforts('llm-example', { model: 'qwen' })
    // A level nobody can select is noise, and a repeat is the same level.
    expect(probed.accepted).toEqual(['low'])
    expect(probed.refused).toEqual([{ level: 'high', detail: 'Unexpected reasoning effort high' }])
    expect(probed.declared).toEqual(['low', 'medium'])
    // `off` omits the parameter, so it has no spelling to send, and a level
    // with no spelling declares nothing.
    expect(probed.declaration).toEqual({ off: null, low: 'low', high: 'high' })
    expect(probed.outcomes).toEqual([
      { level: 'low', accepted: true },
      { level: 'high', accepted: false, detail: 'Unexpected reasoning effort high' },
    ])
  })

  it('carries cancellation into Remote probing and maps provider failures', async () => {
    const ctx = await setup()
    const probe = vi.fn()
      .mockResolvedValueOnce(sampleResult())
      .mockRejectedValueOnce(new Error('endpoint offline'))
      .mockRejectedValueOnce('provider refused')
    ctx.llm.registerReasoningEffortProbe('llm-example', probe)
    const signal = new AbortController().signal

    await expect(ctx.llm.remoteProbeReasoningEfforts('llm-example', { model: 'qwen' }, signal))
      .resolves.toEqual(sampleResult())
    expect(probe).toHaveBeenCalledWith({ model: 'qwen' }, signal)

    await expect(ctx.llm.remoteProbeReasoningEfforts('llm-example', { model: 'qwen' }, signal))
      .rejects.toMatchObject({
        code: 'llm/reasoning-effort-probe-rejected',
        message: 'endpoint offline',
        details: { settingsNs: 'llm-example' },
      })
    await expect(ctx.llm.remoteProbeReasoningEfforts('llm-example', { model: 'qwen' }, signal))
      .rejects.toMatchObject({
        code: 'llm/reasoning-effort-probe-rejected',
        message: 'provider refused',
      })
  })

  it('maps an unserved namespace onto the same Remote failure code', async () => {
    const ctx = await setup()

    await expect(ctx.llm.remoteProbeReasoningEfforts('llm-absent', { model: 'qwen' }, new AbortController().signal))
      .rejects.toMatchObject({
        code: 'llm/reasoning-effort-probe-rejected',
        message: 'no reasoning-effort probe is registered for "llm-absent"',
        details: { settingsNs: 'llm-absent' },
      })
  })
})
