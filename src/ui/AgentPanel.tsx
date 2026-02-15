/**
 * AgentPanel：顯示 agent 列表 + heartbeat + last-activity
 */
import React, { memo } from 'react'
import { Box, Text } from 'ink'
import type { AgentState } from '../core/types.js'
import { formatCost, formatTokens, totalTokenCount } from '../core/pricing.js'

interface AgentPanelProps {
  readonly agents: readonly AgentState[]
  readonly totalCost: number
  readonly totalTokens: number
}

export const AgentPanel = memo(function AgentPanel({ agents, totalCost, totalTokens }: AgentPanelProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{pad('AGENTS', 30)}</Text>
        <Text dimColor>{pad('STATUS', 12)}</Text>
        <Text dimColor>{pad('ACTIVE', 10)}</Text>
        <Text dimColor>{pad('TOKENS', 10)}</Text>
        <Text dimColor>COST</Text>
      </Box>

      {agents.length === 0 ? (
        <Text dimColor>  (no agents detected yet)</Text>
      ) : (
        agents.map((agent, i) => (
          <AgentRow
            key={agent.agentId}
            agent={agent}
            isLast={i === agents.length - 1}
          />
        ))
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

function formatTimeSince(timestamp: number): string {
  const ms = Date.now() - timestamp
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m${secs % 60}s`
  return `${Math.floor(mins / 60)}h${mins % 60}m`
}
