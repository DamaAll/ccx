import { describe, it, expect } from 'vitest'
import { redactSecrets, containsSecrets } from '../src/core/redact.js'

// 用拼接避免 GitHub push protection 誤判測試用假 key
const FAKE = {
  anthropic: 'sk-ant-' + 'api03-abc123456789012345678901234567890',
  openai: 'sk-proj-' + 'abc1234567890123456789012345678901234567890',
  ghp: 'ghp_' + '1234567890abcdef1234567890abcdef12345678',
  ghPat: 'github_pat_' + '1234567890abcdef1234567890',
  aws: 'AKIA' + 'IOSFODNN7EXAMPLE',
  bearer: 'Bearer ' + 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc',
  skLive: 'sk_live_' + 'abcdefghijklmnopqrst12345',
  pkTest: 'pk_test_' + 'abcdefghijklmnopqrst12345',
  slack: 'xoxb-' + '1234567890-abcdefghij',
}

describe('redact', () => {
  describe('redactSecrets', () => {
    it('redacts Anthropic API keys', () => {
      expect(redactSecrets(`key: ${FAKE.anthropic}`)).toBe('key: [REDACTED]')
    })

    it('redacts OpenAI API keys', () => {
      expect(redactSecrets(FAKE.openai)).toBe('[REDACTED]')
    })

    it('redacts GitHub tokens', () => {
      expect(redactSecrets(FAKE.ghp)).toBe('[REDACTED]')
      expect(redactSecrets(FAKE.ghPat)).toBe('[REDACTED]')
    })

    it('redacts AWS access keys', () => {
      expect(redactSecrets(FAKE.aws)).toBe('[REDACTED]')
    })

    it('redacts Bearer tokens', () => {
      expect(redactSecrets(FAKE.bearer)).toBe('[REDACTED]')
    })

    it('redacts generic api key patterns', () => {
      expect(redactSecrets('api_key=sk_1234567890abcdef12'))
        .toBe('[REDACTED]')
      expect(redactSecrets('API-SECRET: "my-super-secret-key-12345"'))
        .toBe('[REDACTED]')
    })

    it('redacts password patterns', () => {
      expect(redactSecrets('password: mysecretpassword123'))
        .toBe('[REDACTED]')
      expect(redactSecrets('pwd="longpassword!"'))
        .toBe('[REDACTED]')
    })

    it('redacts private key headers', () => {
      expect(redactSecrets('-----BEGIN RSA PRIVATE KEY-----'))
        .toBe('[REDACTED]')
    })

    it('redacts connection strings', () => {
      expect(redactSecrets('postgres://user:pass@host/db'))
        .toBe('[REDACTED]host/db')
    })

    it('redacts Slack tokens', () => {
      expect(redactSecrets(FAKE.slack)).toBe('[REDACTED]')
    })

    it('redacts Stripe keys', () => {
      expect(redactSecrets(FAKE.skLive)).toBe('[REDACTED]')
      expect(redactSecrets(FAKE.pkTest)).toBe('[REDACTED]')
    })

    it('leaves non-secret text unchanged', () => {
      const clean = 'This is a normal log message with no secrets'
      expect(redactSecrets(clean)).toBe(clean)
    })

    it('redacts multiple secrets in one string', () => {
      const input = `key1=${FAKE.anthropic} key2=${FAKE.ghp}`
      const result = redactSecrets(input)
      expect(result).not.toContain('sk-ant')
      expect(result).not.toContain('ghp_')
    })
  })

  describe('containsSecrets', () => {
    it('returns true for text with secrets', () => {
      expect(containsSecrets(FAKE.anthropic)).toBe(true)
      expect(containsSecrets(FAKE.aws)).toBe(true)
    })

    it('returns false for clean text', () => {
      expect(containsSecrets('just a regular message')).toBe(false)
      expect(containsSecrets('123456')).toBe(false)
    })
  })
})
