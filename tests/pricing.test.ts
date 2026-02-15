import { describe, it, expect } from 'vitest'
import {
  calculateCost,
  formatCost,
  formatTokens,
  addUsage,
  emptyUsage,
  totalTokenCount,
  resolveModelName,
  getModelShortName,
} from '../src/core/pricing.js'
import type { TokenUsage } from '../src/core/types.js'

describe('pricing', () => {
  describe('resolveModelName', () => {
    it('resolves short alias to full name', () => {
      expect(resolveModelName('opus')).toBe('claude-opus-4-6')
      expect(resolveModelName('sonnet')).toBe('claude-sonnet-4-5-20250929')
      expect(resolveModelName('haiku')).toBe('claude-haiku-4-5-20251001')
    })

    it('returns unknown model as-is', () => {
      expect(resolveModelName('gpt-4')).toBe('gpt-4')
    })
  })

  describe('getModelShortName', () => {
    it('extracts short name from full model id', () => {
      expect(getModelShortName('claude-opus-4-6')).toBe('opus')
      expect(getModelShortName('claude-sonnet-4-5-20250929')).toBe('sonnet')
      expect(getModelShortName('claude-haiku-4-5-20251001')).toBe('haiku')
    })

    it('returns unknown model as-is', () => {
      expect(getModelShortName('gpt-4')).toBe('gpt-4')
    })
  })

  describe('calculateCost', () => {
    it('calculates opus cost correctly', () => {
      const usage: TokenUsage = {
        input_tokens: 1_000_000,
        output_tokens: 100_000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      }
      // 1M input * $15/M + 100k output * $75/M = $15 + $7.5 = $22.5
      expect(calculateCost('opus', usage)).toBeCloseTo(22.5)
    })

    it('calculates haiku cost correctly', () => {
      const usage: TokenUsage = {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      }
      // 1M input * $0.80/M + 500k output * $4/M = $0.80 + $2.0 = $2.80
      expect(calculateCost('haiku', usage)).toBeCloseTo(2.8)
    })

    it('includes cache pricing', () => {
      const usage: TokenUsage = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      }
      // opus: 1M cache_write * $18.75/M + 1M cache_read * $1.5/M = $20.25
      expect(calculateCost('opus', usage)).toBeCloseTo(20.25)
    })

    it('returns 0 for unknown model', () => {
      const usage: TokenUsage = {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      }
      expect(calculateCost('unknown-model', usage)).toBe(0)
    })

    it('handles zero usage', () => {
      expect(calculateCost('opus', emptyUsage())).toBe(0)
    })
  })

  describe('formatCost', () => {
    it('formats small values with 4 decimals', () => {
      expect(formatCost(0.005)).toBe('$0.0050')
    })

    it('formats normal values with 2 decimals', () => {
      expect(formatCost(1.23)).toBe('$1.23')
      expect(formatCost(99.99)).toBe('$99.99')
    })

    it('formats zero', () => {
      expect(formatCost(0)).toBe('$0.0000')
    })
  })

  describe('formatTokens', () => {
    it('formats millions', () => {
      expect(formatTokens(5_000_000)).toBe('5.0M')
      expect(formatTokens(1_500_000)).toBe('1.5M')
    })

    it('formats thousands', () => {
      expect(formatTokens(50_000)).toBe('50.0k')
      expect(formatTokens(1_234)).toBe('1.2k')
    })

    it('formats small numbers as-is', () => {
      expect(formatTokens(999)).toBe('999')
      expect(formatTokens(0)).toBe('0')
    })
  })

  describe('addUsage', () => {
    it('adds two token usages', () => {
      const a: TokenUsage = {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 30,
      }
      const b: TokenUsage = {
        input_tokens: 300,
        output_tokens: 400,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 70,
      }
      const result = addUsage(a, b)
      expect(result.input_tokens).toBe(400)
      expect(result.output_tokens).toBe(600)
      expect(result.cache_creation_input_tokens).toBe(50)
      expect(result.cache_read_input_tokens).toBe(100)
    })

    it('adding empty to value returns value', () => {
      const usage: TokenUsage = {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 30,
      }
      expect(addUsage(usage, emptyUsage())).toEqual(usage)
    })
  })

  describe('totalTokenCount', () => {
    it('sums all token fields', () => {
      const usage: TokenUsage = {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 30,
      }
      expect(totalTokenCount(usage)).toBe(380)
    })

    it('returns 0 for empty usage', () => {
      expect(totalTokenCount(emptyUsage())).toBe(0)
    })
  })

  describe('emptyUsage', () => {
    it('returns all zeros', () => {
      const empty = emptyUsage()
      expect(empty.input_tokens).toBe(0)
      expect(empty.output_tokens).toBe(0)
      expect(empty.cache_creation_input_tokens).toBe(0)
      expect(empty.cache_read_input_tokens).toBe(0)
    })

    it('returns a new object each call', () => {
      expect(emptyUsage()).not.toBe(emptyUsage())
    })
  })
})
