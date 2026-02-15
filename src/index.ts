#!/usr/bin/env node
/**
 * ccx — Agent Teams control plane for Claude Code
 */
import { Command } from 'commander'
import { runWatch } from './commands/watch.js'
import { runReport } from './commands/report.js'
import { listTeamNames } from './core/team-reader.js'
import { listSessions } from './core/snapshot-reader.js'

const program = new Command()

program
  .name('ccx')
  .description('Agent Teams control plane for Claude Code')
  .version('0.1.0')

// ─── watch ───
program
  .command('watch [team]')
  .description('Live dashboard for an active Agent Team')
  .option('--budget <usd>', 'Cost alert threshold in USD', parseFloat)
  .option('--stuck-timeout <seconds>', 'Seconds before marking agent as stuck (default: 180)', parseInt)
  .option('--kill', 'Hard limit: send C-c to agents when budget exceeded')
  .option('--notify', 'Send OS notification on budget alerts')
  .option('--plain', 'Accessible text-only mode (no colors)')
  .action(async (team: string | undefined, opts) => {
    if (opts.plain || process.env.NO_COLOR || process.env.TERM === 'dumb') {
      process.env.NO_COLOR = '1'
      opts.plain = true
    }
    await runWatch({
      team,
      budget: opts.budget,
      stuckTimeout: opts.stuckTimeout,
      plain: opts.plain,
      kill: opts.kill,
      notify: opts.notify,
    })
  })

// ─── report ───
program
  .command('report [target]')
  .description('Generate a post-mortem report from a saved session or live team')
  .option('--md', 'Output as Markdown')
  .option('--json', 'Output as JSON')
  .option('--save [name]', 'Also save report as Markdown file')
  .action(async (target: string | undefined, opts) => {
    await runReport({
      target,
      md: opts.md,
      json: opts.json,
      save: opts.save,
    })
  })

// ─── ls ───
program
  .command('ls')
  .description('List teams and sessions')
  .option('--active', 'Only show active teams')
  .option('--sessions', 'Only show saved sessions')
  .action(async (opts) => {
    const [teams, sessions] = await Promise.all([
      opts.sessions ? Promise.resolve([]) : listTeamNames(),
      opts.active ? Promise.resolve([]) : listSessions(),
    ])

    if (teams.length === 0 && sessions.length === 0) {
      console.log('No active teams or saved sessions found.')
      console.log('Start a team in Claude Code first, then run "ccx watch".')
      return
    }

    if (teams.length > 0) {
      console.log(`Active teams (${teams.length}):`)
      for (const name of teams) {
        console.log(`  ${name}`)
      }
    }

    if (sessions.length > 0) {
      if (teams.length > 0) console.log('')
      console.log(`Saved sessions (${sessions.length}):`)
      for (const s of sessions) {
        const date = new Date(s.lastUpdatedAt).toLocaleDateString()
        const status = s.finalized ? 'finalized' : 'active'
        console.log(`  ${s.name.padEnd(30)} ${s.teamName.padEnd(20)} ${date.padEnd(12)} ${status}`)
      }
    }
  })

// ─── Default: help ───
program
  .action(() => {
    console.log(`
ccx — Agent Teams control plane for Claude Code

Quick start:
  ccx watch              Monitor the active team
  ccx watch --budget 5   Set a $5 cost alert
  ccx report             Post-mortem report
  ccx ls                 List teams and sessions

Commands:
  watch [team]           Live dashboard
  report [target]        Report from saved session or live team
  ls                     List teams and sessions
  reuse <session>        Reuse team topology (Day 4)

Run "ccx <command> --help" for details.
`)
  })

program.parse()
