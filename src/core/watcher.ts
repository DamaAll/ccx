/**
 * Watcher：chokidar 檔案監控 → 串接 readers → StateAggregator
 *
 * 負責：
 * 1. 啟動時 full scan（progressive loading）
 * 2. 持續監控檔案變更
 * 3. TeamDelete polling（2 consecutive miss）
 * 4. 新 agent JSONL 偵測
 */
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import { readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { claudePaths } from './paths.js'
import { readTeamConfig, teamExists } from './team-reader.js'
import { readAllTasks } from './task-reader.js'
import { readAllInboxes, extractAgentNamesFromInboxes } from './inbox-reader.js'
import { createCursor, readFull, readIncremental, type CursorReadResult } from './cursor-reader.js'
import { tryResolveFromRawLines, batchResolve } from './identity-resolver.js'
import { discoverSubagents, listAgentFiles, type AgentFileInfo } from './session-discovery.js'
import { StateAggregator } from './state-aggregator.js'
import { SnapshotManager } from './snapshot-manager.js'
import type { FileCursor, StateEvent } from './types.js'

export interface WatchOptions {
  readonly teamName: string
  readonly budget?: number
  readonly stuckTimeoutMs?: number
  readonly onStateChange?: () => void
  readonly onError?: (err: Error) => void
}

export interface WatchHandle {
  readonly aggregator: StateAggregator
  readonly snapshotManager: SnapshotManager
  stop: () => Promise<void>
}

export async function startWatch(options: WatchOptions): Promise<WatchHandle> {
  const { teamName, budget, stuckTimeoutMs, onStateChange, onError } = options

  const aggregator = new StateAggregator({ budget, stuckThresholdMs: stuckTimeoutMs })
  const snapshotManager = new SnapshotManager(aggregator, teamName)

  // State change callback
  if (onStateChange) {
    aggregator.on('event', onStateChange)
  }

  // ─── Phase 1: Initial load ───

  const config = await readTeamConfig(teamName)
  if (!config) {
    throw new Error(`Team "${teamName}" not found. Check ~/.claude/teams/`)
  }

  aggregator.updateTeamConfig(config)

  // 平行讀取 tasks + inboxes
  const [tasks, inboxes] = await Promise.all([
    readAllTasks(teamName),
    readAllInboxes(teamName),
  ])

  aggregator.updateTasks(tasks)
  for (const inbox of inboxes) {
    aggregator.updateInbox(inbox)
  }

  // 找到 subagents 目錄
  const discovery = await discoverSubagents(config.leadSessionId)
  const cursors = new Map<string, FileCursor>()

  if (discovery) {
    // Progressive loading: 逐一讀取 JSONL + 收集 raw lines 做 batch resolve
    const rawLinesMap = new Map<string, readonly string[]>()

    for (const agentFile of discovery.agentFiles) {
      try {
        const result = await readFull(agentFile.filePath, agentFile.agentId)
        let cursor = result.cursor
        cursor = tryResolveFromRawLines(cursor, result.rawLines)
        cursors.set(agentFile.agentId, cursor)
        aggregator.updateCursor(cursor)

        // 只保留 UNRESOLVED 的 raw lines 給 batch resolve
        if (cursor.state === 'UNRESOLVED') {
          rawLinesMap.set(agentFile.agentId, result.rawLines)
        }
      } catch {
        // 忽略單一檔案的讀取錯誤
      }
    }

    // Batch resolve: 用剩餘 raw lines 再試一次
    if (rawLinesMap.size > 0) {
      const unresolved = [...cursors.values()].filter(c => c.state === 'UNRESOLVED')
      const resolvedCursors = batchResolve(unresolved, rawLinesMap)
      for (const cursor of resolvedCursors) {
        cursors.set(cursor.agentId, cursor)
        aggregator.updateCursor(cursor)
      }
    }
  }

  // Initialize snapshot
  await snapshotManager.initialize()

  // ─── Phase 2: Watch for changes ───

  const watchers: FSWatcher[] = []

  const handleWatcherError = (source: string) => (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    if (onError) onError(err instanceof Error ? err : new Error(message))
    else aggregator.emit('event', { type: 'watcher_error', source, message } satisfies StateEvent)
  }

  // Watch config.json
  const configWatcher = chokidarWatch(claudePaths.teamConfig(teamName), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200 },
  })
  configWatcher.on('change', async () => {
    try {
      const updated = await readTeamConfig(teamName)
      if (updated) aggregator.updateTeamConfig(updated)
    } catch { /* ignore */ }
  })
  configWatcher.on('error', handleWatcherError('config'))
  watchers.push(configWatcher)

  // Watch tasks directory
  const tasksDir = claudePaths.teamTasks(teamName)
  const taskWatcher = chokidarWatch(join(tasksDir, '*.json'), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200 },
  })
  taskWatcher.on('all', async () => {
    try {
      const updated = await readAllTasks(teamName)
      aggregator.updateTasks(updated)
    } catch { /* ignore */ }
  })
  taskWatcher.on('error', handleWatcherError('tasks'))
  watchers.push(taskWatcher)

  // Watch inboxes directory
  const inboxDir = claudePaths.teamInboxes(teamName)
  const inboxWatcher = chokidarWatch(join(inboxDir, '*.json'), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200 },
  })
  inboxWatcher.on('all', async () => {
    try {
      const updated = await readAllInboxes(teamName)
      for (const inbox of updated) {
        aggregator.updateInbox(inbox)
      }
    } catch { /* ignore */ }
  })
  inboxWatcher.on('error', handleWatcherError('inboxes'))
  watchers.push(inboxWatcher)

  // Watch subagents JSONL
  let subagentWatcher: FSWatcher | null = null
  if (discovery) {
    subagentWatcher = chokidarWatch(join(discovery.subagentsDir, 'agent-*.jsonl'), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100 },
    })

    subagentWatcher.on('change', async (filePath) => {
      const agentId = basename(filePath).replace('agent-', '').replace('.jsonl', '')
      try {
        let cursor = cursors.get(agentId) ?? createCursor(filePath, agentId)
        const result = await readIncremental(cursor)
        cursor = result.cursor
        cursor = tryResolveFromRawLines(cursor, result.rawLines)
        cursors.set(agentId, cursor)
        aggregator.updateCursor(cursor)
      } catch { /* ignore */ }
    })

    subagentWatcher.on('add', async (filePath) => {
      const agentId = basename(filePath).replace('agent-', '').replace('.jsonl', '')
      if (cursors.has(agentId)) return
      try {
        const result = await readFull(filePath, agentId)
        let cursor = result.cursor
        cursor = tryResolveFromRawLines(cursor, result.rawLines)
        cursors.set(agentId, cursor)
        aggregator.updateCursor(cursor)
      } catch { /* ignore */ }
    })

    subagentWatcher.on('error', handleWatcherError('subagents'))
    watchers.push(subagentWatcher)
  }

  // ─── Phase 3: TeamDelete polling ───

  let deleteMissCount = 0
  const deleteCheckInterval = setInterval(async () => {
    const exists = await teamExists(teamName)
    if (!exists) {
      deleteMissCount++
      if (deleteMissCount >= 2) {
        aggregator.markTeamDeleted()
        clearInterval(deleteCheckInterval)
      }
    } else {
      deleteMissCount = 0
    }
  }, 30_000) // 每 30 秒檢查

  // ─── Stop handle ───

  const stop = async () => {
    clearInterval(deleteCheckInterval)
    for (const w of watchers) {
      await w.close()
    }
    await snapshotManager.finalize()
  }

  return { aggregator, snapshotManager, stop }
}
