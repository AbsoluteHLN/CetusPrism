/**
 * Fixed-density heuristic token pricing shared by the meter service and the
 * pure context-breakdown projection, so both surfaces price identical content
 * to identical numbers.
 *
 * @module @deepseek-ai/dsh-token-meter/estimate
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { EpochHeader } from '@deepseek-ai/dsh-session'

/** Fixed text-density estimate for scripts outside the CJK ranges. */
const CHARS_PER_TOKEN = 4

/**
 * Tokens per character in the CJK ranges. Real tokenizers emit roughly
 * 0.6–1.0 tokens per CJK character against the plain rate's 0.25, so the
 * fixed heuristic prices them at 0.75: conservative against underpricing
 * (the direction that produces context-overflow 400s) without discarding
 * accurate provider usage to heuristic overshoot in the common case.
 */
const CJK_TOKENS_PER_CHAR = 0.75

/** Per-block structural overhead for JSON framing and type tags. */
const BLOCK_OVERHEAD = 4

/** Role-field framing overhead added to every priced message. */
export const ROLE_OVERHEAD = 4

/**
 * Recognize the Unified CJK ranges — Han, kana, hangul, CJK punctuation and
 * radicals, fullwidth forms, and the supplementary ideographic planes — whose
 * scripts tokenize far denser than the plain rate.
 * @param code - one Unicode code point.
 * @returns true when the code point belongs to a dense CJK range.
 */
function isCjkCodePoint(code: number): boolean {
  return (code >= 0x2E80 && code <= 0x9FFF)
    || (code >= 0xAC00 && code <= 0xD7FF)
    || (code >= 0xF900 && code <= 0xFAFF)
    || (code >= 0xFF00 && code <= 0xFFEF)
    || (code >= 0x20000 && code <= 0x3FFFD)
}

/**
 * Price one string with CJK-aware density: code points in the CJK ranges
 * count at the dense rate, everything else at the plain rate, so Chinese,
 * Japanese, and Korean text stops underpricing by roughly threefold.
 * @param text - string to price without mutation.
 * @returns heuristic tokens, rounded up.
 */
export function estimateTextTokens(text: string): number {
  let tokens = 0
  let index = 0
  while (index < text.length) {
    const unit = text.charCodeAt(index)
    let code = unit
    let units = 1
    if (unit >= 0xD800 && unit <= 0xDBFF && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1)
      if (low >= 0xDC00 && low <= 0xDFFF) {
        code = (unit - 0xD800) * 0x400 + (low - 0xDC00) + 0x10000
        units = 2
      }
    }
    tokens += isCjkCodePoint(code) ? CJK_TOKENS_PER_CHAR : units / CHARS_PER_TOKEN
    index += units
  }
  return Math.ceil(tokens)
}

/**
 * Structural JSON price of one block outside the typed pricing arms: the
 * fixed heuristic for merge-extended blocks and for image references, whose
 * request price is route-owned rather than fixed. Image offload marks do not
 * change this reference-only heuristic; route pricing owns their placeholders.
 * @param block - block to price without mutation.
 * @returns heuristic tokens for the block's JSON structure.
 */
export function estimateStructuralBlock(block: ContentBlock): number {
  if (block.type === 'image') {
    const { offloaded: _offloaded, ...reference } = block
    return BLOCK_OVERHEAD + estimateTextTokens(JSON.stringify(reference))
  }
  return BLOCK_OVERHEAD + estimateTextTokens(JSON.stringify(block))
}

/**
 * Price content blocks recursively under the fixed density heuristic.
 * @param blocks - content blocks to price without mutation.
 * @returns heuristic tokens including per-block structural overhead.
 */
export function estimateContent(blocks: readonly ContentBlock[]): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += estimateTextTokens(block.text) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens += estimateTextTokens(block.name)
          + estimateTextTokens(block.arguments)
          + BLOCK_OVERHEAD
        break
      default:
        // ContentBlockMap is merge-extensible; unknown blocks (and image
        // references, whose request price is route-owned) retain a
        // conservative structural JSON price under the fixed heuristic.
        tokens += estimateStructuralBlock(block)
    }
  }
  return tokens
}

/**
 * Price the rendered system prompt: the `system/message` surface node's text.
 * Adapters serialize the prompt as a plain string — a system-role message or
 * the request's system field — not as a typed content block, so the price is
 * text density plus role framing with no per-block overhead.
 * @param message - system-role message to price without mutation.
 * @returns heuristic system-prompt tokens; 0 for empty content ("no system prompt").
 */
export function estimateSystemMessage(message: Message): number {
  if (message.content.length === 0) return 0
  let tokens = 0
  for (const block of message.content) {
    tokens += block.type === 'text' ? estimateTextTokens(block.text) : estimateTextTokens(JSON.stringify(block))
  }
  return tokens + ROLE_OVERHEAD
}

/**
 * Heuristically price one model-visible message.
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens under the fixed heuristic; a
 *   system-role message prices as {@link estimateSystemMessage}.
 */
export function estimateMessage(message: Message): number {
  if (message.role === 'system') return estimateSystemMessage(message)
  return estimateContent(message.content) + ROLE_OVERHEAD
}

/**
 * Price the tool-schema part of a canonical request envelope — the envelope's
 * only priced field, since the system prompt is a surface node.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic tool-schema tokens; 0 when absent or empty.
 */
export function estimateToolsTokens(header: EpochHeader | undefined): number {
  if (header?.tools === undefined || header.tools.length === 0) return 0
  return estimateTextTokens(JSON.stringify(header.tools)) + BLOCK_OVERHEAD
}
