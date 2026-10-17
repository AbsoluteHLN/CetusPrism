/**
 * Quick comprehensive documentation-standard tests: the reference example
 * stays valid and maintained package and persistence documents use the
 * declared kinds. Private ignored skills and historical notes are not inputs.
 * Session release records match the writer bound, bilingual counterpart,
 * and evidence links. These run in `pnpm run test` and
 * `pnpm run test:docs` to guard the standard between heavier corpus gates.
 * @module scripts/doc-standard.spec
 */

import { existsSync, globSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { JSON_SCHEMA, load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { readCurrentSessionFormatVersion } from './gen-session-format-catalog.ts'
import { parseTranslationPairingRecord } from './translation-pairing-record.ts'

const root = resolve(import.meta.dirname, '..')
/** Current files maintained by Git, excluding private ignored copies. */
function maintainedDocuments(pattern: string, repositoryRoot = root): string[] {
  const paths = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1 << 26,
  }).split('\0').filter(Boolean))
  return globSync(pattern, { cwd: repositoryRoot })
    .map(file => file.replaceAll('\\', '/'))
    .filter(file => paths.has(file))
    .sort()
}
const PACKAGE_README_GLOBS = [
  'packages/README.md',
  'packages/README.zh.md',
  'packages/*/README.md',
  'packages/*/README.zh.md',
  'packages/*/*/README.md',
  'packages/*/*/README.zh.md',
] as const

function packageReadmes(): string[] {
  return PACKAGE_README_GLOBS
    .flatMap(pattern => maintainedDocuments(pattern))
    .sort()
}

/**
 * Audited packages whose entry is a plain module API rather than a Cordis
 * plugin (`apply` export or a default service export) or an installable
 * bundle (`dsh.bundle.patch`). Each entry names why the package is a
 * library; the check re-derives the entry shape so a stale entry fails loud.
 */
const PACKAGE_LIBRARIES: Readonly<Record<string, string>> = {
  'packages/experimental/browser-use-runtime': 'Provider-owned browser resource management and MCP integration helpers; no plugin entry.',
  'packages/boot/app-boot': 'Boot library the app bins import; plain helper exports.',
  'packages/boot/cmdline': 'Command-line library the app bins import; plain module exports.',
  'packages/client/store': 'Browser-side state primitives; plain function/type exports.',
  'packages/client/ui-primitives': 'Browser-side UI component library; plain component exports.',
  'packages/client/ui-slots': 'Browser-side slot-map declarations; plain type exports.',
  'packages/client/web': 'Browser application boot library; exports the app entry and static module table.',
  'packages/core/scope': 'Scoped-context primitives; exports functions and types without a plugin entry.',
  'packages/experimental/webworker-packer': 'Build-time VFS image packer and command library.',
  'packages/experimental/webworker-runtime': 'Browser worker runtime library with explicit host entry points.',
  'packages/hooks/hook-protocol': 'Shared wire-protocol library between the hook bridges.',
  'packages/identity/anonymous-user-id': 'Harness-home identity helper with no plugin registration.',
  'packages/sandbox/sandbox-windows-acl': 'Windows ACL sandbox library consumed by sandbox-local.',
  'packages/sdk/client': 'Client-process library; the spawned runtime owns plugin behavior.',
  'packages/sdk/protocol': 'Wire-protocol library with type declarations only.',
  'packages/session/session-format': 'Pure Session format planning, codec dispatch, and lossless JSON library.',
  'packages/session/session-format-catalog': 'Generated build-static Session format inventory with no plugin registration.',
  'packages/session/session-format-v0-to-v1': 'Pure released-v0 codec and adjacent migration library.',
  'packages/session/session-format-v2-to-v3': 'Pure released-v2 codec and adjacent migration library.',
  'packages/session/session-format-v3-to-v4': 'Released V3 codec reuse and adjacent migration library.',
  'packages/session/session-telemetry': 'Telemetry Service Definition and capture library; providers mount the backend.',
  'packages/session/session-title-llm': 'Shared LLM title-provider registration and request policy.',
  'packages/subagent/subagent-in-process-driver': 'Shared one-shot child-agent driver used by provider plugins.',
  'packages/subprocess/win32-process': 'Low-level Win32 process and Job Object primitives.',
  'packages/test-support/session-snapshot': 'Test infrastructure; mounts nothing into a product composition.',
  'packages/test-support/agent-loop-testkit': 'Test helper library; mounts nothing into a product composition.',
  'packages/test-support/client-runtime': 'Browser-side test infrastructure.',
  'packages/test-support/llm-mock-server': 'Test server library; substitutes provider wire behavior.',
  'packages/test-support/loader-smoke': 'Test harness library; mounts nothing into a product composition.',
  'packages/test-support/remote-mock': 'Browser-side test infrastructure; mounts nothing into a product composition.',
  'packages/typert/generator': 'Build-time generator run outside any agent runtime.',
  'packages/typert/protocol': 'Compiler-independent protocol declarations.',
  'packages/util/code-language': 'Stateless filename-to-language mapping without plugin registration.',
  'packages/util/atomic-write': 'Zero-dependency filesystem write utility.',
  'packages/util/brand': 'Stateless nominal-string and canonical-key constructors.',
  'packages/util/crypto': 'Zero-dependency identifier minting utility.',
  'packages/util/deque': 'Zero-dependency circular deque utility.',
  'packages/util/chunked-list': 'Persistent collection operations and checkpoint validation without a plugin surface.',
  'packages/util/home-paths': 'Zero-dependency harness-home path resolver.',
  'packages/util/launch-environment': 'Zero-dependency environment resolver.',
  'packages/util/lazy-require': 'Caller-relative CommonJS-compatible dependency loader.',
  'packages/util/native-command': 'Host-side subprocess runner utility.',
  'packages/util/output-retention': 'Zero-dependency retention utility.',
  'packages/util/package-manifest': 'Shared package manifest declarations with type-only exports.',
  'packages/util/time': 'Zero-dependency time-zone canonicalization utility.',
  'packages/util/timeout': 'Zero-dependency timeout utility.',
  'packages/util/values': 'Stateless lossless-JSON and immutable-value helpers.',
  'packages/util/workspace-path': 'Zero-dependency Workspace path formatter.',
}

function readFrontmatter(file: string, repositoryRoot = root): Record<string, unknown> {
  const source = readFileSync(resolve(repositoryRoot, file), 'utf8').replaceAll('\r\n', '\n')
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(source)
  expect(match, `${file}: YAML frontmatter`).not.toBeNull()
  const metadata = load(match?.[1] ?? '')
  expect(metadata, `${file}: frontmatter object`).toBeTypeOf('object')
  expect(Array.isArray(metadata), `${file}: frontmatter object`).toBe(false)
  return metadata as Record<string, unknown>
}

function packageDir(file: string): string {
  return file.replaceAll('\\', '/').replace(/\/README\.zh\.md$/, '').replace(/\/README\.md$/, '')
}

/** Whether the package manifest declares `dsh.bundle.patch`. */
function declaresBundle(dir: string): boolean {
  const manifest = resolve(root, dir, 'package.json')
  if (!existsSync(manifest)) return false
  const metadata = JSON.parse(readFileSync(manifest, 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
  return metadata.dsh?.bundle?.patch !== undefined
}

/** The expected kind for one package README, from the facts the skill documents. */
function expectedKind(file: string): string {
  const normalized = file.replaceAll('\\', '/')
  if (normalized.split('/').length <= 3) return 'package-group'
  const dir = packageDir(normalized)
  if (declaresBundle(dir)) return 'package-bundle'
  if (Object.hasOwn(PACKAGE_LIBRARIES, dir)) return 'package-library'
  return 'package-reference'
}

function packageReadmeMetadataErrors(file: string, metadata: Record<string, unknown>): string[] {
  const errors: string[] = []
  if (metadata.kind !== expectedKind(file)) errors.push(`kind must be ${expectedKind(file)}`)
  if (typeof metadata.description !== 'string' || metadata.description.trim() === '') {
    errors.push('description must be a non-empty string')
  }
  for (const field of ['name', 'audience', 'tags', 'i18n']) {
    if (field in metadata) errors.push(`${field} is redundant or has no governed consumer`)
  }
  return errors
}

/** Required metadata for an optional maintained persistence-history document. */
function persistenceMetadataErrors(kind: string, metadata: Record<string, unknown>): string[] {
  const errors: string[] = []
  if (metadata.kind !== kind) errors.push(`kind must be ${kind}`)
  if (typeof metadata.description !== 'string' || metadata.description.trim() === '') {
    errors.push('description must be a non-empty string')
  }
  return errors
}

function packageReadmeStructureErrors(file: string, source: string): string[] {
  const chinese = file.endsWith('.zh.md')
  const required = chinese
    ? [[/^## 概述$/m, '概述'], [/^## 目录$/m, '目录'], [/^#{2,3} 开发备注$/m, '开发备注']] as const
    : [[/^## Summary$/m, 'Summary'], [/^## Table of Contents$/m, 'Table of Contents'], [/^#{2,3} Dev Note$/m, 'Dev Note']] as const
  return required.flatMap(([pattern, label]) => pattern.test(source) ? [] : [`missing ${label}`])
}

interface SessionFormatRelease {
  latestReleasedVersion: number
  evidenceTag: string
}

/** Validate release metadata and tagged writer evidence; throw on malformed or inconsistent input. */
function validateSessionFormatRelease(source: string, currentWriterVersion: number): SessionFormatRelease {
  const normalized = source.replaceAll('\r\n', '\n')
  const openings = [...normalized.matchAll(/^```yaml session-format-release[ \t]*$/gmu)]
  if (openings.length !== 1) throw new Error('Expected exactly one session-format-release record')
  const block = /^```yaml session-format-release[ \t]*\n([\s\S]*?)^```[ \t]*$/mu.exec(normalized)
  if (block === null) throw new Error('Expected a closed session-format-release record')
  const metadata: unknown = load(block[1]!, { schema: JSON_SCHEMA })
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Session format release record must be a mapping')
  }
  const fields = Object.keys(metadata).sort()
  if (fields.join(',') !== 'evidenceTag,latestReleasedVersion') {
    throw new Error('Session format release record requires exactly latestReleasedVersion and evidenceTag')
  }
  const { latestReleasedVersion, evidenceTag } = metadata as Record<string, unknown>
  if (typeof latestReleasedVersion !== 'number' || !Number.isSafeInteger(latestReleasedVersion)
    || latestReleasedVersion < 0) {
    throw new Error('latestReleasedVersion must be a non-negative safe integer')
  }
  if (latestReleasedVersion > currentWriterVersion) {
    throw new Error('latestReleasedVersion must not exceed the current writer version')
  }
  if (typeof evidenceTag !== 'string'
    || !/^dsh-v\d+\.\d+\.\d+(?:-[\dA-Za-z]+(?:[.-][\dA-Za-z]+)*)?(?:\+[\dA-Za-z]+(?:[.-][\dA-Za-z]+)*)?$/u.test(evidenceTag)) {
    throw new Error('evidenceTag must be a non-empty dsh-v version tag without URL delimiters')
  }
  const hasEvidence = normalized.split('\n').some(line =>
    line.includes(`\`${evidenceTag}\``) && line.includes('`packages/core/session/src/types.ts`'))
  if (!hasEvidence) throw new Error('Missing matching evidence tag and tagged writer path')
  return { latestReleasedVersion, evidenceTag }
}

function sessionFormatReleaseFixture(): { record: SessionFormatRelease; body: string; evidence: string; source: string } {
  const record = validateSessionFormatRelease(
    readFileSync(resolve(root, 'docs/session-format-status.md'), 'utf8'),
    readCurrentSessionFormatVersion(root),
  )
  const body = `latestReleasedVersion: ${record.latestReleasedVersion}\nevidenceTag: ${record.evidenceTag}`
  const evidence = `Evidence: published product tag \`${record.evidenceTag}\`; tagged writer: \`packages/core/session/src/types.ts\`.`
  return { record, body, evidence, source: releaseDocument(body, evidence) }
}

function releaseDocument(body: string, evidence: string): string {
  return `\`\`\`yaml session-format-release\n${body}\n\`\`\`\n\n${evidence}\n`
}

describe('Session format release authority', () => {
  it('keeps bilingual release metadata consistent with the writer and tagged evidence', () => {
    const records = ['docs/session-format-status.md', 'docs/session-format-status.zh.md'].map(file =>
      validateSessionFormatRelease(readFileSync(resolve(root, file), 'utf8'), readCurrentSessionFormatVersion(root)),
    )
    expect(records[0]).toEqual(records[1])
  })

  it('accepts a released writer and a newer development writer, including format zero', () => {
    const { record, body, evidence, source } = sessionFormatReleaseFixture()
    expect(validateSessionFormatRelease(source, record.latestReleasedVersion)).toEqual(record)
    expect(validateSessionFormatRelease(source, record.latestReleasedVersion + 1)).toEqual(record)
    const zero = releaseDocument(body.replace(`latestReleasedVersion: ${record.latestReleasedVersion}`, 'latestReleasedVersion: 0'), evidence)
    expect(validateSessionFormatRelease(zero, 0)).toEqual({ ...record, latestReleasedVersion: 0 })
  })

  it('rejects missing, duplicated, unclosed, and malformed release records', () => {
    const { record, body, evidence, source } = sessionFormatReleaseFixture()
    for (const invalid of [
      evidence,
      source + source,
      source + '\n```yaml session-format-release\n',
      `\`\`\`yaml session-format-release\n${body}`,
      releaseDocument('[unterminated', evidence),
      releaseDocument('', evidence),
      releaseDocument('null', evidence),
      releaseDocument('scalar', evidence),
      releaseDocument(`- latestReleasedVersion: ${record.latestReleasedVersion}`, evidence),
      releaseDocument(`${body}\n---\n${body}`, evidence),
    ]) {
      expect(() => validateSessionFormatRelease(invalid, record.latestReleasedVersion), invalid).toThrow()
    }
  })

  it('rejects missing, duplicate, and extra record fields', () => {
    const { record, body, evidence } = sessionFormatReleaseFixture()
    for (const invalid of [
      '{}',
      `evidenceTag: ${record.evidenceTag}`,
      `latestReleasedVersion: ${record.latestReleasedVersion}`,
      `${body}\nlatestReleasedVersion: ${record.latestReleasedVersion}`,
      `${body}\nevidenceTag: ${record.evidenceTag}`,
      `${body}\nreleased: true`,
    ]) {
      expect(() => validateSessionFormatRelease(releaseDocument(invalid, evidence), record.latestReleasedVersion), invalid).toThrow()
    }
  })

  it('rejects invalid released versions and releases beyond the current writer', () => {
    const { record, evidence } = sessionFormatReleaseFixture()
    for (const value of ['-1', '1.5', String(Number.MAX_SAFE_INTEGER + 1), '.inf', '.nan', 'null', 'true', '"0"']) {
      const source = releaseDocument(`latestReleasedVersion: ${value}\nevidenceTag: ${record.evidenceTag}`, evidence)
      expect(() => validateSessionFormatRelease(source, Number.MAX_SAFE_INTEGER), value).toThrow('non-negative safe integer')
    }
    const writer = readCurrentSessionFormatVersion(root)
    const future = releaseDocument(`latestReleasedVersion: ${writer + 1}\nevidenceTag: ${record.evidenceTag}`, evidence)
    expect(() => validateSessionFormatRelease(future, writer)).toThrow('must not exceed the current writer')
  })

  it('rejects empty, malformed, and URL-injecting evidence tags', () => {
    const { record, evidence } = sessionFormatReleaseFixture()
    for (const tag of [
      null, true, 1, '', ' ', 'dsh-v', record.evidenceTag.replace('dsh-v', 'v'),
      `${record.evidenceTag}/other`, `${record.evidenceTag}?query`, `${record.evidenceTag}#fragment`,
      `${record.evidenceTag}%2Fother`, `${record.evidenceTag})`, `${record.evidenceTag}\n`,
    ]) {
      const source = releaseDocument(`latestReleasedVersion: ${record.latestReleasedVersion}\nevidenceTag: ${JSON.stringify(tag)}`, evidence)
      expect(() => validateSessionFormatRelease(source, record.latestReleasedVersion), String(tag)).toThrow('dsh-v version tag')
    }
  })

  it('rejects absent or mismatched release tags and tagged writer paths', () => {
    const { record, body, evidence } = sessionFormatReleaseFixture()
    for (const invalid of [
      '',
      evidence.replace(record.evidenceTag, `${record.evidenceTag}-other`),
      evidence.replace(record.evidenceTag, 'main'),
      evidence.replace('packages/core/session/src/types.ts', 'packages/core/session/src/other.ts'),
      evidence.replace(record.evidenceTag, `${record.evidenceTag}?query`),
      evidence.replace('types.ts', 'types.ts#fragment'),
      evidence.replace('; tagged writer:', ';\n tagged writer:'),
    ]) {
      expect(() => validateSessionFormatRelease(releaseDocument(body, invalid), record.latestReleasedVersion), invalid)
        .toThrow('Missing matching evidence tag and tagged writer path')
    }
  })
})

describe('maintained documentation standards', () => {
  it('excludes private ignored documents and validates them after force-staging', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-doc-standard-'))
    const file = 'docs/persistence-changes/private.md'
    try {
      execFileSync('git', ['init', '--quiet', fixture])
      writeFileSync(join(fixture, '.gitignore'), 'docs/persistence-changes/\n')
      mkdirSync(join(fixture, 'docs/persistence-changes'), { recursive: true })
      writeFileSync(join(fixture, file), '---\nkind: invalid\n---\n')
      expect(maintainedDocuments('docs/persistence-changes/*.md', fixture)).toEqual([])
      execFileSync('git', ['-C', fixture, 'add', '-f', '--', file])
      expect(maintainedDocuments('docs/persistence-changes/*.md', fixture)).toEqual([file])
      expect(persistenceMetadataErrors('persistence-change', readFrontmatter(file, fixture))).toEqual([
        'kind must be persistence-change', 'description must be a non-empty string',
      ])
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('maps package README kinds to their documentation standards', () => {
    const files = packageReadmes()
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const metadata = readFrontmatter(file)
      expect(packageReadmeMetadataErrors(file, metadata), file).toEqual([])
    }
  })

  it('maps persistence transition records to their dedicated document kind', () => {
    const files = maintainedDocuments('docs/persistence-changes/*.md')
      .filter(file => !/\/README(?:\.zh)?\.md$/u.test(file.replaceAll('\\', '/')))
    for (const file of files) {
      const metadata = readFrontmatter(file)
      expect(persistenceMetadataErrors('persistence-change', metadata), file).toEqual([])
    }
  })

  it('maps retrospective release comparisons to their dedicated document kind', () => {
    const files = maintainedDocuments('docs/persistence-changes/releases/dsh-*.md')
    for (const file of files) {
      const metadata = readFrontmatter(file)
      expect(persistenceMetadataErrors('persistence-release', metadata), file).toEqual([])
    }
  })

  it('maps historical Session format references to their dedicated document kind', () => {
    const files = maintainedDocuments('docs/persistence-changes/historical-formats/v*.md')
    for (const file of files) {
      const metadata = readFrontmatter(file)
      expect(persistenceMetadataErrors('persistence-format', metadata), file).toEqual([])
    }
  })

  it('keeps the audited library registry accurate: every entry has a plain module entry and no bundle declaration', () => {
    for (const [dir, reason] of Object.entries(PACKAGE_LIBRARIES)) {
      expect(reason.trim().length, `${dir}: library justification`).toBeGreaterThan(0)
      expect(declaresBundle(dir), `${dir}: a bundle declaration makes this package-bundle, not a library`).toBe(false)
      const entry = resolve(root, dir, 'src/index.ts')
      expect(existsSync(entry), `${dir}: library entry`).toBe(true)
      const source = readFileSync(entry, 'utf8')
      expect(source, `${dir}: entry must be a plain module, not a plugin`).not.toMatch(/export (?:default|\{[^}]*default[^}]*\} from)/u)
      expect(source, `${dir}: entry must be a plain module, not a plugin`).not.toMatch(/export (?:async )?(?:function|const) apply\b/u)
    }
  })

  it('keeps every package README on the summary, contents, and Dev Note skeleton', () => {
    for (const file of packageReadmes().filter(file => file.split('/').length === 4)) {
      const source = readFileSync(resolve(root, file), 'utf8')
      expect(packageReadmeStructureErrors(file, source), file).toEqual([])
    }
  })

  it('rejects redundant fields and a kind that does not match the README position', () => {
    expect(packageReadmeMetadataErrors('packages/example/README.md', {
      description: 'Example group.',
      kind: 'package-reference',
      name: 'example',
      audience: ['developer'],
      tags: ['example'],
      i18n: { counterpart: 'README.zh.md' },
    })).toEqual([
      'kind must be package-group',
      'name is redundant or has no governed consumer',
      'audience is redundant or has no governed consumer',
      'tags is redundant or has no governed consumer',
      'i18n is redundant or has no governed consumer',
    ])
    expect(packageReadmeMetadataErrors('packages\\example\\package\\README.md', {
      description: 'Example package.',
      kind: 'package-reference',
    })).toEqual([])
  })

  it('rejects README-local i18n metadata', () => {
    expect(packageReadmeMetadataErrors('packages\\example\\package\\README.md', {
      description: 'Example package.',
      kind: 'package-reference',
      i18n: {
        'counterpart': 'packages/example/package/README.zh.md',
        'line-aligned': true,
      },
    })).toEqual([
      'i18n is redundant or has no governed consumer',
    ])
  })
})

describe('reference-example README pair', () => {
  const dir = 'packages/session/session-persistence-jsonl'

  it('keeps exact English/Chinese physical line alignment', () => {
    const sourceLines = readFileSync(resolve(root, dir, 'README.md'), 'utf8').split('\n').length
    const zhLines = readFileSync(resolve(root, dir, 'README.zh.md'), 'utf8').split('\n').length
    expect(sourceLines).toBe(zhLines)
  })

  it('keeps the sidecar consistency record present', () => {
    const sidecar = readFileSync(resolve(root, dir, 'README.i18n.yaml'), 'utf8')
    const record = parseTranslationPairingRecord(sidecar)
    expect(record).toBeDefined()
    expect(record?.size).toBeGreaterThan(0)
  })
})
