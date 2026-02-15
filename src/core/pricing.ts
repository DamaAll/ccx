/**
 * Claude model pricing table (USD per 1M tokens)
 */
import type { TokenUsage } from './types.js'

interface ModelPricing {
  readonly inputPerMillion: number
  readonly outputPerMillion: number
  readonly cacheWritePerMillion: number
  readonly cacheReadPerMillion: number
}

const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheWritePerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
  'claude-sonnet-4-5-20250929': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-haiku-4-5-20251001': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheWritePerMillion: 1,
    cacheReadPerMillion: 0.08,
  },
}

// 短名稱對照
const MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001',
}

export function resolveModelName(model: string): string {
  return MODEL_ALIASES[model] ?? model
}

export function getModelShortName(model: string): string {
  if (model.includes('opus')) return 'opus'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('haiku')) return 'haiku'
  return model
}

export function calculateCost(model: string, usage: TokenUsage): number {
  const resolved = resolveModelName(model)
  const pricing = PRICING[resolved]
  if (!pricing) return 0

  return (
    (usage.input_tokens * pricing.inputPerMillion) / 1_000_000 +
    (usage.output_tokens * pricing.outputPerMillion) / 1_000_000 +
    (usage.cache_creation_input_tokens * pricing.cacheWritePerMillion) / 1_000_000 +
    (usage.cache_read_input_tokens * pricing.cacheReadPerMillion) / 1_000_000
  )
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return `${count}`
}

export const emptyUsage: () => TokenUsage = () => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
})

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
  }
}

export function totalTokenCount(usage: TokenUsage): number {
  return (
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens
  )
}
