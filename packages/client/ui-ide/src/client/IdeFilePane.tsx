/**
 * The IDE center column: code editing or a read-only media preview.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { IdeFile } from './ide-model.ts'
import { ideViewUsesTextRead, type IdeViewKind } from './ide-view-kind.ts'
import { IdeCodeEditor } from './IdeCodeEditor.tsx'
import css from './IdeWorkspace.module.css'
import type { IdeKey } from './locales.ts'

/** Props for the center file surface. */
export interface IdeFilePaneProps {
  readonly file: IdeFile
  readonly onChange: (content: string) => void
  readonly onSave: () => void
  readonly onCursor?: (line: number, column: number) => void
  readonly t: (key: IdeKey) => string
}

type PreviewMode = 'source' | 'preview'

/**
 * Whether one kind offers a source/preview toggle.
 * @param kind - the file's view kind.
 * @returns true when the toolbar should appear.
 */
function hasPreviewToggle(kind: IdeViewKind): boolean {
  return kind === 'markdown' || kind === 'html'
}

/**
 * Render the active file in the center column.
 * @param props - the open file and edit/save callbacks.
 * @returns the editor or viewer surface.
 */
export function IdeFilePane(props: IdeFilePaneProps): ReactNode {
  const { file, onChange, onSave, onCursor, t } = props
  const kind = file.viewKind ?? 'text'
  const [previewMode, setPreviewMode] = useState<PreviewMode>('source')

  const labels: MarkdownLabels = useMemo(() => ({
    code: { copyLabel: t('code.copy'), copiedLabel: t('code.copied') },
    footnotes: 'Footnotes',
  }), [t])

  const preview = useMemo(() => {
    if (kind === 'markdown') {
      return <div className={css.markdownPreview}><MarkdownText text={file.content} labels={labels} /></div>
    }
    if (kind === 'html') {
      return (
        <iframe
          className={css.htmlPreview}
          title={t('viewer.html')}
          sandbox=""
          srcDoc={file.content}
        />
      )
    }
    return null
  }, [file.content, kind, labels, t])

  if (ideViewUsesTextRead(kind)) {
    return (
      <div className={css.filePane} data-ide-file-pane="">
        {hasPreviewToggle(kind) && (
          <div className={css.viewerToolbar} role="tablist" aria-label={t('viewer.mode.aria')}>
            <button
              type="button"
              role="tab"
              className={css.viewerMode}
              data-active={previewMode === 'source'}
              aria-selected={previewMode === 'source'}
              onClick={() => { setPreviewMode('source') }}
            >
              {t('viewer.mode.source')}
            </button>
            <button
              type="button"
              role="tab"
              className={css.viewerMode}
              data-active={previewMode === 'preview'}
              aria-selected={previewMode === 'preview'}
              onClick={() => { setPreviewMode('preview') }}
            >
              {t('viewer.mode.preview')}
            </button>
          </div>
        )}
        {previewMode === 'preview' && hasPreviewToggle(kind)
          ? preview
          : (
            <IdeCodeEditor
              content={file.content}
              language={file.language}
              onChange={onChange}
              onSave={onSave}
              {...(onCursor !== undefined ? { onCursor } : {})}
              ariaLabel={t('code.aria')}
            />
          )}
      </div>
    )
  }

  const url = file.mediaUrl
  if (url === undefined) {
    return (
      <div className={css.empty}>
        <p className={css.emptyTitle}>{t('viewer.empty')}</p>
      </div>
    )
  }

  return (
    <div className={css.filePane} data-ide-file-pane="" data-ide-viewer={kind}>
      {kind === 'image' && (
        <p className={css.viewerFit}>
          <img className={css.viewerImage} src={url} alt={file.name} />
        </p>
      )}
      {kind === 'pdf' && (
        <iframe className={css.viewerEmbed} title={file.name} src={url} />
      )}
      {kind === 'video' && (
        <video className={css.viewerEmbed} controls src={url}>
          <track kind="captions" />
        </video>
      )}
      {kind === 'audio' && (
        <div className={css.viewerAudioShell}>
          <audio className={css.viewerAudio} controls src={url}>
            <track kind="captions" />
          </audio>
        </div>
      )}
    </div>
  )
}