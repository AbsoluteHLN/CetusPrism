/**
 * Pure types of the computer-use delivery domain: the ONE home of the
 * `computerDelivery` projection-key declarations and the delivery-mode union,
 * free of this package's host-side value imports. The package root re-exports
 * them for host consumers; client aggregates re-export from here.
 *
 * @module @deepseek-ai/dsh-computer-use-policy/types
 */

/**
 * Whether computer-use input tools may take the window foreground in one
 * session. `allow-foreground` preserves the driver's own per-call choice
 * (background delivery stays the advertised default); `background-only`
 * rewrites every foreground request to background delivery before the
 * provider sees it, so an unsupported background route refuses instead of
 * activating a window.
 */
export type ComputerUseDeliveryMode = 'allow-foreground' | 'background-only'

/** Every {@link ComputerUseDeliveryMode}, for advertisement and runtime validation of untrusted mode strings. */
export const COMPUTER_USE_DELIVERY_MODES: readonly ComputerUseDeliveryMode[] = ['allow-foreground', 'background-only']

/** Whole `computerDelivery` Session projection view: the effective mode only. */
export interface ComputerDeliveryView {
  /** The last override, or the composition default before one. */
  mode: ComputerUseDeliveryMode
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The session's computer-use delivery policy, folded from the
     * `computer-use/delivery` event over the composition default. Key absence
     * means no delivery-policy service is composed — clients hide the control.
     */
    computerDelivery: ComputerDeliveryView
  }

  interface SessionProjectionStateMap {
    /** Last `computer-use/delivery` payload, or null before one. */
    computerDelivery: ComputerUseDeliveryMode | null
  }
}
