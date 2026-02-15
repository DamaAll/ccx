/**
 * SnapshotManager：event-driven + debounced 快照寫入
 *
 * 設計：
 * - trailing-edge debounce 500ms（多事件合併成一次寫入）
 * - 寫入 ~/.ccx/sessions/{team}-{timestamp}/
 * - Atomic write（寫 .tmp → rename）
 * - SIGINT 時 finalize
 */
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { ccxPaths } from './paths.js'
import type { StateAggregator } from './state-aggregator.js'
import type { SessionSnapshot, StateEvent } from './types.js'

const DEBOUNCE_MS = 500

export class SnapshotManager {
  private readonly aggregator: StateAggregator
  private readonly sessionName: string
  private readonly sessionDir: string
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private initialized = false
  private finalized = false

  constructor(aggregator: StateAggregator, teamName: string) {
    this.aggregator = aggregator
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    this.sessionName = `${teamName}-${ts}`
    this.sessionDir = ccxPaths.session(this.sessionName)

    // 監聽 state events → debounced write
    this.aggregator.on('event', (event: StateEvent) => {
      if (this.finalized) return
      this.scheduleWrite()
    })
  }

  get sessionPath(): string {
    return this.sessionDir
  }

  get name(): string {
    return this.sessionName
  }

  /**
   * 初始化：建立目錄 + 寫入 initial snapshot
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    await mkdir(this.sessionDir, { recursive: true, mode: 0o700 })
    await this.writeSnapshot()
    this.initialized = true
  }

  /**
   * Finalize：取消 debounce timer + 寫入最終 snapshot
   */
  async finalize(): Promise<void> {
    if (this.finalized) return
    this.finalized = true

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    await this.writeSnapshot(true)
  }

  /**
   * Debounced write schedule
   */
  private scheduleWrite(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null
      await this.writeSnapshot()
    }, DEBOUNCE_MS)
  }

  /**
   * 實際寫入 snapshot 到磁碟
   */
  private async writeSnapshot(isFinal = false): Promise<void> {
    const state = this.aggregator.getState()

    const snapshot: SessionSnapshot = {
      teamName: state.teamName,
      sessionId: this.sessionName,
      startedAt: state.startedAt,
      lastUpdatedAt: Date.now(),
      finalized: isFinal,
      agents: state.agents.map(a => ({
        agentId: a.agentId,
        name: a.name,
        model: a.model,
        tokenUsage: a.tokenUsage,
        cost: a.cost,
        status: a.status,
      })),
      tasks: state.tasks,
      totalCost: state.totalCost,
      totalTokens: state.totalTokens,
      alerts: state.alerts,
    }

    try {
      await mkdir(this.sessionDir, { recursive: true, mode: 0o700 })
      await atomicWriteYaml(join(this.sessionDir, 'snapshot.yaml'), snapshot)

      this.aggregator.emit('event', {
        type: 'snapshot_written',
        path: this.sessionDir,
      } satisfies StateEvent)
    } catch (err) {
      // Snapshot 寫入失敗不應該 crash watch
      // 靜默忽略，下次 debounce 再試
    }
  }
}

// ─── Atomic write ───

async function atomicWriteYaml(targetPath: string, data: unknown): Promise<void> {
  const tmpPath = `${targetPath}.tmp`
  const content = stringify(data, { indent: 2 })
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 })
  await rename(tmpPath, targetPath)
}
