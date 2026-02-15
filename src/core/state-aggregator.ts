/**
 * StateAggregator：純計算層，解耦 readers 和 consumers
 *
 * 接收所有 reader 的輸出 → 計算統一的 TeamState → 發射 events
 */
import { EventEmitter } from 'node:events'
import type {
  TeamConfig,
  TaskData,
  AgentState,
  AgentStatus,
  TeamState,
  TokenUsage,
  Alert,
  FileCursor,
  StateEvent,
} from './types.js'
import type { InboxData } from './inbox-reader.js'
import { calculateCost, addUsage, emptyUsage, getModelShortName, totalTokenCount } from './pricing.js'
import { getDisplayName } from './identity-resolver.js'

const STUCK_THRESHOLD_MS = 180_000 // 3 分鐘

export class StateAggregator extends EventEmitter {
  private teamConfig: TeamConfig | null = null
  private tasks: TaskData[] = []
  private inboxes: Map<string, InboxData> = new Map()
  private cursors: Map<string, FileCursor> = new Map()
  private alerts: Alert[] = []
  private startedAt: number = Date.now()
  private budget: number | null = null
  private stuckThresholdMs: number = STUCK_THRESHOLD_MS

  constructor(options?: { budget?: number; stuckThresholdMs?: number }) {
    super()
    if (options?.budget) this.budget = options.budget
    if (options?.stuckThresholdMs) this.stuckThresholdMs = options.stuckThresholdMs
  }

  // ─── Input methods（由 watcher 呼叫）───

  updateTeamConfig(config: TeamConfig): void {
    this.teamConfig = config
    if (config.createdAt) this.startedAt = config.createdAt
  }

  updateTasks(tasks: TaskData[]): void {
    this.tasks = tasks
    for (const task of tasks) {
      this.emit('event', { type: 'task_updated', task } satisfies StateEvent)
    }
  }

  updateInbox(inbox: InboxData): void {
    this.inboxes.set(inbox.agentName, inbox)
  }

  updateCursor(cursor: FileCursor): void {
    const prev = this.cursors.get(cursor.agentId)
    this.cursors.set(cursor.agentId, cursor)

    const agent = this.buildAgentState(cursor)
    this.emit('event', { type: 'agent_updated', agent } satisfies StateEvent)

    // Budget check
    if (this.budget) {
      const totalCost = this.computeTotalCost()
      this.checkBudgetThresholds(totalCost)
    }

    // Stuck detection
    if (prev && agent.status === 'stuck') {
      const prevAgent = this.buildAgentState(prev)
      if (prevAgent.status !== 'stuck') {
        this.addAlert('warning', `${agent.name}: no activity for ${Math.round(this.stuckThresholdMs / 60000)}m (possibly stuck)`)
      }
    }
  }

  markTeamDeleted(): void {
    this.emit('event', { type: 'team_deleted' } satisfies StateEvent)
  }

  // ─── Output：取得當前完整狀態 ───

  getState(): TeamState {
    const rawAgents = [...this.cursors.values()].map(c => this.buildAgentState(c))
    const agents = deduplicateAgents(rawAgents)
    const totalTokens = this.computeTotalTokens()
    const totalCost = this.computeTotalCost()

    return {
      teamName: this.teamConfig?.name ?? 'unknown',
      startedAt: this.startedAt,
      elapsedMs: Date.now() - this.startedAt,
      agents,
      tasks: this.tasks,
      totalCost,
      totalTokens,
      alerts: this.alerts.slice(-10),
      isActive: this.teamConfig !== null,
    }
  }

  // ─── Private ───

  private buildAgentState(cursor: FileCursor): AgentState {
    const name = getDisplayName(cursor)
    const model = cursor.model ?? 'unknown'
    const cost = calculateCost(model, cursor.accumulated)
    const status = this.inferAgentStatus(cursor)

    // 從 ring buffer 取最後一條的 timestamp 和內容摘要
    const lastEntry = cursor.recentEntries.length > 0
      ? cursor.recentEntries[cursor.recentEntries.length - 1]
      : null
    const lastActivityAt = lastEntry ? new Date(lastEntry.timestamp).getTime() : 0

    return {
      agentId: cursor.agentId,
      name,
      model: getModelShortName(model),
      status,
      tokenUsage: cursor.accumulated,
      cost,
      lastActivityAt,
      lastActivity: '',
      identityConfidence: cursor.resolvedName ? 'high' : 'low',
    }
  }

  private inferAgentStatus(cursor: FileCursor): AgentStatus {
    const name = cursor.resolvedName ?? cursor.agentId

    // 優先用 inbox 推斷
    const inbox = this.inboxes.get(name)
    if (inbox) {
      if (inbox.inferredStatus === 'shutdown') return 'shutdown'
      if (inbox.inferredStatus === 'done') return 'done'
    }

    // 用 task owner 推斷
    const ownedTasks = this.tasks.filter(t => t.owner === name)
    const hasActiveTasks = ownedTasks.some(t => t.status === 'in_progress')
    const allDone = ownedTasks.length > 0 && ownedTasks.every(t => t.status === 'completed')

    if (allDone && !hasActiveTasks) return 'done'

    // 用 JSONL activity 推斷
    const lastEntry = cursor.recentEntries.length > 0
      ? cursor.recentEntries[cursor.recentEntries.length - 1]
      : null

    if (!lastEntry) return 'unknown'

    const lastActivityMs = Date.now() - new Date(lastEntry.timestamp).getTime()

    if (lastActivityMs > this.stuckThresholdMs && hasActiveTasks) return 'stuck'
    if (lastActivityMs > 30_000) return 'idle'
    return 'working'
  }

  private computeTotalTokens(): TokenUsage {
    let total = emptyUsage()
    for (const cursor of this.cursors.values()) {
      total = addUsage(total, cursor.accumulated)
    }
    return total
  }

  private computeTotalCost(): number {
    let total = 0
    for (const cursor of this.cursors.values()) {
      const model = cursor.model ?? 'claude-opus-4-6'
      total += calculateCost(model, cursor.accumulated)
    }
    return total
  }

  private lastBudgetLevel = 0

  private checkBudgetThresholds(currentCost: number): void {
    if (!this.budget) return

    const pct = currentCost / this.budget
    let level = 0

    if (pct >= 1.0) level = 4
    else if (pct >= 0.9) level = 3
    else if (pct >= 0.8) level = 2
    else if (pct >= 0.6) level = 1

    if (level > this.lastBudgetLevel) {
      this.lastBudgetLevel = level

      if (level >= 3) {
        this.addAlert('critical', `Budget: ${Math.round(pct * 100)}% consumed ($${currentCost.toFixed(2)} / $${this.budget.toFixed(2)})`)
      } else if (level >= 1) {
        this.addAlert('warning', `Budget: ${Math.round(pct * 100)}% consumed ($${currentCost.toFixed(2)} / $${this.budget.toFixed(2)})`)
      }

      this.emit('event', {
        type: 'cost_threshold',
        current: currentCost,
        budget: this.budget,
      } satisfies StateEvent)
    }
  }

  private addAlert(level: Alert['level'], message: string): void {
    this.alerts.push({ level, message, timestamp: Date.now() })
  }
}

// ─── Agent deduplication ───
// 多輪 session 可能產生多個同名 agent（例如 team-lead 出現 6 次）
// 策略：合併同名 agents 的 token usage 和 cost

function deduplicateAgents(agents: AgentState[]): AgentState[] {
  const byName = new Map<string, AgentState[]>()

  for (const agent of agents) {
    const existing = byName.get(agent.name) ?? []
    existing.push(agent)
    byName.set(agent.name, existing)
  }

  const result: AgentState[] = []

  for (const [, group] of byName) {
    if (group.length === 1) {
      result.push(group[0])
      continue
    }

    // 合併：加總 tokens/cost，取最新的 status 和 activity
    let mergedUsage = emptyUsage()
    let mergedCost = 0
    let latestActivity = 0
    let latestAgent = group[0]

    for (const agent of group) {
      mergedUsage = addUsage(mergedUsage, agent.tokenUsage)
      mergedCost += agent.cost
      if (agent.lastActivityAt > latestActivity) {
        latestActivity = agent.lastActivityAt
        latestAgent = agent
      }
    }

    result.push({
      ...latestAgent,
      tokenUsage: mergedUsage,
      cost: mergedCost,
      lastActivityAt: latestActivity,
    })
  }

  return result
}
