// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { IdeFilePane } from '../src/client/IdeFilePane.tsx'
import type { IdeFile } from '../src/client/ide-model.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)

afterEach(cleanup)

const base: IdeFile = {
  path: '/project/a.ts',
  name: 'a.ts',
  language: 'typescript',
  content: 'export const a = 1\n',
  viewKind: 'text',
}

describe('IdeFilePane', () => {
  it('shows a markdown preview when the user switches modes', () => {
    const file: IdeFile = { ...base, path: '/project/readme.md', name: 'readme.md', viewKind: 'markdown', content: '# Title' }
    render(
      <IdeFilePane
        file={file}
        onChange={vi.fn()}
        onSave={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByRole('tab', { name: '源代码' })).toBeDefined()
    fireEvent.click(screen.getByRole('tab', { name: '预览' }))
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined()
  })

  it('renders an image preview from a blob URL', () => {
    const file: IdeFile = {
      ...base,
      path: '/project/logo.png',
      name: 'logo.png',
      content: '',
      viewKind: 'image',
      mediaUrl: 'blob:test',
    }
    render(<IdeFilePane file={file} onChange={vi.fn()} onSave={vi.fn()} t={t} />)
    expect(document.querySelector('[data-ide-viewer="image"] img')).toBeTruthy()
  })
})