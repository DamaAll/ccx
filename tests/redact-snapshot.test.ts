import { describe, it, expect } from 'vitest'
import { redactSnapshot } from '../src/report/redact-snapshot.js'
import type { SessionSnapshot } from '../src/core/types.js'
import { emptyUsage } from '../src/core/pricing.js'

function makeSnapshot(overrides?: Partial<SessionSnapshot>): SessionSnapshot {
  return {
    teamName: 'test-team',
    sessionId: 'test-session',
    startedAt: 1700000000000,
    lastUpdatedAt: 1700001000000,
    finalized: false,
    agents: [],
    tasks: [],
    totalCost: 0,
    totalTokens: emptyUsage(),
    alerts: [],
    ...overrides,
  }
}

// 用拼接避免 GitHub push protection 誤判測試用假 key
const FAKE_STRIPE = 'sk_live_' + 'abc12345678901234567890'
const FAKE_AWS = 'AKIA' + 'IOSFODNN7EXAMPLE'

describe('redactSnapshot', () => {
  it('redacts secrets from task subjects', () => {
    const snapshot = makeSnapshot({
      tasks: [
        {
          id: '1',
          subject: `Deploy with api_key=${FAKE_STRIPE}`,
          description: `Use key ${FAKE_AWS}`,
          activeForm: '',
          owner: '',
          status: 'pending',
          blocks: [],
          blockedBy: [],
        },
      ],
    })

    const redacted = redactSnapshot(snapshot)
    expect(redacted.tasks[0].subject).not.toContain('sk_live')
    expect(redacted.tasks[0].subject).toContain('[REDACTED]')
    expect(redacted.tasks[0].description).not.toContain('AKIA')
    expect(redacted.tasks[0].description).toContain('[REDACTED]')
  })

  it('redacts secrets from alert messages', () => {
    const snapshot = makeSnapshot({
      alerts: [
        {
          level: 'warning',
          message: 'Found password: supersecretpassword',
          timestamp: 1700000000000,
        },
      ],
    })

    const redacted = redactSnapshot(snapshot)
    expect(redacted.alerts[0].message).toContain('[REDACTED]')
  })

  it('preserves non-secret fields unchanged', () => {
    const snapshot = makeSnapshot({
      teamName: 'safe-team',
      agents: [
        {
          agentId: 'abc',
          name: 'worker-1',
          model: 'opus',
          tokenUsage: emptyUsage(),
          cost: 1.5,
          status: 'idle',
        },
      ],
    })

    const redacted = redactSnapshot(snapshot)
    expect(redacted.teamName).toBe('safe-team')
    expect(redacted.agents[0].name).toBe('worker-1')
    expect(redacted.agents[0].cost).toBe(1.5)
  })

  it('does not mutate the original snapshot', () => {
    const snapshot = makeSnapshot({
      tasks: [
        {
          id: '1',
          subject: `api_key=${FAKE_STRIPE}`,
          description: '',
          activeForm: '',
          owner: '',
          status: 'pending',
          blocks: [],
          blockedBy: [],
        },
      ],
    })

    redactSnapshot(snapshot)
    expect(snapshot.tasks[0].subject).toContain('sk_live')
  })
})
