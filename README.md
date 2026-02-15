# ccx

Agent Teams control plane for Claude Code.

Real-time observability, cost tracking, and team topology reuse for Claude Code's Agent Teams.

## Install

```bash
npm install -g ccx
```

Or run directly:

```bash
npx ccx watch
```

## Commands

### `ccx watch [team]`

Live dashboard for an active Agent Team.

```bash
ccx watch                      # auto-detect active team
ccx watch my-team              # specify team name
ccx watch --budget 10          # alert at $10
ccx watch --budget 10 --kill   # send C-c when budget exceeded
ccx watch --plain              # text-only mode (no ink UI)
```

Features:
- Real-time agent status, token usage, and cost tracking
- Per-agent identity resolution (maps agent IDs to names)
- Task progress tracking
- Budget alerts with OS notifications (`--notify`)
- Hard limit: kill agents via tmux when budget exceeded (`--kill`)
- Auto-save snapshots to `~/.ccx/sessions/`
- Detects team deletion (2 consecutive miss polling)

### `ccx report [target]`

Generate a post-mortem report from a saved session or live team.

```bash
ccx report                           # auto-detect
ccx report my-team                   # by team name
ccx report my-session-id             # by session ID
ccx report my-team --md              # Markdown output
ccx report my-team --json            # JSON output
ccx report my-team --save            # also save .md file
```

### `ccx reuse [target]`

Extract team topology from a saved session for reuse.

```bash
ccx reuse                            # auto-detect latest session
ccx reuse my-team --prompt           # output prompt only (pipe-friendly)
ccx reuse my-team --json             # structured JSON
```

Generates a prompt you can paste into Claude Code to recreate a similar team structure.

### `ccx ls`

List active teams and saved sessions.

```bash
ccx ls                    # show all
ccx ls --active           # only active teams
ccx ls --sessions         # only saved sessions
```

## How It Works

ccx is a **read-only** observer. It never writes to Claude Code's filesystem (sole exception: `--kill` sends `C-c` to tmux panes).

### Data Sources

| Source | Path | Content |
|--------|------|---------|
| Team config | `~/.claude/teams/{team}/config.json` | Team name, lead session ID |
| Tasks | `~/.claude/tasks/{team}/*.json` | Per-task status, owner |
| Inboxes | `~/.claude/teams/{team}/inboxes/*.json` | Agent messages |
| Token usage | `~/.claude/projects/*/subagents/agent-*.jsonl` | Per-agent JSONL journals |

### Architecture

```
FileWatcher (chokidar) → Readers → IdentityResolver → StateAggregator
  → SnapshotManager (debounced 500ms → ~/.ccx/sessions/)
  → Dashboard (ink React UI)
```

**Identity Resolution**: Agent JSONL files contain `teammate_id="<name>"` in message content, providing deterministic mapping from short agent IDs to human-readable names.

**Cost Tracking**: Reads token usage from JSONL journals and applies Claude model pricing (Opus $15/$75, Sonnet $3/$15, Haiku $0.80/$4 per 1M tokens).

## Security

- Secret redaction: 15 regex patterns covering API keys, tokens, passwords, private keys
- Snapshot files are written with `0o700`/`0o600` permissions
- Path traversal protection via name validation
- All report output is redacted before display

## Development

```bash
npm install
npm run dev -- watch          # run with tsx
npm test                      # run tests (90 tests)
npm run lint                  # type check
npm run build                 # compile to dist/
```

## Requirements

- Node.js >= 18
- Claude Code with Agent Teams feature

## License

MIT
