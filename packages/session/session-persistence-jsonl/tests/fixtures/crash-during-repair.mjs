/** Kill the writer at a filesystem sync point, bypassing handle cleanup. */
import { open } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

const [root, path, id, point] = process.argv.slice(2)
const ctx = new Context()
await ctx.plugin(JsonlSessionPersistence, { root })
const writer = await ctx.sessionPersistence.open(id, 'write')
const probe = await open(path, 'r')
const prototype = Object.getPrototypeOf(probe)
await probe.close()
// Windows reports self-termination as an exit code rather than a POSIX signal.
function crash() {
  if (process.platform === 'win32') process.exit(86)
  process.kill(process.pid, 'SIGKILL')
}
const sync = prototype.sync
prototype.sync = async function () {
  if (point === 'before-directory-sync' && (await this.stat()).isDirectory()) crash()
  await sync.call(this)
  if (point === 'after-file-sync' && (await this.stat()).isFile()) crash()
}
await writer.append([{ type: 'turn/end', seq: 7, time: 8, data: { turn: 2, reason: { kind: 'interrupted' } } }])
throw new Error('Writer finished without reaching the requested crash point')
