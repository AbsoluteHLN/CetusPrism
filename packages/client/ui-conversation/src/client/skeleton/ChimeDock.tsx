/**
 * Completion-chime dock: renders nothing and exists to observe the session's
 * `running` transition — when the agent finishes a turn (including a run that
 * completes the whole todo list), a short synthesized chime plays so a user
 * working elsewhere knows the task is done. WebAudio only: no audio assets,
 * and a blocked/suspended context degrades to silence (best-effort by
 * contract — the chime is a convenience, never a behavior).
 */
import { useEffect, useRef } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export interface ChimeDockProps {
  /** Session lifecycle snapshot selector (standard dock share). */
  useSession: PropsRuntime<'conversation.input.dock'>['useSession']
  /** Test seam: overrides the sound renderer. */
  play?: () => void
}

/** Module-scoped so repeated turns reuse one unlocked context. */
let audioContext: AudioContext | undefined

/**
 * Play the completion chime: a soft two-note bell (E5 → B5) synthesized on
 * the shared AudioContext. If the context cannot start (no user gesture yet,
 * no audio device), the chime is silently skipped.
 */
export function playCompletionChime(): void {
  try {
    audioContext ??= new AudioContext()
    if (audioContext.state === 'suspended') void audioContext.resume()
    const start = audioContext.currentTime
    for (const [frequency, at] of [[659.26, 0], [987.77, 0.12]] as const) {
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + at)
      gain.gain.exponentialRampToValueAtTime(0.15, start + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.5)
      oscillator.connect(gain).connect(audioContext.destination)
      oscillator.start(start + at)
      oscillator.stop(start + at + 0.55)
    }
  } catch (error) {
    // Best-effort: an unavailable audio device or blocked context must never
    // surface as an error from a finished turn.
    void error
  }
}

/** Observes the session's running flag and chimes on the running→idle edge. */
export function ChimeDock({ useSession, play = playCompletionChime }: ChimeDockProps): null {
  const running = useSession(snapshot => snapshot.running)
  const wasRunning = useRef(false)
  useEffect(() => {
    if (!running && wasRunning.current) play()
    wasRunning.current = running
  }, [running, play])
  return null
}

/** Props for the projected chime dock. */
export type ChimeDockEntryProps = PropsRuntime<'conversation.input.dock'>

/** Registers the completion-chime dock. */
export const chimeDockEntry = {
  name: 'conversation-chime-dock',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register({ name: 'conversation.input.dock', id: 'chime', order: 1 }, ChimeDock))
  },
}
