/**
 * TaskReader：讀取 ~/.claude/tasks/{team}/*.json
 */
import { readFile, readdir } from 'node:fs/promises'
import { claudePaths } from './paths.js'
import { TaskDataSchema, safeParseJson } from './data-source-adapter.js'
import type { TaskData } from './types.js'

/**
 * 讀取單一 task
 */
export async function readTask(teamName: string, taskId: string): Promise<TaskData | null> {
  const taskPath = claudePaths.teamTask(teamName, taskId)
  try {
    const raw = await readFile(taskPath, 'utf-8')
    const result = safeParseJson(raw, TaskDataSchema)
    if (result.ok) return result.data
    return null
  } catch {
    return null
  }
}

/**
 * 讀取 team 的所有 tasks
 */
export async function readAllTasks(teamName: string): Promise<TaskData[]> {
  const dir = claudePaths.teamTasks(teamName)
  try {
    const entries = await readdir(dir)
    const jsonFiles = entries.filter(f => f.endsWith('.json'))
    const tasks = await Promise.all(
      jsonFiles.map(async (filename) => {
        const taskId = filename.replace('.json', '')
        return readTask(teamName, taskId)
      })
    )
    return tasks
      .filter((t): t is TaskData => t !== null)
      .sort((a, b) => Number(a.id) - Number(b.id))
  } catch {
    return []
  }
}

/**
 * 從 tasks 中推斷 agent 名稱（owner 欄位）
 */
export function extractAgentNames(tasks: readonly TaskData[]): string[] {
  const names = new Set<string>()
  for (const task of tasks) {
    if (task.owner && task.owner.length > 0) {
      names.add(task.owner)
    }
  }
  return [...names].sort()
}
