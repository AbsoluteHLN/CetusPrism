/**
 * The composer's prompt history: the prompts one Session sent, and the cursor
 * that walks them.
 *
 * The walk is terminal-like. `older` steps back through the sent prompts,
 * `newer` steps forward again, and leaving the newest end restores the draft
 * that was in the editor before the walk started — so a wrong ↑ is undone by a
 * ↓, never by retyping. The walk is entered from the newest end and continues
 * across edits: a draft the user changed between two gestures is not a
 * remembered prompt, so the walk restarts from the newest one.
 *
 * The history is the composer's own record of what it sent, not a transcript
 * projection: it holds the clipboard form of the prompt (what the user typed),
 * so a recalled draft carries the reference labels they wrote rather than the
 * model form the send serialized.
 *
 * @module @deepseek-ai/dsh-client-ui-conversation/prompt-history
 */

/** How many sent prompts one Session keeps. */
const HISTORY_LIMIT = 100

/**
 * The prompt history of one Session.
 *
 * Package-private to the composer: the input shell owns the instance and the
 * keyboard face exposes only the two gestures.
 */
export class PromptHistory {
  /** The sent prompts, oldest first. */
  private readonly prompts: string[] = []
  /** The walk position while a gesture is in progress; null means "not walking". */
  private cursor: number | null = null
  /** The draft that stood in the editor when the walk began. */
  private pending: string | undefined
  /** The text the last gesture put into the editor. */
  private placed: string | undefined

  /**
   * Record one sent prompt.
   *
   * A prompt equal to the newest entry is not stored twice, and any walk in
   * progress ends: the newest prompt is now the one the user just sent.
   * @param text - the prompt text as the composer held it.
   */
  record(text: string): void {
    const prompt = text.trim()
    this.cursor = null
    this.pending = undefined
    this.placed = undefined
    if (prompt === '') return
    if (this.prompts[this.prompts.length - 1] === prompt) return
    this.prompts.push(prompt)
    if (this.prompts.length > HISTORY_LIMIT) this.prompts.shift()
  }

  /**
   * Step one prompt back.
   * @param current - the draft currently in the editor.
   * @param canStart - whether the gesture may begin a walk (the caret rule).
   * @returns the prompt to place in the editor, or undefined when the gesture does not apply.
   */
  older(current: string, canStart: boolean): string | undefined {
    if (this.prompts.length === 0) return undefined
    if (this.cursor === null) {
      if (!canStart) return undefined
      this.pending = current
      this.cursor = this.prompts.length - 1
      return this.place(this.prompts[this.cursor])
    }
    // A draft the user changed between gestures is not the remembered prompt:
    // the walk restarts from the newest end with the edited draft kept aside.
    if (current !== this.placed) {
      this.pending = current
      this.cursor = this.prompts.length - 1
      return this.place(this.prompts[this.cursor])
    }
    if (this.cursor === 0) return undefined
    this.cursor -= 1
    return this.place(this.prompts[this.cursor])
  }

  /**
   * Step one prompt forward; leaving the newest end restores the draft the
   * walk started from.
   * @returns the prompt to place in the editor, or undefined when the gesture does not apply.
   */
  newer(): string | undefined {
    if (this.cursor === null) return undefined
    const next = this.cursor + 1
    if (next >= this.prompts.length) {
      this.cursor = null
      const pending = this.pending ?? ''
      this.pending = undefined
      this.placed = undefined
      return pending
    }
    this.cursor = next
    return this.place(this.prompts[next])
  }

  /**
   * Whether a walk is in progress (the composer reads it to decide whether a
   * gesture continues the walk or starts one).
   */
  get walking(): boolean {
    return this.cursor !== null
  }

  /**
   * Remember the text a gesture placed, so the next gesture can tell an
   * untouched recalled draft from an edited one.
   * @param text - the text placed in the editor.
   */
  private place(text: string | undefined): string | undefined {
    if (text === undefined) return undefined
    this.placed = text
    return text
  }
}
