/**
 * SessionDiscovery：掃描 projects/ 建立 sessionId → subagents path 索引
 *
 * Claude Code 的目錄結構：
 *   ~/.claude/projects/{encoded-project-path}/{sessionId}/subagents/agent-{id}.jsonl
 *
 * 目標：給定 leadSessionId，找到對應的 subagents 目錄
 */
import { readdir, access, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { claudePaths } from './paths.js'

export interface SubagentDiscovery {
  readonly sessionId: string
  readonly projectPath: string
  readonly subagentsDir: string
  readonly agentFiles: readonly AgentFileInfo[]
}

export interface AgentFileInfo {
  readonly filePath: string
  readonly agentId: string
  readonly sizeBytes: number
}

/**
 * 根據 leadSessionId 找到 subagents 目錄
 * 掃描所有 project 目錄下的 session 目錄
 */
export async function discoverSubagents(leadSessionId: string): Promise<SubagentDiscovery | null> {
  const projectsDir = claudePaths.projects

  try {
    const projectEntries = await readdir(projectsDir, { withFileTypes: true })
    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory()) continue

      const projectPath = projectEntry.name
      const sessionDir = join(projectsDir, projectPath, leadSessionId)

      try {
        await access(sessionDir)
      } catch {
        continue
      }

      const subagentsDir = join(sessionDir, 'subagents')
      try {
        await access(subagentsDir)
      } catch {
        continue
      }

      const agentFiles = await listAgentFiles(subagentsDir)
      return {
        sessionId: leadSessionId,
        projectPath,
        subagentsDir,
        agentFiles,
      }
    }
  } catch {
    // projects 目錄不存在
  }

  return null
}

/**
 * 列出 subagents 目錄下的所有 agent JSONL 檔案
 */
export async function listAgentFiles(subagentsDir: string): Promise<AgentFileInfo[]> {
  try {
    const entries = await readdir(subagentsDir)
    const agentFiles: AgentFileInfo[] = []

    for (const entry of entries) {
      if (!entry.startsWith('agent-') || !entry.endsWith('.jsonl')) continue

      const agentId = entry.replace('agent-', '').replace('.jsonl', '')
      const filePath = join(subagentsDir, entry)

      try {
        const fileStat = await stat(filePath)
        agentFiles.push({
          filePath,
          agentId,
          sizeBytes: fileStat.size,
        })
      } catch {
        continue
      }
    }

    return agentFiles.sort((a, b) => a.agentId.localeCompare(b.agentId))
  } catch {
    return []
  }
}

/**
 * 監測新的 agent JSONL 出現（watch 模式用）
 * 比較當前檔案列表和已知列表，回傳新增的
 */
export function findNewAgentFiles(
  current: readonly AgentFileInfo[],
  known: ReadonlySet<string>
): AgentFileInfo[] {
  return current.filter(f => !known.has(f.agentId))
}
