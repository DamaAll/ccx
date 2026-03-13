import { describe, it, expect } from 'vitest'
import { tryResolveFromRawLines, batchResolve, getDisplayName } from '../src/core/identity-resolver.js'
import { createCursor, resolveCursorIdentity } from '../src/core/cursor-reader.js'

describe('identity-resolver', () => {
  describe('tryResolveFromRawLines', () => {
    it('resolves teammate_id from raw JSONL line', () => {
      const cursor = createCursor('/tmp/agent-abc.jsonl', 'abc')
      const rawLines = [
        '{"timestamp":"2026-01-01T00:00:00Z","message":{"usage":{"input_tokens":10,"output_tokens":5}}}',
        '{"timestamp":"2026-01-01T00:01:00Z","message":{"content":"<teammate-message teammate_id=\\"syntax-fixer\\" color=\\"blue\\">\\nHello"}}',
      ]

      const resolved = tryResolveFromRawLines(cursor, rawLines)
      expect(resolved.state).toBe('RESOLVED')
      expect(resolved.resolvedName).toBe('syntax-fixer')
    })

    it('returns cursor unchanged if no teammate_id found', () => {
      const cursor = createCursor('/tmp/agent-abc.jsonl', 'abc')
      const rawLines = [
        '{"timestamp":"2026-01-01T00:00:00Z","message":{"usage":{"input_tokens":10}}}',
      ]

      const result = tryResolveFromRawLines(cursor, rawLines)
      expect(result.state).toBe('UNRESOLVED')
      expect(result.resolvedName).toBeNull()
    })

    it('skips if already RESOLVED', () => {
      const cursor = resolveCursorIdentity(
        createCursor('/tmp/agent-abc.jsonl', 'abc'),
        'original-name'
      )
      const rawLines = [
        '{"message":{"content":"teammate_id=\\"new-name\\""}}',
      ]

      const result = tryResolveFromRawLines(cursor, rawLines)
      expect(result.resolvedName).toBe('original-name')
    })

    it('handles hyphenated and underscored names', () => {
      const cursor = createCursor('/tmp/agent-abc.jsonl', 'abc')
      const rawLines = [
        '{"message":{"content":"teammate_id=\\"my-cool_agent-v2\\""}}',
      ]

      const resolved = tryResolveFromRawLines(cursor, rawLines)
      expect(resolved.resolvedName).toBe('my-cool_agent-v2')
    })

    it('matches direct-quote format: teammate_id="name"', () => {
      const cursor = createCursor('/tmp/agent-abc.jsonl', 'abc')
      const rawLines = [
        '<teammate-message teammate_id="direct-worker" color="blue">',
      ]

      const resolved = tryResolveFromRawLines(cursor, rawLines)
      expect(resolved.state).toBe('RESOLVED')
      expect(resolved.resolvedName).toBe('direct-worker')
    })

    it('matches JSON key-value format: "teammate_id": "name"', () => {
      const cursor = createCursor('/tmp/agent-abc.jsonl', 'abc')
      const rawLines = [
        '{"teammate_id": "json-worker", "color": "blue"}',
      ]

      const resolved = tryResolveFromRawLines(cursor, rawLines)
      expect(resolved.state).toBe('RESOLVED')
      expect(resolved.resolvedName).toBe('json-worker')
    })

    it('matches unquoted format: teammate_id=name>', () => {
      const cursor = createCursor('/tmp/agent-abc.jsonl', 'abc')
      const rawLines = [
        '<teammate-message teammate_id=unquoted-worker>',
      ]

      const resolved = tryResolveFromRawLines(cursor, rawLines)
      expect(resolved.state).toBe('RESOLVED')
      expect(resolved.resolvedName).toBe('unquoted-worker')
    })

    it('matches unquoted format: teammate_id=name followed by space', () => {
      const cursor = createCursor('/tmp/agent-abc.jsonl', 'abc')
      const rawLines = [
        'some text teammate_id=spaced-worker color=blue',
      ]

      const resolved = tryResolveFromRawLines(cursor, rawLines)
      expect(resolved.state).toBe('RESOLVED')
      expect(resolved.resolvedName).toBe('spaced-worker')
    })
  })

  describe('batchResolve', () => {
    it('resolves multiple cursors from rawLinesMap', () => {
      const cursor1 = createCursor('/tmp/agent-a.jsonl', 'a')
      const cursor2 = createCursor('/tmp/agent-b.jsonl', 'b')

      const rawLinesMap = new Map<string, readonly string[]>([
        ['a', ['{"message":{"content":"teammate_id=\\"worker-1\\""}}']],
        ['b', ['{"message":{"content":"teammate_id=\\"worker-2\\""}}']],
      ])

      const results = batchResolve([cursor1, cursor2], rawLinesMap)
      expect(results).toHaveLength(2)
      expect(results[0].resolvedName).toBe('worker-1')
      expect(results[1].resolvedName).toBe('worker-2')
    })

    it('leaves unresolvable cursors unchanged', () => {
      const cursor = createCursor('/tmp/agent-x.jsonl', 'x')
      const rawLinesMap = new Map<string, readonly string[]>([
        ['x', ['{"message":{"usage":{"input_tokens":10}}}']],
      ])

      const results = batchResolve([cursor], rawLinesMap)
      expect(results[0].state).toBe('UNRESOLVED')
    })

    it('skips already resolved cursors', () => {
      const cursor = resolveCursorIdentity(
        createCursor('/tmp/agent-y.jsonl', 'y'),
        'already-resolved'
      )
      const rawLinesMap = new Map<string, readonly string[]>()

      const results = batchResolve([cursor], rawLinesMap)
      expect(results[0].resolvedName).toBe('already-resolved')
    })
  })

  describe('getDisplayName', () => {
    it('returns resolved name when available', () => {
      const cursor = resolveCursorIdentity(
        createCursor('/tmp/agent-abc.jsonl', 'abc'),
        'my-agent'
      )
      expect(getDisplayName(cursor)).toBe('my-agent')
    })

    it('returns agent-{id} for unresolved', () => {
      const cursor = createCursor('/tmp/agent-abc123.jsonl', 'abc123')
      expect(getDisplayName(cursor)).toBe('agent-abc123')
    })
  })
})
