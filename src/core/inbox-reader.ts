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

function parseMessageType(text: string): KnownMessageType | null {
  // inbox messages 裡的 text 可能包含 JSON，也可能是純文字
  // 嘗試解析 JSON 中的 type 欄位
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      return parsed.type as KnownMessageType
    }
  } catch {
    // 純文字 — 用關鍵字比對
  }

  if (text.includes('idle')) return 'idle_notification'
  if (text.includes('shutdown_approved') || text.includes('shutdown approved')) return 'shutdown_approved'
  if (text.includes('shutdown')) return 'shutdown_request'
  if (text.includes('task_completed') || text.includes('完成')) return 'task_completed'
  if (text.includes('task_assignment')) return 'task_assignment'

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
