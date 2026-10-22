/** Versioned built-in agent selection protocol and file-backed configuration. */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parseBuiltinAgentBackend, type BuiltinAgentBackendId } from './backend.ts'

/** The first wire-compatible built-in agent protocol revision. */
export const BUILTIN_AGENT_PROTOCOL_VERSION = 1
/** Release that introduced the protocol. */
export const BUILTIN_AGENT_RELEASE = '1.7.0-beta.1'

/** Stable identity for a built-in agent. */
export type BuiltinAgentId = string & { readonly __builtinAgentId: unique symbol }

/** Driver names reserved by the protocol. Unknown names remain forward-compatible. */
export type BuiltinAgentDriver = 'native' | 'zcode' | 'antigravity' | (string & {})

/** Compatibility declaration supplied by an agent driver. */
export interface BuiltinAgentCompatibility {
  readonly protocolVersion: number
  readonly minCetusPrismVersion?: string
  readonly maxCetusPrismVersion?: string
}

/** Persisted declaration for one selectable model-driven agent. */
export interface BuiltinAgentDeclaration {
  readonly id: BuiltinAgentId
  readonly enabled: boolean
  readonly driver: BuiltinAgentDriver
  readonly version: string
  readonly source: string
  readonly compatibility: BuiltinAgentCompatibility
}

/** Persisted v1 configuration. It intentionally has no credential or runtime fields. */
export interface BuiltinAgentConfig {
  readonly schemaVersion: 1
  readonly release: typeof BUILTIN_AGENT_RELEASE
  readonly installDirectory: string
  /** Default backend for a newly created Session; omitted legacy files mean DSH. */
  readonly defaultBackend?: BuiltinAgentBackendId
  readonly agents: readonly BuiltinAgentDeclaration[]
}

/** A validated update to the persisted configuration. */
export type BuiltinAgentConfigInput = Omit<BuiltinAgentConfig, 'schemaVersion' | 'release'>

/** Error raised when a persisted or requested configuration violates the protocol. */
export class BuiltinAgentConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuiltinAgentConfigError'
  }
}

const forbiddenPrivateFields = ['credential', 'credentials', 'runtime', 'privateConfig'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new BuiltinAgentConfigError(`${field} must be a non-empty string`)
  return value
}

function agentId(value: unknown): BuiltinAgentId {
  return nonEmptyString(value, 'agents[].id') as BuiltinAgentId
}

function parseCompatibility(value: unknown): BuiltinAgentCompatibility {
  if (!isRecord(value) || typeof value.protocolVersion !== 'number' || !Number.isInteger(value.protocolVersion) || value.protocolVersion < 1) {
    throw new BuiltinAgentConfigError('agents[].compatibility.protocolVersion must be a positive integer')
  }
  const result: BuiltinAgentCompatibility = {
    protocolVersion: value.protocolVersion,
    ...(value.minCetusPrismVersion === undefined ? {} : { minCetusPrismVersion: nonEmptyString(value.minCetusPrismVersion, 'agents[].compatibility.minCetusPrismVersion') }),
    ...(value.maxCetusPrismVersion === undefined ? {} : { maxCetusPrismVersion: nonEmptyString(value.maxCetusPrismVersion, 'agents[].compatibility.maxCetusPrismVersion') }),
  }
  return result
}

function parseDeclaration(value: unknown): BuiltinAgentDeclaration {
  if (!isRecord(value) || typeof value.enabled !== 'boolean') throw new BuiltinAgentConfigError('each agent must declare a boolean enabled field')
  if (forbiddenPrivateFields.some(key => key in value)) throw new BuiltinAgentConfigError('agent declarations cannot contain credentials, runtime, or private configuration')
  return {
    id: agentId(value.id),
    enabled: value.enabled,
    driver: nonEmptyString(value.driver, 'agents[].driver'),
    version: nonEmptyString(value.version, 'agents[].version'),
    source: nonEmptyString(value.source, 'agents[].source'),
    compatibility: parseCompatibility(value.compatibility),
  }
}

/**
 * Validate and normalize a protocol document from a file or caller.
 * @param value - untrusted public configuration document.
 * @returns the validated public fields.
 */
export function validateBuiltinAgentConfig(value: unknown): BuiltinAgentConfig {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.release !== BUILTIN_AGENT_RELEASE) {
    throw new BuiltinAgentConfigError(`expected schemaVersion 1 and release ${BUILTIN_AGENT_RELEASE}`)
  }
  if (forbiddenPrivateFields.some(key => key in value)) throw new BuiltinAgentConfigError('built-in agent configuration cannot contain credentials, runtime, or private configuration')
  if (!Array.isArray(value.agents)) throw new BuiltinAgentConfigError('agents must be an array')
  const agents = value.agents.map(parseDeclaration)
  const ids = new Set<string>()
  for (const agent of agents) {
    if (ids.has(agent.id)) throw new BuiltinAgentConfigError(`duplicate agent id: ${agent.id}`)
    ids.add(agent.id)
  }
  return {
    schemaVersion: 1,
    release: BUILTIN_AGENT_RELEASE,
    installDirectory: nonEmptyString(value.installDirectory, 'installDirectory'),
    ...(value.defaultBackend === undefined ? {} : { defaultBackend: parseBuiltinAgentBackend(value.defaultBackend) }),
    agents,
  }
}

function encode(config: BuiltinAgentConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

/** File-backed configuration with validation, atomic commits, and one-step rollback. */
export class BuiltinAgentConfigStore {
  /** Location of the previous valid configuration generation. */
  readonly backupPath: string

  constructor(readonly configPath: string) {
    this.backupPath = `${configPath}.bak`
  }

  /**
   * Return the first-install default, beside the configuration file.
   * @returns an empty configuration without creating files.
   */
  defaultConfig(): BuiltinAgentConfig {
    return { schemaVersion: 1, release: BUILTIN_AGENT_RELEASE, installDirectory: dirname(this.configPath), defaultBackend: 'dsh', agents: [] }
  }

  /**
   * Read the current valid configuration, falling back to the last committed copy.
   * @returns the current or recoverable previous configuration.
   */
  async load(): Promise<BuiltinAgentConfig> {
    try {
      return validateBuiltinAgentConfig(JSON.parse(await readFile(this.configPath, 'utf8')))
    } catch (error) {
      try {
        return validateBuiltinAgentConfig(JSON.parse(await readFile(this.backupPath, 'utf8')))
      } catch (backupError) {
        // The current file's validation error is more useful when no backup exists.
        void backupError
        if (error instanceof BuiltinAgentConfigError) throw error
        throw new BuiltinAgentConfigError(`unable to load built-in agent configuration: ${String(error)}`)
      }
    }
  }

  /**
   * Atomically save a validated configuration and retain the previous copy for rollback.
   * @param input - public directory and agent declarations to save.
   * @returns the committed configuration.
   */
  async save(input: BuiltinAgentConfigInput): Promise<BuiltinAgentConfig> {
    const next = validateBuiltinAgentConfig({ ...input, schemaVersion: 1, release: BUILTIN_AGENT_RELEASE })
    await mkdir(dirname(this.configPath), { recursive: true, mode: 0o700 })
    await withFileLock(this.configPath, async () => {
      let current: BuiltinAgentConfig | undefined
      try { current = await this.load() } catch (error) {
        // First install has no prior document to retain.
        void error
      }
      if (current !== undefined) await writeFileAtomic(this.backupPath, encode(current), { mode: 0o600 })
      await writeFileAtomic(this.configPath, encode(next), { mode: 0o600 })
    })
    return next
  }

  /**
   * Restore the previous valid configuration and keep the current one as the next rollback point.
   * @returns the restored configuration.
   */
  async rollback(): Promise<BuiltinAgentConfig> {
    return await withFileLock(this.configPath, async () => {
      const previous = validateBuiltinAgentConfig(JSON.parse(await readFile(this.backupPath, 'utf8')))
      let current: BuiltinAgentConfig | undefined
      try { current = await this.load() } catch (error) {
        // The backup is the only recoverable generation.
        void error
      }
      if (current !== undefined) await writeFileAtomic(this.backupPath, encode(current), { mode: 0o600 })
      await writeFileAtomic(this.configPath, encode(previous), { mode: 0o600 })
      return previous
    })
  }
}

/**
 * Build a declaration without accepting driver-private configuration.
 * @param input - public driver metadata and enabled state.
 * @returns the validated declaration.
 */
export function defineBuiltinAgent(input: Omit<BuiltinAgentDeclaration, 'id'> & { id: string }): BuiltinAgentDeclaration {
  return parseDeclaration(input)
}

/**
 * Default location for a first-install agent directory.
 * @param configPath - location of the public configuration file.
 * @returns its containing directory.
 */
export function defaultBuiltinAgentDirectory(configPath: string): string {
  return dirname(configPath)
}
