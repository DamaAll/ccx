/**
 * CompletionBanner：team 完成時的 summary + 快捷鍵
 */
import React, { memo } from 'react'
import { Box, Text } from 'ink'
import { formatCost } from '../core/pricing.js'

interface CompletionBannerProps {
  readonly completedAt: string
  readonly elapsed: string
  readonly totalCost: number
}

export const CompletionBanner = memo(function CompletionBanner({
  completedAt,
  elapsed,
  totalCost,
}: CompletionBannerProps) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="green" paddingX={1}>
      <Text color="green" bold>
        Team completed at {completedAt} | {elapsed} | {formatCost(totalCost)}
      </Text>
      <Box marginTop={1}>
        <Text dimColor>[r] report  [s] save snapshot  [q] quit</Text>
      </Box>
    </Box>
  )
})
