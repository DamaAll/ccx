import { describe, it, expect } from 'vitest'
import { createCursor, resolveCursorIdentity, readFull, readIncremental } from '../src/core/cursor-reader.js'
import { emptyUsage } from '../src/core/pricing.js'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ─── Pure function tests ───

describe('cursor-reader', () => {
  describe('createCursor', () => {
    it('creates cursor with default values', () => {
      const cursor = createCursor('/tmp/agent-abc.jsonl', 'abc')
      expect(cursor.path).toBe('/tmp/agent-abc.jsonl')
      expect(cursor.agentId).toBe('abc')
      expect(cursor.lastByteOffset).toBe(0)
      expect(cursor.lastInode).toBe(0)
      expect(cursor.state).toBe('UNRESOLVED')
      expect(cursor.resolvedName).toBeNull()
      expect(cursor.accumulated).toEqual(emptyUsage())
      expect(cursor.model).toBeNull()
      expect(cursor.recentEntries).toHaveLength(0)
    })
  })

  describe('resolveCursorIdentity', () => {
    it('sets state to RESOLVED and resolvedName', () => {
      const cursor = createCursor('/tmp/agent-abc.jsonl', 'abc')
      const resolved = resolveCursorIdentity(cursor, 'my-worker')
      expect(resolved.state).toBe('RESOLVED')
      expect(resolved.resolvedName).toBe('my-worker')
    })

    it('preserves other cursor fields', () => {
      const cursor = createCursor('/tmp/agent-abc.jsonl', 'abc')
      const resolved = resolveCursorIdentity(cursor, 'my-worker')
      expect(resolved.path).toBe('/tmp/agent-abc.jsonl')
      expect(resolved.agentId).toBe('abc')
      expect(resolved.lastByteOffset).toBe(0)
    })

    it('returns a new object (immutability)', () => {
      const cursor = createCursor('/tmp/agent-abc.jsonl', 'abc')
      const resolved = resolveCursorIdentity(cursor, 'my-worker')
      expect(resolved).not.toBe(cursor)
    })
  })

  // ─── File-based integration tests ───

  describe('readFull', () => {
    const testDir = join(tmpdir(), 'ccx-cursor-test-' + Date.now())

    async function setup() {
      await mkdir(testDir, { recursive: true })
    }

    async function cleanup() {
      await rm(testDir, { recursive: true, force: true })
    }

    it('reads JSONL file and accumulates usage', async () => {
      await setup()
      try {
        const filePath = join(testDir, 'agent-test1.jsonl')
        const lines = [
          JSON.stringify({
            timestamp: '2026-01-01T00:00:00Z',
            message: { model: 'claude-opus-4-6', usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
          }),
          JSON.stringify({
            timestamp: '2026-01-01T00:01:00Z',
            message: { model: 'claude-opus-4-6', usage: { input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 } },
          }),
        ].join('\n') + '\n'

        await writeFile(filePath, lines)
        const result = await readFull(filePath, 'test1')

        expect(result.newEntries).toHaveLength(2)
        expect(result.rawLines).toHaveLength(2)
        expect(result.cursor.accumulated.input_tokens).toBe(300)
        expect(result.cursor.accumulated.output_tokens).toBe(150)
        expect(result.cursor.accumulated.cache_creation_input_tokens).toBe(10)
        expect(result.cursor.accumulated.cache_read_input_tokens).toBe(5)
        expect(result.cursor.model).toBe('claude-opus-4-6')
        expect(result.cursor.lastByteOffset).toBeGreaterThan(0)
      } finally {
        await cleanup()
      }
    })

    it('handles empty file', async () => {
      await setup()
      try {
        const filePath = join(testDir, 'agent-empty.jsonl')
        await writeFile(filePath, '')
        const result = await readFull(filePath, 'empty')

        expect(result.newEntries).toHaveLength(0)
        expect(result.rawLines).toHaveLength(0)
      } finally {
        await cleanup()
      }
    })

    it('handles non-existent file', async () => {
      const result = await readFull('/tmp/nonexistent-ccx-test.jsonl', 'ghost')
      expect(result.newEntries).toHaveLength(0)
      expect(result.rawLines).toHaveLength(0)
    })

    it('skips malformed JSON lines', async () => {
      await setup()
      try {
        const filePath = join(testDir, 'agent-malformed.jsonl')
        const lines = [
          '{"timestamp":"2026-01-01T00:00:00Z","message":{"model":"claude-opus-4-6","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
          'not valid json',
          '{"broken": true}',
          '{"timestamp":"2026-01-01T00:02:00Z","message":{"model":"claude-opus-4-6","usage":{"input_tokens":200,"output_tokens":100,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
        ].join('\n') + '\n'

        await writeFile(filePath, lines)
        const result = await readFull(filePath, 'malformed')

        // Only 2 valid entries, but all 4 raw lines
        expect(result.newEntries).toHaveLength(2)
        expect(result.rawLines).toHaveLength(4)
        expect(result.cursor.accumulated.input_tokens).toBe(300)
      } finally {
        await cleanup()
      }
    })

    it('maintains ring buffer size limit', async () => {
      await setup()
      try {
        const filePath = join(testDir, 'agent-ringbuf.jsonl')
        const lines = Array.from({ length: 30 }, (_, i) =>
          JSON.stringify({
            timestamp: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
            message: { model: 'claude-opus-4-6', usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
          })
        ).join('\n') + '\n'

        await writeFile(filePath, lines)
        const result = await readFull(filePath, 'ringbuf')

        // Ring buffer capped at 20
        expect(result.cursor.recentEntries).toHaveLength(20)
        // But all 30 entries parsed
        expect(result.newEntries).toHaveLength(30)
        // Accumulated usage = 30 * 10 = 300
        expect(result.cursor.accumulated.input_tokens).toBe(300)
      } finally {
        await cleanup()
      }
    })
  })

  describe('readIncremental', () => {
    const testDir = join(tmpdir(), 'ccx-incr-test-' + Date.now())

    async function setup() {
      await mkdir(testDir, { recursive: true })
    }

    async function cleanup() {
      await rm(testDir, { recursive: true, force: true })
    }

    it('reads only new content after first read', async () => {
      await setup()
      try {
        const filePath = join(testDir, 'agent-incr.jsonl')
        const line1 = JSON.stringify({
          timestamp: '2026-01-01T00:00:00Z',
          message: { model: 'claude-opus-4-6', usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
        }) + '\n'

        await writeFile(filePath, line1)
        const result1 = await readFull(filePath, 'incr')
        expect(result1.newEntries).toHaveLength(1)
        expect(result1.cursor.accumulated.input_tokens).toBe(100)

        // Append more content
        const line2 = JSON.stringify({
          timestamp: '2026-01-01T00:01:00Z',
          message: { model: 'claude-opus-4-6', usage: { input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
        }) + '\n'

        await writeFile(filePath, line1 + line2) // Rewrite with both lines
        const result2 = await readIncremental(result1.cursor)

        expect(result2.newEntries).toHaveLength(1) // Only the new line
        expect(result2.cursor.accumulated.input_tokens).toBe(300) // Accumulated
      } finally {
        await cleanup()
      }
    })

    it('detects file truncation and resets', async () => {
      await setup()
      try {
        const filePath = join(testDir, 'agent-trunc.jsonl')
        const longContent = Array.from({ length: 10 }, (_, i) =>
          JSON.stringify({
            timestamp: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
            message: { model: 'claude-opus-4-6', usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
          })
        ).join('\n') + '\n'

        await writeFile(filePath, longContent)
        const result1 = await readFull(filePath, 'trunc')
        expect(result1.cursor.accumulated.input_tokens).toBe(1000)
        expect(result1.cursor.lastByteOffset).toBeGreaterThan(0)

        // Truncate file to just one line
        const shortContent = JSON.stringify({
          timestamp: '2026-01-01T01:00:00Z',
          message: { model: 'claude-opus-4-6', usage: { input_tokens: 50, output_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
        }) + '\n'

        await writeFile(filePath, shortContent)
        const result2 = await readIncremental(result1.cursor)

        // Should reset accumulated since file was truncated
        expect(result2.cursor.accumulated.input_tokens).toBe(50)
        expect(result2.cursor.lastByteOffset).toBeGreaterThan(0)
      } finally {
        await cleanup()
      }
    })
  })
})
