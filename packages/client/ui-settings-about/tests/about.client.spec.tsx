// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {} from '../src/client/index.ts'
import { zh, type AboutKey } from '../src/client/locales.ts'
import { AboutSection } from '../src/client/AboutSection.tsx'
import type { AboutSectionProps } from '../src/client/AboutSection.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('AboutSection', () => {
  const t = ((key: AboutKey, params?: Record<string, string | number>): string =>
    Object.entries(params ?? {}).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      zh[key],
    )) as AboutSectionProps['t']

  // AboutSection consumes no global hooks; the slot supplies them in the application.
  const globals = {} as GlobalStandardProps

  function renderAbout(): void {
    render(<AboutSection {...globals} close={() => undefined} t={t} />)
  }

  it('renders the distribution version, core build, credit, and disclaimer', () => {
    vi.stubEnv('DSH_CLIENT_PRODUCT_VERSION', '1.5.7')
    vi.stubEnv('DSH_CLIENT_VERSION', '0.1.7-rc.1')
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', '0123456')
    renderAbout()
    expect(screen.getByText('CetusPrism')).toBeTruthy()
    expect(screen.getByText(`${zh['product.version']} 1.5.7`)).toBeTruthy()
    expect(screen.getByText('0.1.7-rc.1-0123456')).toBeTruthy()
    expect(screen.getByText(zh['credit.title'])).toBeTruthy()
    const repo = screen.getByText(zh['credit.repo'])
    expect(repo.getAttribute('href')).toBe('https://github.com/deepseek-ai/deepseek-harness')
    expect(repo.getAttribute('rel')).toContain('noopener')
    expect(screen.getByText(zh['legal.disclaimer'])).toBeTruthy()
  })

  it('omits the version rows when build metadata is absent', () => {
    renderAbout()
    expect(screen.queryByText(zh['product.version'])).toBeNull()
    expect(screen.queryByText(zh['core.title'])).toBeNull()
    // The credit and legal statements do not depend on build metadata.
    expect(screen.getByText(zh['credit.body'])).toBeTruthy()
    expect(screen.getByText(zh['legal.disclaimer'])).toBeTruthy()
  })
})
