/**
 * The one-shot and interactive app's ordinary command-line provider over a real Loader tree:
 * the task, exact Session identity, and output mode become injected runner
 * config, while help and usage errors leave the consumer pending.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals as cmdlineInternals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply,
  HEADLESS_STARTUP_SERVICE,
  type HeadlessStartupValues,
} from '../src/startup.ts'
import { internals as startupInternals } from '../src/startup-internals.ts'

/** What one boot of the fixture tree observed. */
interface Observed {
  exits: number[]
  out: string
  err: string
  runnerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

/** The real process facts captured before any test substitutes them. */
const originalInternals = { ...startupInternals }

/** Fixture tree roots, removed after their booted tree has been disposed. */
const tempDirs: string[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  cmdlineInternals.stdout = process.stdout
  cmdlineInternals.stderr = process.stderr
  startupInternals.stdinIsTty = () => process.stdin.isTTY
  startupInternals.stdout = process.stdout
})

/**
 * Mount the real provider over a runner stand-in.
 * @param args - the invocation's inner arguments.
 * @param options - process facts the provider reads.
 * @returns the resolved service value and observed runner/process effects.
 */
async function bootStartup(
  args: string[],
  options: { stdinIsTty?: boolean } = {},
): Promise<{ task: HeadlessStartupValues | undefined; observed: Observed }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-headless-startup-'))
  tempDirs.push(dir)
  const observed: Observed = { exits: [], out: '', err: '' }
  writeFileSync(join(dir, 'row.mjs'), 'export function apply(_ctx, config) { globalThis.__headlessStartupObserved.runnerConfig = config }\n')
  // Loader imports through Node's resolver, so this fixture delegates to the
  // source-plane plugin already imported by the test.
  writeFileSync(join(dir, 'startup.mjs'), `
export const name = 'headless-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__headlessStartupApply(ctx)
`)
  const rowUrl = pathToFileURL(join(dir, 'row.mjs')).href
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: headless-runner',
    `  name: ${rowUrl}`,
    `  inject: [${HEADLESS_STARTUP_SERVICE}]`,
    '  config:',
    '    task: !!js ctx.headlessStartup.task',
    '    sessionId: !!js ctx.headlessStartup.sessionId',
    '    json: !!js ctx.headlessStartup.json',
    '    tui: !!js ctx.headlessStartup.tui',
    '    plain: !!js ctx.headlessStartup.plain',
    '    interactive: !!js ctx.headlessStartup.interactive',
    '    oneShot: !!js ctx.headlessStartup.oneShot',
    '- id: headless-startup',
    `  name: ${pathToFileURL(join(dir, 'startup.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  // Commander's own output keeps landing in `out` so existing assertions see
  // the full transcript, while `err` isolates what stderr actually carried.
  const observingErr = {
    write: (chunk: string) => {
      observed.out += chunk
      observed.err += chunk
      return true
    },
  }
  cmdlineInternals.stdout = observing
  cmdlineInternals.stderr = observingErr
  startupInternals.stdinIsTty = () => options.stdinIsTty === true
  startupInternals.stdout = observing
  const globals = globalThis as unknown as {
    __headlessStartupApply: typeof apply
    __headlessStartupObserved: Observed
  }
  globals.__headlessStartupApply = apply
  globals.__headlessStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    task: ctx.get(HEADLESS_STARTUP_SERVICE) as HeadlessStartupValues | undefined,
    observed,
  }
}

describe('headless command-line provider', () => {
  it('joins the task positional into the runner config', async () => {
    const { task, observed } = await bootStartup(['run', 'the', 'tests'])
    expect(task).toEqual({ task: 'run the tests', sessionId: undefined, json: false, tui: false, plain: false, interactive: false, oneShot: false })
    expect(observed.runnerConfig).toMatchObject({ task: 'run the tests', json: false })
    expect(observed.exits).toEqual([])
  })

  it('publishes the machine-readable output mode and the exact Session identity', async () => {
    const { task, observed } = await bootStartup(['--json', '--session-id', 'session-exact', 'do', 'it'])
    expect(task).toEqual({ task: 'do it', sessionId: 'session-exact', json: true, tui: false, plain: false, interactive: false, oneShot: false })
    expect(observed.runnerConfig).toMatchObject({ task: 'do it', sessionId: 'session-exact', json: true })
  })

  it('keeps the stdin marker as the task so the runner reads the pipe', async () => {
    const { task } = await bootStartup(['-'], { stdinIsTty: false })
    expect(task).toEqual({ task: '-', sessionId: undefined, json: false, tui: false, plain: false, interactive: false, oneShot: false })
  })

  it('defers an absent task to stdin when stdin is not a terminal', async () => {
    const { task, observed } = await bootStartup([], { stdinIsTty: false })
    expect(task).toEqual({ task: undefined, sessionId: undefined, json: false, tui: false, plain: false, interactive: false, oneShot: false })
    expect(observed.runnerConfig).toMatchObject({ json: false })
  })

  it('publishes interactive mode on a terminal when no task is provided', async () => {
    const { task, observed } = await bootStartup([], { stdinIsTty: true })
    expect(task).toEqual({
      task: undefined,
      sessionId: undefined,
      json: false,
      tui: false,
      plain: false,
      interactive: true,
      oneShot: false,
    })
    expect(observed.runnerConfig).toMatchObject({ interactive: true })
    expect(observed.exits).toEqual([])
  })

  it('rejects an interactive invocation with a blank task', async () => {
    const { task, observed } = await bootStartup(['   '], { stdinIsTty: true })
    expect(observed.out).toContain('a task is required')
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('rejects an invocation with no task when --one-shot is specified on a terminal', async () => {
    const { task, observed } = await bootStartup(['--one-shot'], { stdinIsTty: true })
    expect(observed.out).toContain('a task is required')
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('publishes interactive mode when -i is passed with a task', async () => {
    const { task, observed } = await bootStartup(['-i', 'do', 'it'])
    expect(task).toEqual({
      task: 'do it',
      sessionId: undefined,
      json: false,
      tui: false,
      plain: false,
      interactive: true,
      oneShot: false,
    })
    expect(observed.runnerConfig).toMatchObject({ task: 'do it', interactive: true })
  })

  it('rejects mutually exclusive combinations with --interactive', async () => {
    const jsonInt = await bootStartup(['--json', '--interactive'])
    expect(jsonInt.observed.out).toContain('--json and --interactive are mutually exclusive')
    expect(jsonInt.observed.exits).toEqual([1])

    const oneShotInt = await bootStartup(['--one-shot', '--interactive'])
    expect(oneShotInt.observed.out).toContain('--one-shot and --interactive are mutually exclusive')
    expect(oneShotInt.observed.exits).toEqual([1])
  })

  it('rejects an explicitly empty Session identity', async () => {
    const { task, observed } = await bootStartup(['--session-id', '', 'do', 'it'])
    expect(observed.out).toContain('--session-id requires a non-empty session id')
    expect(task).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('keeps the caller-provided exact Session identity verbatim', async () => {
    const { task } = await bootStartup(['--session-id', ' session-x ', 'do', 'it'])
    expect(task).toEqual({ task: 'do it', sessionId: ' session-x ', json: false, tui: false, plain: false, interactive: false, oneShot: false })
  })

  it('rejects a lone stdin marker mixed with other task words', async () => {
    const { task, observed } = await bootStartup(['-', 'do', 'it'])
    expect(observed.out).toContain('`-` must be the only task argument')
    expect(task).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('writes the JSON error event for a --json usage error', async () => {
    const { task, observed } = await bootStartup(['--json'], { stdinIsTty: true })
    const first = JSON.parse(observed.out.trim().split('\n')[0] ?? '{}') as { type: string; message: string }
    expect(first).toEqual({
      type: 'error',
      message: 'a task is required, for example: dsh --profile headless "run the tests"',
    })
    expect(task).toBeUndefined()
    expect(observed.err).toBe('')
    expect(observed.exits).toEqual([1])
  })

  it('writes the JSON error event for an empty Session identity in --json mode', async () => {
    const { observed } = await bootStartup(['--json', '--session-id', '', 'do', 'it'])
    const first = JSON.parse(observed.out.trim().split('\n')[0] ?? '{}') as { type: string; message: string }
    expect(first.type).toBe('error')
    expect(first.message).toContain('--session-id requires a non-empty session id')
    expect(observed.err).toBe('')
    expect(observed.exits).toEqual([1])
  })

  it('writes the JSON error event for a commander grammar rejection in --json mode', async () => {
    const { task, observed } = await bootStartup(['--json', '--bogus', 'do', 'it'])
    const first = JSON.parse(observed.out.trim().split('\n')[0] ?? '{}') as { type: string; message: string }
    expect(first).toEqual({ type: 'error', message: "unknown option '--bogus'" })
    expect(task).toBeUndefined()
    expect(observed.err).toBe('')
    expect(observed.exits).toEqual([1])
  })

  it('does not install the JSON error override for a --json option value', async () => {
    const { observed } = await bootStartup(['--one-shot', '--session-id', '--json'], { stdinIsTty: true })
    expect(observed.out).toContain('a task is required')
    expect(observed.out).not.toContain('"type":"error"')
    expect(observed.exits).toEqual([1])
  })

  it('does not install the JSON error override for a --json positional after --', async () => {
    const { task, observed } = await bootStartup(['--', '--json'], { stdinIsTty: false })
    expect(task).toEqual({ task: '--json', sessionId: undefined, json: false, tui: false, plain: false, interactive: false, oneShot: false })
    expect(observed.out).not.toContain('"type":"error"')
  })

  it('rejects a blank positional task instead of reading stdin', async () => {
    const { task, observed } = await bootStartup(['   '], { stdinIsTty: false })
    expect(observed.out).toContain('a task is required')
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('reports the real process stdin terminal state by default', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'stdin')
    Object.defineProperty(process, 'stdin', { value: { isTTY: true }, configurable: true })
    try {
      expect(originalInternals.stdinIsTty()).toBe(true)
    } finally {
      if (original !== undefined) Object.defineProperty(process, 'stdin', original)
    }
  })

  it('fails loud without the launcher command line and exit request', () => {
    expect(() => { apply(new Context()) }).toThrow('the launcher must provide ctx.cmdlineArgs and ctx.appExit')
  })

  it('prints its own help and leaves the runner pending', async () => {
    const { task, observed } = await bootStartup(['--help'])
    expect(observed.out).toContain('dsh --profile headless')
    expect(observed.out).toContain('on a terminal the run renders as a live UI')
    expect(observed.out).toContain('--session-id')
    expect(observed.out).toContain('--tui')
    expect(observed.out).toContain('--plain')
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })

  it('publishes the live-UI and classic-output modes from their flags', async () => {
    const tui = await bootStartup(['--tui', 'do', 'it'])
    expect(tui.task).toEqual({ task: 'do it', sessionId: undefined, json: false, tui: true, plain: false, interactive: false, oneShot: false })
    expect(tui.observed.runnerConfig).toMatchObject({ tui: true, plain: false })

    const plain = await bootStartup(['--plain', 'do', 'it'])
    expect(plain.task).toEqual({ task: 'do it', sessionId: undefined, json: false, tui: false, plain: true, interactive: false, oneShot: false })
    expect(plain.observed.runnerConfig).toMatchObject({ tui: false, plain: true })
  })

  it('rejects --json and --tui as conflicting stdout contracts', async () => {
    const { task, observed } = await bootStartup(['--json', '--tui', 'do', 'it'])
    expect(observed.out).toContain('--json and --tui are mutually exclusive')
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })
})
