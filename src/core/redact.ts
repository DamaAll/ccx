/**
 * Secret Redaction：在 CursorReader 層移除敏感資料
 *
 * 套用時機：raw line 進入 ring buffer 之前
 * 即使 --show-content 也會 redact
 */

const REDACTION_PLACEHOLDER = '[REDACTED]'

const SECRET_PATTERNS: readonly RegExp[] = [
  // Anthropic API keys
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  // OpenAI API keys
  /sk-proj-[a-zA-Z0-9_-]{20,}/g,
  /sk-[a-zA-Z0-9]{40,}/g,
  // GitHub tokens
  /ghp_[a-zA-Z0-9]{36,}/g,
  /gho_[a-zA-Z0-9]{36,}/g,
  /ghs_[a-zA-Z0-9]{36,}/g,
  /github_pat_[a-zA-Z0-9_]{22,}/g,
  // AWS keys
  /AKIA[0-9A-Z]{16}/g,
  // Bearer tokens
  /Bearer\s+[a-zA-Z0-9._\-/+=]{20,}/g,
  // Generic API key patterns
  /(?:api[_-]?key|apikey|api[_-]?secret|api[_-]?token)\s*[:=]\s*['"]?[a-zA-Z0-9_\-/.+=]{16,}['"]?/gi,
  // Password patterns
  /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
  // Private keys
  /-----BEGIN\s[\w\s]+PRIVATE\sKEY-----/g,
  // Connection strings with passwords
  /(?:mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@/g,
  // Slack tokens
  /xox[bpsar]-[a-zA-Z0-9-]{10,}/g,
  // Stripe keys
  /sk_(?:live|test)_[a-zA-Z0-9]{20,}/g,
  /pk_(?:live|test)_[a-zA-Z0-9]{20,}/g,
]

/**
 * 對單一字串做 secret redaction
 */
export function redactSecrets(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0
    result = result.replace(pattern, REDACTION_PLACEHOLDER)
  }
  return result
}

/**
 * 檢查字串是否包含可能的 secrets
 */
export function containsSecrets(text: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(text)) return true
  }
  return false
}
