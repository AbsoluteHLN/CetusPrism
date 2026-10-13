/** Real profile acceptance for model validation, persistent turns, and resumed routing. */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

it('validates model changes and restores the admitted route in a second CLI process', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-persistent-tui-'))
  try {
    const home = join(cwd, '.dsh')
    const sessions = join(home, 'sessions')
    const profile = join(home, 'profiles', 'headless')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-headless', private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
    }) + '\n')
    const fixture = pathToFileURL(fileURLToPath(new URL('./fixtures/tui-llm.mjs', import.meta.url))).href
    await writeFile(join(profile, 'cordis.patch.yml'), [
      '- id: llm-deepseek', '  disabled: true',
      '- id: session-persistence-jsonl', '  config:', `    root: '${sessions}'`, '    compression: none',
      '- insert:', '    - id: tui-fixture-llm', `      name: '${fixture}'`, '',
    ].join('\n'))
    const launch = (args: string[], input: string) => {
      const resolved = resolveExampleLaunch({
        srcBin: fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url)),
        tsconfigPath: fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url)),
        sourceImport: 'tsx/esm', configArgs: ['--profile', 'headless', '--interactive', ...args],
        env: { DSH_HOME: home, DSH_AGENTS_HOME: join(cwd, '.agents'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: '' },
      })
      return execa(resolved.command, resolved.args, {
        cwd, env: resolved.env, input, timeout: 90_000, killSignal: 'SIGKILL', reject: false,
      })
    }
    const first = await launch([], [
      '/models', '/model deepseek-official tui-second', '/model deepseek-official absent',
      '/models unmounted', '/unknown', '/team', 'first', 'second', '/status', '/exit', '',
    ].join('\n'))
    expect(first.exitCode, first.stderr).toBe(0)
    expect(first.stdout).toContain('Selected deepseek-official/tui-second')
    expect(first.stdout).toContain('Model selection failed: model is not advertised')
    expect(first.stdout).toContain('unmounted')
    expect(first.stdout).toContain('Unknown command: /unknown')
    expect(first.stdout).toContain('Agent Teams is not enabled')
    expect(first.stdout.match(/TUI_REPLY_tui-second/g), first.stdout + '\n' + first.stderr).toHaveLength(2)
    const identity = first.stdout.match(/persistent TUI — session (\S+)/)?.[1]
    expect(identity).toBeDefined()
    const second = await launch(['--resume', identity!], 'third\n/exit\n')
    expect(second.exitCode, second.stderr).toBe(0)
    expect(second.stdout).toContain('TUI_REPLY_tui-second')
    const files = (await readdir(sessions, { recursive: true })).filter(file => file.endsWith('.jsonl'))
    expect(files).toHaveLength(1)
    const log = await readFile(join(sessions, files[0]!), 'utf8')
    const records = log.split('\n').filter(Boolean).map(line => JSON.parse(line) as { type: string; data?: { source?: { kind: string }; content?: { text?: string }[] } })
    expect(records.filter(record => record.type === 'user/message' && record.data?.source?.kind === 'user').map(record => record.data?.content?.[0]?.text))
      .toEqual(['first', 'second', 'third'])
    expect(log).toContain('tui-second')
    expect(log).not.toContain('"model":"absent"')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
