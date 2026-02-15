/**
 * AlertBanner：最近 alerts（最多 3 條）
 */
import React, { memo } from 'react'
import { Box, Text } from 'ink'
import type { Alert } from '../core/types.js'

interface AlertBannerProps {
  readonly alerts: readonly Alert[]
}

const MAX_VISIBLE = 3

export const AlertBanner = memo(function AlertBanner({ alerts }: AlertBannerProps) {
  if (alerts.length === 0) return null

  const visible = alerts.slice(-MAX_VISIBLE)
  const hidden = alerts.length - visible.length

  return (
    <Box flexDirection="column">
      <Text bold>
        ALERTS{hidden > 0 ? ` (showing ${visible.length} of ${alerts.length})` : ''}
      </Text>
      {visible.map((alert, i) => (
        <AlertRow key={i} alert={alert} />
      ))}
    </Box>
  )
})

function AlertRow({ alert }: { alert: Alert }) {
  const isCritical = alert.level === 'critical'
  return (
    <Box>
      <Text color={isCritical ? 'red' : 'yellow'}>{'⚠ '}</Text>
      <Text color={isCritical ? 'red' : 'yellow'}>{alert.message}</Text>
    </Box>
  )
}
