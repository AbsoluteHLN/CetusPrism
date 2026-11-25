/**
 * The IDE workspace surface: the project tree on the left, the code in the
 * middle and the bound Session's assistant conversation on the right.
 *
 * The surface is CONTROLLED: it reads the workspace state from the store it
 * is handed and calls back with the verbs, so the same surface serves the web
 * client, the desktop shell and the tests. It owns no data source of its own
 * — the file contents and the tree arrive through the injected face.
 *
 * The three columns are independent of the conversation frame the app shows
 * in the central column: the IDE IS that central panel, and the assistant
 * beside the code is a second, explicitly bound occurrence of the shared
 * Conversation content.
 *
 * The surface carries its OWN title bar: opening the IDE replaces the
 * conversation frame, so the title bar is what says what is on screen — the
 * IDE, the Session it belongs to and the project it shows. It is built from
 * the application's own central-panel header (the session title as the
 * current crumb, the project path as its ancestors), so the IDE reads as a
 * panel of this product rather than as a second product. The columns then
 * read as columns, each with a section label of its own, and the two seams
 * between them can be dragged, because a workbench whose widths are welded
 * shut is a screenshot.
 *
 * The WIDTHS are the editor's first: the code column is what the workbench
 * exists for, so the side columns may not eat it. A frame too narrow for all
 * three gives the tree up first, and the assistant folds to its rail before
 * the code does.
 *
 * The code view is an EDITABLE surface — the file is the user's to change —
 * and it fills its column: the pane IS the code, with no card floating
 * inside it.
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  FileTypeIcon, IconChevronLeftOutlineRegular, IconCodeOutlineRegular,
  IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PropsRenderSlots, SessionProviderComponent,
} from '@deepseek-ai/dsh-client-ui-slots'
import { activeFile, type IdeWorkspaceState } from './ide-model.ts'
import { ideTreeRows } from './ide-tree.ts'
import { IdeAssistant } from './IdeAssistant.tsx'
import { IdeFilePane } from './IdeFilePane.tsx'
import { IdeFileTree } from './IdeFileTree.tsx'
import { IdePaneHeader } from './IdePaneHeader.tsx'
import { IdeSplitter } from './IdeSplitter.tsx'
import { resolveIdeColumns, type IdeLayout } from './ide-columns.ts'
import type { IdeKey } from './locales.ts'
import css from './IdeWorkspace.module.css'

/** The face the surface renders from. */
export interface IdeWorkspaceInjected {
  /** The workspace state; the surface subscribes to it. */
  readonly store: SnapshotStore<IdeWorkspaceState>
  /** Open a file in the tab strip. */
  readonly open: (path: string, name: string) => void
  /** Close a tab. */
  readonly close: (path: string) => void
  /** Bring an open file to the front. */
  readonly activate: (path: string) => void
  /** Expand or collapse one directory. */
  readonly toggleDirectory: (path: string) => void
  /** Set the tree's filter text. */
  readonly setQuery: (query: string) => void
  /** Replace one open file's text with the editor's own edit. */
  readonly edit: (path: string, content: string) => void
  /** Write one open file's text back to disk. */
  readonly save: (path: string) => void
  /** Reload the listed levels and the open files. */
  readonly refresh: () => void
  /** Leave the IDE and show the conversation again. */
  readonly backToConversation: () => void
}

/** The surface's props: the workspace face the slot spreads in, plus the copy. */
export interface IdeWorkspaceProps extends IdeWorkspaceInjected {
  /** The localized copy of the surface. */
  readonly t: (key: IdeKey) => string
  /** Render the declared assistant child slot. */
  readonly renderSlot: PropsRenderSlots<'ide.assistant'>['renderSlot']
  /** Bind a subtree to one Session. */
  readonly SessionProvider: SessionProviderComponent
}

/** Where the column widths live between visits. */
const LAYOUT_KEY = 'dsh.ide.layout.v3'

/**
 * Read the remembered layout.
 * @returns the layout, or the defaults when nothing was remembered.
 */
function readLayout(): IdeLayout {
  const fallback: IdeLayout = {
    filesWidth: 260,
    assistantWidth: 420,
    filesCollapsed: false,
    assistantCollapsed: false,
  }
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_KEY)
    if (raw === undefined || raw === null) return fallback
    const parsed = JSON.parse(raw) as Partial<IdeLayout>
    return {
      filesWidth: typeof parsed.filesWidth === 'number' ? parsed.filesWidth : fallback.filesWidth,
      assistantWidth: typeof parsed.assistantWidth === 'number' ? parsed.assistantWidth : fallback.assistantWidth,
      filesCollapsed: parsed.filesCollapsed === true,
      assistantCollapsed: parsed.assistantCollapsed === true,
    }
  } catch {
    return fallback
  }
}

/**
 * Remember the layout.
 * @param layout - the layout to remember.
 * @returns nothing.
 */
function writeLayout(layout: IdeLayout): void {
  try {
    globalThis.localStorage?.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // A browser that refuses storage still gets a usable IDE.
  }
}

/**
 * The path of a file relative to the project root.
 * @param root - the project root.
 * @param path - the file's path.
 * @returns the relative path, or the path itself when it lies elsewhere.
 */
function relativePath(root: string | undefined, path: string): string {
  if (root === undefined) return path
  const trimmed = root.replace(/[/\\]+$/, '')
  if (path.startsWith(`${trimmed}/`) || path.startsWith(`${trimmed}\\`)) {
    return path.slice(trimmed.length + 1)
  }
  return path
}

/**
 * Render the IDE workspace.
 * @param props - the workspace face and the localized copy.
 * @returns the workspace surface.
 */
export function IdeWorkspace(props: IdeWorkspaceProps): ReactNode {
  const {
    store, open, close, activate, toggleDirectory, setQuery, edit, save,
    refresh, backToConversation, t, renderSlot, SessionProvider,
  } = props
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )
  const rows = useMemo(() => ideTreeRows(state), [state])
  const file = activeFile(state)
  const openPaths = useMemo(
    () => new Set(state.files.map(entry => entry.path)),
    [state.files],
  )

  const [layout, setLayout] = useState<IdeLayout>(readLayout)
  const [container, setContainer] = useState(0)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const reportCursor = useCallback((line: number, column: number) => {
    setCursor(prev => (prev.line === line && prev.column === column ? prev : { line, column }))
  }, [])
  const [pathFolded, setPathFolded] = useState(false)
  const surfaceRef = useRef<HTMLElement>(null)
  const crumbsRef = useRef<HTMLElement>(null)
  const sessionRef = useRef<HTMLSpanElement>(null)
  const pathRef = useRef<HTMLSpanElement>(null)

  // The project path is a breadcrumb RUN, not a string to squeeze: every
  // segment keeps its own width, and the run folds its middle segments into
  // one "…" crumb when it no longer fits the title bar. The decision is
  // measured rather than guessed — the browser owns this geometry, and a
  // folded crumb is the difference between a path that reads and a path
  // crushed into single letters.
  const pathParts = useMemo(() => {
    if (state.root === undefined) return []
    return state.root.split(/[/\\]+/).filter(part => part !== '')
  }, [state.root])

  // The frame's width decides how much room the editor keeps: a narrow
  // window must not squeeze the code into a column of broken words.
  useEffect(() => {
    const element = surfaceRef.current
    // A host without the observer (a test DOM) keeps the remembered widths.
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setContainer(current => (Math.abs(current - width) < 1 ? current : width))
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])

  // Measure the run against the room it has and fold it when it no longer
  // fits. The measurement is the same in both states: a segment's own text
  // width survives the fold, so the run's natural width stays knowable.
  useLayoutEffect(() => {
    const crumbs = crumbsRef.current
    const path = pathRef.current
    if (crumbs === null || path === null) return
    const measure = (): void => {
      const parts = [...path.querySelectorAll<HTMLElement>('[data-ide-path-part]')]
      const first = parts[0]
      const last = parts[parts.length - 1]
      // Fewer than three segments have no middle to fold.
      if (first === undefined || last === undefined || parts.length < 3) {
        setPathFolded(false)
        return
      }
      const partStyle = getComputedStyle(first)
      const padding = Number.parseFloat(partStyle.paddingLeft)
        + Number.parseFloat(partStyle.paddingRight)
      const separator = last.querySelector<HTMLElement>('[data-ide-path-sep]')
      const separatorWidth = separator?.getBoundingClientRect().width ?? 0
      let natural = 0
      for (const part of parts) {
        const text = part.querySelector<HTMLElement>('[data-ide-path-text]')
        natural += (text?.scrollWidth ?? 0) + padding
        if (part.querySelector('[data-ide-path-sep]') !== null) natural += separatorWidth
      }
      natural += (Number.parseFloat(getComputedStyle(path).columnGap) || 0) * (parts.length - 1)
      const session = sessionRef.current?.getBoundingClientRect().width ?? 0
      const gap = Number.parseFloat(getComputedStyle(crumbs).columnGap) || 0
      setPathFolded(natural > crumbs.clientWidth - session - gap + 1)
    }
    measure()
    // A host without the observer (a test DOM) keeps the measured fold.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(crumbs)
    return () => { observer.disconnect() }
  }, [state.root, state.sessionTitle])

  const setFilesWidth = useCallback((filesWidth: number) => {
    setLayout(current => {
      const next = { ...current, filesWidth }
      writeLayout(next)
      return next
    })
  }, [])
  const setAssistantWidth = useCallback((assistantWidth: number) => {
    setLayout(current => {
      const next = { ...current, assistantWidth }
      writeLayout(next)
      return next
    })
  }, [])
  const toggleCollapsed = useCallback(() => {
    setLayout(current => {
      const next = { ...current, filesCollapsed: !current.filesCollapsed }
      writeLayout(next)
      return next
    })
  }, [])
  const toggleAssistantCollapsed = useCallback(() => {
    setLayout(current => {
      const next = { ...current, assistantCollapsed: !current.assistantCollapsed }
      writeLayout(next)
      return next
    })
  }, [])

  const columns = useMemo(
    () => resolveIdeColumns(container, layout),
    [container, layout],
  )
  const gridStyle = {
    '--ide-files-width': `${columns.filesWidth}px`,
    '--ide-assistant-width': `${columns.assistantWidth}px`,
  } as CSSProperties

  const lineCount = file === undefined ? 0 : file.content.split('\n').length
  const charCount = file === undefined ? 0 : file.content.length

  return (
    <section ref={surfaceRef} className={css.workspace} data-ide-workspace style={gridStyle}>
      <header className={css.titleBar} data-ide-titlebar>
        <span className={css.titleBrand}>
          <span className={css.titleBrandIcon} aria-hidden="true">
            <IconCodeOutlineRegular size={15} />
          </span>
          <span className={css.titleBrandName}>{t('title.ide')}</span>
        </span>
        <nav ref={crumbsRef} className={css.titleCrumbs} aria-label={t('title.project')}>
          <span ref={sessionRef} className={css.titleSession} title={state.sessionTitle}>
            {state.sessionTitle ?? t('empty.session')}
          </span>
          {pathParts.length > 0 && (
            <span
              ref={pathRef}
              className={css.titlePath}
              title={state.root}
              data-ide-breadcrumb=""
              data-collapsed={pathFolded ? 'true' : undefined}
            >
              {pathParts.map((part, index) => {
                const last = index === pathParts.length - 1
                const middle = index > 0 && !last
                return (
                  <Fragment key={part}>
                    {last && pathFolded && (
                      <span className={css.titlePathPart} data-ide-path-fold="" aria-hidden="true">
                        <span className={css.titlePathSep}>/</span>
                        <span>…</span>
                      </span>
                    )}
                    <span
                      className={css.titlePathPart}
                      data-ide-path-part=""
                      data-middle={middle ? 'true' : undefined}
                      data-last={last ? 'true' : undefined}
                    >
                      {index > 0 && (
                        <span className={css.titlePathSep} data-ide-path-sep="" aria-hidden="true">/</span>
                      )}
                      <span
                        className={last ? css.titlePathLast : undefined}
                        data-ide-path-text=""
                      >
                        {part}
                      </span>
                    </span>
                  </Fragment>
                )
              })}
            </span>
          )}
        </nav>
        <span className={css.titleActions}>
          <button
            type="button"
            className={css.titleButton}
            onClick={() => { refresh() }}
          >
            <IconRefreshOutlineRegular size={14} />
            <span>{t('header.refresh')}</span>
          </button>
          <button
            type="button"
            className={css.titleButton}
            onClick={() => { backToConversation() }}
          >
            <IconChevronLeftOutlineRegular size={14} />
            <span>{t('header.back')}</span>
          </button>
        </span>
      </header>

      <IdeFileTree
        root={state.root}
        rows={rows}
        openPaths={openPaths}
        activePath={state.activePath}
        query={state.query}
        error={state.error}
        collapsed={columns.filesCollapsed}
        toggleCollapsed={toggleCollapsed}
        open={open}
        toggleDirectory={toggleDirectory}
        setQuery={setQuery}
        t={t}
      />

      <IdeSplitter
        side="start"
        width={columns.filesWidth}
        min={columns.filesCollapsed ? 44 : 200}
        max={460}
        onResize={setFilesWidth}
        ariaLabel={t('splitter.files.aria')}
      />

      <div className={css.editor} data-ide-pane="code">
        <IdePaneHeader
          icon={file === undefined
            ? <IconCodeOutlineRegular size={15} />
            : <FileTypeIcon path={file.name} size={15} />}
          title={t('pane.code')}
          detail={file === undefined ? undefined : <span className={css.languageChip}>{file.language}</span>}
          ariaLabel={t('pane.code.aria')}
        />

        <div className={css.tabBar}>
          <div className={css.tabs} role="tablist" aria-label={t('tabs.aria')}>
            {state.files.map(tab => (
              <div
                key={tab.path}
                className={css.tab}
                data-active={tab.path === state.activePath}
                data-dirty={tab.dirty === true}
                role="tab"
                aria-selected={tab.path === state.activePath}
              >
                <button type="button" className={css.tabName} onClick={() => { activate(tab.path) }}>
                  <FileTypeIcon path={tab.name} size={13} />
                  <span className={css.tabLabel}>{tab.name}</span>
                  {tab.dirty === true && <span className={css.tabDirty} aria-label={t('tab.dirty')} />}
                </button>
                <button
                  type="button"
                  className={css.tabClose}
                  aria-label={t('tab.close')}
                  onClick={() => { close(tab.path) }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {file?.dirty === true && (file.viewKind === undefined || file.viewKind === 'text' || file.viewKind === 'markdown' || file.viewKind === 'html') && (
            <button
              type="button"
              className={css.saveButton}
              onClick={() => { save(file.path) }}
              disabled={file.saving === true}
            >
              {file.saving === true ? t('editor.saving') : t('editor.save')}
            </button>
          )}
        </div>

        {file === undefined
          ? (
            <div className={css.empty}>
              <span className={css.emptyIcon} aria-hidden="true">
                <IconCodeOutlineRegular size={28} />
              </span>
              <p className={css.emptyTitle}>{t('empty.title')}</p>
              <p className={css.emptyHint}>{t('empty.hint')}</p>
            </div>
          )
          : file.error !== undefined
            ? (
              <div className={css.empty}>
                <p className={css.emptyTitle}>{t('code.error')}</p>
                <p className={css.emptyHint}>{file.error}</p>
              </div>
            )
            : file.loading === true
              ? (
                <div className={css.empty}>
                  <p className={css.emptyTitle}>{t('code.loading')}</p>
                </div>
              )
              : (
                <IdeFilePane
                  file={file}
                  onChange={(content) => { edit(file.path, content) }}
                  onSave={() => { save(file.path) }}
                  onCursor={reportCursor}
                  t={t}
                />
              )}

        <footer className={css.statusBar} data-ide-statusbar>
          <span className={css.statusPath} title={file === undefined ? undefined : file.path}>
            {file === undefined
              ? t('code.noFile')
              : relativePath(state.root, file.path)}
          </span>
          <span className={css.statusItems}>
            {file?.conflict !== undefined && (
              <span className={css.statusConflict}>{file.conflict}</span>
            )}
            {file !== undefined && (
              <>
                {(file.viewKind === undefined || file.viewKind === 'text' || file.viewKind === 'markdown' || file.viewKind === 'html')
                  ? (
                    <>
                      <span className={css.statusItem}>{t('status.editable')}</span>
                      <span className={css.statusItem}>{cursor.line}:{cursor.column}</span>
                      <span className={css.statusItem}>{lineCount} {t('status.lines')}</span>
                      <span className={css.statusItem}>{charCount} {t('status.chars')}</span>
                    </>
                  )
                  : <span className={css.statusItem}>{t('status.preview')}</span>}
              </>
            )}
          </span>
        </footer>
      </div>

      <IdeSplitter
        side="end"
        width={columns.assistantWidth}
        min={columns.assistantCollapsed ? 44 : 320}
        max={720}
        onResize={setAssistantWidth}
        ariaLabel={t('splitter.assistant.aria')}
      />

      <IdeAssistant
        reference={state.reference}
        sessionTitle={state.sessionTitle}
        collapsed={columns.assistantCollapsed}
        toggleCollapsed={toggleAssistantCollapsed}
        renderSlot={renderSlot}
        SessionProvider={SessionProvider}
        t={t}
      />
    </section>
  )
}
