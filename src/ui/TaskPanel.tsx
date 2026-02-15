/**
 * TaskPanel：顯示 task 列表 + dependency + elapsed time
 */
import React, { memo } from 'react'
import { Box, Text } from 'ink'
import type { TaskData } from '../core/types.js'

interface TaskPanelProps {
  readonly tasks: readonly TaskData[]
}

export const TaskPanel = memo(function TaskPanel({ tasks }: TaskPanelProps) {
  return (
    <Box flexDirection="column">
      <Text bold>TASKS</Text>
      {tasks.length === 0 ? (
        <Text dimColor>  (no tasks)</Text>
      ) : (
        tasks.map(task => <TaskRow key={task.id} task={task} />)
      )}
    </Box>
  )
})

const TaskRow = memo(function TaskRow({ task }: { task: TaskData }) {
  const id = `#${task.id}`
  const subject = truncate(task.subject, 30)
  const owner = task.owner || '──'
  const blocked = task.blockedBy.length > 0
    ? `needs #${task.blockedBy.join(',#')}`
    : '──'

  return (
    <Box>
      <Text>{pad(id, 6)}</Text>
      <TaskStatusBadge status={task.status} />
      <Text> {pad(subject, 32)}</Text>
      <Text dimColor>{pad(owner, 18)}</Text>
      {task.blockedBy.length > 0 && <Text color="yellow">{blocked}</Text>}
    </Box>
  )
})

function TaskStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'in_progress':
      return <Text color="green">{pad('[working]', 12)}</Text>
    case 'completed':
      return <Text color="blue">{pad('[done]', 12)}</Text>
    case 'pending':
      return <Text dimColor>{pad('[pending]', 12)}</Text>
    default:
      return <Text dimColor>{pad(`[${status}]`, 12)}</Text>
  }
}

function pad(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width)
  return str + ' '.repeat(width - str.length)
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}
