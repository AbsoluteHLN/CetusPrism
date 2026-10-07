import { describe, expect, it, vi } from 'vitest'
import { claimDesktopSingleInstance, INSTALLER_QUIT_FLAG, type DesktopSingleInstanceApplication } from '../src/single-instance.ts'

describe('desktop single-instance ownership', () => {
  it('quits a second process without registering lifecycle work', () => {
    const quit = vi.fn()
    const on = vi.fn()
    const application = {
      requestSingleInstanceLock: () => false,
      quit,
      on,
    } satisfies DesktopSingleInstanceApplication

    expect(claimDesktopSingleInstance(application, vi.fn())).toBe(false)
    expect(quit).toHaveBeenCalledOnce()
    expect(on).not.toHaveBeenCalled()
  })

  it('routes a later launch to the primary process', () => {
    let secondInstance: ((event: unknown, argv: string[]) => void) | undefined
    const focus = vi.fn()
    const application = {
      requestSingleInstanceLock: () => true,
      quit: vi.fn(),
      on: vi.fn((_event: 'second-instance', listener: (event: unknown, argv: string[]) => void) => { secondInstance = listener }),
    } satisfies DesktopSingleInstanceApplication

    expect(claimDesktopSingleInstance(application, focus)).toBe(true)
    secondInstance?.({}, [])
    expect(focus).toHaveBeenCalledOnce()
  })

  it('quits the owner without confirmation when a later launch carries the installer flag', () => {
    let secondInstance: ((event: unknown, argv: string[]) => void) | undefined
    const focus = vi.fn()
    const quitForInstaller = vi.fn()
    const application = {
      requestSingleInstanceLock: () => true,
      quit: vi.fn(),
      on: vi.fn((_event: 'second-instance', listener: (event: unknown, argv: string[]) => void) => { secondInstance = listener }),
    } satisfies DesktopSingleInstanceApplication

    claimDesktopSingleInstance(application, focus, quitForInstaller)
    secondInstance?.({}, ['--something-else', INSTALLER_QUIT_FLAG])
    expect(quitForInstaller).toHaveBeenCalledOnce()
    expect(focus).not.toHaveBeenCalled()

    secondInstance?.({}, ['--ordinary-launch'])
    expect(quitForInstaller).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
  })
})
