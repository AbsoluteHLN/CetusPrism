/** V5 framing with the released V4 row admission and the V5 header generation. */

import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatCodec, SessionFormatCurrentEncoder, SessionFormatHeader, SessionFormatEvent } from '@deepseek-ai/dsh-session-format'
import { releasedV2SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { assertV4RowAdmission } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertReleasedV5Header } from './validation.ts'

function physicalV5(value: unknown): SessionFormatHeader {
  if (!isSessionFormatJsonObject(value) || value['version'] !== 5) throw new SessionFormatError('expected format v5 physical header')
  return { ...value, version: 2 } as SessionFormatHeader
}

/**
 * V5 physical encoder and decoder retain the released row framing while
 * admitting every released V4 event payload unchanged.
 */
export const releasedV5SessionFormatCodec = Object.freeze({
  version: 5,
  decodeHeader(value: unknown) {
    return { ...releasedV2SessionFormatCodec.decodeHeader(physicalV5(value)), version: 5 }
  },
  createDecoder(value, recovery) {
    const decoder = releasedV2SessionFormatCodec.createDecoder(physicalV5(value), recovery)
    return {
      ...decoder,
      header: { ...decoder.header, version: 5 },
      decodeRow(row, context) {
        assertV5RowAdmission(row)
        decoder.decodeRow(row, {
          emitRun: context.emitRun.bind(context),
          emitEvent: context.emitEvent.bind(context),
        })
      },
    }
  },
  encodeHeader(header, inheritedEventCount) {
    assertReleasedV5Header(header)
    return { ...releasedV2SessionFormatCodec.encodeHeader({ ...header, version: 2 }, inheritedEventCount), version: 5 }
  },
  encodeEvent(event: SessionFormatEvent) {
    assertV5RowAdmission(event)
    return releasedV2SessionFormatCodec.encodeEvent(event)
  },
} satisfies SessionFormatCodec & SessionFormatCurrentEncoder)

/**
 * Apply native V5 admission to one physical row.
 * V5 adds no native admission rule: every V5 payload is a released V4 payload,
 * so the released V4 admission decides the row unchanged.
 * @param row - parsed physical row before framing and source-event range decoding.
 */
export function assertV5RowAdmission(row: unknown): void {
  assertV4RowAdmission(row)
}
