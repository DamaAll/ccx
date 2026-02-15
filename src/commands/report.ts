/**
 * report command：從 saved session 或 live team 生成報告
 *
 * 資料來源：
 * 1. session name → 讀 ~/.ccx/sessions/
 * 2. team name → 即時讀 ~/.claude/ + aggregate
 * 3. 無參數 → auto-detect
 */
import chalk from 'chalk'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { findSnapshot, listSessions } from '../core/snapshot-reader.js'
import { readTeamConfig, listTeamNames } from '../core/team-reader.js'
import { startWatch } from '../core/watcher.js'
import { formatTerminalReport } from '../report/terminal.js'
import { formatMarkdownReport } from '../report/markdown.js'
import { formatJsonReport } from '../report/json.js'
import { redactSnapshot } from '../report/redact-snapshot.js'
import type { SessionSnapshot } from '../core/types.js'

export interface ReportCommandOptions {
  readonly target?: string
  readonly md?: boolean
  readonly json?: boolean
  readonly save?: string | boolean
}

export async function runReport(options: ReportCommandOptions): Promise<void> {
  const rawSnapshot = await resolveSnapshot(options.target)
  if (!rawSnapshot) {
    console.error(chalk.red('No data found.'))
    console.error('Usage: ccx report <team-name|session-id>')
    console.error('Run "ccx ls" to see available sessions.')
    process.exit(1)
  }

  // Secret redaction on snapshot data
  const snapshot = redactSnapshot(rawSnapshot)

  // Format output
  let output: string
  if (options.json) {
    output = formatJsonReport(snapshot)
  } else if (options.md) {
    output = formatMarkdownReport(snapshot)
  } else {
    output = formatTerminalReport(snapshot)
  }

  console.log(output)

  // --save: 同時存 snapshot
  if (options.save) {
    const saveName = typeof options.save === 'string' ? options.save : snapshot.teamName
    const mdContent = formatMarkdownReport(snapshot)
    const mdPath = resolve(`${saveName}-report.md`)
    await writeFile(mdPath, mdContent, 'utf-8')
    console.log(chalk.dim(`Report saved to: ${mdPath}`))
  }
}

async function resolveSnapshot(target?: string): Promise<SessionSnapshot | null> {
  // 有指定 target
  if (target) {
    // 先試 saved session
    const saved = await findSnapshot(target)
    if (saved) return saved

    // 再試 live team → 建立臨時 snapshot
    return await buildLiveSnapshot(target)
  }

  // 無指定 → auto-detect
  // 優先用 saved sessions
  const sessions = await listSessions()
  if (sessions.length > 0) {
    return findSnapshot(sessions[0].name)
  }

  // 嘗試 live team
  const teams = await listTeamNames()
  if (teams.length === 1) {
    return buildLiveSnapshot(teams[0])
  }

  if (teams.length > 1) {
    console.log(chalk.yellow('Multiple teams found. Specify one:'))
    for (const name of teams) {
      console.log(`  ccx report ${name}`)
    }
    process.exit(1)
  }

  return null
}

/**
 * 從 live team 資料建立一次性 snapshot
 */
async function buildLiveSnapshot(teamName: string): Promise<SessionSnapshot | null> {
  const config = await readTeamConfig(teamName)
  if (!config) return null

  try {
    const handle = await startWatch({ teamName })
    const state = handle.aggregator.getState()
    await handle.stop()

    return {
      teamName: state.teamName,
      sessionId: `live-${teamName}`,
      startedAt: state.startedAt,
      lastUpdatedAt: Date.now(),
      finalized: false,
      agents: state.agents.map(a => ({
        agentId: a.agentId,
        name: a.name,
        model: a.model,
        tokenUsage: a.tokenUsage,
        cost: a.cost,
        status: a.status,
      })),
      tasks: state.tasks,
      totalCost: state.totalCost,
      totalTokens: state.totalTokens,
      alerts: state.alerts,
    }
  } catch {
    return null
  }
}
