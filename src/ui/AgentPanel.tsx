/**
 * AgentPanel：顯示 agent 列表 + heartbeat + last-activity
 *
 * 預設行為：隱藏 idle >1h / done / shutdown 的 agent，
 * 按 cost 降序排列，最多顯示 20 筆，其餘折疊為 summary。
 * showAll=true 時顯示所有 agent。
 */
import React, { memo, useMemo } from 'react'
import { Box, Text } from 'ink'
import type { AgentState } from '../core/types.js'
import { formatCost, formatTokens, totalTokenCount, formatTimeSince } from '../core/pricing.js'

const MAX_VISIBLE = 20
const IDLE_HIDE_MS = 60 * 60 * 1000 // 1 hour

interface AgentPanelProps {
  readonly agents: readonly AgentState[]
  readonly totalCost: number
  readonly totalTokens: number
  readonly showAll?: boolean
}

export const AgentPanel = memo(function AgentPanel({ agents, totalCost, totalTokens, showAll }: AgentPanelProps) {
  const { visible, hiddenCount, hiddenCost } = useMemo(() => {
    if (showAll || agents.length <= MAX_VISIBLE) {
      return { visible: agents, hiddenCount: 0, hiddenCost: 0 }
    }

    const now = Date.now()
    const active: AgentState[] = []
    let hCount = 0
    let hCost = 0

    for (const a of agents) {
      const isInactive = a.status === 'done' || a.status === 'shutdown'
      const isLongIdle = a.status === 'idle' && a.lastActivityAt > 0 && (now - a.lastActivityAt) > IDLE_HIDE_MS

      if (isInactive || isLongIdle) {
        hCount++
        hCost += a.cost
      } else {
        active.push(a)
      }
    }

    // 如果過濾後仍超過 MAX_VISIBLE，按 cost 降序取前 N
    if (active.length > MAX_VISIBLE) {
      const sorted = [...active].sort((a, b) => b.cost - a.cost)
      const extra = sorted.slice(MAX_VISIBLE)
      for (const a of extra) {
        hCount++
        hCost += a.cost
      }
      return { visible: sorted.slice(0, MAX_VISIBLE), hiddenCount: hCount, hiddenCost: hCost }
    }

    return { visible: active, hiddenCount: hCount, hiddenCost: hCost }
  }, [agents, showAll])

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{pad('AGENTS', 30)}</Text>
        <Text dimColor>{pad('STATUS', 12)}</Text>
        <Text dimColor>{pad('ACTIVE', 10)}</Text>
        <Text dimColor>{pad('TOKENS', 10)}</Text>
        <Text dimColor>COST</Text>
      </Box>

      {visible.length === 0 && hiddenCount === 0 ? (
        <Text dimColor>  (no agents detected yet)</Text>
      ) : (
        visible.map((agent, i) => (
          <AgentRow
            key={agent.agentId}
            agent={agent}
            isLast={i === visible.length - 1 && hiddenCount === 0}
          />
        ))
      )}

      {hiddenCount > 0 && (
        <Box>
          <Text dimColor>└─ ... and {hiddenCount} more agent{hiddenCount > 1 ? 's' : ''} ({formatCost(hiddenCost)})</Text>
        </Box>
      )}

      <Box>
        <Text dimColor>{' '.repeat(30) + '────────────────────────────'}</Text>
      </Box>
      <Box>
        <Text>{pad('', 30)}</Text>
        <Text bold>{pad('TOTAL', 12)}</Text>
        <Text>{pad('', 10)}</Text>
        <Text>{pad(formatTokens(totalTokens), 10)}</Text>
        <Text bold>{formatCost(totalCost)}</Text>
      </Box>
    </Box>
  )
})

const AgentRow = memo(function AgentRow({ agent, isLast }: { agent: AgentState; isLast: boolean }) {
  const prefix = isLast ? '└─' : '├─'
  const name = truncate(`${agent.name} (${agent.model})`, 26)
  const active = agent.lastActivityAt > 0
    ? formatTimeSince(agent.lastActivityAt)
    : '──'
  const tokens = formatTokens(totalTokenCount(agent.tokenUsage))
  const cost = formatCost(agent.cost)

  return (
    <Box flexDirection="column">
      <Box>
        <Text>{prefix} {pad(name, 28)}</Text>
        <StatusText status={agent.status} />
        <Text dimColor>{pad(active, 10)}</Text>
        <Text>{pad(tokens, 10)}</Text>
        <Text>{cost}</Text>
      </Box>
    </Box>
  )
})

function StatusText({ status }: { status: string }) {
  const width = 12
  switch (status) {
    case 'working':
      return <Text color="green">{pad(status, width)}</Text>
    case 'idle':
      return <Text dimColor>{pad(status, width)}</Text>
    case 'thinking':
      return <Text color="yellow">{pad(status, width)}</Text>
    case 'stuck':
      return <Text color="red">{pad('stuck?', width)}</Text>
    case 'done':
      return <Text color="blue">{pad(status, width)}</Text>
    case 'shutdown':
      return <Text dimColor>{pad(status, width)}</Text>
    default:
      return <Text dimColor>{pad(status, width)}</Text>
  }
}

// ─── Helpers ───

function pad(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width)
  return str + ' '.repeat(width - str.length)
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

