/**
 * Suites the local pre-push checkpoint leaves to CI.
 *
 * Membership rule: a suite qualifies when its verdict depends on host-level
 * behaviour that a bulk local run cannot guarantee. The Windows console probe
 * owns a freshly allocated console and asks Windows to deliver a control
 * event through it; once the host runs many suites at once that delivery is
 * not reliable, and the probe reports a signal that never reached the child
 * even though the child booted and the event was generated. Such a verdict
 * describes the host, not the change being pushed.
 *
 * A listed suite still runs in the ordinary test run and in CI, which owns
 * the full repository-wide gate matrix. Only the local checkpoint leaves it
 * out.
 *
 * @module scripts/checkpoint-exempt
 */

/** Env var the local checkpoint sets to leave the listed suites to CI. */
export const CHECKPOINT_EXEMPT_ENV = 'DSH_CHECKPOINT_EXEMPT_SUITES'

/** Suites the local pre-push checkpoint leaves to CI; keep the paths exact. */
export const checkpointExemptSuites: readonly string[] = [
  'apps/desktop/tests/windows-cli-signals.spec.ts',
]
