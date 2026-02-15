/**
 * Soft Limit：cost threshold → alert notification
 *
 * 完全由 StateAggregator 處理（checkBudgetThresholds）
 * 這個檔案提供 OS notification 支援
 */
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/**
 * 發送 macOS 系統通知
 */
export async function sendOsNotification(title: string, message: string): Promise<void> {
  try {
    const escaped = message.replace(/"/g, '\\"')
    await execAsync(
      `osascript -e 'display notification "${escaped}" with title "${title}"'`
    )
  } catch {
    // 通知失敗不影響主流程
  }
}
