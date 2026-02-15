/**
 * Snapshot-level secret redaction
 *
 * 套用 redactSecrets 到所有文字欄位（task subject/description, alert message）
 */
import { redactSecrets } from '../core/redact.js'
import type { SessionSnapshot } from '../core/types.js'

export function redactSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map(t => ({
      ...t,
      subject: redactSecrets(t.subject),
      description: redactSecrets(t.description),
    })),
    alerts: snapshot.alerts.map(a => ({
      ...a,
      message: redactSecrets(a.message),
    })),
  }
}
