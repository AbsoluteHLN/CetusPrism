/**
 * Per-session computer-use delivery policy (ctx.computerUseDeliveryPolicy):
 * whether computer-use input tools may take the window foreground. The
 * session log is the store — the same pattern as the sandbox-mode override:
 * a runtime switch appends exactly one `computer-use/delivery` event,
 * `effective = projection state ?? the composition default`, so an override
 * survives restart by replay, two sessions never see each other's state, and
 * there is no external config store. Providers read
 * {@link ComputerUseDeliveryPolicy.modeOf} once per tool call and enforce it
 * on their delivery arguments; the client toggle writes through the
 * `/foreground` command so both surfaces share one write path and the pushed
 * projection frame is the one confirmation. The model has no write path: the
 * policy is user-owned.
 *
 * @module @deepseek-ai/dsh-computer-use-policy
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import z from '@deepseek-ai/schemastery'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
// Type-only: pulls the ctx.commands merge (the optional /foreground write path)
// and the ctx.sessionProjections merge into this program.
import type {} from '@deepseek-ai/dsh-commands'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  COMPUTER_USE_DELIVERY_MODES,
  type ComputerDeliveryView,
  type ComputerUseDeliveryMode,
} from './types.ts'

export {
  COMPUTER_USE_DELIVERY_MODES,
  type ComputerDeliveryView,
  type ComputerUseDeliveryMode,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    computerUseDeliveryPolicy: ComputerUseDeliveryPolicy
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's computer-use delivery policy was switched — log-only
     * (like `sandbox/mode`; NOT a surface event): durable and replayable,
     * never in the model transcript. The LAST such event is the session's
     * override (folded by the `computerDelivery` projection unit); the
     * composition default applies before one. Providers honor the fold at
     * their next tool call.
     * @param mode - the delivery mode every subsequent computer-use input
     *   call in this session runs under, until the next switch.
     */
    'computer-use/delivery': { mode: ComputerUseDeliveryMode }
  }
}

/** The delivery-mode projection's state schema (state equals the mode or null). */
const deliveryStateSchema: zod.ZodType<ComputerUseDeliveryMode | null> = zod.union([
  zod.literal('allow-foreground'),
  zod.literal('background-only'),
]).nullable()

/** Runtime validation of one untrusted delivery-mode string (the `/foreground` argument). */
function isComputerUseDeliveryMode(value: string): value is ComputerUseDeliveryMode {
  return (COMPUTER_USE_DELIVERY_MODES as readonly string[]).includes(value)
}

const deliveryViewSchema: zod.ZodType<ComputerDeliveryView> = zod.object({
  mode: zod.union([
    zod.literal('allow-foreground'),
    zod.literal('background-only'),
  ]),
})

/** Plugin config: the composition default beneath a session override. */
export interface Config {
  /** Mode a session runs under before a `/foreground` override (default: `allow-foreground`). */
  defaultMode?: ComputerUseDeliveryMode
}

/**
 * Owns the per-session computer-use delivery policy. Registers the
 * `computerDelivery` projection unit and the `/foreground` command; the
 * command activates only when a command registry is composed.
 */
export class ComputerUseDeliveryPolicy extends Service {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    defaultMode: z.union(['allow-foreground', 'background-only'] as const).default('allow-foreground'),
  })

  static inject = ['sessionProjections']

  /** The composition default mode — the fallback beneath a session override. */
  readonly defaultMode: ComputerUseDeliveryMode

  constructor(ctx: Context, config: Config) {
    super(ctx, 'computerUseDeliveryPolicy')
    // schemastery (static Config) already filled the union; the cast records that runtime fact.
    this.defaultMode = config.defaultMode as ComputerUseDeliveryMode

    ctx.sessionProjections.register({
      key: 'computerDelivery',
      stateVersion: 1,
      stateSchema: deliveryStateSchema,
      init: () => null,
      apply: (state, event) => (event.type === 'computer-use/delivery' ? event.data.mode : state),
      wire: {
        viewSchema: deliveryViewSchema,
        view: state => ({ mode: state ?? this.defaultMode }),
      },
    })

    // The /foreground command: the one write path a web client uses (the
    // composer toggle submits the picked mode as this line).
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        definitionId: CommandDefinitionId('@deepseek-ai/dsh-computer-use-policy'),
        name: 'foreground',
        description: 'Switch whether computer use may take the window foreground',
        input: { hint: '<allow-foreground | background-only>' },
        handler: ({ agent, rawInput }) => {
          const value = rawInput.trim()
          if (value === '') {
            return { kind: 'success', text: `current delivery ${this.modeOf(agent.session)}` }
          }
          if (!isComputerUseDeliveryMode(value)) {
            return { kind: 'error', text: `unknown delivery "${value}" (available: ${COMPUTER_USE_DELIVERY_MODES.join(', ')})` }
          }
          setComputerUseDelivery(agent.session, value)
          return { kind: 'success', text: `delivery ${value}` }
        },
      })
    })
  }

  /**
   * The session's effective delivery mode: the last `computer-use/delivery`
   * event, or the composition default.
   * @param session - the session whose log supplies the override.
   * @returns the mode every computer-use call in this session runs under.
   */
  modeOf(session: Session): ComputerUseDeliveryMode {
    return this.ctx.sessionProjections.stateOf(session, 'computerDelivery') ?? this.defaultMode
  }
}

/**
 * THE write path for a session's delivery-mode override: appends exactly one
 * `computer-use/delivery` event — the switch IS its event; nothing mutates
 * mode state out of band. Takes effect on the session's next computer-use
 * tool call (consumers read the shared projection state).
 * @param session - the session the override belongs to.
 * @param mode - the delivery mode every subsequent computer-use input call in
 *   this session runs under (until the next switch).
 */
export function setComputerUseDelivery(session: Session, mode: ComputerUseDeliveryMode): void {
  session.append('computer-use/delivery', { mode })
}

export default ComputerUseDeliveryPolicy
