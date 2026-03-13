/**
 * InboxReader：讀取 ~/.claude/teams/{team}/inboxes/*.json
 * 從 inbox messages 推斷 agent 狀態
 */
import { readFile, readdir } from 'node:fs/promises'
import { claudePaths } from './paths.js'
import { InboxMessageSchema, safeParseJsonArray } from './data-source-adapter.js'
import type { InboxMessage, AgentStatus } from './types.js'

export interface InboxData {
  readonly agentName: string
  readonly messages: readonly InboxMessage[]
  readonly lastMessage: InboxMessage | null
  readonly inferredStatus: AgentStatus
}

/**
 * 讀取單一 agent 的 inbox
 */
export async function readInbox(teamName: string, agentName: string): Promise<InboxData | null> {
  const inboxPath = claudePaths.teamInbox(teamName, agentName)
  try {
    const raw = await readFile(inboxPath, 'utf-8')
    const result = safeParseJsonArray(raw, InboxMessageSchema)
    if (!result.ok) return null

    const messages = result.data
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null
    const inferredStatus = inferStatusFromMessages(messages)

    return { agentName, messages, lastMessage, inferredStatus }
  } catch {
    return null
  }
}

/**
 * 讀取 team 所有 inbox
 */
export async function readAllInboxes(teamName: string): Promise<InboxData[]> {
  const dir = claudePaths.teamInboxes(teamName)
  try {
    const entries = await readdir(dir)
    const jsonFiles = entries.filter(f => f.endsWith('.json'))
    const inboxes = await Promise.all(
      jsonFiles.map(async (filename) => {
        const agentName = filename.replace('.json', '')
        return readInbox(teamName, agentName)
      })
    )
    return inboxes.filter((i): i is InboxData => i !== null)
  } catch {
    return []
  }
}

/**
 * 從 inbox messages 列出所有 agent 名稱
 */
export function extractAgentNamesFromInboxes(inboxes: readonly InboxData[]): string[] {
  const names = new Set<string>()
  for (const inbox of inboxes) {
    names.add(inbox.agentName)
    for (const msg of inbox.messages) {
      if (msg.from) names.add(msg.from)
    }
  }
  return [...names].sort()
}

// ─── 狀態推斷 ───

function inferStatusFromMessages(messages: readonly InboxMessage[]): AgentStatus {
  if (messages.length === 0) return 'unknown'

  // 從最後一條往前找 type 線索
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgType = parseMessageType(messages[i].text)
    if (msgType) {
      return mapMessageTypeToStatus(msgType)
    }
  }

  return 'unknown'
}

type KnownMessageType =
  | 'idle_notification'
  | 'shutdown_request'
  | 'shutdown_approved'
  | 'task_assignment'
  | 'task_completed'

const VALID_MESSAGE_TYPES = new Set<KnownMessageType>([
  'idle_notification',
  'shutdown_request',
  'shutdown_approved',
  'task_assignment',
  'task_completed',
])

// 文字 fallback 匹配規則 — 順序重要：更具體的 pattern 在前
const TEXT_FALLBACK_PATTERNS: readonly { pattern: RegExp; type: KnownMessageType }[] = [
  { pattern: /shutdown[_\s]?approved/i, type: 'shutdown_approved' },
  { pattern: /shutdown[_\s]?request/i, type: 'shutdown_request' },
  { pattern: /\bshutdown\b/i, type: 'shutdown_request' },
  { pattern: /task[_\s]?completed|完成/i, type: 'task_completed' },
  { pattern: /task[_\s]?assignment/i, type: 'task_assignment' },
  { pattern: /\bidle\b/i, type: 'idle_notification' },
]

function parseMessageType(text: string): KnownMessageType | null {
  // 優先：嘗試解析 JSON 中的 type 欄位
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      const candidate = parsed.type as string
      if (VALID_MESSAGE_TYPES.has(candidate as KnownMessageType)) {
        return candidate as KnownMessageType
      }
    }
  } catch {
    // 非 JSON — 使用文字 fallback
  }

  // Fallback：case-insensitive regex 匹配，更具體的 pattern 優先
  for (const { pattern, type } of TEXT_FALLBACK_PATTERNS) {
    if (pattern.test(text)) return type
  }

  return null
}

function mapMessageTypeToStatus(msgType: KnownMessageType): AgentStatus {
  switch (msgType) {
    case 'idle_notification': return 'idle'
    case 'shutdown_approved': return 'shutdown'
    case 'shutdown_request': return 'idle' // 收到 shutdown request 但還沒 approve
    case 'task_assignment': return 'working'
    case 'task_completed': return 'done'
  }
}
