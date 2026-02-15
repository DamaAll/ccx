/**
 * CursorReader：byte-offset based JSONL 差量讀取
 *
 * 每個 JSONL 檔案維護獨立狀態：
 * - UNRESOLVED: 每行的 raw text 都傳給 IdentityResolver 直到找到 teammate_id
 * - RESOLVED: 只累加 token counts + 維護 ring buffer
 *
 * 設計原則：
 * - 只存 offset + aggregated counts，不存全部 parsed records
 * - Line-boundary parsing：記錄 lastCompleteLineEndOffset
 * - Truncation detection：newSize < lastOffset → reset to 0
 */
import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { parseJournalLine } from './data-source-adapter.js'
import { addUsage, emptyUsage } from './pricing.js'
import type { FileCursor, TokenUsage, JournalEntry, CursorState } from './types.js'

const RING_BUFFER_SIZE = 20

export interface CursorReadResult {
  readonly newEntries: readonly JournalEntry[]
  readonly rawLines: readonly string[]
  readonly cursor: FileCursor
}

/**
 * 建立新的 FileCursor
 */
export function createCursor(path: string, agentId: string): FileCursor {
  return {
    path,
    agentId,
    lastByteOffset: 0,
    lastInode: 0,
    state: 'UNRESOLVED',
    resolvedName: null,
    accumulated: emptyUsage(),
    model: null,
    recentEntries: [],
  }
}

/**
 * 從 cursor 的 lastByteOffset 開始讀取新增內容
 * 回傳 parsed entries（有 usage 的行）和 raw lines（全部行，用於 identity resolve）
 */
export async function readIncremental(cursor: FileCursor): Promise<CursorReadResult> {
  const fileStat = await stat(cursor.path).catch(() => null)
  if (!fileStat) {
    return { newEntries: [], rawLines: [], cursor }
  }

  const currentInode = fileStat.ino
  const currentSize = fileStat.size

  // Truncation/replacement detection
  const wasReplaced = cursor.lastInode !== 0 && currentInode !== cursor.lastInode
  const wasTruncated = currentSize < cursor.lastByteOffset

  let startOffset = cursor.lastByteOffset
  let resetAccumulated = cursor.accumulated

  if (wasReplaced || wasTruncated) {
    startOffset = 0
    resetAccumulated = emptyUsage()
  }

  if (currentSize <= startOffset) {
    return {
      newEntries: [],
      rawLines: [],
      cursor: { ...cursor, lastInode: currentInode },
    }
  }

  // 讀取新增部分
  const { entries, rawLines, bytesRead } = await readLines(cursor.path, startOffset, currentSize)

  // 累加 token usage
  let accumulated = resetAccumulated
  let model = cursor.model
  for (const entry of entries) {
    accumulated = addUsage(accumulated, entry.message.usage)
    if (!model && entry.message.model) {
      model = entry.message.model
    }
  }

  // 更新 ring buffer
  const existingRecent = wasReplaced || wasTruncated ? [] : [...cursor.recentEntries]
  const allRecent = [...existingRecent, ...entries]
  const recentEntries = allRecent.slice(-RING_BUFFER_SIZE)

  const updatedCursor: FileCursor = {
    ...cursor,
    lastByteOffset: startOffset + bytesRead,
    lastInode: currentInode,
    accumulated,
    model,
    recentEntries,
  }

  return { newEntries: entries, rawLines, cursor: updatedCursor }
}

/**
 * Full scan：從頭讀取整個檔案（startup 用）
 */
export async function readFull(path: string, agentId: string): Promise<CursorReadResult> {
  const cursor = createCursor(path, agentId)
  return readIncremental(cursor)
}

/**
 * 更新 cursor 的 identity 狀態
 */
export function resolveCursorIdentity(
  cursor: FileCursor,
  name: string,
): FileCursor {
  return {
    ...cursor,
    state: 'RESOLVED' as CursorState,
    resolvedName: name,
  }
}

// ─── Internal ───

interface ReadLinesResult {
  readonly entries: JournalEntry[]
  readonly rawLines: string[]
  readonly bytesRead: number
}

async function readLines(
  filePath: string,
  startOffset: number,
  endOffset: number
): Promise<ReadLinesResult> {
  const entries: JournalEntry[] = []
  const rawLines: string[] = []
  let bytesRead = 0

  const stream = createReadStream(filePath, {
    start: startOffset,
    end: endOffset - 1,
    encoding: 'utf-8',
  })

  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  let lastCompleteLineEnd = 0

  for await (const line of rl) {
    const lineBytes = Buffer.byteLength(line, 'utf-8') + 1 // +1 for newline
    lastCompleteLineEnd += lineBytes

    rawLines.push(line)

    const result = parseJournalLine(line)
    if (result.ok) {
      entries.push(result.data)
    }
  }

  stream.destroy()
  bytesRead = lastCompleteLineEnd

  return { entries, rawLines, bytesRead }
}
