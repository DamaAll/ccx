# ccx

**Agent Teams control plane for Claude Code.**

ccx 是一個唯讀的 CLI 觀測工具，用於即時監控 Claude Code Agent Teams 的運行狀態、成本追蹤、事後報告，以及團隊拓撲重用。

---

## Why

Claude Code 的 Agent Teams 可以同時啟動數十個 agent 並行工作，但缺乏：

- 即時的成本可視化（跑完才知道花了多少）
- agent 狀態一覽（誰在工作、誰卡住了）
- 事後分析（這次 team 的效能如何）
- 拓撲重用（上次的 team 結構很好，怎麼快速重建）

ccx 填補了這個缺口。

## Install

```bash
npm install -g ccx
```

或直接用 npx：

```bash
npx ccx watch
```

## Quick Start

```bash
# 監控當前 active team（自動偵測）
ccx watch

# 設定 $10 預算警告
ccx watch --budget 10

# 預算超標時自動送 C-c 給 agent
ccx watch --budget 10 --kill

# 查看所有 teams 和 sessions
ccx ls

# 產生事後報告
ccx report

# 提取 team 拓撲供下次重用
ccx reuse --prompt
```

## Commands

### `ccx watch [team]`

即時 dashboard，追蹤所有 agent 的狀態、token 用量和成本。

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
| `--budget <usd>` | 成本警告閾值（USD） |
| `--kill` | 超過預算時送 C-c 給 agent tmux pane |
| `--notify` | 預算警告時送 OS 通知 |
| `--stuck-timeout <s>` | 標記 agent 為 stuck 的秒數（預設 180） |
| `--plain` | 純文字模式（無 ink UI） |

**Features:**

- ink React UI（即時更新，按 `q` 退出）
- 自動辨識 agent 名稱（從 JSONL 中的 `teammate_id` 確定性映射）
- 同名 agent 自動合併（多輪 session 造成的重複）
- 預算分級警告（60% / 80% / 90% / 100%）
- 偵測 team 刪除（30s polling，2 次確認）
- SIGINT graceful shutdown（自動存 snapshot）
- Double-tap SIGINT force exit

### `ccx report [target]`

從 saved session 或 live team 產生事後報告。

```bash
ccx report                     # auto-detect（最新 session）
ccx report my-team             # 指定 team name
ccx report my-session-id       # 指定 session ID
ccx report e2e-opt             # 前綴匹配
ccx report my-team --md        # Markdown 格式
ccx report my-team --json      # JSON 格式
ccx report my-team --save      # 同時存成 .md 檔案
ccx report my-team --save rpt  # 自訂檔名（rpt-report.md）
```

三種輸出格式：
- **Terminal**（預設）：彩色表格，包含 Summary / Agents / Tasks / Alerts
- **Markdown** (`--md`)：可直接貼到 PR 或文件裡
- **JSON** (`--json`)：供程式化處理

### `ccx reuse [target]`

從 saved session 提取 team 拓撲，生成可直接貼入 Claude Code 的 prompt。

```bash
ccx reuse                      # auto-detect 最新 session
ccx reuse my-team              # 指定 team name
ccx reuse my-team --prompt     # 只輸出 prompt（適合 pipe）
ccx reuse my-team --json       # JSON 格式
```

範例輸出（`--prompt`）：

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

列出 active teams 和 saved sessions。

```bash
ccx ls                  # 全部
ccx ls --active         # 只看 active teams
ccx ls --sessions       # 只看 saved sessions
```

## How It Works

ccx 是一個**唯讀觀測者**。它只讀取 Claude Code 的 filesystem，永遠不寫入（唯一例外：`--kill` 透過 tmux `send-keys C-c` 終止 agent）。

### Data Sources

ccx 讀取 4 個 Claude Code 內部資料來源：

| Source | Path | Content |
|--------|------|---------|
| Team config | `~/.claude/teams/{team}/config.json` | team name, lead session ID, members |
| Tasks | `~/.claude/tasks/{team}/*.json` | per-task status, owner, subject |
| Inboxes | `~/.claude/teams/{team}/inboxes/*.json` | agent 間通訊訊息 |
| Token usage | `~/.claude/projects/*/subagents/agent-*.jsonl` | per-agent JSONL journals（token counts） |

ccx 自己的資料存放在 `~/.ccx/`：

| Path | Content |
|------|---------|
| `~/.ccx/sessions/{name}/snapshot.yaml` | session snapshots（YAML） |

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

**CursorReader**: byte-offset 差量讀取 JSONL，per-file state machine（UNRESOLVED → RESOLVED）。只累加 token counts + 維護 20-entry ring buffer，不存全部 records。

**IdentityResolver**: 從 JSONL raw text 中匹配 `teammate_id="<name>"`，確定性映射 agent ID → 人類可讀名稱。不用時間戳 heuristic。

**StateAggregator**: EventEmitter 架構，解耦 readers 和 consumers。同名 agent 自動合併（多輪 session 造成的重複 JSONL）。

**SnapshotManager**: 500ms trailing-edge debounce，atomic write（`.tmp` → `rename()`）。

### Cost Calculation

讀取 JSONL journals 的 token usage，套用 Claude model 定價：

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| Opus | $15/M | $75/M | $18.75/M | $1.50/M |
| Sonnet | $3/M | $15/M | $3.75/M | $0.30/M |
| Haiku | $0.80/M | $4/M | $1.00/M | $0.08/M |

## Security

- **Secret redaction**: 15 regex patterns 覆蓋 Anthropic / OpenAI / GitHub / AWS / Stripe / Slack keys、Bearer tokens、passwords、private keys、connection strings
- **Snapshot permissions**: 目錄 `0o700`、檔案 `0o600`
- **Path traversal protection**: 名稱驗證 `[a-zA-Z0-9._-]`，最長 128 字元
- **Report redaction**: 所有 report 輸出自動過濾 task subject / description / alert message 中的 secrets

## Development

```bash
git clone https://github.com/DamaAll/ccx.git
cd ccx
npm install

npm run dev -- watch            # 用 tsx 即時運行
npm run dev -- ls               # 測試其他指令
npm test                        # 跑 90 個單元測試
npm run test:watch              # watch mode
npm run lint                    # TypeScript type check
npm run build                   # 編譯到 dist/
```

### Project Structure

```
src/
  commands/         CLI 指令（watch, report, reuse）
  core/             核心邏輯
    cursor-reader   byte-offset JSONL 差量讀取
    data-source-adapter  zod schema validation
    identity-resolver    agent ID → name 映射
    paths           路徑常數（~/.claude/, ~/.ccx/）
    pricing         token cost 計算
    redact          secret redaction patterns
    session-discovery    subagents 目錄探索
    snapshot-manager     debounced snapshot 寫入
    snapshot-reader      saved session 讀取
    state-aggregator     狀態聚合 + event emitter
    task-reader     task JSON 讀取
    team-reader     team config 讀取
    types           TypeScript 型別定義
    watcher         chokidar 檔案監控 orchestrator
  guard/            budget guard（soft / hard limit）
  report/           report formatters（terminal / markdown / json）
  ui/               ink React 元件（Dashboard, AgentPanel, TaskPanel, etc.）
tests/              90 個單元測試（vitest）
```

## Requirements

- Node.js >= 18
- Claude Code with Agent Teams feature（Opus 4.6）

## License

[MIT](LICENSE)
