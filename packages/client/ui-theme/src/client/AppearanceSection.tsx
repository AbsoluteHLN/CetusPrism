/** The Appearance section: one column rendering theme-feature item contributions. */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useHlnEnterMotion } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './AppearanceSection.module.css'

/** Full component props: section owner share plus item render share. */
export type AppearanceSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.appearance.item'>

/**
 * Render the Appearance section content column: the dedicated 皮肤/主题 page
 * the theme feature owns (HLN theme cards, background motion, conversation
 * font size). The column plays the shell's v3.2 enter motion on mount.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function AppearanceSection({ renderSlot }: AppearanceSectionComponentProps) {
  const motionScope = useHlnEnterMotion('panel')
  return (
    <div className={css.section} data-hln-motion="panel" ref={motionScope}>
      {renderSlot('settings.appearance.item', {})}
    </div>
  )
}
