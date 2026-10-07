/** Electron single-instance ownership before any Desktop profile lifecycle begins. */

/** The argv flag an NSIS installer passes so the running instance quits cleanly. */
export const INSTALLER_QUIT_FLAG = '--dsh-installer-quit'

/** Minimal Electron application operations needed for instance ownership. */
export interface DesktopSingleInstanceApplication {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: (event: unknown, argv: string[]) => unknown): unknown
}

/**
 * Claim the process-lifetime Desktop lock and route later launches to the owner.
 * @param application - Electron application singleton.
 * @param focusOwner - focus or recreate the primary window after a later launch.
 * @param quitForInstaller - quit without the close confirmation when a later
 *   launch carries {@link INSTALLER_QUIT_FLAG}: the reinstalling installer needs
 *   the process (and its backend child) gone, and the tray close confirmation
 *   would leave it running.
 * @returns true only in the process that may access the Desktop profile.
 */
export function claimDesktopSingleInstance(
  application: DesktopSingleInstanceApplication,
  focusOwner: () => void,
  quitForInstaller: () => void = () => { application.quit() },
): boolean {
  if (!application.requestSingleInstanceLock()) {
    application.quit()
    return false
  }
  application.on('second-instance', (_event, argv) => {
    if (argv.includes(INSTALLER_QUIT_FLAG)) quitForInstaller()
    else focusOwner()
  })
  return true
}
