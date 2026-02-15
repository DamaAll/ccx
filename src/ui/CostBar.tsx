/**
 * CostBar：cost/budget 進度條 + soft/hard indicator
 */
import React, { memo } from 'react'
import { Box, Text } from 'ink'
import { formatCost } from '../core/pricing.js'

interface CostBarProps {
  readonly currentCost: number
  readonly budget: number | null
  readonly hardLimit: boolean
}

export const CostBar = memo(function CostBar({ currentCost, budget, hardLimit }: CostBarProps) {
  if (!budget) return null

  const pct = Math.min(currentCost / budget, 1.5) // cap at 150% for display
  const pctDisplay = Math.round((currentCost / budget) * 100)
  const barWidth = 20
  const filled = Math.min(Math.round(pct * barWidth), barWidth)
  const empty = barWidth - filled

  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  const limitLabel = hardLimit ? ' [HARD]' : ' [soft]'

  let barColor: string
  if (pctDisplay >= 100) barColor = 'red'
  else if (pctDisplay >= 80) barColor = 'red'
  else if (pctDisplay >= 60) barColor = 'yellow'
  else barColor = 'green'

  return (
    <Box>
      <Text>Budget: </Text>
      <Text color={barColor}>{bar}</Text>
      <Text> {formatCost(currentCost)} / {formatCost(budget)} ({pctDisplay}%)</Text>
      <Text color={hardLimit ? 'red' : 'yellow'} bold={hardLimit}>{limitLabel}</Text>
    </Box>
  )
})
