/** Convert a released V4 Session into the V5 generation without rewriting its body. */

import { defineSessionFormatMigration, SessionFormatError, SessionFormatUnsupportedMigrationError, isSessionFormatJsonObject, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatEventRun, SessionFormatMigrationContext, SessionFormatMigrationStage, SessionFormatMigrationStageInput } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header, validateDeliveryAccepted } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertReleasedV5Header } from './validation.ts'

/** Header-only migration declaration; the body conversion preserves every V4 event. */
export const sessionFormatV4ToV5 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v4-to-v5',
  fromVersion: 4,
  toVersion: 5,
  migrateHeader(header) {
    assertReleasedV4Header(header)
    return { ...header, version: 5 }
  },
  createStage(input) {
    return new ReleasedV4ToV5Stage(input)
  },
  validateTargetHeader: assertReleasedV5Header,
})

/**
 * One V4-to-V5 body stage. V5 widens one declared union and adds optional
 * payloads, so every released V4 event is already a valid V5 event and the
 * stage preserves sequence numbers, coordinates, references, and the cut.
 */
class ReleasedV4ToV5Stage implements SessionFormatMigrationStage {
  readonly headerInheritedEventCount?: number
  private cut: number | undefined
  private sourceCut: number | undefined
  private readonly mapping: number[] = []
  private foreignDeliverySeq: number | undefined

  constructor(private readonly input: SessionFormatMigrationStageInput) {
    this.cut = input.sourceHeader.isSeeded ? undefined : 0
    this.sourceCut = this.cut
    if (!input.sourceHeader.isSeeded) this.headerInheritedEventCount = 0
  }

  transformEvent(event: SessionFormatEvent, context: SessionFormatMigrationContext): void {
    if (event.seq !== this.mapping.length) throw new SessionFormatError('V4 source events must be dense')
    const targetSeq = this.mapping.length
    if (event.type === 'session-log-deepseek/delivery-accepted' && isSessionFormatJsonObject(event.data)
      && event.data['sessionFormatVersion'] === 5) {
      throw new SessionFormatUnsupportedMigrationError('format v4 delivery marker claims target format v5')
    }
    if (event.type === 'session/end-seed' && isSessionFormatJsonObject(event.data) && event.data['inherited'] === true) {
      this.sourceCut = event.seq
      this.cut = targetSeq
    }
    const deliveryId = validateDeliveryAccepted(event, 4)
    if (deliveryId !== undefined && deliveryId !== this.input.sourceHeader.id) this.foreignDeliverySeq = event.seq
    this.mapping.push(targetSeq)
    context.emitEvent(event)
  }

  transformRun(run: SessionFormatEventRun, context: SessionFormatMigrationContext): void {
    for (const event of run.expand()) this.transformEvent(event, context)
  }

  finish(_context: SessionFormatMigrationContext): number {
    const cut = sessionFormatCount(this.cut, 'V5 inherited event count')
    const sourceCut = sessionFormatCount(this.sourceCut, 'V4 source inherited event count')
    if (this.input.sourceInheritedEventCount !== undefined && sourceCut !== this.input.sourceInheritedEventCount) {
      throw new SessionFormatError('format v4 inherited cut disagrees with its source marker')
    }
    if (this.foreignDeliverySeq !== undefined
      && (this.input.sourceHeader.parentSession === undefined || this.foreignDeliverySeq >= sourceCut)) {
      throw new SessionFormatError('current-generation delivery marker names the wrong Session')
    }
    return cut
  }
}
