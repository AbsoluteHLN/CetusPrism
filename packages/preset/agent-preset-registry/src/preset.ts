import type { Volatile } from '@deepseek-ai/cordis'
/** Public preset roster and selection configuration. */
/** One declared preset and its current activation failure, if any. */
export interface AgentPreset {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly broken?: string
}

/** Registry selection policy. */
export interface Config {
  /** Deployment default when the caller omits a preset. */
  default: string
  /** User-selected default; edited through Settings. */
  selectedDefault: Volatile<string | undefined>
  /**
   * Explicit runtime executables, for the operators who installed an external
   * runtime outside the PATH. A runtime that is not named here is discovered
   * on the PATH, exactly like the upstream's own command.
   */
  externalRuntimes: Volatile<{
    /**
     * Absolute path or command name of the Pi runtime executable; the
     * deployment's own PATH lookup applies when this is omitted.
     */
    pi?: string
    /**
     * Absolute path or command name of the ZCode runtime executable; the
     * deployment's own PATH lookup applies when this is omitted.
     */
    zcode?: string
  } | undefined>
}
