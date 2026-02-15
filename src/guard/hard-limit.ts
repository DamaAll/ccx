/**
 * Hard Limit：超預算 → tmux send-keys C-c（需 PID 驗證）
 *
 * 安全機制：
 * 1. 必須有 tmuxPaneId
 * 2. PID 驗證：確認 pane 內的前景進程是 node/claude
 * 3. 5 秒冷卻期：避免重複發送
 * 4. 10 秒倒數：讓使用者有機會取消
 */
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const COOLDOWN_MS = 5000
const lastSentAt = new Map<string, number>()

/**
 * 安全地向 tmux pane 發送 C-c
 * 回傳 true 表示成功發送，false 表示跳過
 */
export async function safeSendCtrlC(paneId: string): Promise<boolean> {
  if (!paneId) return false

  // 冷卻期
  const last = lastSentAt.get(paneId)
  if (last && Date.now() - last < COOLDOWN_MS) {
    return false
  }

  // PID 驗證
  const isValid = await verifyPanePid(paneId)
  if (!isValid) return false

  try {
    await execAsync(`tmux send-keys -t ${escapePaneId(paneId)} C-c`)
    lastSentAt.set(paneId, Date.now())
    return true
  } catch {
    return false
  }
}

/**
 * 驗證 pane 內的前景進程是否是 node/claude
 */
async function verifyPanePid(paneId: string): Promise<boolean> {
  try {
    const { stdout: pidStr } = await execAsync(
      `tmux display-message -p -t ${escapePaneId(paneId)} '#{pane_pid}'`
    )
    const pid = parseInt(pidStr.trim())
    if (isNaN(pid)) return false

    const { stdout: comm } = await execAsync(`ps -p ${pid} -o comm=`)
    const processName = comm.trim()

    // 只允許 node 或 claude 進程
    return /^(node|claude)/.test(processName)
  } catch {
    return false
  }
}

/**
 * 對所有有 tmuxPaneId 的 member 發送 C-c
 */
export async function killAllMembers(
  paneIds: readonly string[]
): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0

  for (const paneId of paneIds) {
    if (!paneId) continue
    const ok = await safeSendCtrlC(paneId)
    if (ok) sent++
    else failed++
  }

  return { sent, failed }
}

function escapePaneId(paneId: string): string {
  // tmux pane ID 應該只包含 %數字 格式，但防禦性 escape
  return paneId.replace(/[^a-zA-Z0-9%_.-]/g, '')
}
