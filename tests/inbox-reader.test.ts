import { describe, it, expect } from 'vitest'
import { extractAgentNamesFromInboxes, type InboxData } from '../src/core/inbox-reader.js'

// inferStatusFromMessages 是 private，但可以透過 InboxData 的 inferredStatus 間接測試
// 這裡直接測試 exported 函式 + 透過模組導出測試 parseMessageType 的行為

// ─── 為了測試 parseMessageType，我們需要 re-export 或直接測試 inferStatusFromMessages
// 由於 inferStatusFromMessages 是 private，我們改用整合測試策略：
// 測試 extractAgentNamesFromInboxes + 驗證 InboxData 結構

describe('inbox-reader', () => {
  describe('extractAgentNamesFromInboxes', () => {
    it('extracts unique agent names from inboxes and messages', () => {
      const inboxes: InboxData[] = [
        {
          agentName: 'worker-1',
          messages: [
            { from: 'team-lead', text: '', summary: '', timestamp: '2026-01-01T00:00:00Z', color: '', read: false },
            { from: 'worker-2', text: '', summary: '', timestamp: '2026-01-01T00:01:00Z', color: '', read: false },
          ],
          lastMessage: null,
          inferredStatus: 'working',
        },
        {
          agentName: 'worker-2',
          messages: [
            { from: 'team-lead', text: '', summary: '', timestamp: '2026-01-01T00:00:00Z', color: '', read: false },
          ],
          lastMessage: null,
          inferredStatus: 'idle',
        },
      ]

      const names = extractAgentNamesFromInboxes(inboxes)
      expect(names).toEqual(['team-lead', 'worker-1', 'worker-2'])
    })

    it('returns empty array for empty inboxes', () => {
      expect(extractAgentNamesFromInboxes([])).toEqual([])
    })

    it('deduplicates names', () => {
      const inboxes: InboxData[] = [
        {
          agentName: 'worker',
          messages: [
            { from: 'worker', text: '', summary: '', timestamp: '2026-01-01T00:00:00Z', color: '', read: false },
          ],
          lastMessage: null,
          inferredStatus: 'working',
        },
      ]

      const names = extractAgentNamesFromInboxes(inboxes)
      expect(names).toEqual(['worker'])
    })
  })
})
