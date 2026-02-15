/**
 * IdentityResolver：從 JSONL raw content 確定性匹配 agentId → agent name
 *
 * 映射路徑：
 * 1. 掃描 JSONL 行的 raw text，找 `teammate_id="<name>"` pattern
 * 2. 一旦找到 → 標記為 RESOLVED
 * 3. 交叉比對 inbox 檔名確認
 *
 * 關鍵：teammate_id 在 message.content 裡，不在 parsed JournalEntry 裡
 * 所以必須用 raw line text 而非 parsed entry
 */
import type { FileCursor } from './types.js'
import { resolveCursorIdentity } from './cursor-reader.js'

// 匹配 teammate_id=\"name\" 或 teammate_id="name"
const TEAMMATE_ID_RE = /teammate_id\\?"?=?\\?"([a-zA-Z0-9_-]+)\\?"/

/**
 * 嘗試從 raw JSONL lines 中解析 agent name
 * 在 UNRESOLVED 狀態下，每次 CursorReader 讀到新行時呼叫
 */
export function tryResolveFromRawLines(
  cursor: FileCursor,
  rawLines: readonly string[]
): FileCursor {
  if (cursor.state === 'RESOLVED') return cursor

  for (const line of rawLines) {
    const name = extractTeammateIdFromRaw(line)
    if (name) {
      return resolveCursorIdentity(cursor, name)
    }
  }

  return cursor
}

/**
 * 從 raw JSONL line text 中提取 teammate_id
 *
 * JSONL 行範例（已 JSON-escaped）：
 * {...,"content":"<teammate-message teammate_id=\"syntax-fixer\" color=\"blue\">\n..."}
 */
function extractTeammateIdFromRaw(line: string): string | null {
  const match = line.match(TEAMMATE_ID_RE)
  if (match && match[1]) {
    return match[1]
  }
  return null
}

/**
 * Batch resolve：startup 時對所有 cursors 做一次全量匹配
 * rawLinesMap: agentId → raw lines from full scan
 */
export function batchResolve(
  cursors: readonly FileCursor[],
  rawLinesMap: ReadonlyMap<string, readonly string[]>,
): FileCursor[] {
  return cursors.map(cursor => {
    if (cursor.state === 'RESOLVED') return cursor

    const rawLines = rawLinesMap.get(cursor.agentId)
    if (rawLines) {
      return tryResolveFromRawLines(cursor, rawLines)
    }
    return cursor
  })
}

/**
 * 為 UNRESOLVED cursor 生成顯示名稱
 */
export function getDisplayName(cursor: FileCursor): string {
  if (cursor.resolvedName) return cursor.resolvedName
  return `agent-${cursor.agentId}`
}
