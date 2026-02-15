/**
 * watch command：純文字版 dashboard MVP
 *
 * Day 2 會替換為 ink Dashboard UI
 */
import chalk from 'chalk'
import { startWatch, type WatchHandle } from '../core/watcher.js'
import { listTeamNames } from '../core/team-reader.js'
import { formatCost, formatTokens, totalTokenCount } from '../core/pricing.js'
import type { TeamState, AgentState, TaskData, Alert } from '../core/types.js'

export interface WatchCommandOptions {
  readonly team?: string
  readonly budget?: number
  readonly stuckTimeout?: number
  readonly plain?: boolean
}

export async function runWatch(options: WatchCommandOptions): Promise<void> {
  const teamName = options.team ?? await autoDetectTeam()
  if (!teamName) {
    console.error(chalk.red('No active team found.'))
    console.error('Usage: ccx watch <team-name>')
    console.error('Run "ccx ls --active" to see active teams.')
    process.exit(1)
  }

  console.log(chalk.dim(`Starting watch for team: ${teamName}...`))

  // 用 mutable ref 避免 closure capture 未賦值的 handle
  const ref: { handle: WatchHandle | null } = { handle: null }

  let handle: WatchHandle
  try {
    handle = await startWatch({
      teamName,
      budget: options.budget,
      stuckTimeoutMs: options.stuckTimeout ? options.stuckTimeout * 1000 : undefined,
      onStateChange: () => { if (ref.handle) render(ref.handle) },
    })
    ref.handle = handle
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : 'Failed to start watch'))
    process.exit(1)
  }

  // SIGINT handling
  process.on('SIGINT', async () => {
    console.log(chalk.dim('\nSaving final snapshot...'))
    await handle.stop()
    console.log(chalk.dim(`Saved to: ${handle.snapshotManager.sessionPath}`))
    console.log(chalk.dim(`Run "ccx report ${handle.snapshotManager.name}" to view full report.`))
    process.exit(0)
  })

  // Initial render
  render(handle)

  // 定期 re-render（純文字版用 interval，ink 版用 event-driven）
  const renderInterval = setInterval(() => render(handle), 2000)

  // TeamDelete event → graceful stop
  handle.aggregator.on('event', async (event) => {
    if (event.type === 'team_deleted') {
      clearInterval(renderInterval)
      console.log(chalk.yellow('\nTeam has been deleted. Finalizing snapshot...'))
      await handle.stop()
      console.log(chalk.dim(`Saved to: ${handle.snapshotManager.sessionPath}`))
      process.exit(0)
    }
  })
}

// ─── Auto-detect team ───

async function autoDetectTeam(): Promise<string | null> {
  const teams = await listTeamNames()
  if (teams.length === 1) return teams[0]
  if (teams.length === 0) return null

  console.log(chalk.yellow('Multiple active teams found:'))
  for (const name of teams) {
    console.log(`  - ${name}`)
  }
  console.log(chalk.dim('Specify one: ccx watch <team-name>'))
  process.exit(1)
}

// ─── Render ───

let lastRenderAt = 0
const RENDER_THROTTLE_MS = 200

function render(handle: WatchHandle): void {
  const now = Date.now()
  if (now - lastRenderAt < RENDER_THROTTLE_MS) return
  lastRenderAt = now

  const state = handle.aggregator.getState()
  const output = formatDashboard(state)

  // Clear screen + move cursor to top
  process.stdout.write('\x1B[2J\x1B[H')
  process.stdout.write(output)
}

function formatDashboard(state: TeamState): string {
  const lines: string[] = []
  const elapsed = formatElapsed(state.elapsedMs)

  // ─── Header ───
  const header = `ccx watch: ${state.teamName} (${elapsed})`
  const costStr = `Cost: ${formatCost(state.totalCost)}`
  const padding = Math.max(0, 72 - header.length - costStr.length)
  lines.push(chalk.bold(header) + ' '.repeat(padding) + chalk.cyan(costStr))
  lines.push(chalk.dim('─'.repeat(72)))

  // ─── Agents ───
  lines.push(formatAgentHeader())

  if (state.agents.length === 0) {
    lines.push(chalk.dim('  (no agents detected yet)'))
  } else {
    for (let i = 0; i < state.agents.length; i++) {
      const agent = state.agents[i]
      const isLast = i === state.agents.length - 1
      const prefix = isLast ? '└─' : '├─'
      lines.push(formatAgentRow(prefix, agent))
    }
  }

  // ─── Total ───
  const totalTokens = formatTokens(totalTokenCount(state.totalTokens))
  lines.push(chalk.dim(' '.repeat(38) + '────────────────────────'))
  lines.push(
    ' '.repeat(38) +
    padRight('TOTAL', 10) +
    padRight(totalTokens, 10) +
    formatCost(state.totalCost)
  )

  lines.push('')

  // ─── Tasks ───
  lines.push(chalk.bold('TASKS'))

  if (state.tasks.length === 0) {
    lines.push(chalk.dim('  (no tasks)'))
  } else {
    for (const task of state.tasks) {
      lines.push(formatTaskRow(task))
    }
  }

  lines.push('')

  // ─── Alerts ───
  const recentAlerts = state.alerts.slice(-3)
  if (recentAlerts.length > 0) {
    lines.push(chalk.bold(`ALERTS (showing ${recentAlerts.length} of ${state.alerts.length})`))
    for (const alert of recentAlerts) {
      lines.push(formatAlert(alert))
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Format helpers ───

function formatAgentHeader(): string {
  return chalk.dim(
    padRight('AGENTS', 30) +
    padRight('STATUS', 12) +
    padRight('ACTIVE', 10) +
    padRight('TOKENS', 10) +
    'COST'
  )
}

function formatAgentRow(prefix: string, agent: AgentState): string {
  const name = truncate(`${agent.name} (${agent.model})`, 26)
  const status = colorizeStatus(agent.status)
  const active = agent.lastActivityAt > 0
    ? formatTimeSince(agent.lastActivityAt)
    : chalk.dim('──')
  const tokens = formatTokens(totalTokenCount(agent.tokenUsage))
  const cost = formatCost(agent.cost)

  return (
    `${prefix} ${padRight(name, 28)}` +
    padRight(status, 20) + // extra width for ANSI codes
    padRight(active, 10) +
    padRight(tokens, 10) +
    cost
  )
}

function formatTaskRow(task: TaskData): string {
  const id = `#${task.id}`
  const status = colorizeTaskStatus(task.status)
  const subject = truncate(task.subject, 30)
  const owner = task.owner || chalk.dim('──')

  return `${padRight(id, 5)} ${padRight(status, 18)} ${padRight(subject, 32)} ${owner}`
}

function formatAlert(alert: Alert): string {
  const icon = alert.level === 'critical' ? chalk.red('!!') : chalk.yellow('!!')
  const msg = alert.level === 'critical' ? chalk.red(alert.message) : chalk.yellow(alert.message)
  return `${icon} ${msg}`
}

function colorizeStatus(status: string): string {
  switch (status) {
    case 'working': return chalk.green(status)
    case 'idle': return chalk.dim(status)
    case 'thinking': return chalk.yellow(status)
    case 'stuck': return chalk.red('stuck?')
    case 'done': return chalk.blue(status)
    case 'shutdown': return chalk.dim('shutdown')
    default: return chalk.dim(status)
  }
}

function colorizeTaskStatus(status: string): string {
  switch (status) {
    case 'in_progress': return chalk.green('[working]')
    case 'completed': return chalk.blue('[done]')
    case 'pending': return chalk.dim('[pending]')
    default: return chalk.dim(`[${status}]`)
  }
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60

  if (hours > 0) return `${hours}h ${mins}m ${secs}s`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

function formatTimeSince(timestamp: number): string {
  const ms = Date.now() - timestamp
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m${secs % 60}s`
  return `${Math.floor(mins / 60)}h${mins % 60}m`
}

function padRight(str: string, width: number): string {
  // 移除 ANSI codes 計算真實寬度
  const stripped = str.replace(/\x1B\[[0-9;]*m/g, '')
  const pad = Math.max(0, width - stripped.length)
  return str + ' '.repeat(pad)
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}
