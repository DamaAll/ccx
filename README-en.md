# ccx

**Agent Teams control plane for Claude Code.**

ccx is a read-only CLI observability tool for real-time monitoring of Claude Code Agent Teams — tracking status, costs, post-mortem reports, and team topology reuse.

> [中文版 README](README.md)

---

## Why

Claude Code's Agent Teams can spin up dozens of agents working in parallel, but there's no built-in way to:

- See costs in real time (you only find out after it's done)
- Get a bird's-eye view of agent status (who's working, who's stuck)
- Analyze team performance after a run
- Reuse a team structure that worked well last time

ccx fills that gap.

## Install

```bash
npm install -g ccx
```

Or run directly:

```bash
npx ccx watch
```

## Quick Start

```bash
# Monitor the active team (auto-detect)
ccx watch

# Set a $10 budget alert
ccx watch --budget 10

# Auto-kill agents when budget exceeded
ccx watch --budget 10 --kill

# List all teams and sessions
ccx ls

# Generate a post-mortem report
ccx report

# Extract team topology for reuse
ccx reuse --prompt
```

## Commands

### `ccx watch [team]`

Live dashboard tracking all agent status, token usage, and costs.

```
ccx watch: e2e-optimization (2h 15m 30s)    Cost: $45.23
────────────────────────────────────────────────────────────────────────
AGENTS                        STATUS      ACTIVE    TOKENS    COST
├─ team-lead (opus)            working     12s       3.2M      $15.40
├─ syntax-fixer (haiku)        working     3s        1.8M      $0.45
├─ regression-guard (opus)     idle        2m30s     500.0k    $0.91
└─ agent-a0cc0a3 (opus)        idle        5m12s     2.1M      $8.30
                               TOTAL                 7.6M      $25.06

TASKS
#1     [done]       Fix syntax errors                          syntax-fixer
#2     [working]    Run regression tests                       regression-guard
#3     [pending]    Final integration check                    ──
```

**Options:**

| Flag | Description |
|------|-------------|
| `--budget <usd>` | Cost alert threshold (USD) |
| `--kill` | Send C-c to agent tmux panes when budget exceeded |
| `--notify` | Send OS notification on budget alerts |
| `--stuck-timeout <s>` | Seconds before marking agent as stuck (default: 180) |
| `--plain` | Text-only mode (no ink UI) |

**Features:**

- ink React UI (live updates, press `q` to quit)
- Automatic agent name resolution (deterministic mapping from `teammate_id` in JSONL)
- Deduplication of same-name agents across multiple sessions
- Tiered budget alerts (60% / 80% / 90% / 100%)
- Team deletion detection (30s polling, 2 consecutive misses to confirm)
- SIGINT graceful shutdown (auto-saves snapshot)
- Double-tap SIGINT for force exit

### `ccx report [target]`

Generate a post-mortem report from a saved session or live team.

```bash
ccx report                     # auto-detect (latest session)
ccx report my-team             # by team name
ccx report my-session-id       # by session ID
ccx report e2e-opt             # prefix match
ccx report my-team --md        # Markdown output
ccx report my-team --json      # JSON output
ccx report my-team --save      # also save as .md file
ccx report my-team --save rpt  # custom filename (rpt-report.md)
```

Three output formats:
- **Terminal** (default): colored tables with Summary / Agents / Tasks / Alerts
- **Markdown** (`--md`): paste directly into PRs or docs
- **JSON** (`--json`): for programmatic processing

### `ccx reuse [target]`

Extract team topology from a saved session and generate a prompt you can paste into Claude Code.

```bash
ccx reuse                      # auto-detect latest session
ccx reuse my-team              # by team name
ccx reuse my-team --prompt     # prompt only (pipe-friendly)
ccx reuse my-team --json       # structured JSON
```

Example output (`--prompt`):

```
Create a team called "e2e-optimization" with the following structure:

Team size: 72 agents (36x haiku, 35x opus, 1x sonnet)

Named roles:
- team-lead: opus (lead)
- regression-guard: opus
- syntax-fixer: opus

Worker agents:
- 36x haiku workers
- 31x opus workers

Task examples from previous run:
- Fix syntax errors in generated Go code
- Run regression tests
- Final integration check
```

### `ccx ls`

List active teams and saved sessions.

```bash
ccx ls                  # show all
ccx ls --active         # only active teams
ccx ls --sessions       # only saved sessions
```

## How It Works

ccx is a **read-only observer**. It only reads from Claude Code's filesystem and never writes to it (sole exception: `--kill` sends `C-c` via tmux `send-keys`).

### Data Sources

ccx reads 4 Claude Code internal data sources:

| Source | Path | Content |
|--------|------|---------|
| Team config | `~/.claude/teams/{team}/config.json` | Team name, lead session ID, members |
| Tasks | `~/.claude/tasks/{team}/*.json` | Per-task status, owner, subject |
| Inboxes | `~/.claude/teams/{team}/inboxes/*.json` | Inter-agent messages |
| Token usage | `~/.claude/projects/*/subagents/agent-*.jsonl` | Per-agent JSONL journals (token counts) |

ccx stores its own data in `~/.ccx/`:

| Path | Content |
|------|---------|
| `~/.ccx/sessions/{name}/snapshot.yaml` | Session snapshots (YAML) |

### Architecture

```
chokidar FileWatcher
  ├─ TeamReader      ─┐
  ├─ TaskReader       │
  ├─ InboxReader      ├─→ StateAggregator ─→ SnapshotManager (500ms debounce)
  └─ CursorReader ────┘         │
       ↓                        ↓
  IdentityResolver     EventEmitter → Dashboard (ink) / PlainMode
```

**CursorReader**: Byte-offset incremental JSONL reader with a per-file state machine (UNRESOLVED → RESOLVED). Only accumulates token counts and maintains a 20-entry ring buffer — never stores all records.

**IdentityResolver**: Matches `teammate_id="<name>"` from raw JSONL text for deterministic agent ID → human-readable name mapping. No timestamp heuristics.

**StateAggregator**: EventEmitter-based architecture decoupling readers from consumers. Auto-merges same-name agents caused by duplicate JSONL files across sessions.

**SnapshotManager**: 500ms trailing-edge debounce with atomic writes (`.tmp` → `rename()`).

### Cost Calculation

Reads token usage from JSONL journals and applies Claude model pricing:

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| Opus | $15/M | $75/M | $18.75/M | $1.50/M |
| Sonnet | $3/M | $15/M | $3.75/M | $0.30/M |
| Haiku | $0.80/M | $4/M | $1.00/M | $0.08/M |

## Security

- **Secret redaction**: 15 regex patterns covering Anthropic / OpenAI / GitHub / AWS / Stripe / Slack keys, Bearer tokens, passwords, private keys, and connection strings
- **Snapshot permissions**: Directories `0o700`, files `0o600`
- **Path traversal protection**: Name validation `[a-zA-Z0-9._-]`, max 128 characters
- **Report redaction**: All report output automatically filters secrets from task subjects, descriptions, and alert messages

## Development

```bash
git clone https://github.com/DamaAll/ccx.git
cd ccx
npm install

npm run dev -- watch            # run with tsx
npm run dev -- ls               # test other commands
npm test                        # run 90 unit tests
npm run test:watch              # watch mode
npm run lint                    # TypeScript type check
npm run build                   # compile to dist/
```

### Project Structure

```
src/
  commands/         CLI commands (watch, report, reuse)
  core/             Core logic
    cursor-reader   Byte-offset incremental JSONL reader
    data-source-adapter  Zod schema validation
    identity-resolver    Agent ID → name mapping
    paths           Path constants (~/.claude/, ~/.ccx/)
    pricing         Token cost calculation
    redact          Secret redaction patterns
    session-discovery    Subagents directory discovery
    snapshot-manager     Debounced snapshot writer
    snapshot-reader      Saved session reader
    state-aggregator     State aggregation + event emitter
    task-reader     Task JSON reader
    team-reader     Team config reader
    types           TypeScript type definitions
    watcher         chokidar file watcher orchestrator
  guard/            Budget guard (soft / hard limit)
  report/           Report formatters (terminal / markdown / json)
  ui/               ink React components (Dashboard, AgentPanel, TaskPanel, etc.)
tests/              90 unit tests (vitest)
```

## Requirements

- Node.js >= 18
- Claude Code with Agent Teams feature (Opus 4.6)

## License

[MIT](LICENSE)
