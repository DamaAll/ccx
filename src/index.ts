#!/usr/bin/env node
/**
 * ccx — Agent Teams control plane for Claude Code
 */
import { Command } from 'commander'
import { runWatch } from './commands/watch.js'
import { listTeamNames } from './core/team-reader.js'

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
  .option('--plain', 'Accessible text-only mode (no colors)')
  .action(async (team: string | undefined, opts) => {
    if (opts.plain) {
      // chalk 支援 NO_COLOR 環境變數
      process.env.NO_COLOR = '1'
    }
    await runWatch({
      team,
      budget: opts.budget,
      stuckTimeout: opts.stuckTimeout,
      plain: opts.plain,
    })
  })

// ─── ls ───
program
  .command('ls')
  .description('List teams and sessions')
  .option('--active', 'Only show active teams')
  .action(async (opts) => {
    const teams = await listTeamNames()
    if (teams.length === 0) {
      console.log('No active teams found.')
      console.log('Start a team in Claude Code first, then run "ccx watch".')
      return
    }
    console.log(`Active teams (${teams.length}):`)
    for (const name of teams) {
      console.log(`  ${name}`)
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
  ccx ls                 List active teams

Commands:
  watch [team]           Live dashboard
  ls                     List teams and sessions
  report [team|session]  Post-mortem report (Day 3)
  reuse <session>        Reuse team topology (Day 4)

Run "ccx <command> --help" for details.
`)
  })

program.parse()
