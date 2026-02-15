import { describe, it, expect } from 'vitest'
import {
  safeParseJson,
  safeParseJsonArray,
  parseJournalLine,
  TeamConfigSchema,
  TaskDataSchema,
  InboxMessageSchema,
  JournalEntrySchema,
} from '../src/core/data-source-adapter.js'

describe('data-source-adapter', () => {
  describe('safeParseJson', () => {
    it('parses valid JSON matching schema', () => {
      const raw = JSON.stringify({
        id: '1',
        subject: 'Test task',
        status: 'pending',
      })
      const result = safeParseJson(raw, TaskDataSchema)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe('1')
        expect(result.data.subject).toBe('Test task')
        expect(result.data.status).toBe('pending')
        // default values should be applied
        expect(result.data.description).toBe('')
        expect(result.data.owner).toBe('')
        expect(result.data.blocks).toEqual([])
      }
    })

    it('returns error for invalid JSON', () => {
      const result = safeParseJson('not json{', TaskDataSchema)
      expect(result.ok).toBe(false)
    })

    it('returns error for schema mismatch', () => {
      const result = safeParseJson('{"foo":"bar"}', TaskDataSchema)
      expect(result.ok).toBe(false)
    })
  })

  describe('safeParseJsonArray', () => {
    it('parses JSON array', () => {
      const raw = JSON.stringify([
        { from: 'lead', text: 'hello', timestamp: '2026-01-01T00:00:00Z' },
        { from: 'worker', text: 'hi', timestamp: '2026-01-01T00:01:00Z' },
      ])
      const result = safeParseJsonArray(raw, InboxMessageSchema)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toHaveLength(2)
        expect(result.data[0].from).toBe('lead')
        expect(result.data[1].from).toBe('worker')
      }
    })

    it('returns error for non-array', () => {
      const result = safeParseJsonArray('{"not":"array"}', InboxMessageSchema)
      expect(result.ok).toBe(false)
    })
  })

  describe('parseJournalLine', () => {
    it('parses valid JSONL line with usage', () => {
      const line = JSON.stringify({
        sessionId: 'sess-1',
        timestamp: '2026-01-01T00:00:00Z',
        message: {
          model: 'claude-opus-4-6',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 200,
          },
        },
      })
      const result = parseJournalLine(line)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.message.usage.input_tokens).toBe(100)
        expect(result.data.message.usage.output_tokens).toBe(50)
        expect(result.data.message.model).toBe('claude-opus-4-6')
      }
    })

    it('applies default values for missing fields', () => {
      const line = JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: {
          usage: {
            input_tokens: 10,
            output_tokens: 20,
          },
        },
      })
      const result = parseJournalLine(line)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.message.usage.cache_creation_input_tokens).toBe(0)
        expect(result.data.message.usage.cache_read_input_tokens).toBe(0)
        expect(result.data.message.model).toBe('claude-opus-4-6')
      }
    })

    it('returns ok:false for empty line', () => {
      expect(parseJournalLine('')).toEqual({ ok: false })
      expect(parseJournalLine('   ')).toEqual({ ok: false })
    })

    it('returns ok:false for invalid JSON', () => {
      expect(parseJournalLine('{broken')).toEqual({ ok: false })
    })

    it('returns ok:false for valid JSON but missing required fields', () => {
      const result = parseJournalLine('{"foo":"bar"}')
      expect(result.ok).toBe(false)
    })
  })

  describe('TeamConfigSchema', () => {
    it('parses full config', () => {
      const raw = {
        name: 'test-team',
        createdAt: 1700000000000,
        leadAgentId: 'abc123',
        leadSessionId: 'sess-abc',
        members: [
          {
            agentId: 'abc123',
            name: 'team-lead',
            agentType: 'general-purpose',
            joinedAt: 1700000000000,
          },
        ],
      }
      const result = TeamConfigSchema.safeParse(raw)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('test-team')
        expect(result.data.members).toHaveLength(1)
        expect(result.data.description).toBe('')
      }
    })
  })
})
