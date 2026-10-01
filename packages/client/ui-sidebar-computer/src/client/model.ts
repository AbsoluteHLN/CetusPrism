/**
 * Pure derivation of the computer-use control panel's state from raw Chat
 * nodes.
 *
 * Every export is a pure function of chat nodes and the dictionary, so the
 * live panel and a session-log replay show the identical feed. Wire values
 * that fail their local shape checks degrade to the generic form instead of
 * throwing — display must never crash a replay.
 * @module
 */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ChatConversationViewNode, ToolCallBlock, ToolChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'

/**
 * Wire prefix of the native Cua Driver computer-use tools, registered by
 * `@deepseek-ai/dsh-experimental-computer-use-cua-driver-native`; the suffix is
 * the upstream Cua Driver tool name.
 */
export const CUA_TOOL_PREFIX = 'cua_driver_native__'

/** Feed length cap: the panel is a control surface, not a transcript. */
export const MAX_ACTIONS = 50

/** Longest one value shows inside a label before truncation. */
const VALUE_PREVIEW_LIMIT = 40

/** One settled or in-flight computer action row. */
export interface ComputerAction {
  /** The call's identity; stable across replay. */
  readonly callId: string
  /** Chat anchor sequence of the call's node; the feed sorts on it, newest first. */
  readonly seq: number
  /** Upstream Cua Driver tool name, wire prefix removed. */
  readonly tool: string
  /** The human-readable action line. */
  readonly label: string
  /** Whether the action is running, settled successfully, or settled with an error. */
  readonly state: 'running' | 'ok' | 'error'
  /** Unix epoch ms of the latest stage's event. */
  readonly time: number
  /** Settled duration when the paired call head is inside the loaded window. */
  readonly durationMs: number | null
  /** Durable images the result carries, in result order. */
  readonly images: readonly ImageAttachmentRef[]
}

/** Whole-panel activity derived from the Chat target's materialized nodes. */
export interface ComputerActivity {
  /** Newest-first action rows, capped at {@link MAX_ACTIONS}. */
  readonly items: readonly ComputerAction[]
  /** Whether any computer action is still in flight. */
  readonly running: boolean
  /** The newest durable frame across all settled results. */
  readonly latestImage: ImageAttachmentRef | undefined
  /** Actions older than the cap. */
  readonly hiddenCount: number
}

/**
 * Build one action's human-readable line from the wire tool name and its
 * arguments. An unrecognized tool shows its own upstream name; malformed or
 * missing arguments degrade the detail, never the row.
 * @param toolName - the wire tool name, including the provider prefix.
 * @param args - the parsed argument object (possibly empty).
 * @param t - namespace-bound translate.
 * @returns the localized action line.
 */
export function actionLabel(toolName: string, args: Readonly<Record<string, unknown>>, t: TranslateNS<'sidebarComputer'>): string {
  const tool = toolName.startsWith(CUA_TOOL_PREFIX) ? toolName.slice(CUA_TOOL_PREFIX.length) : toolName
  switch (tool) {
    case 'click':
      if (args['button'] === 'right') return t('verb.rightClick', { detail: targetDetail(args, t) })
      if (typeof args['count'] === 'number' && args['count'] >= 2) return t('verb.doubleClick', { detail: targetDetail(args, t) })
      return t('verb.click', { detail: targetDetail(args, t) })
    case 'double_click': return t('verb.doubleClick', { detail: targetDetail(args, t) })
    case 'right_click': return t('verb.rightClick', { detail: targetDetail(args, t) })
    case 'type_text': return t('verb.type', { text: preview(t, stringOf(args, 'text')) })
    case 'press_key': return t('verb.pressKey', { keys: [...stringArrayOf(args, 'modifiers'), stringOf(args, 'key')].filter(Boolean).join('+') })
    case 'hotkey': return t('verb.hotkey', { keys: stringArrayOf(args, 'keys').join('+') })
    case 'scroll': return t('verb.scroll', { detail: scrollDetail(args, t) })
    case 'drag': return t('verb.drag')
    case 'set_value': return t('verb.setValue', { value: preview(t, stringOf(args, 'value')) })
    case 'launch_app': return t('verb.launchApp', { name: firstStringOf(args, ['name', 'path', 'aumid', 'bundle_id']) })
    case 'kill_app': return t('verb.killApp', { pid: numberText(args['pid']) })
    case 'bring_to_front': return t('verb.bringToFront')
    case 'invoke_menu': return t('verb.invokeMenu', { path: stringArrayOf(args, 'path').join(' > ') })
    case 'set_window_frame': return t('verb.setWindowFrame')
    case 'clipboard_read': return t('verb.clipboardRead')
    case 'clipboard_write': return t('verb.clipboardWrite')
    case 'list_apps': return t('verb.listApps')
    case 'list_windows': return t('verb.listWindows')
    case 'get_window_state': return t('verb.getWindowState')
    case 'get_desktop_state': return t('verb.getDesktopState')
    case 'get_screen_size': return t('verb.getScreenSize')
    case 'verify_state': return t('verb.verifyState')
    case 'get_accessibility_tree': return t('verb.getAccessibilityTree')
    case 'get_cursor_position': return t('verb.getCursorPosition')
    case 'move_cursor': return t('verb.moveCursor')
    case 'browser_navigate': return t('verb.browserNavigate', { url: preview(t, stringOf(args, 'url')) })
    case 'start_recording': return t('verb.startRecording')
    case 'stop_recording': return t('verb.stopRecording')
    case 'replay_trajectory': return t('verb.replayTrajectory')
    case 'start_session': return t('verb.startSession')
    case 'end_session': return t('verb.endSession')
    case 'escalate_session': return t('verb.escalateSession')
    default: return t('verb.unknown', { name: tool })
  }
}

/** The click target phrase: element handle, pixel coordinates, or process. */
function targetDetail(args: Readonly<Record<string, unknown>>, t: TranslateNS<'sidebarComputer'>): string {
  if (typeof args['element_index'] === 'number') return t('detail.element', { index: String(args['element_index']) })
  if (typeof args['x'] === 'number' && typeof args['y'] === 'number') {
    return t('detail.coords', { x: String(args['x']), y: String(args['y']) })
  }
  if (typeof args['pid'] === 'number') return t('detail.pid', { pid: String(args['pid']) })
  return ''
}

/** The scroll's localized direction and amount as one phrase. */
function scrollDetail(args: Readonly<Record<string, unknown>>, t: TranslateNS<'sidebarComputer'>): string {
  const parts: string[] = []
  const direction = args['direction']
  if (typeof direction === 'string') parts.push(directionLine(t, direction))
  const amount = args['amount']
  if (typeof amount === 'number') parts.push(t('detail.amount', { amount: String(amount) }))
  else if (args['by'] === 'page') parts.push(t('detail.page'))
  return parts.join(' ')
}

/** Localized scroll direction word for a wire direction value. */
function directionLine(t: TranslateNS<'sidebarComputer'>, direction: string): string {
  switch (direction) {
    case 'up': return t('direction.up')
    case 'down': return t('direction.down')
    case 'left': return t('direction.left')
    case 'right': return t('direction.right')
    default: return direction
  }
}

/** Shorten one value for label display, through the truncation copy. */
function preview(t: TranslateNS<'sidebarComputer'>, value: string): string {
  return value.length <= VALUE_PREVIEW_LIMIT ? value : t('text.truncated', { text: value.slice(0, VALUE_PREVIEW_LIMIT) })
}

/** The first string-valued argument among the given keys. */
function stringOf(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value : ''
}

/** The first non-empty string-valued argument among the given keys. */
function firstStringOf(args: Readonly<Record<string, unknown>>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = stringOf(args, key)
    if (value !== '') return value
  }
  return ''
}

/** The string members of one array-valued argument. */
function stringArrayOf(args: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = args[key]
  return Array.isArray(value) ? value.filter((part): part is string => typeof part === 'string') : []
}

/** Render one numeric argument, absent-safe. */
function numberText(value: unknown): string {
  return typeof value === 'number' ? String(value) : ''
}

/** Parse the model-produced argument JSON, absent or malformed safe. */
function parseArgs(argsRaw: string | undefined): Readonly<Record<string, unknown>> {
  if (argsRaw === undefined || argsRaw === '') return {}
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Readonly<Record<string, unknown>>
      : {}
  } catch {
    return {}
  }
}

/** The tool name a lifecycle block is attributable to; a settled call without its head has none. */
function callName(root: ToolCallBlock): string | undefined {
  return 'kind' in root ? root.call?.name : root.name
}

/** One materialized Chat Node narrowed to its Tool row payload, other kinds safe. */
function toolChatData(node: ChatConversationViewNode): ToolChatData | undefined {
  if (node.kind !== 'tool-call') return undefined
  const data: unknown = node.data
  return typeof data === 'object' && data !== null && 'root' in data
    ? data as ToolChatData
    : undefined
}

/** One settled result's durable image references, in result order. */
function collectImages(content: readonly ContentBlock[]): ImageAttachmentRef[] {
  const images: ImageAttachmentRef[] = []
  for (const block of content) {
    if (block.type === 'image') images.push(block.attachment)
  }
  return images
}

/**
 * One row per root computer-use call, newest first, plus the running flag and
 * the newest frame. Settled calls whose head fell outside the loaded window
 * cannot be attributed to computer use and are skipped.
 * @param nodes - the Chat node store's currently materialized nodes.
 * @param t - namespace-bound translate for the action labels.
 * @returns the feed, running flag, latest frame, and hidden count.
 */
export function deriveComputerActivity(nodes: readonly ChatConversationViewNode[], t: TranslateNS<'sidebarComputer'>): ComputerActivity {
  const rows: ComputerAction[] = []
  for (const node of nodes) {
    const data = toolChatData(node)
    if (data === undefined) continue
    const root = data.root
    const name = callName(root)
    if (name === undefined || !name.startsWith(CUA_TOOL_PREFIX)) continue
    const settled = 'kind' in root
    const args = parseArgs(settled ? root.call?.argsRaw : root.phase === 'start' ? root.argsRaw : undefined)
    rows.push({
      callId: root.callId,
      seq: node.anchorSeq,
      tool: name.slice(CUA_TOOL_PREFIX.length),
      label: actionLabel(name, args, t),
      state: settled ? (root.isError ? 'error' : 'ok') : 'running',
      time: root.time,
      durationMs: settled && root.callTime !== null ? root.time - root.callTime : null,
      images: settled ? collectImages(root.content) : [],
    })
  }
  rows.sort((left, right) => right.seq - left.seq)
  const latest = rows.find(row => row.images.length > 0)
  return {
    items: rows.slice(0, MAX_ACTIONS),
    running: rows.some(row => row.state === 'running'),
    latestImage: latest?.images[0],
    hiddenCount: Math.max(0, rows.length - MAX_ACTIONS),
  }
}
