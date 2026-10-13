/** Keyless model catalog and route echo for persistent CLI acceptance. */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

class TuiFixtureAdapter extends LlmAdapter {
  listModels(provider) {
    return Promise.resolve(['deepseek-chat', 'tui-second'].map(id => ({ provider, id, name: id })))
  }

  async *stream(options) {
    options.signal?.throwIfAborted()
    yield { type: 'block-start', index: 0, blockType: 'text' }
    const prompt = options.messages.findLast(message => message.role === 'user')?.content?.[0]?.text
    if (prompt === 'TUI_SLOW') {
      yield { type: 'text-delta', index: 0, text: 'TUI_WAITING\n' }
      const signal = options.signal
      if (signal === undefined) throw new Error('cancellation fixture requires a signal')
      let abort
      try {
        await new Promise((_, reject) => {
          abort = () => reject(signal.reason)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
        })
      } finally {
        if (abort !== undefined) signal.removeEventListener('abort', abort)
      }
    }
    yield { type: 'text-delta', index: 0, text: `TUI_REPLY_${options.model}` }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: `TUI_REPLY_${options.model}` } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Cordis plugin identifier. */
export const name = 'tui-fixture-llm'
/** Required catalog and streaming registry. */
export const inject = ['llm']
/** Register only the test-owned provider adapter. */
export function apply(ctx) {
  ctx.llm.registerAdapter(['deepseek-official'], new TuiFixtureAdapter())
}
