import { defineNodeEntryBundle } from '../../../scripts/tsdown-package.ts'

/** Builds each published entry as a self-contained file admitted by the package whitelist. */
export default defineNodeEntryBundle(
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { outputOptions: { codeSplitting: false } },
)
