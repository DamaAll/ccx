/**
 * TaskPanel：顯示 task 列表 + dependency + elapsed time
 *
 * 預設最多顯示 15 筆 task（優先顯示 in_progress + pending），
 * showAll=true 時顯示全部。
 */
import React, { memo, useMemo } from 'react'
import { Box, Text } from 'ink'
import type { TaskData } from '../core/types.js'

const MAX_TASKS = 15

interface TaskPanelProps {
  readonly tasks: readonly TaskData[]
  readonly showAll?: boolean
}

export const TaskPanel = memo(function TaskPanel({ tasks, showAll }: TaskPanelProps) {
  const { visible, hiddenCount } = useMemo(() => {
    if (showAll || tasks.length <= MAX_TASKS) {
      return { visible: tasks, hiddenCount: 0 }
    }

    // 優先顯示 in_progress → pending → completed
    const prioritized = [...tasks].sort((a, b) => {
      const order: Record<string, number> = { in_progress: 0, pending: 1, completed: 2, deleted: 3 }
      return (order[a.status] ?? 4) - (order[b.status] ?? 4)
    })

    return {
      visible: prioritized.slice(0, MAX_TASKS),
      hiddenCount: prioritized.length - MAX_TASKS,
    }
  }, [tasks, showAll])

  return (
    <Box flexDirection="column">
      <Text bold>TASKS</Text>
      {visible.length === 0 ? (
        <Text dimColor>  (no tasks)</Text>
      ) : (
        visible.map(task => <TaskRow key={task.id} task={task} />)
      )}
      {hiddenCount > 0 && (
        <Text dimColor>  ... and {hiddenCount} more task{hiddenCount > 1 ? 's' : ''} (completed)</Text>
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
