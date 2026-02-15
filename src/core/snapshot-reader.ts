/**
 * SnapshotReader：讀取 ~/.ccx/sessions/ 下的 snapshot
 *
 * 資料來源優先級：
 * 1. ~/.claude/teams/* 仍存在 → 用 watcher 讀即時資料
 * 2. ~/.claude/teams/* 已刪除 → 讀 ~/.ccx/sessions/* 副本
 * 3. 都沒有 → 報錯
 */
import { readFile, readdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { ccxPaths } from './paths.js'
import type { SessionSnapshot, AgentSnapshotEntry, TokenUsage, TaskData, Alert } from './types.js'
import { emptyUsage } from './pricing.js'

/**
 * 列出所有 saved sessions
 */
export async function listSessions(): Promise<SessionInfo[]> {
  try {
    const entries = await readdir(ccxPaths.sessions, { withFileTypes: true })
    const sessions: SessionInfo[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const snapshot = await readSnapshot(entry.name)
      if (snapshot) {
        sessions.push({
          name: entry.name,
          teamName: snapshot.teamName,
          startedAt: snapshot.startedAt,
          lastUpdatedAt: snapshot.lastUpdatedAt,
          finalized: snapshot.finalized,
          totalCost: snapshot.totalCost,
          agentCount: snapshot.agents.length,
        })
      }
    }

    return sessions.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
  } catch {
    return []
  }
}

export interface SessionInfo {
  readonly name: string
  readonly teamName: string
  readonly startedAt: number
  readonly lastUpdatedAt: number
  readonly finalized: boolean
  readonly totalCost: number
  readonly agentCount: number
}

/**
 * 讀取 snapshot YAML
 */
export async function readSnapshot(sessionName: string): Promise<SessionSnapshot | null> {
  const snapshotPath = join(ccxPaths.sessions, sessionName, 'snapshot.yaml')
  try {
    const raw = await readFile(snapshotPath, 'utf-8')
    const data = parseYaml(raw)
    return normalizeSnapshot(data)
  } catch {
    return null
  }
}

/**
 * 根據 session name 或 team name 查找 snapshot
 */
export async function findSnapshot(nameOrTeam: string): Promise<SessionSnapshot | null> {
  // 精確匹配 session name
  const exact = await readSnapshot(nameOrTeam)
  if (exact) return exact

  // 模糊匹配 team name（取最新的）
  const sessions = await listSessions()
  const matching = sessions.filter(s => s.teamName === nameOrTeam)
  if (matching.length > 0) {
    return readSnapshot(matching[0].name)
  }

  // 前綴匹配
  const prefixMatch = sessions.find(s => s.name.startsWith(nameOrTeam))
  if (prefixMatch) {
    return readSnapshot(prefixMatch.name)
  }

  return null
}

// ─── YAML normalization ───

function normalizeSnapshot(data: unknown): SessionSnapshot | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>

  return {
    teamName: String(d.teamName ?? 'unknown'),
    sessionId: String(d.sessionId ?? ''),
    startedAt: Number(d.startedAt ?? 0),
    lastUpdatedAt: Number(d.lastUpdatedAt ?? 0),
    finalized: Boolean(d.finalized ?? false),
    agents: normalizeAgents(d.agents),
    tasks: normalizeTasks(d.tasks),
    totalCost: Number(d.totalCost ?? 0),
    totalTokens: normalizeUsage(d.totalTokens),
    alerts: normalizeAlerts(d.alerts),
  }
}

function normalizeAgents(raw: unknown): AgentSnapshotEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map(a => ({
    agentId: String(a?.agentId ?? ''),
    name: String(a?.name ?? ''),
    model: String(a?.model ?? ''),
    tokenUsage: normalizeUsage(a?.tokenUsage),
    cost: Number(a?.cost ?? 0),
    status: a?.status ?? 'unknown',
  }))
}

function normalizeTasks(raw: unknown): TaskData[] {
  if (!Array.isArray(raw)) return []
  return raw.map(t => ({
    id: String(t?.id ?? ''),
    subject: String(t?.subject ?? ''),
    description: String(t?.description ?? ''),
    activeForm: String(t?.activeForm ?? ''),
    owner: String(t?.owner ?? ''),
    status: t?.status ?? 'pending',
    blocks: Array.isArray(t?.blocks) ? t.blocks.map(String) : [],
    blockedBy: Array.isArray(t?.blockedBy) ? t.blockedBy.map(String) : [],
  }))
}

function normalizeUsage(raw: unknown): TokenUsage {
  if (!raw || typeof raw !== 'object') return emptyUsage()
  const u = raw as Record<string, unknown>
  return {
    input_tokens: Number(u.input_tokens ?? 0),
    output_tokens: Number(u.output_tokens ?? 0),
    cache_creation_input_tokens: Number(u.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: Number(u.cache_read_input_tokens ?? 0),
  }
}

function normalizeAlerts(raw: unknown): Alert[] {
  if (!Array.isArray(raw)) return []
  return raw.map(a => ({
    level: a?.level ?? 'info',
    message: String(a?.message ?? ''),
    timestamp: Number(a?.timestamp ?? 0),
  }))
}
