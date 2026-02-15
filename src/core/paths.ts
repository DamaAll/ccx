/**
 * 路徑解析：~/.claude/* 和 ~/.ccx/* 的標準路徑
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()

// ─── Claude Code 路徑 ───

const CLAUDE_HOME = join(HOME, '.claude')

export const claudePaths = {
  root: CLAUDE_HOME,
  teams: join(CLAUDE_HOME, 'teams'),
  tasks: join(CLAUDE_HOME, 'tasks'),
  projects: join(CLAUDE_HOME, 'projects'),

  teamConfig: (teamName: string): string =>
    join(CLAUDE_HOME, 'teams', teamName, 'config.json'),

  teamInboxes: (teamName: string): string =>
    join(CLAUDE_HOME, 'teams', teamName, 'inboxes'),

  teamInbox: (teamName: string, agentName: string): string =>
    join(CLAUDE_HOME, 'teams', teamName, 'inboxes', `${agentName}.json`),

  teamTasks: (teamName: string): string =>
    join(CLAUDE_HOME, 'tasks', teamName),

  teamTask: (teamName: string, taskId: string): string =>
    join(CLAUDE_HOME, 'tasks', teamName, `${taskId}.json`),

  subagents: (projectPath: string, sessionId: string): string =>
    join(CLAUDE_HOME, 'projects', projectPath, sessionId, 'subagents'),

  subagentFile: (projectPath: string, sessionId: string, agentId: string): string =>
    join(CLAUDE_HOME, 'projects', projectPath, sessionId, 'subagents', `agent-${agentId}.jsonl`),
} as const

// ─── ccx 路徑 ───

const CCX_HOME = join(HOME, '.ccx')

export const ccxPaths = {
  root: CCX_HOME,
  sessions: join(CCX_HOME, 'sessions'),
  checkpoints: join(CCX_HOME, 'checkpoints'),
  config: join(CCX_HOME, 'config.yaml'),

  session: (sessionName: string): string =>
    join(CCX_HOME, 'sessions', sessionName),

  sessionMeta: (sessionName: string): string =>
    join(CCX_HOME, 'sessions', sessionName, 'meta.yaml'),

  sessionTokens: (sessionName: string): string =>
    join(CCX_HOME, 'sessions', sessionName, 'tokens.yaml'),

  sessionTasks: (sessionName: string): string =>
    join(CCX_HOME, 'sessions', sessionName, 'tasks.yaml'),

  sessionAlerts: (sessionName: string): string =>
    join(CCX_HOME, 'sessions', sessionName, 'alerts.yaml'),

  checkpoint: (fileHash: string): string =>
    join(CCX_HOME, 'checkpoints', `${fileHash}.json`),
} as const

// ─── 名稱驗證 ───

const SAFE_NAME_RE = /^[a-zA-Z0-9._-]+$/

export function validateName(name: string): boolean {
  return SAFE_NAME_RE.test(name) && name.length > 0 && name.length <= 128
}

export function assertSafeName(name: string, label: string): void {
  if (!validateName(name)) {
    throw new Error(
      `Invalid ${label}: "${name}". Must match [a-zA-Z0-9._-] and be 1-128 chars.`
    )
  }
}
