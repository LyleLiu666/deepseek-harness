import { spawnSync } from 'node:child_process'
import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'
import { logPath } from '../src/format.ts'
import { compressZstdFrame } from '../src/zstd.ts'

const child = fileURLToPath(new URL('./fixtures/crash-during-repair.mjs', import.meta.url))
const crashPoints = process.platform === 'win32' ? ['after-file-sync'] : ['after-file-sync', 'before-directory-sync']

it.each(crashPoints)('preserves every readable event across a writer crash at %s', async (point) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-repair-crash-'))
  const ctx = new Context()
  try {
    await ctx.plugin(JsonlSessionPersistence, { root })
    const header = meta('crash-repair', '/project')
    const initial = oneTurnLog()
    const tail: SessionEvent = { type: 'turn/start', seq: SessionSeq(6), time: 7, data: { turn: 2 } }
    const next: SessionEvent = { type: 'turn/end', seq: SessionSeq(7), time: 8, data: { turn: 2, reason: { kind: 'interrupted' } } }
    const created = await ctx.sessionPersistence.create(header)
    await created.append(initial)
    await created.close()
    const path = logPath(root, header.cwd, header.id, 'zstd')
    const frame = await compressZstdFrame(JSON.stringify(tail) + '\n')
    await appendFile(path, frame.subarray(0, -1))
    const before = await ctx.sessionPersistence.open(header.id, 'read')
    const { events } = await before.read()
    expect(events).toEqual([...initial, tail])
    await before.close()

    const crash = spawnSync(process.execPath, [child, root, path, header.id, point], { timeout: 15_000, encoding: 'utf8', killSignal: 'SIGKILL' })
    expect(crash.error).toBeUndefined()
    if (process.platform === 'win32') expect(crash.status, crash.stderr).toBe(86)
    else expect(crash.signal, crash.stderr).toBe('SIGKILL')
    const resumed = await ctx.sessionPersistence.open(header.id, 'write')
    expect((await resumed.read()).events).toEqual(events)
    await resumed.append([next])
    await resumed.close()
    const final = await ctx.sessionPersistence.open(header.id, 'read')
    expect((await final.read()).events).toEqual([...events, next])
    await final.close()
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
