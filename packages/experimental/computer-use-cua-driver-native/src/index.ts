/**
 * Computer use through the in-process Cua Driver native SDK and its own tools.
 * @module @deepseek-ai/dsh-experimental-computer-use-cua-driver-native
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { ComputerUseProviderName } from '@deepseek-ai/dsh-computer-use/brand'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { z } from 'zod'
import type { CuaDriver as NativeDriver } from '@trycua/cua-driver'
import type {} from '@deepseek-ai/dsh-computer-use'
import type { ComputerUseDeliveryMode } from '@deepseek-ai/dsh-computer-use-policy'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

/** Cordis plugin identity for the native Cua Driver provider. */
export const name = 'experimental-computer-use-cua-driver-native'

/** Services required before the native runtime can publish tools. */
export const inject = ['computerUse', 'tools', 'systemPrompt']

/** The native provider uses the installed SDK's same-process defaults. */
export const Config = Schema.object({})

const ToolCatalog = z.object({
  tools: z.array(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.unknown().optional(),
  })),
})

/** DeepSeek's function-name alphabet and maximum length are protocol constants. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/u

/** Native catalog tools that inspect desktop or SDK state without changing it. */
const BACKGROUND_ONLY_READ_TOOLS: ReadonlySet<string> = new Set([
  'list_apps',
  'list_windows',
  'get_window_state',
  'verify_state',
  'debug_window_info',
  'clipboard_read',
  'get_screen_size',
  'get_desktop_state',
  'get_cursor_position',
  'get_agent_cursor_state',
  'check_permissions',
  'health_report',
  'get_config',
  'get_accessibility_tree',
  'zoom',
  'get_browser_state',
  'get_recording_state',
  'get_session',
  'list_sessions',
  'get_session_state',
])

const GUIDANCE = `Cua Driver native computer-use tools operate the host desktop. Discover the exact app and window, then get a fresh window snapshot before acting. Use element_token from that snapshot, or coordinates from its screenshot. A new snapshot of that window invalidates its earlier element tokens. Select either target or the legacy pid/window_id fields; do not combine them.

Prefer background delivery. A refusal does not authorize a foreground retry. Verify the requested outcome from fresh state after an action; a delivered click alone does not prove the outcome. After cancellation, inspect current state before retrying because completed input is not rolled back. Other sessions and applications may change the same desktop.

On macOS, cursor-overlay operations may return facility_unavailable even when screenshots and input work.`

/**
 * Own one native runtime and expose its catalog through the MCP result adapter.
 * Startup failures roll back every registration. Unload removes tools, aborts
 * calls and image admission, awaits settlement and SDK shutdown, then releases computer use.
 * Calls use the optional delivery policy per agent session; without an agent,
 * they use its composition default. An absent policy preserves SDK arguments.
 * @param ctx - context providing the exclusive registration and tool services.
 * @returns after native import, runtime creation, and tool discovery complete.
 */
export async function apply(ctx: Context): Promise<void> {
  const lifetime = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let driver: NativeDriver | undefined
  // Cordis announces disposal before it awaits asynchronous plugin startup.
  ctx.on('internal/plugin', (fiber) => {
    if (fiber === ctx.fiber && fiber.uid === null) lifetime.abort()
  }, { global: true })
  let ready: Promise<void> = Promise.resolve()
  const dispose = ctx.effect(function* () {
    yield ctx.computerUse.register(ComputerUseProviderName('cua-driver-native'))
    yield async () => {
      lifetime.abort()
      // apply() reports startup failure; teardown still owns its native handle.
      await ready.catch(() => {})
      await Promise.allSettled(pending)
      if (driver !== undefined) {
        await driver.shutdown()
        driver.uniffiDestroy()
      }
    }
    const child = ctx.plugin({
      name: 'computer-use-cua-driver-native-runtime',
      inject: ['tools', 'systemPrompt'],
      apply: mountRuntime,
    })
    yield child.dispose
    ready = Promise.resolve(child).then(() => {})
  }, 'computer-use-cua-driver-native.runtime')
  try {
    await ready
  } catch (error) {
    await dispose()
    throw error
  }

  /** The child owns tool registrations; the outer effect owns native teardown. */
  async function mountRuntime(inner: Context): Promise<void> {
    const { CuaDriver } = await import('@trycua/cua-driver')
    lifetime.signal.throwIfAborted()
    // The generated constructor returns its class with an owned binding handle,
    // but declares only CuaDriverLike, which omits uniffiDestroy().
    const activeDriver = driver = CuaDriver.create(undefined) as NativeDriver
    const catalog = ToolCatalog.parse(JSON.parse(await activeDriver.listToolsJson({ signal: lifetime.signal })))
    lifetime.signal.throwIfAborted()
    const names = new Set<string>()
    for (const tool of catalog.tools) {
      const publicName = `cua_driver_native__${tool.name}`
      if (!TOOL_NAME.test(publicName)) {
        throw new Error(`Cua Driver tool "${tool.name}" exceeds the supported function-name format`)
      }
      if (names.has(publicName)) throw new Error(`Cua Driver listed tool "${tool.name}" more than once`)
      names.add(publicName)
      const definition = createMcpToolDefinition(inner, {
        name: publicName,
        rawName: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        async call(args, execution) {
          const combined = AbortSignal.any([execution.signal, lifetime.signal])
          combined.throwIfAborted()
          const policy = inner.get('computerUseDeliveryPolicy')
          const mode = policy === undefined
            ? undefined
            : execution.agent === undefined
              ? policy.defaultMode
              : policy.modeOf(execution.agent.session)
          const callArguments = applyDeliveryPolicy(tool.name, tool.inputSchema, args, mode)
          const result = await activeDriver.callTool(tool.name, JSON.stringify(callArguments), { signal: combined })
          combined.throwIfAborted()
          const value: unknown = JSON.parse(result.rawJson)
          return tool.name === 'get_window_state' ? exposeWindowHandles(value) : value
        },
      })
      inner.tools.register(definition)
    }
    inner.on('tools/execute', async (exec, next) => {
      if (!names.has(exec.name)) return next()
      const upstream = exec.signal
      exec.signal = AbortSignal.any([upstream, lifetime.signal])
      const operation = Promise.resolve().then(next)
      pending.add(operation)
      try {
        return await operation
      } finally {
        pending.delete(operation)
        exec.signal = upstream
      }
    })
    inner.systemPrompt.section({
      name: 'computer-use:cua-driver-native',
      order: inner.systemPrompt.getSectionOrder('TOOL_COMPUTER_USE'),
      text: GUIDANCE,
    })
  }
}

/** Enforce background-only delivery using the active SDK catalog and known read-only tools. */
function applyDeliveryPolicy(
  name: string,
  inputSchema: Record<string, unknown>,
  args: Record<string, unknown>,
  mode: ComputerUseDeliveryMode | undefined,
): Record<string, unknown> {
  if (mode !== 'background-only') return args
  if (supportsBackgroundDelivery(inputSchema)) return { ...args, delivery_mode: 'background' }
  if (BACKGROUND_ONLY_READ_TOOLS.has(name)) return args
  throw new Error(`Computer-use delivery policy "background-only" rejects Cua Driver tool "${name}" without a background delivery route`)
}

/** Read the optional background enum from one SDK tool's advertised input schema. */
function supportsBackgroundDelivery(inputSchema: Record<string, unknown>): boolean {
  const properties = inputSchema.properties
  if (!isRecord(properties)) return false
  const deliveryMode = properties.delivery_mode
  return isRecord(deliveryMode) && Array.isArray(deliveryMode.enum) && deliveryMode.enum.includes('background')
}

/** Add the native snapshot handles to model-visible content without changing canonical fields. */
function exposeWindowHandles(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.content) || !isRecord(value.structuredContent)) return value
  const text = windowHandleText(value.structuredContent)
  if (text === undefined) return value
  return { ...value, content: [...value.content, { type: 'text', text }] }
}

/** Project native action handles as an index map without copying the full tree. */
function windowHandleText(structured: Record<string, unknown>): string | undefined {
  if (!Array.isArray(structured.elements)) return undefined
  const lines = structured.elements.flatMap((element) => {
    if (!isRecord(element) || typeof element.element_index !== 'number'
      || !Number.isInteger(element.element_index) || typeof element.element_token !== 'string') return []
    return [`${element.element_index} -> ${JSON.stringify(element.element_token)}`]
  })
  if (lines.length === 0) return undefined
  return `Cua Driver element_index to element_token (valid until this window is snapshotted again):\n${lines.join('\n')}`
}

/** Narrow parsed native JSON without trusting its fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
