/**
 * The composer's prompt history: what it records, how the gestures walk it,
 * and what a stray edit does to the walk.
 */

import { describe, expect, it } from 'vitest'
import { PromptHistory } from '../src/client/input/prompt-history.ts'

describe('the composer prompt history', () => {
  it('recalls the newest prompt first and steps back through the older ones', () => {
    const history = new PromptHistory()
    history.record('first prompt')
    history.record('second prompt')

    expect(history.older('draft', true)).toBe('second prompt')
    expect(history.older('second prompt', true)).toBe('first prompt')
    // The oldest end holds: there is nothing older to step to.
    expect(history.older('first prompt', true)).toBeUndefined()
  })

  it('restores the draft that stood before the walk when it leaves the newest end', () => {
    const history = new PromptHistory()
    history.record('sent prompt')

    expect(history.older('unsent draft', true)).toBe('sent prompt')
    expect(history.newer()).toBe('unsent draft')
    // The walk is over: a further gesture has nothing to walk.
    expect(history.newer()).toBeUndefined()
  })

  it('walks forward again without leaving the walk', () => {
    const history = new PromptHistory()
    history.record('older prompt')
    history.record('newer prompt')

    history.older('draft', true)
    history.older('newer prompt', true)
    expect(history.newer()).toBe('newer prompt')
    expect(history.newer()).toBe('draft')
  })

  it('records nothing for an empty prompt and no repeat of the newest one', () => {
    const history = new PromptHistory()
    history.record('   ')
    expect(history.older('', true)).toBeUndefined()

    history.record('same prompt')
    history.record('same prompt')
    history.older('', true)
    // One entry only: the repeat did not stack.
    expect(history.older('same prompt', true)).toBeUndefined()
  })

  it('starts the walk only when the gesture may begin one', () => {
    const history = new PromptHistory()
    history.record('sent prompt')

    expect(history.older('draft', false)).toBeUndefined()
    expect(history.older('draft', true)).toBe('sent prompt')
  })

  it('restarts the walk when the draft changed between gestures', () => {
    const history = new PromptHistory()
    history.record('older prompt')
    history.record('newer prompt')

    expect(history.older('draft', true)).toBe('newer prompt')
    // The user edited the recalled prompt: the walk restarts from the newest.
    expect(history.older('edited prompt', true)).toBe('newer prompt')
  })

  it('forgets the walk when a new prompt is recorded', () => {
    const history = new PromptHistory()
    history.record('sent prompt')
    history.older('draft', true)

    history.record('another prompt')

    expect(history.walking).toBe(false)
    expect(history.older('draft', true)).toBe('another prompt')
  })
})
