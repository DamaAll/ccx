import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StateAggregator } from '../src/core/state-aggregator.js'
import { createCursor, resolveCursorIdentity } from '../src/core/cursor-reader.js'
import { emptyUsage, addUsage } from '../src/core/pricing.js'
import type { FileCursor, TokenUsage, TaskData, StateEvent } from '../src/core/types.js'
import type { InboxData } from '../src/core/inbox-reader.js'

// ─── Helpers ───

function makeCursor(overrides: Partial<FileCursor> & { agentId: string }): FileCursor {
  return {
    path: `/tmp/agent-${overrides.agentId}.jsonl`,
    lastByteOffset: 0,
    lastInode: 0,
    state: 'UNRESOLVED',
    resolvedName: null,
    accumulated: emptyUsage(),
    model: null,
    recentEntries: [],
    ...overrides,
  }
}

function makeResolvedCursor(
  agentId: string,
  name: string,
  opts?: { model?: string; accumulated?: TokenUsage; recentEntries?: FileCursor['recentEntries'] },
): FileCursor {
  const base = makeCursor({ agentId })
  return {
    ...base,
    state: 'RESOLVED',
    resolvedName: name,
    model: opts?.model ?? 'claude-opus-4-6',
    accumulated: opts?.accumulated ?? emptyUsage(),
    recentEntries: opts?.recentEntries ?? [],
  }
}

function makeTask(overrides: Partial<TaskData> & { id: string }): TaskData {
  return {
    subject: '',
    description: '',
    activeForm: '',
    owner: '',
    status: 'pending',
    blocks: [],
    blockedBy: [],
    ...overrides,
  }
}

function makeInbox(agentName: string, status: InboxData['inferredStatus']): InboxData {
  return {
    agentName,
    messages: [],
    lastMessage: null,
    inferredStatus: status,
  }
}

function recentTimestamp(agoMs: number = 0): string {
  return new Date(Date.now() - agoMs).toISOString()
}

function cursorWithActivity(agentId: string, name: string, agoMs: number): FileCursor {
  return makeResolvedCursor(agentId, name, {
    recentEntries: [{
      timestamp: recentTimestamp(agoMs),
      message: { model: 'claude-opus-4-6', usage: emptyUsage() },
    }],
  })
}

// ─── Tests ───

describe('StateAggregator', () => {
  let agg: StateAggregator

  beforeEach(() => {
    agg = new StateAggregator()
  })

  describe('getState basics', () => {
    it('returns default state when empty', () => {
      const state = agg.getState()
      expect(state.teamName).toBe('unknown')
      expect(state.agents).toHaveLength(0)
      expect(state.tasks).toHaveLength(0)
      expect(state.totalCost).toBe(0)
      expect(state.isActive).toBe(false)
    })

    it('reflects team config', () => {
      agg.updateTeamConfig({
        name: 'my-team',
        description: 'test',
        createdAt: 1000,
        leadAgentId: 'lead-1',
        leadSessionId: 'sess-1',
        members: [],
      })

      const state = agg.getState()
      expect(state.teamName).toBe('my-team')
      expect(state.startedAt).toBe(1000)
      expect(state.isActive).toBe(true)
    })

    it('includes tasks', () => {
      agg.updateTasks([
        makeTask({ id: 't1', status: 'in_progress', owner: 'worker' }),
        makeTask({ id: 't2', status: 'completed', owner: 'worker' }),
      ])

      const state = agg.getState()
      expect(state.tasks).toHaveLength(2)
    })
  })

  describe('agent status inference', () => {
    it('returns "working" for recent activity with active task', () => {
      const cursor = cursorWithActivity('a1', 'worker', 5_000) // 5s ago
      agg.updateTasks([makeTask({ id: 't1', status: 'in_progress', owner: 'worker' })])
      agg.updateCursor(cursor)

      const state = agg.getState()
      expect(state.agents[0].status).toBe('working')
    })

    it('returns "idle" when no activity for >30s', () => {
      const cursor = cursorWithActivity('a1', 'worker', 60_000) // 60s ago
      agg.updateCursor(cursor)

      const state = agg.getState()
      expect(state.agents[0].status).toBe('idle')
    })

    it('returns "stuck" when active task but no activity beyond threshold', () => {
      agg = new StateAggregator({ stuckThresholdMs: 60_000 })
      const cursor = cursorWithActivity('a1', 'worker', 120_000) // 2m ago, threshold=1m
      agg.updateTasks([makeTask({ id: 't1', status: 'in_progress', owner: 'worker' })])
      agg.updateCursor(cursor)

      const state = agg.getState()
      expect(state.agents[0].status).toBe('stuck')
    })

    it('returns "done" when all owned tasks completed', () => {
      const cursor = cursorWithActivity('a1', 'worker', 60_000)
      agg.updateTasks([
        makeTask({ id: 't1', status: 'completed', owner: 'worker' }),
        makeTask({ id: 't2', status: 'completed', owner: 'worker' }),
      ])
      agg.updateCursor(cursor)

      const state = agg.getState()
      expect(state.agents[0].status).toBe('done')
    })

    it('returns "shutdown" when inbox says shutdown', () => {
      agg.updateInbox(makeInbox('worker', 'shutdown'))
      const cursor = cursorWithActivity('a1', 'worker', 5_000)
      agg.updateCursor(cursor)

      const state = agg.getState()
      expect(state.agents[0].status).toBe('shutdown')
    })

    it('returns "done" when inbox says done', () => {
      agg.updateInbox(makeInbox('worker', 'done'))
      const cursor = cursorWithActivity('a1', 'worker', 5_000)
      agg.updateCursor(cursor)

      const state = agg.getState()
      expect(state.agents[0].status).toBe('done')
    })

    it('inbox status takes priority over task-based status', () => {
      agg.updateInbox(makeInbox('worker', 'shutdown'))
      agg.updateTasks([makeTask({ id: 't1', status: 'in_progress', owner: 'worker' })])
      const cursor = cursorWithActivity('a1', 'worker', 5_000)
      agg.updateCursor(cursor)

      const state = agg.getState()
      expect(state.agents[0].status).toBe('shutdown')
    })

    it('returns "unknown" for cursor with no recent entries', () => {
      const cursor = makeResolvedCursor('a1', 'worker')
      agg.updateCursor(cursor)

      const state = agg.getState()
      expect(state.agents[0].status).toBe('unknown')
    })
  })

  describe('agent deduplication', () => {
    it('merges agents with same resolved name', () => {
      const usage1: TokenUsage = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      const usage2: TokenUsage = { input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

      const cursor1 = makeResolvedCursor('a1', 'worker', {
        accumulated: usage1,
        recentEntries: [{ timestamp: recentTimestamp(60_000), message: { model: 'claude-opus-4-6', usage: emptyUsage() } }],
      })
      const cursor2 = makeResolvedCursor('a2', 'worker', {
        accumulated: usage2,
        recentEntries: [{ timestamp: recentTimestamp(5_000), message: { model: 'claude-opus-4-6', usage: emptyUsage() } }],
      })

      agg.updateCursor(cursor1)
      agg.updateCursor(cursor2)

      const state = agg.getState()
      expect(state.agents).toHaveLength(1)
      expect(state.agents[0].name).toBe('worker')
      // Merged token usage
      expect(state.agents[0].tokenUsage.input_tokens).toBe(300)
      expect(state.agents[0].tokenUsage.output_tokens).toBe(150)
    })

    it('uses latest activity timestamp after merge', () => {
      const cursor1 = makeResolvedCursor('a1', 'worker', {
        recentEntries: [{ timestamp: recentTimestamp(120_000), message: { model: 'claude-opus-4-6', usage: emptyUsage() } }],
      })
      const cursor2 = makeResolvedCursor('a2', 'worker', {
        recentEntries: [{ timestamp: recentTimestamp(5_000), message: { model: 'claude-opus-4-6', usage: emptyUsage() } }],
      })

      agg.updateCursor(cursor1)
      agg.updateCursor(cursor2)

      const state = agg.getState()
      // lastActivityAt should be from cursor2 (more recent)
      expect(state.agents[0].lastActivityAt).toBeGreaterThan(Date.now() - 10_000)
    })

    it('keeps separate agents with different names', () => {
      const cursor1 = makeResolvedCursor('a1', 'worker-1')
      const cursor2 = makeResolvedCursor('a2', 'worker-2')

      agg.updateCursor(cursor1)
      agg.updateCursor(cursor2)

      const state = agg.getState()
      expect(state.agents).toHaveLength(2)
    })

    it('merges cost correctly', () => {
      const usage1: TokenUsage = { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      const usage2: TokenUsage = { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

      const cursor1 = makeResolvedCursor('a1', 'worker', { accumulated: usage1 })
      const cursor2 = makeResolvedCursor('a2', 'worker', { accumulated: usage2 })

      agg.updateCursor(cursor1)
      agg.updateCursor(cursor2)

      const state = agg.getState()
      // Each cursor: 1M input * $15/M = $15, merged = $30
      expect(state.agents[0].cost).toBeCloseTo(30)
    })
  })

  describe('total cost calculation', () => {
    it('sums cost across all cursors', () => {
      const usage: TokenUsage = { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

      agg.updateCursor(makeResolvedCursor('a1', 'worker-1', { accumulated: usage }))
      agg.updateCursor(makeResolvedCursor('a2', 'worker-2', { accumulated: usage }))

      const state = agg.getState()
      // 2 * $15 = $30
      expect(state.totalCost).toBeCloseTo(30)
    })

    it('defaults to opus pricing for unknown model', () => {
      const cursor = makeCursor({
        agentId: 'a1',
        accumulated: { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        model: null, // null → defaults to opus in computeTotalCost
      })
      agg.updateCursor(cursor)

      const state = agg.getState()
      expect(state.totalCost).toBeCloseTo(15)
    })
  })

  describe('total tokens calculation', () => {
    it('aggregates tokens across cursors', () => {
      const usage1: TokenUsage = { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 10, cache_read_input_tokens: 20 }
      const usage2: TokenUsage = { input_tokens: 300, output_tokens: 400, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 }

      agg.updateCursor(makeResolvedCursor('a1', 'w1', { accumulated: usage1 }))
      agg.updateCursor(makeResolvedCursor('a2', 'w2', { accumulated: usage2 }))

      const state = agg.getState()
      expect(state.totalTokens.input_tokens).toBe(400)
      expect(state.totalTokens.output_tokens).toBe(600)
      expect(state.totalTokens.cache_creation_input_tokens).toBe(40)
      expect(state.totalTokens.cache_read_input_tokens).toBe(60)
    })
  })

  describe('budget thresholds', () => {
    it('emits warning at 60% budget', () => {
      agg = new StateAggregator({ budget: 100 })
      const events: StateEvent[] = []
      agg.on('event', (e: StateEvent) => events.push(e))

      // $15 per 1M input opus → need ~4.33M tokens for $65 (65%)
      const cursor = makeResolvedCursor('a1', 'worker', {
        accumulated: { input_tokens: 4_333_333, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      })
      agg.updateCursor(cursor)

      const thresholdEvents = events.filter(e => e.type === 'cost_threshold')
      expect(thresholdEvents).toHaveLength(1)
    })

    it('emits critical at 90% budget', () => {
      agg = new StateAggregator({ budget: 10 })
      const alerts: string[] = []
      agg.on('event', (e: StateEvent) => {
        if (e.type === 'cost_threshold') {
          // check alerts in state
        }
      })

      // $15 per 1M → 600k tokens = $9 = 90%
      const cursor = makeResolvedCursor('a1', 'worker', {
        accumulated: { input_tokens: 600_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      })
      agg.updateCursor(cursor)

      const state = agg.getState()
      const criticalAlerts = state.alerts.filter(a => a.level === 'critical')
      expect(criticalAlerts.length).toBeGreaterThanOrEqual(1)
    })

    it('ratchets up — does not re-emit lower threshold', () => {
      agg = new StateAggregator({ budget: 10 })
      const events: StateEvent[] = []
      agg.on('event', (e: StateEvent) => events.push(e))

      // First: 90% → level 3
      agg.updateCursor(makeResolvedCursor('a1', 'worker', {
        accumulated: { input_tokens: 600_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }))

      // Update with same cost — should not emit again
      agg.updateCursor(makeResolvedCursor('a1', 'worker', {
        accumulated: { input_tokens: 600_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }))

      const thresholdEvents = events.filter(e => e.type === 'cost_threshold')
      expect(thresholdEvents).toHaveLength(1) // Only one emission
    })

    it('does not emit below 60%', () => {
      agg = new StateAggregator({ budget: 100 })
      const events: StateEvent[] = []
      agg.on('event', (e: StateEvent) => events.push(e))

      // $15 per 1M → 200k tokens = $3 = 3%
      agg.updateCursor(makeResolvedCursor('a1', 'worker', {
        accumulated: { input_tokens: 200_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }))

      const thresholdEvents = events.filter(e => e.type === 'cost_threshold')
      expect(thresholdEvents).toHaveLength(0)
    })
  })

  describe('event emission', () => {
    it('emits agent_updated on cursor update', () => {
      const events: StateEvent[] = []
      agg.on('event', (e: StateEvent) => events.push(e))

      agg.updateCursor(makeResolvedCursor('a1', 'worker'))

      const agentEvents = events.filter(e => e.type === 'agent_updated')
      expect(agentEvents).toHaveLength(1)
    })

    it('emits task_updated on tasks update', () => {
      const events: StateEvent[] = []
      agg.on('event', (e: StateEvent) => events.push(e))

      agg.updateTasks([makeTask({ id: 't1' }), makeTask({ id: 't2' })])

      const taskEvents = events.filter(e => e.type === 'task_updated')
      expect(taskEvents).toHaveLength(2)
    })

    it('emits team_deleted', () => {
      const events: StateEvent[] = []
      agg.on('event', (e: StateEvent) => events.push(e))

      agg.markTeamDeleted()

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('team_deleted')
    })

    it('emits stuck alert when agent transitions to stuck', () => {
      agg = new StateAggregator({ stuckThresholdMs: 60_000 })
      agg.updateTasks([makeTask({ id: 't1', status: 'in_progress', owner: 'worker' })])

      // First update: working (recent activity)
      const cursor1 = cursorWithActivity('a1', 'worker', 5_000)
      agg.updateCursor(cursor1)

      // Second update: stuck (old activity)
      const cursor2 = cursorWithActivity('a1', 'worker', 120_000)
      agg.updateCursor(cursor2)

      const state = agg.getState()
      const stuckAlerts = state.alerts.filter(a => a.message.includes('stuck'))
      expect(stuckAlerts).toHaveLength(1)
    })
  })

  describe('alerts', () => {
    it('caps alerts at 10', () => {
      agg = new StateAggregator({ budget: 10 })

      // Generate many updates to create many alerts
      for (let i = 0; i < 15; i++) {
        agg.updateTasks([makeTask({ id: `t${i}`, status: 'in_progress', owner: `worker-${i}` })])
      }

      // Force budget alerts by incrementally increasing cost
      for (let i = 1; i <= 12; i++) {
        agg.updateCursor(makeResolvedCursor(`a${i}`, `worker-${i}`, {
          accumulated: { input_tokens: 100_000 * i, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          recentEntries: [{ timestamp: recentTimestamp(200_000), message: { model: 'claude-opus-4-6', usage: emptyUsage() } }],
        }))
      }

      const state = agg.getState()
      expect(state.alerts.length).toBeLessThanOrEqual(10)
    })
  })

  describe('identity confidence', () => {
    it('returns "high" for resolved cursor', () => {
      agg.updateCursor(makeResolvedCursor('a1', 'worker'))
      const state = agg.getState()
      expect(state.agents[0].identityConfidence).toBe('high')
    })

    it('returns "low" for unresolved cursor', () => {
      agg.updateCursor(makeCursor({ agentId: 'a1' }))
      const state = agg.getState()
      expect(state.agents[0].identityConfidence).toBe('low')
    })
  })

  describe('model short name', () => {
    it('shows short model name', () => {
      agg.updateCursor(makeResolvedCursor('a1', 'worker', { model: 'claude-opus-4-6' }))
      const state = agg.getState()
      expect(state.agents[0].model).toBe('opus')
    })

    it('shows "unknown" for null model', () => {
      agg.updateCursor(makeCursor({ agentId: 'a1', model: null }))
      const state = agg.getState()
      expect(state.agents[0].model).toBe('unknown')
    })
  })
})
