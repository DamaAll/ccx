/**
 * 資料來源適配層：zod schema validation + 容錯 JSON 解析
 */
import { z } from 'zod'

// ─── Zod Schemas ───

export const TeamMemberSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  agentType: z.string(),
  model: z.string().default('claude-opus-4-6'),
  joinedAt: z.number(),
  tmuxPaneId: z.string().default(''),
  cwd: z.string().default(''),
  subscriptions: z.array(z.string()).default([]),
})

export const TeamConfigSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  createdAt: z.number(),
  leadAgentId: z.string(),
  leadSessionId: z.string(),
  members: z.array(TeamMemberSchema).default([]),
})

export const TaskDataSchema = z.object({
  id: z.string(),
  subject: z.string().default(''),
  description: z.string().default(''),
  activeForm: z.string().default(''),
  owner: z.string().default(''),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']).default('pending'),
  blocks: z.array(z.string()).default([]),
  blockedBy: z.array(z.string()).default([]),
})

export const InboxMessageSchema = z.object({
  from: z.string(),
  text: z.string().default(''),
  summary: z.string().default(''),
  timestamp: z.string(),
  color: z.string().default(''),
  read: z.boolean().default(false),
})

export const JournalEntrySchema = z.object({
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  timestamp: z.string(),
  message: z.object({
    model: z.string().default('claude-opus-4-6'),
    usage: z.object({
      input_tokens: z.number().default(0),
      output_tokens: z.number().default(0),
      cache_creation_input_tokens: z.number().default(0),
      cache_read_input_tokens: z.number().default(0),
    }),
  }),
})

// ─── 容錯 JSON 解析 ───

export function safeParseJson<S extends z.ZodTypeAny>(
  raw: string,
  schema: S
): { ok: true; data: z.output<S> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw)
    const result = schema.safeParse(parsed)
    if (result.success) {
      return { ok: true, data: result.data as z.output<S> }
    }
    return { ok: false, error: result.error.message }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'JSON parse failed' }
  }
}

export function safeParseJsonArray<S extends z.ZodTypeAny>(
  raw: string,
  itemSchema: S
): { ok: true; data: Array<z.output<S>> } | { ok: false; error: string } {
  return safeParseJson(raw, z.array(itemSchema))
}

/**
 * 解析 JSONL 的單一行 — 忽略不完整的行
 */
export function parseJournalLine(
  line: string
): { ok: true; data: z.output<typeof JournalEntrySchema> } | { ok: false } {
  const trimmed = line.trim()
  if (trimmed.length === 0) return { ok: false }
  const result = safeParseJson(trimmed, JournalEntrySchema)
  if (result.ok) return { ok: true, data: result.data }
  return { ok: false }
}
