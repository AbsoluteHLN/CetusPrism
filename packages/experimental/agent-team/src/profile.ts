/** Declared agent profiles: the reusable identities a Team may instantiate. */

import { TeamError } from './error.ts'
import type { AgentProfile, AgentProfileView } from './types.ts'
import { MEMBER_NAME } from './validation.ts'

/**
 * Normalize one declared profile into its stored shape.
 * @param profile - raw declared profile.
 * @returns the normalized profile.
 * @throws {TeamError} when the identity or name is unusable.
 */
function normalizeProfile(profile: AgentProfile): AgentProfile {
  const id = typeof profile.id === 'string' ? profile.id.trim() : ''
  const name = typeof profile.name === 'string' ? profile.name.trim() : ''
  const description = typeof profile.description === 'string' ? profile.description.trim() : ''
  if (!MEMBER_NAME.test(id)) {
    throw new TeamError('agent profile id must be lower-kebab-case', 'TEAM_INVALID_CONFIG')
  }
  if (!MEMBER_NAME.test(name) || name.length > 64 || name === 'lead') {
    throw new TeamError(
      'agent profile name must be lower-kebab-case, at most 64 characters, and not "lead"',
      'TEAM_INVALID_CONFIG',
    )
  }
  if (description.length === 0) {
    throw new TeamError(`agent profile "${id}" needs a description`, 'TEAM_INVALID_CONFIG')
  }
  const efforts = profile.allowedEfforts
    ?.map(effort => (typeof effort === 'string' ? effort.trim() : ''))
    .filter(effort => effort.length > 0)
  return {
    id,
    name,
    description,
    ...profile.backend === undefined ? {} : { backend: profile.backend.trim() },
    ...profile.provider === undefined ? {} : { provider: profile.provider.trim() },
    ...profile.model === undefined ? {} : { model: profile.model.trim() },
    ...efforts === undefined ? {} : { allowedEfforts: efforts },
    ...profile.preset === undefined ? {} : { preset: profile.preset.trim() },
  }
}

/**
 * The deployment's declared agent profiles.
 *
 * A profile is a deployment fact, not a session fact: the same identity can
 * be instantiated in any Team, and the instance records which profile it came
 * from so a later session can address it by id.
 */
export class AgentProfileRegistry {
  private readonly byId: Map<string, AgentProfile>

  /**
   * @param profiles - declared profiles, in declaration order.
   */
  constructor(profiles: readonly AgentProfile[] = []) {
    this.byId = new Map()
    for (const profile of profiles) {
      const normalized = normalizeProfile(profile)
      if (this.byId.has(normalized.id)) {
        throw new TeamError(`agent profile "${normalized.id}" is declared twice`, 'TEAM_INVALID_CONFIG')
      }
      this.byId.set(normalized.id, normalized)
    }
  }

  /**
   * List the declared profiles.
   * @returns detached profile views in declaration order.
   */
  list(): AgentProfileView[] {
    return [...this.byId.values()].map(profile => ({ ...profile }))
  }

  /**
   * Read one declared profile.
   * @param id - profile identity.
   * @returns the profile, or undefined when it is not declared.
   */
  get(id: string): AgentProfile | undefined {
    return this.byId.get(id.trim())
  }

  /**
   * Resolve one declared profile or fail with the missing identity.
   * @param id - profile identity.
   * @returns the declared profile.
   * @throws {TeamError} `TEAM_PROFILE_UNKNOWN` when no profile carries that id.
   */
  resolve(id: string): AgentProfile {
    const profile = this.get(id)
    if (profile === undefined) {
      throw new TeamError(`agent profile "${id}" is not declared`, 'TEAM_PROFILE_UNKNOWN')
    }
    return profile
  }
}
