/**
 * reuse command：從 saved session 提取 team topology，生成可複製的 prompt
 *
 * 使用場景：
 * 1. 上次跑了一個 8-agent team 效果很好，下次想快速重建同樣陣型
 * 2. 分享 team topology 給同事
 *
 * 輸出格式：
 * - terminal (default): 彩色概覽 + 可複製的 prompt
 * - prompt (--prompt): 只輸出乾淨的 prompt text
 * - json (--json): 結構化 JSON
 */
import chalk from 'chalk'
import { findSnapshot, listSessions } from '../core/snapshot-reader.js'
import { formatCost, formatTokens, totalTokenCount } from '../core/pricing.js'
import type { SessionSnapshot, AgentSnapshotEntry } from '../core/types.js'

export interface ReuseCommandOptions {
  readonly target?: string
  readonly prompt?: boolean
  readonly json?: boolean
}

export async function runReuse(options: ReuseCommandOptions): Promise<void> {
  const snapshot = await resolveTarget(options.target)
  if (!snapshot) {
    console.error(chalk.red('No session found.'))
    console.error('Usage: ccx reuse <session-name|team-name>')
    console.error('Run "ccx ls --sessions" to see saved sessions.')
    process.exit(1)
  }

  const topology = extractTopology(snapshot)

  if (options.json) {
    console.log(JSON.stringify(topology, null, 2))
  } else if (options.prompt) {
    console.log(generatePrompt(topology))
  } else {
    printTopologyOverview(topology, snapshot)
    console.log('')
    console.log(chalk.bold('Reuse prompt (copy & paste into Claude Code):'))
    console.log(chalk.dim('─'.repeat(72)))
    console.log(generatePrompt(topology))
    console.log(chalk.dim('─'.repeat(72)))
  }
}

// ─── Topology extraction ───

interface TeamTopology {
  readonly teamName: string
  readonly roles: readonly RoleEntry[]
  readonly taskPatterns: readonly string[]
  readonly totalAgents: number
  readonly modelMix: Record<string, number>
}

interface RoleEntry {
  readonly name: string
  readonly model: string
  readonly cost: number
  readonly tokens: number
  readonly isLead: boolean
}

function extractTopology(snapshot: SessionSnapshot): TeamTopology {
  const modelMix: Record<string, number> = {}
  const roles: RoleEntry[] = []

  // 用 cost 排序，最貴的（通常是 lead 或核心 agent）排前面
  const sorted = [...snapshot.agents].sort((a, b) => b.cost - a.cost)

  for (const agent of sorted) {
    const isLead = agent.name === 'team-lead' || agent.name.includes('lead')
    roles.push({
      name: agent.name,
      model: agent.model,
      cost: agent.cost,
      tokens: totalTokenCount(agent.tokenUsage),
      isLead,
    })

    modelMix[agent.model] = (modelMix[agent.model] ?? 0) + 1
  }

  // 從 tasks 提取 pattern（去重 subject 的前綴）
  const taskPatterns = extractTaskPatterns(snapshot)

  return {
    teamName: snapshot.teamName,
    roles,
    taskPatterns,
    totalAgents: snapshot.agents.length,
    modelMix,
  }
}

function extractTaskPatterns(snapshot: SessionSnapshot): string[] {
  if (snapshot.tasks.length === 0) return []

  // 取 unique task subjects（截短到 60 字元）
  const seen = new Set<string>()
  const patterns: string[] = []

  for (const task of snapshot.tasks) {
    const short = task.subject.slice(0, 60)
    if (!seen.has(short)) {
      seen.add(short)
      patterns.push(short)
    }
  }

  return patterns.slice(0, 20) // 最多 20 條
}

// ─── Prompt generation ───

function generatePrompt(topology: TeamTopology): string {
  const lines: string[] = []

  lines.push(`Create a team called "${topology.teamName}" with the following structure:`)
  lines.push('')

  // Model mix summary
  const mixParts = Object.entries(topology.modelMix)
    .sort(([, a], [, b]) => b - a)
    .map(([model, count]) => `${count}x ${model}`)
  lines.push(`Team size: ${topology.totalAgents} agents (${mixParts.join(', ')})`)
  lines.push('')

  // Named roles (只列出有名字的，排除 agent-xxx 的匿名 agents)
  const namedRoles = topology.roles.filter(r => !r.name.startsWith('agent-'))
  const anonymousCount = topology.roles.length - namedRoles.length

  if (namedRoles.length > 0) {
    lines.push('Named roles:')
    for (const role of namedRoles) {
      const lead = role.isLead ? ' (lead)' : ''
      lines.push(`- ${role.name}: ${role.model}${lead}`)
    }
    lines.push('')
  }

  if (anonymousCount > 0) {
    // 按 model 分組匿名 agents
    const anonByModel: Record<string, number> = {}
    for (const role of topology.roles) {
      if (role.name.startsWith('agent-')) {
        anonByModel[role.model] = (anonByModel[role.model] ?? 0) + 1
      }
    }

    lines.push('Worker agents:')
    for (const [model, count] of Object.entries(anonByModel).sort(([, a], [, b]) => b - a)) {
      lines.push(`- ${count}x ${model} workers`)
    }
    lines.push('')
  }

  // Task patterns as hints
  if (topology.taskPatterns.length > 0) {
    lines.push('Task examples from previous run:')
    for (const pattern of topology.taskPatterns.slice(0, 10)) {
      lines.push(`- ${pattern}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Terminal display ───

function printTopologyOverview(topology: TeamTopology, snapshot: SessionSnapshot): void {
  console.log(chalk.bold(`Topology: ${topology.teamName}`))
  console.log(chalk.dim('═'.repeat(72)))

  // Summary
  const mixParts = Object.entries(topology.modelMix)
    .sort(([, a], [, b]) => b - a)
    .map(([model, count]) => `${count}x ${model}`)
  console.log(`  Agents:  ${topology.totalAgents} (${mixParts.join(', ')})`)
  console.log(`  Cost:    ${formatCost(snapshot.totalCost)}`)
  console.log(`  Tasks:   ${snapshot.tasks.length}`)
  console.log('')

  // Top agents by cost
  const top = topology.roles.slice(0, 10)
  console.log(chalk.bold('Top agents by cost:'))
  console.log(chalk.dim(`  ${'NAME'.padEnd(30)} ${'MODEL'.padEnd(8)} ${'TOKENS'.padEnd(10)} COST`))

  for (const role of top) {
    const name = role.name.slice(0, 29).padEnd(30)
    const model = role.model.padEnd(8)
    const tokens = formatTokens(role.tokens).padEnd(10)
    const cost = formatCost(role.cost)
    const lead = role.isLead ? chalk.cyan(' *') : ''
    console.log(`  ${name} ${model} ${tokens} ${cost}${lead}`)
  }

  if (topology.roles.length > 10) {
    console.log(chalk.dim(`  ... and ${topology.roles.length - 10} more`))
  }
}

// ─── Target resolution ───

async function resolveTarget(target?: string): Promise<SessionSnapshot | null> {
  if (target) {
    return findSnapshot(target)
  }

  // Auto-detect: 取最新 session
  const sessions = await listSessions()
  if (sessions.length > 0) {
    return findSnapshot(sessions[0].name)
  }

  return null
}
