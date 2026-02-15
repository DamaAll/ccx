/**
 * watch command：ink Dashboard UI
 *
 * --plain 回退到純文字模式（Day 1 的實作）
 */
import React from 'react'
import { render } from 'ink'
import chalk from 'chalk'
import { startWatch, type WatchHandle } from '../core/watcher.js'
import { listTeamNames } from '../core/team-reader.js'
import { Dashboard } from '../ui/Dashboard.js'
import { sendOsNotification } from '../guard/soft-limit.js'
import { killAllMembers } from '../guard/hard-limit.js'
import { formatCost, formatTokens, totalTokenCount, formatDuration, formatTimeSince } from '../core/pricing.js'
import type { TeamState, StateEvent, TaskData } from '../core/types.js'

export interface WatchCommandOptions {
  readonly team?: string
  readonly budget?: number
  readonly stuckTimeout?: number
  readonly plain?: boolean
  readonly kill?: boolean
  readonly notify?: boolean
  readonly all?: boolean
}

export async function runWatch(options: WatchCommandOptions): Promise<void> {
  const teamName = options.team ?? await autoDetectTeam()
  if (!teamName) {
    console.error(chalk.red('No active team found.'))
    console.error('Usage: ccx watch <team-name>')
    console.error('Run "ccx ls --active" to see active teams.')
    process.exit(1)
  }

  // --kill 啟動確認
  if (options.kill && options.budget) {
    console.log(chalk.yellow.bold(`⚠ Hard Limit enabled.`))
    console.log(chalk.yellow(`  When cost exceeds $${options.budget}, ccx will send C-c to agent tmux panes.`))
    console.log(chalk.yellow(`  This may cause unfinished work to be lost.`))
    console.log()
  }

  let handle: WatchHandle
  try {
    handle = await startWatch({
      teamName,
      budget: options.budget,
      stuckTimeoutMs: options.stuckTimeout ? options.stuckTimeout * 1000 : undefined,
    })
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : 'Failed to start watch'))
    process.exit(1)
  }

  // Guard: OS notification + hard limit
  if (options.notify || options.kill) {
    handle.aggregator.on('event', async (event: StateEvent) => {
      if (event.type === 'cost_threshold') {
        if (options.notify) {
          await sendOsNotification(
            'ccx budget alert',
            `${teamName}: ${formatCost(event.current)} / ${formatCost(event.budget)}`
          )
        }

        if (options.kill && event.current >= event.budget) {
          const state = handle.aggregator.getState()
          const paneIds = getPaneIds(state)
          if (paneIds.length > 0) {
            await killAllMembers(paneIds)
          }
        }
      }
    })
  }

  if (options.plain) {
    // ─── Plain text mode ───
    let shuttingDown = false
    const gracefulShutdown = async () => {
      if (shuttingDown) { process.exit(1) }
      shuttingDown = true
      try {
        await handle.stop()
        console.log(chalk.dim(`\nSaved to: ${handle.snapshotManager.sessionPath}`))
      } catch {
        console.error(chalk.dim('\nSnapshot save failed.'))
      }
      process.exit(0)
    }
    process.on('SIGINT', gracefulShutdown)
    process.on('SIGTERM', gracefulShutdown)

    runPlainMode(handle, options.all)
  } else {
    // ─── ink mode ───
    // 需要 TTY 支援 raw mode，否則 fallback 到 plain mode
    if (!process.stdin.isTTY) {
      console.error(chalk.yellow('stdin is not a TTY — falling back to --plain mode.'))
      let shuttingDown = false
      const gracefulShutdown = async () => {
        if (shuttingDown) { process.exit(1) }
        shuttingDown = true
        try {
          await handle.stop()
          console.log(chalk.dim(`\nSaved to: ${handle.snapshotManager.sessionPath}`))
        } catch {
          console.error(chalk.dim('\nSnapshot save failed.'))
        }
        process.exit(0)
      }
      process.on('SIGINT', gracefulShutdown)
      process.on('SIGTERM', gracefulShutdown)
      runPlainMode(handle, options.all)
      return
    }

    // ink 在 raw mode 下攔截 Ctrl+C（作為 \x03 byte），自動呼叫 exit()
    // 按 q / Escape 也會在 Dashboard 內呼叫 exit()
    // waitUntilExit() 在 ink 退出後 resolve → 清理 → process.exit
    const instance = render(
      React.createElement(Dashboard, {
        aggregator: handle.aggregator,
        budget: options.budget ?? null,
        hardLimit: options.kill ?? false,
        sessionPath: handle.snapshotManager.sessionPath,
        showAll: options.all ?? false,
      })
    )

    // SIGTERM（kill 指令）→ 觸發 ink unmount
    process.on('SIGTERM', () => instance.unmount())

    await instance.waitUntilExit()

    // ink 已釋放 raw mode，Ctrl+C 恢復為 SIGINT
    // 如果清理過程中使用者按 Ctrl+C → force exit
    process.on('SIGINT', () => process.exit(1))

    try {
      await handle.stop()
      console.log(chalk.dim(`Saved to: ${handle.snapshotManager.sessionPath}`))
    } catch {
      console.error(chalk.dim('Snapshot save failed.'))
    }
    process.exit(0)
  }
}

// ─── Plain text mode (Day 1 fallback) ───

function runPlainMode(handle: WatchHandle, showAll?: boolean): void {
  const renderPlain = () => {
    const state = handle.aggregator.getState()
    process.stdout.write('\x1B[2J\x1B[H')
    process.stdout.write(formatPlainDashboard(state, showAll))
  }

  renderPlain()
  setInterval(renderPlain, 2000)

  handle.aggregator.on('event', async (event: StateEvent) => {
    if (event.type === 'team_deleted') {
      console.log(chalk.yellow(`\nTeam deleted. Snapshot saved to: ${handle.snapshotManager.sessionPath}`))
      await handle.stop()
      process.exit(0)
    }
    if (event.type === 'watcher_error') {
      console.error(chalk.dim(`[watcher] ${event.source}: ${event.message}`))
    }
  })
}

const PLAIN_MAX_AGENTS = 20
const PLAIN_MAX_TASKS = 15
const PLAIN_IDLE_HIDE_MS = 60 * 60 * 1000

function formatPlainDashboard(state: TeamState, showAll?: boolean): string {
  const lines: string[] = []
  const elapsed = formatDuration(state.elapsedMs)

  lines.push(`ccx watch: ${state.teamName} (${elapsed})    Cost: ${formatCost(state.totalCost)}`)
  lines.push('─'.repeat(72))
  lines.push(`${'AGENTS'.padEnd(30)}${'STATUS'.padEnd(12)}${'ACTIVE'.padEnd(10)}${'TOKENS'.padEnd(10)}COST`)

  // 過濾 agent
  let visibleAgents = state.agents
  let hiddenAgentCount = 0
  let hiddenAgentCost = 0

  if (!showAll && state.agents.length > PLAIN_MAX_AGENTS) {
    const now = Date.now()
    const active: typeof state.agents[number][] = []

    for (const a of state.agents) {
      const isInactive = a.status === 'done' || a.status === 'shutdown'
      const isLongIdle = a.status === 'idle' && a.lastActivityAt > 0 && (now - a.lastActivityAt) > PLAIN_IDLE_HIDE_MS

      if (isInactive || isLongIdle) {
        hiddenAgentCount++
        hiddenAgentCost += a.cost
      } else {
        active.push(a)
      }
    }

    if (active.length > PLAIN_MAX_AGENTS) {
      const sorted = [...active].sort((a, b) => b.cost - a.cost)
      for (const a of sorted.slice(PLAIN_MAX_AGENTS)) {
        hiddenAgentCount++
        hiddenAgentCost += a.cost
      }
      visibleAgents = sorted.slice(0, PLAIN_MAX_AGENTS)
    } else {
      visibleAgents = active
    }
  }

  for (let i = 0; i < visibleAgents.length; i++) {
    const a = visibleAgents[i]
    const isLast = i === visibleAgents.length - 1 && hiddenAgentCount === 0
    const prefix = isLast ? '└─' : '├─'
    const name = `${a.name} (${a.model})`.slice(0, 26)
    const active = a.lastActivityAt > 0
      ? formatTimeSince(a.lastActivityAt) : '──'
    const tokens = formatTokens(totalTokenCount(a.tokenUsage))

    lines.push(
      `${prefix} ${name.padEnd(28)}${a.status.padEnd(12)}${active.padEnd(10)}${tokens.padEnd(10)}${formatCost(a.cost)}`
    )
  }

  if (hiddenAgentCount > 0) {
    lines.push(`└─ ... and ${hiddenAgentCount} more agent${hiddenAgentCount > 1 ? 's' : ''} (${formatCost(hiddenAgentCost)})`)
  }

  lines.push(`${''.padEnd(30)}${'TOTAL'.padEnd(12)}${''.padEnd(10)}${formatTokens(totalTokenCount(state.totalTokens)).padEnd(10)}${formatCost(state.totalCost)}`)
  lines.push('')
  lines.push('TASKS')

  // 過濾 tasks
  let visibleTasks: readonly TaskData[] = state.tasks
  let hiddenTaskCount = 0

  if (!showAll && state.tasks.length > PLAIN_MAX_TASKS) {
    const sorted = [...state.tasks].sort((a, b) => {
      const order: Record<string, number> = { in_progress: 0, pending: 1, completed: 2, deleted: 3 }
      return (order[a.status] ?? 4) - (order[b.status] ?? 4)
    })
    visibleTasks = sorted.slice(0, PLAIN_MAX_TASKS)
    hiddenTaskCount = sorted.length - PLAIN_MAX_TASKS
  }

  for (const t of visibleTasks) {
    const status = t.status === 'in_progress' ? '[working]' : t.status === 'completed' ? '[done]' : `[${t.status}]`
    lines.push(`#${t.id.padEnd(5)} ${status.padEnd(12)} ${t.subject.slice(0, 30).padEnd(32)} ${t.owner || '──'}`)
  }

  if (hiddenTaskCount > 0) {
    lines.push(`  ... and ${hiddenTaskCount} more task${hiddenTaskCount > 1 ? 's' : ''} (completed)`)
  }

  if (state.alerts.length > 0) {
    lines.push('')
    lines.push('ALERTS')
    for (const a of state.alerts.slice(-3)) {
      lines.push(`⚠ ${a.message}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

// ─── Auto-detect ───

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

function getPaneIds(state: TeamState): string[] {
  // 目前沒有直接拿到 paneId 的方式（config.json 的 tmuxPaneId 通常是空的）
  // 這是 v1.5 hard limit 的限制
  return []
}

