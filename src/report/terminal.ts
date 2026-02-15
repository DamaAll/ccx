/**
 * Terminal report formatter：彩色表格輸出
 */
import chalk from 'chalk'
import type { SessionSnapshot } from '../core/types.js'
import { formatCost, formatTokens, totalTokenCount } from '../core/pricing.js'

export function formatTerminalReport(snapshot: SessionSnapshot): string {
  const lines: string[] = []
  const elapsed = formatDuration(snapshot.lastUpdatedAt - snapshot.startedAt)
  const startedAt = new Date(snapshot.startedAt).toLocaleString()

  // Header
  lines.push(chalk.bold(`ccx report: ${snapshot.teamName}`))
  lines.push(chalk.dim('═'.repeat(72)))
  lines.push('')

  // Summary
  lines.push(chalk.bold('SUMMARY'))
  lines.push(`  Team:       ${snapshot.teamName}`)
  lines.push(`  Session:    ${snapshot.sessionId}`)
  lines.push(`  Started:    ${startedAt}`)
  lines.push(`  Duration:   ${elapsed}`)
  lines.push(`  Status:     ${snapshot.finalized ? chalk.blue('finalized') : chalk.green('active')}`)
  lines.push(`  Total Cost: ${chalk.bold(formatCost(snapshot.totalCost))}`)
  lines.push(`  Agents:     ${snapshot.agents.length}`)
  lines.push(`  Tasks:      ${snapshot.tasks.length}`)
  lines.push('')

  // Agents table
  lines.push(chalk.bold('AGENTS'))
  lines.push(chalk.dim(
    `  ${'NAME'.padEnd(25)} ${'MODEL'.padEnd(10)} ${'STATUS'.padEnd(12)} ${'TOKENS'.padEnd(12)} COST`
  ))
  lines.push(chalk.dim('  ' + '─'.repeat(68)))

  for (const agent of snapshot.agents) {
    const name = agent.name.slice(0, 24).padEnd(25)
    const model = agent.model.padEnd(10)
    const status = colorStatus(agent.status).padEnd(20) // extra for ANSI
    const tokens = formatTokens(totalTokenCount(agent.tokenUsage)).padEnd(12)
    const cost = formatCost(agent.cost)
    lines.push(`  ${name} ${model} ${status} ${tokens} ${cost}`)
  }

  // Totals
  const totalTokens = formatTokens(totalTokenCount(snapshot.totalTokens))
  lines.push(chalk.dim('  ' + '─'.repeat(68)))
  lines.push(`  ${'TOTAL'.padEnd(25)} ${''.padEnd(10)} ${''.padEnd(12)} ${totalTokens.padEnd(12)} ${chalk.bold(formatCost(snapshot.totalCost))}`)
  lines.push('')

  // Tasks table
  if (snapshot.tasks.length > 0) {
    lines.push(chalk.bold('TASKS'))
    for (const task of snapshot.tasks) {
      const id = `#${task.id}`.padEnd(6)
      const status = colorTaskStatus(task.status)
      const subject = task.subject.slice(0, 40).padEnd(42)
      const owner = task.owner || chalk.dim('──')
      lines.push(`  ${id}${status} ${subject} ${owner}`)
    }
    lines.push('')
  }

  // Alerts
  if (snapshot.alerts.length > 0) {
    lines.push(chalk.bold('ALERTS'))
    for (const alert of snapshot.alerts) {
      const time = new Date(alert.timestamp).toLocaleTimeString()
      const icon = alert.level === 'critical' ? chalk.red('!!') : chalk.yellow('!!')
      const msg = alert.level === 'critical' ? chalk.red(alert.message) : chalk.yellow(alert.message)
      lines.push(`  ${icon} ${chalk.dim(time)} ${msg}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function colorStatus(status: string): string {
  switch (status) {
    case 'working': return chalk.green(status)
    case 'idle': return chalk.dim(status)
    case 'stuck': return chalk.red('stuck?')
    case 'done': return chalk.blue(status)
    case 'shutdown': return chalk.dim(status)
    default: return chalk.dim(status)
  }
}

function colorTaskStatus(status: string): string {
  switch (status) {
    case 'in_progress': return chalk.green('[working]'.padEnd(12))
    case 'completed': return chalk.blue('[done]'.padEnd(12))
    case 'pending': return chalk.dim('[pending]'.padEnd(12))
    default: return chalk.dim(`[${status}]`.padEnd(12))
  }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}
