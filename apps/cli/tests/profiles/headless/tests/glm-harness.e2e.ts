/** Exercises the opt-in GLM composition through the supported CLI and a local wire endpoint. */
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleMode, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { decompressZstdFrame, scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'
import { expect, it } from 'vitest'

const repo = fileURLToPath(new URL('../../../../../../', import.meta.url))
const overlay = join(repo, 'apps/cli/config/examples/glm-harness/cordis.yml')

it('keeps explicit GLM reasoning, tool history, and coding guidance in a real headless session', async () => {
  const requests: Record<string, unknown>[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8').on('data', (part: string) => { body += part })
    request.on('end', () => {
      const payload = JSON.parse(body) as Record<string, unknown>
      const isAgent = Array.isArray(payload.tools) && payload.tools.length > 0
      if (isAgent) requests.push(payload)
      const first = requests.length === 1
      const delta = !isAgent ? { content: 'GLM smoke' } : first
        ? {
            reasoning_content: 'Inspect the task and record evidence.',
            tool_calls: [{ index: 0, id: 'glm-plan', type: 'function', function: {
              name: 'todo_write', arguments: JSON.stringify({ todos: [{ content: 'Inspect project', status: 'completed' }] }),
            } }],
          }
        : { content: 'GLM_LOCAL_SMOKE_DONE' }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const choice of [{ delta, finish_reason: null }, { delta: {}, finish_reason: isAgent && first ? 'tool_calls' : 'stop' }]) {
        response.write(`data: ${JSON.stringify({ id: 'glm-smoke', object: 'chat.completion.chunk', model: 'gateway-glm', choices: [{ index: 0, ...choice }] })}\n\n`)
      }
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('GLM fixture did not bind')
    const output = await runLoaderSmoke({
      label: 'GLM harness headless composition',
      binScript: join(repo, 'apps/cli/src/bin.ts'),
      tsconfigPath: join(repo, 'configs/tsconfig.base.json'),
      mode: resolveExampleMode(),
      sourceImport: 'tsx/esm',
      configPath: overlay,
      binArgs: ['--profile', 'headless', '--patch', overlay, '--plain', 'Record a completed inspection task and report.'],
      tempDirPrefix: 'cetus-glm-smoke-',
      env: {
        DSH_TELEMETRY_DISABLED: '1',
        DSH_PERMISSION_MODE: 'danger-full-access',
        CETUS_GLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        CETUS_GLM_API_KEY: 'local-fixture-key',
        CETUS_GLM_MODEL: 'gateway-glm',
        CETUS_GLM_CONTEXT_WINDOW: '200000',
        CETUS_GLM_MAX_TOKENS: '4096',
      },
      inspect: async (cwd) => {
        const home = join(cwd, '.dsh')
        const entries = await readdir(home, { recursive: true })
        const logs = entries.filter(path => /session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(path))
        expect(logs.length).toBeGreaterThan(0)
        const contents = await Promise.all(logs.map(async (path) => {
          const data = await readFile(join(home, path))
          if (!path.endsWith('.zstd')) return data.toString('utf8')
          const scan = scanZstdFrames(data)
          expect(scan.tornStart).toBeUndefined()
          const frames = await Promise.all(scan.frames.map(({ start, end }) => decompressZstdFrame(data.subarray(start, end))))
          return Buffer.concat(frames).toString('utf8')
        }))
        const persisted = contents.join('\n')
        expect(persisted).toContain('Inspect the relevant files and repository instructions')
        expect(persisted).toContain('todo/write')
        expect(persisted).toContain('GLM_LOCAL_SMOKE_DONE')
        expect(persisted).not.toContain('local-fixture-key')
      },
    })
    expect(output.stdout).toContain('GLM_LOCAL_SMOKE_DONE')
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ model: 'gateway-glm', reasoning_effort: 'high', max_tokens: 4096 })
    expect(requests[1]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', reasoning_content: 'Inspect the task and record evidence.' }),
        expect.objectContaining({ role: 'tool', tool_call_id: 'glm-plan' }),
      ]),
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()) })
  }
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

it('rejects an invalid gateway token capacity while loading the composition', async () => {
  const output = await runLoaderSmoke({
    label: 'GLM harness invalid capacity',
    binScript: join(repo, 'apps/cli/src/bin.ts'),
    tsconfigPath: join(repo, 'configs/tsconfig.base.json'),
    mode: resolveExampleMode(),
    sourceImport: 'tsx/esm',
    configPath: overlay,
    binArgs: ['--profile', 'headless', '--patch', overlay, '--plain', 'Must not reach a model.'],
    tempDirPrefix: 'cetus-glm-invalid-',
    expectedExitCode: 1,
    env: {
      DSH_TELEMETRY_DISABLED: '1',
      CETUS_GLM_BASE_URL: 'http://127.0.0.1:1/v1',
      CETUS_GLM_API_KEY: 'local-fixture-key',
      CETUS_GLM_MODEL: 'gateway-glm',
      CETUS_GLM_CONTEXT_WINDOW: '200000',
      CETUS_GLM_MAX_TOKENS: '0',
    },
  })
  expect(output.stderr).toContain('maxTokens')
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
