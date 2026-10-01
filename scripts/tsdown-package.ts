/** Shared package-local tsdown defaults for independent Node entry bundles. */
import { defineConfig } from 'tsdown'
import type { UserConfig } from 'tsdown'

const NODE_ENTRY_DEFAULTS: UserConfig = {
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

/**
 * Define independent Node bundles for package-owned JavaScript entries.
 * @param entries - emitted JavaScript files to bundle independently.
 * @param overrides - options shared by every entry in this invocation.
 * @returns a tsdown config containing one bundle per entry.
 */
export function defineNodeEntryBundle(
  entries: readonly string[],
  overrides: UserConfig = {},
): UserConfig[] {
  return defineConfig(entries.map(entry => ({
    ...NODE_ENTRY_DEFAULTS,
    entry: [entry],
    ...overrides,
  })))
}
