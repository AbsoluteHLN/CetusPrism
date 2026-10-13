import { describe, expect, it } from 'vitest'
import { parseTuiCommand, tuiCommandCompletions } from '../src/tui-commands.ts'

describe('TUI command parsing', () => {
  it('keeps prompt whitespace and escapes one leading slash', () => {
    expect(parseTuiCommand('  keep  this  ')).toEqual({ kind: 'prompt', text: '  keep  this  ' })
    expect(parseTuiCommand('//foo')).toEqual({ kind: 'prompt', text: '/foo' })
    expect(parseTuiCommand('///foo')).toEqual({ kind: 'prompt', text: '//foo' })
    expect(parseTuiCommand('  /HELP')).toEqual({ kind: 'help' })
    expect(parseTuiCommand('  //help')).toEqual({ kind: 'prompt', text: '  /help' })
  })

  it('preserves built-in command aliases', () => {
    const aliases: [string, string][] = [
      ['/help', 'help'], ['/?', 'help'], ['/exit', 'exit'], ['/quit', 'exit'],
      ['/sessions', 'sessions'], ['/ls', 'sessions'], ['/new', 'new'],
    ]
    for (const [line, kind] of aliases) expect(parseTuiCommand(line)).toEqual({ kind })
  })

  it('parses session, model, status, and team commands', () => {
    expect(parseTuiCommand('/resume session/識別子')).toEqual({ kind: 'resume', sessionId: 'session/識別子' })
    expect(parseTuiCommand('/models')).toEqual({ kind: 'models' })
    expect(parseTuiCommand('/models provider/版')).toEqual({ kind: 'models', provider: 'provider/版' })
    expect(parseTuiCommand('/model')).toEqual({ kind: 'model' })
    expect(parseTuiCommand('/model provider/版 模型/最新版')).toEqual({
      kind: 'model', provider: 'provider/版', model: '模型/最新版',
    })
    expect(parseTuiCommand('/status')).toEqual({ kind: 'status' })
    expect(parseTuiCommand('/team')).toEqual({ kind: 'team' })
  })

  it.each([
    ['/unknown', 'Unknown command: /unknown'],
    ['/help extra', 'Usage: /help'],
    ['/exit extra', 'Usage: /exit'],
    ['/sessions extra', 'Usage: /sessions'],
    ['/new extra', 'Usage: /new'],
    ['/resume', 'Usage: /resume <sessionId>'],
    ['/resume one two', 'Usage: /resume <sessionId>'],
    ['/models one two', 'Usage: /models [provider]'],
    ['/model one', 'Usage: /model [provider model]'],
    ['/model one two three', 'Usage: /model [provider model]'],
    ['/status extra', 'Usage: /status'],
    ['/team extra', 'Usage: /team'],
  ])('returns a clear invalid result for %s', (line, message) => {
    expect(parseTuiCommand(line)).toEqual({ kind: 'invalid', message })
  })
})

describe('TUI command completion', () => {
  it('completes only built-in commands and keeps readline input unchanged', () => {
    expect(tuiCommandCompletions('/')[0]).toEqual([
      '/help', '/?', '/exit', '/quit', '/sessions', '/ls', '/new',
      '/resume', '/models', '/model', '/status', '/team',
    ])
    expect(tuiCommandCompletions('/m')).toEqual([['/models', '/model'], '/m'])
    expect(tuiCommandCompletions('/qu')).toEqual([['/quit'], '/qu'])
    expect(tuiCommandCompletions('/resume session')).toEqual([[], '/resume session'])
    expect(tuiCommandCompletions('/model provider')).toEqual([[], '/model provider'])
  })

  it('does not complete prompts or the slash escape', () => {
    expect(tuiCommandCompletions('你好 👋')).toEqual([[], '你好 👋'])
    expect(tuiCommandCompletions('//foo')).toEqual([[], '//foo'])
  })
})
