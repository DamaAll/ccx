/**
 * Dashboard：ink 主畫面 — 組合所有 panel
 *
 * 200ms render throttle 由 ink 自身處理（React reconciliation）
 * 這裡只負責 state → UI 映射
 */
import React, { useState, useEffect } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import type { StateAggregator } from '../core/state-aggregator.js'
import type { TeamState, StateEvent } from '../core/types.js'
import { formatCost, totalTokenCount, formatDuration } from '../core/pricing.js'
import { AgentPanel } from './AgentPanel.js'
import { TaskPanel } from './TaskPanel.js'
import { CostBar } from './CostBar.js'
import { AlertBanner } from './AlertBanner.js'
import { CompletionBanner } from './CompletionBanner.js'

interface DashboardProps {
  readonly aggregator: StateAggregator
  readonly budget: number | null
  readonly hardLimit: boolean
  readonly sessionPath: string
}

export function Dashboard({ aggregator, budget, hardLimit, sessionPath }: DashboardProps) {
  const { exit } = useApp()
  const [state, setState] = useState<TeamState>(aggregator.getState())
  const [teamDeleted, setTeamDeleted] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)

  // 監聽 state events → trigger re-render
  useEffect(() => {
    let lastUpdate = 0
    const THROTTLE = 200

    const handler = (event: StateEvent) => {
      if (event.type === 'team_deleted') {
        setTeamDeleted(true)
        setState(aggregator.getState())
        return
      }

      // watcher_error 不需要 throttle
      if (event.type === 'watcher_error') {
        setState(aggregator.getState())
        return
      }

      const now = Date.now()
      if (now - lastUpdate < THROTTLE) return
      lastUpdate = now
      setState(aggregator.getState())
    }

    aggregator.on('event', handler)

    // 定期更新 elapsed time
    const timer = setInterval(() => {
      setState(aggregator.getState())
    }, 2000)

    return () => {
      aggregator.removeListener('event', handler)
      clearInterval(timer)
    }
  }, [aggregator])

  // 檢查是否所有 task 都完成
  useEffect(() => {
    if (state.tasks.length > 0) {
      const allDone = state.tasks.every(t => t.status === 'completed' || t.status === 'deleted')
      if (allDone && !isCompleted) {
        setIsCompleted(true)
      }
    }
  }, [state.tasks, isCompleted])

  // 鍵盤：q 或 Escape → 通知 ink 退出
  useInput((input: string, key: { escape?: boolean }) => {
    if (input === 'q' || key.escape) {
      exit()
    }
  })

  const elapsed = formatDuration(state.elapsedMs)

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold>ccx watch: {state.teamName} ({elapsed})</Text>
        <Text color="cyan">Cost: {formatCost(state.totalCost)}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(72)}</Text>

      {/* Budget bar */}
      <CostBar currentCost={state.totalCost} budget={budget} hardLimit={hardLimit} />

      {/* Agents */}
      <AgentPanel
        agents={state.agents}
        totalCost={state.totalCost}
        totalTokens={totalTokenCount(state.totalTokens)}
      />

      <Text> </Text>

      {/* Tasks */}
      <TaskPanel tasks={state.tasks} />

      <Text> </Text>

      {/* Alerts */}
      <AlertBanner alerts={state.alerts} />

      {/* Team deleted */}
      {teamDeleted && (
        <Box marginTop={1}>
          <Text color="yellow" bold>Team has been deleted. Snapshot saved to: {sessionPath}</Text>
        </Box>
      )}

      {/* Completion banner */}
      {isCompleted && !teamDeleted && (
        <Box marginTop={1}>
          <CompletionBanner
            completedAt={new Date().toLocaleTimeString()}
            elapsed={elapsed}
            totalCost={state.totalCost}
          />
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>Press q to quit | Snapshot: {sessionPath}</Text>
      </Box>
    </Box>
  )
}
