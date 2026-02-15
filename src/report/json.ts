/**
 * JSON report formatter
 */
import type { SessionSnapshot } from '../core/types.js'

export function formatJsonReport(snapshot: SessionSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}
