import { describe, it, expect } from 'vitest'
import { validateName, assertSafeName, claudePaths, ccxPaths } from '../src/core/paths.js'

describe('paths', () => {
  describe('validateName', () => {
    it('accepts valid names', () => {
      expect(validateName('my-team')).toBe(true)
      expect(validateName('team_v2')).toBe(true)
      expect(validateName('project.test')).toBe(true)
      expect(validateName('abc123')).toBe(true)
      expect(validateName('A')).toBe(true)
    })

    it('rejects empty string', () => {
      expect(validateName('')).toBe(false)
    })

    it('rejects names with spaces', () => {
      expect(validateName('my team')).toBe(false)
    })

    it('rejects names with path traversal', () => {
      expect(validateName('../etc/passwd')).toBe(false)
      expect(validateName('../../root')).toBe(false)
    })

    it('rejects names with slashes', () => {
      expect(validateName('path/to/file')).toBe(false)
    })

    it('rejects names over 128 chars', () => {
      expect(validateName('a'.repeat(129))).toBe(false)
      expect(validateName('a'.repeat(128))).toBe(true)
    })

    it('rejects special characters', () => {
      expect(validateName('name@host')).toBe(false)
      expect(validateName('name!!')).toBe(false)
      expect(validateName('name$var')).toBe(false)
    })
  })

  describe('assertSafeName', () => {
    it('does not throw for valid names', () => {
      expect(() => assertSafeName('valid-name', 'team')).not.toThrow()
    })

    it('throws for invalid names with descriptive message', () => {
      expect(() => assertSafeName('../hack', 'team'))
        .toThrow('Invalid team')
    })
  })

  describe('claudePaths', () => {
    it('builds team config path', () => {
      const path = claudePaths.teamConfig('my-team')
      expect(path).toContain('.claude/teams/my-team/config.json')
    })

    it('builds team inbox path', () => {
      const path = claudePaths.teamInbox('my-team', 'agent1')
      expect(path).toContain('.claude/teams/my-team/inboxes/agent1.json')
    })

    it('builds task path', () => {
      const path = claudePaths.teamTask('my-team', '42')
      expect(path).toContain('.claude/tasks/my-team/42.json')
    })
  })

  describe('ccxPaths', () => {
    it('builds session path', () => {
      const path = ccxPaths.session('test-session')
      expect(path).toContain('.ccx/sessions/test-session')
    })

    it('builds checkpoint path', () => {
      const path = ccxPaths.checkpoint('abc123')
      expect(path).toContain('.ccx/checkpoints/abc123.json')
    })
  })
})
