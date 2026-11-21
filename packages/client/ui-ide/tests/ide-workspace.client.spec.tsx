// @vitest-environment jsdom

/**
 * The IDE workspace surface: the project tree on the left, the code in the
 * middle and the assistant column on the right, rendered from the workspace
 * service.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  PropsRenderSlots, SessionProviderComponent,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IdeWorkspace } from '../src/client/IdeWorkspace.tsx'
import { createIdeWorkspace, ideWorkspaceFace, type IIdeWorkspace } from '../src/client/ide-workspace-service.ts'
import type { IdeFilesPort } from '../src/client/ide-files.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)
const SID = 'session-one' as SessionId
const REFERENCE = { sessionId: SID } as unknown as SessionReference

afterEach(cleanup)
// The surface remembers its column widths and the collapsed tree, so every
// case starts from a clean layout.
beforeEach(() => {
  globalThis.localStorage?.clear()
})

const files: IdeFilesPort = {
  list: async (_sessionId, path) => path === '/project'
    ? [{ name: 'a.ts', path: '/project/a.ts', kind: 'file' }]
    : [],
  read: async (_sessionId, path) => ({
    content: `export const ${path.endsWith('a.ts') ? 'a_ts' : 'other'} = 1\n`,
    truncated: false,
    version: 'v1',
  }),
  write: async (_sessionId, _path, content) => ({ content, version: 'v2' }),
}

/**
 * A workspace bound to one Session.
 * @param title - the Session's display title.
 * @returns the service.
 */
function workspace(title = '会话标题'): IIdeWorkspace {
  const service = createIdeWorkspace(files)
  service.bind(SID, '/project', REFERENCE, title)
  return service
}

/**
 * The surface's framework props: the child slot renderer and the Session
 * provider, both stubbed.
 * @returns the props the surface needs beyond the workspace face.
 */
function frameworkProps(): {
  renderSlot: PropsRenderSlots<'ide.assistant'>['renderSlot']
  SessionProvider: SessionProviderComponent
} {
  return {
    renderSlot: (() => <span>助手对话</span>) as unknown as PropsRenderSlots<'ide.assistant'>['renderSlot'],
    SessionProvider: (({ children }: { children?: ReactNode }) => <>{children}</>) as SessionProviderComponent,
  }
}

/**
 * Render the surface over one workspace.
 * @param service - the workspace service.
 * @returns nothing.
 */
function renderWorkspace(service: IIdeWorkspace): void {
  const { renderSlot, SessionProvider } = frameworkProps()
  render(
    <IdeWorkspace
      {...ideWorkspaceFace(service)}
      backToConversation={vi.fn()}
      t={t}
      renderSlot={renderSlot}
      SessionProvider={SessionProvider}
    />,
  )
}

describe('the IDE workspace surface', () => {
  it('shows the empty state while no file is open', () => {
    renderWorkspace(workspace())

    expect(screen.getByText('没有打开的文件')).toBeTruthy()
  })

  it('lists the project tree of the bound session', async () => {
    renderWorkspace(workspace())

    expect(await screen.findByRole('treeitem', { name: /a\.ts/ })).toBeTruthy()
    expect(screen.getByLabelText('项目文件树')).toBeTruthy()
  })

  it('opens the file that is picked and shows its code', async () => {
    renderWorkspace(workspace())

    fireEvent.click(await screen.findByRole('treeitem', { name: /a\.ts/ }))

    expect(await screen.findByRole('tab')).toBeTruthy()
    expect(screen.getByRole('tab').textContent).toContain('a.ts')
    // The code surface is an editable text area: its VALUE carries the source,
    // while the highlighted layer behind it carries the colours.
    const code = await screen.findByLabelText('代码内容') as HTMLTextAreaElement
    expect(code.value).toContain('export const a_ts = 1')
  })

  it('closes a tab and hands the surface back to the neighbour', async () => {
    renderWorkspace(workspace())

    fireEvent.click(await screen.findByRole('treeitem', { name: /a\.ts/ }))
    await screen.findByRole('tab')
    fireEvent.click(screen.getByRole('button', { name: '关闭文件' }))

    expect(screen.getByText('没有打开的文件')).toBeTruthy()
  })

  it('filters the tree by the search text', async () => {
    renderWorkspace(workspace())
    await screen.findByRole('treeitem', { name: /a\.ts/ })

    fireEvent.change(screen.getByLabelText('筛选文件'), { target: { value: 'zzz' } })

    await waitFor(() => {
      expect(screen.queryByRole('treeitem', { name: /a\.ts/ })).toBeNull()
    })
    expect(screen.getByText('没有匹配的文件')).toBeTruthy()
  })

  it('shows the assistant column bound to the session', async () => {
    renderWorkspace(workspace())

    expect(screen.getByLabelText('助手会话')).toBeTruthy()
    expect(await screen.findByText('助手对话')).toBeTruthy()
  })

  it('says so when no session is bound', () => {
    const service = createIdeWorkspace(files)
    renderWorkspace(service)

    expect(screen.getByText('选择一个会话后，这里显示它的助手对话。')).toBeTruthy()
  })

  it('never calls the file source when no session is bound', async () => {
    const list = vi.fn(async () => [])
    const service = createIdeWorkspace({
      list,
      read: async () => ({ content: '', truncated: false }),
      write: async () => ({ content: '', version: 'v1' }),
    })
    renderWorkspace(service)

    await waitFor(() => {
      expect(list).not.toHaveBeenCalled()
    })
  })

  it('names the IDE, the session and the project in the title bar', () => {
    renderWorkspace(workspace())

    const titleBar = document.querySelector('[data-ide-titlebar]')
    expect(titleBar).toBeTruthy()
    expect(titleBar?.textContent).toContain('IDE')
    expect(titleBar?.textContent).toContain('会话标题')
    // The path reads as breadcrumb steps, so the separator is gone.
    expect(titleBar?.textContent).toContain('project')
  })

  it('gives every column a header of its own', async () => {
    renderWorkspace(workspace())

    expect(screen.getByLabelText('项目文件面板')).toBeTruthy()
    expect(screen.getByLabelText('代码面板')).toBeTruthy()
    expect(screen.getByLabelText('助手会话面板')).toBeTruthy()
    expect(screen.getByText('项目文件')).toBeTruthy()
    expect(screen.getByText('助手')).toBeTruthy()
  })

  it('names the bound session on the assistant column', () => {
    renderWorkspace(workspace('体素村庄任务'))

    const pane = document.querySelector('[data-ide-pane="assistant"]')
    expect(pane?.textContent).toContain('体素村庄任务')
  })

  it('marks the open file in the tree', async () => {
    renderWorkspace(workspace())
    fireEvent.click(await screen.findByRole('treeitem', { name: /a\.ts/ }))

    await screen.findByRole('tab')
    const item = screen.getByRole('treeitem', { name: /a\.ts/ })
    expect(item.getAttribute('data-open')).toBe('true')
    expect(item.getAttribute('data-active')).toBe('true')
  })

  it('offers a separator for each draggable column edge', () => {
    renderWorkspace(workspace())

    expect(screen.getByLabelText('调整文件栏宽度')).toBeTruthy()
    expect(screen.getByLabelText('调整助手栏宽度')).toBeTruthy()
  })

  it('collapses the file column and offers it back', () => {
    renderWorkspace(workspace())

    fireEvent.click(screen.getByLabelText('收起文件栏'))

    expect(screen.getByLabelText('展开文件栏')).toBeTruthy()
    expect(screen.queryByLabelText('收起文件栏')).toBeNull()
  })

  it('reports the open file in the status bar', async () => {
    renderWorkspace(workspace())
    fireEvent.click(await screen.findByRole('treeitem', { name: /a\.ts/ }))

    const status = document.querySelector('[data-ide-statusbar]')
    expect(status?.textContent).toContain('a.ts')
    // The code column is EDITABLE: the file is the user's to change.
    expect(status?.textContent).toContain('可编辑')
  })

  it('marks a changed file and offers to save it', async () => {
    renderWorkspace(workspace())
    fireEvent.click(await screen.findByRole('treeitem', { name: /a\.ts/ }))
    const code = await screen.findByLabelText('代码内容')

    fireEvent.change(code, { target: { value: 'export const a_ts = 2\n' } })

    // The tab says the file differs from disk, and the column offers the save.
    await waitFor(() => {
      expect(document.querySelector('[data-ide-workspace] [data-dirty="true"]')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy()
  })

  it('folds the assistant column to its rail and offers it back', () => {
    renderWorkspace(workspace())

    fireEvent.click(screen.getByLabelText('收起助手栏'))

    expect(screen.getByLabelText('展开助手栏')).toBeTruthy()
    expect(screen.queryByLabelText('收起助手栏')).toBeNull()
  })

  it('breaks the project path into breadcrumb steps', () => {
    renderWorkspace(workspace())

    const breadcrumb = document.querySelector('[data-ide-breadcrumb]')
    expect(breadcrumb?.children.length).toBeGreaterThan(0)
  })

  it('gives the assistant column a narrower default width than the file column', () => {
    renderWorkspace(workspace())

    // The column carries the REDUCED composer beside the code, so it wants
    // less room than the tree it sits next to.
    const grid = document.querySelector('[data-ide-workspace]') as HTMLElement
    expect(grid.style.getPropertyValue('--ide-assistant-width')).toBe('420px')
    expect(grid.style.getPropertyValue('--ide-files-width')).toBe('260px')
  })
})
