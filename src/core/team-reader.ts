/**
 * TeamReader：讀取 ~/.claude/teams/{team}/config.json
 */
import { readFile, readdir, access } from 'node:fs/promises'
import { claudePaths } from './paths.js'
import { TeamConfigSchema, safeParseJson } from './data-source-adapter.js'
import type { TeamConfig } from './types.js'

/**
 * 讀取單一 team 的 config
 */
export async function readTeamConfig(teamName: string): Promise<TeamConfig | null> {
  const configPath = claudePaths.teamConfig(teamName)
  try {
    const raw = await readFile(configPath, 'utf-8')
    const result = safeParseJson(raw, TeamConfigSchema)
    if (result.ok) return result.data
    return null
  } catch {
    return null
  }
}

/**
 * 列出所有現存 team 名稱
 */
export async function listTeamNames(): Promise<string[]> {
  try {
    const entries = await readdir(claudePaths.teams, { withFileTypes: true })
    const teams: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const configPath = claudePaths.teamConfig(entry.name)
      try {
        await access(configPath)
        teams.push(entry.name)
      } catch {
        // config.json 不存在，跳過
      }
    }
    return teams.sort()
  } catch {
    return []
  }
}

/**
 * 列出所有「活躍」的 team（有 config.json）
 */
export async function listActiveTeams(): Promise<TeamConfig[]> {
  const names = await listTeamNames()
  const configs = await Promise.all(names.map(readTeamConfig))
  return configs.filter((c): c is TeamConfig => c !== null)
}

/**
 * 檢查 team 是否存在
 */
export async function teamExists(teamName: string): Promise<boolean> {
  try {
    await access(claudePaths.teamConfig(teamName))
    return true
  } catch {
    return false
  }
}
