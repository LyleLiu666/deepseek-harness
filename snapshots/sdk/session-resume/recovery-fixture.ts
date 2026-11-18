/** Inspect the physical log after SDK resume has completed the torn frame. @module */
import { readFile } from 'node:fs/promises'
import { decompressZstdFrame, scanZstdFrames } from '../../../packages/session/session-persistence-jsonl/src/zstd.ts'

/**
 * Decode a repaired session's complete frames for the recorded-session comparison.
 * @param path - compressed session log.
 * @returns complete JSONL including the resumed turn.
 */
export async function readCompressedLog(path: string): Promise<string> {
  const bytes = await readFile(path)
  const { frames, tornStart } = scanZstdFrames(bytes)
  if (tornStart !== undefined) throw new Error('Resumed session still has a torn frame')
  return Buffer.concat(await Promise.all(frames.map(frame => decompressZstdFrame(bytes.subarray(frame.start, frame.end))))).toString('utf8')
}
