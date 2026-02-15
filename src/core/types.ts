/**
 * ccx 核心型別定義
 *
 * Claude Code 原始資料型別直接從 zod schema 推導（見 data-source-adapter.ts）
 * 這裡只定義 ccx 內部狀態型別
 */
import type { z } from 'zod'
import type {
  TeamConfigSchema,
  TeamMemberSchema,
  TaskDataSchema,
  InboxMessageSchema,
  JournalEntrySchema,
} from './data-source-adapter.js'

// ─── 從 zod schema 推導的 Claude Code 原始資料型別 ───

export type TeamConfig = z.output<typeof TeamConfigSchema>
export type TeamMember = z.output<typeof TeamMemberSchema>
export type TaskData = z.output<typeof TaskDataSchema>
export type InboxMessage = z.output<typeof InboxMessageSchema>
export type JournalEntry = z.output<typeof JournalEntrySchema>

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

// ─── Token Usage（手動定義，pricing.ts 核心） ───

export interface TokenUsage {
  readonly input_tokens: number
  readonly output_tokens: number
  readonly cache_creation_input_tokens: number
  readonly cache_read_input_tokens: number
}

// ─── ccx 內部狀態 ───

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'stuck' | 'done' | 'shutdown' | 'unknown'

export interface AgentState {
  readonly agentId: string
  readonly name: string
  readonly model: string
  readonly status: AgentStatus
  readonly tokenUsage: TokenUsage
  readonly cost: number
  readonly lastActivityAt: number
  readonly lastActivity: string
  readonly identityConfidence: IdentityConfidence
}

export type IdentityConfidence = 'high' | 'medium' | 'low'

export interface TeamState {
  readonly teamName: string
  readonly startedAt: number
  readonly elapsedMs: number
  readonly agents: readonly AgentState[]
  readonly tasks: readonly TaskData[]
  readonly totalCost: number
  readonly totalTokens: TokenUsage
  readonly alerts: readonly Alert[]
  readonly isActive: boolean
}

export interface Alert {
  readonly level: 'info' | 'warning' | 'critical'
  readonly message: string
  readonly timestamp: number
}

// ─── CursorReader 狀態 ───

export type CursorState = 'UNRESOLVED' | 'RESOLVED'

export interface FileCursor {
  readonly path: string
  readonly agentId: string
  readonly lastByteOffset: number
  readonly lastInode: number
  readonly state: CursorState
  readonly resolvedName: string | null
  readonly accumulated: TokenUsage
  readonly model: string | null
  readonly recentEntries: readonly JournalEntry[]
}

// ─── Snapshot ───

export interface SessionSnapshot {
  readonly teamName: string
  readonly sessionId: string
  readonly startedAt: number
  readonly lastUpdatedAt: number
  readonly finalized: boolean
  readonly agents: readonly AgentSnapshotEntry[]
  readonly tasks: readonly TaskData[]
  readonly totalCost: number
  readonly totalTokens: TokenUsage
  readonly alerts: readonly Alert[]
}

export interface AgentSnapshotEntry {
  readonly agentId: string
  readonly name: string
  readonly model: string
  readonly tokenUsage: TokenUsage
  readonly cost: number
  readonly status: AgentStatus
}

// ─── Events ───

export type StateEvent =
  | { readonly type: 'agent_updated'; readonly agent: AgentState }
  | { readonly type: 'task_updated'; readonly task: TaskData }
  | { readonly type: 'alert'; readonly alert: Alert }
  | { readonly type: 'team_deleted' }
  | { readonly type: 'cost_threshold'; readonly current: number; readonly budget: number }
  | { readonly type: 'snapshot_written'; readonly path: string }
  | { readonly type: 'watcher_error'; readonly source: string; readonly message: string }
