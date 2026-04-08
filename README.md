<p align="center">
  <h1 align="center">ccx</h1>
  <p align="center"><strong>Coding Copilot, eXtended</strong></p>
  <p align="center">
    An <a href="https://opencode.ai">OpenCode</a> plugin that brings Claude Code's behavioral discipline to any model.<br/>
    Built by reverse-engineering Claude Code's prompt architecture and adapting it for the OpenCode ecosystem.
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/@ccx-agent/opencode-ccx"><img src="https://img.shields.io/npm/v/@ccx-agent/opencode-ccx?style=flat-square&color=blue" alt="npm version"></a>
    <a href="https://github.com/Rejudge-F/ccx/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Rejudge-F/ccx?style=flat-square" alt="license"></a>
  </p>
</p>

---

## The Problem

LLM coding agents tend to over-engineer, skip verification, and run destructive commands without thinking. They add abstractions nobody asked for, report "done" without testing, and `rm -rf` without blinking.

Claude Code solved this with a sophisticated behavioral framework — but it's locked to Anthropic's CLI and pricing.

## The Solution

ccx extracts the core behavioral principles from Claude Code's prompt architecture and makes them work in OpenCode — with any model, any provider.

It's not a wrapper or a proxy. It's a complete behavioral framework: 8 composable system prompt sections, 4 default subagents (+ optional coordinator), and 10 runtime hooks that dynamically adapt the agent's behavior every turn.

**Before ccx:** Agent writes 200 lines, adds 3 helper files, says "done."

**After ccx:** Agent writes 40 lines, runs the tests, spawns a verification agent that tries to break it, then reports the VERDICT.

---

## Quick Start

```bash
opencode plugin @ccx-agent/opencode-ccx
```

That's it. Restart OpenCode, press `Tab` to switch agent, select **ccx**.

> **Important:** ccx registers as a standalone agent, not a modifier on the default agent. You must switch to the `ccx` agent for the behavioral framework to take effect. If you want ccx to be your default agent, add `"default_agent": "ccx"` to your `opencode.json`.

For global install (applies to all projects):

```bash
opencode plugin @ccx-agent/opencode-ccx -g
```

### Manual Installation

Add to your `opencode.json`:

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugin": [
    "@ccx-agent/opencode-ccx@0.2.2"
  ]
}
```

### Development / Local Build

```bash
git clone https://github.com/Rejudge-F/ccx.git
cd ccx && bun install && bun run build
```

Then in `opencode.json`:

```jsonc
{
  "plugin": [
    "file:///path/to/ccx/dist/index.js"
  ]
}
```

---

## What's Inside

### Architecture & Hook Integration

ccx intercepts the standard OpenCode execution loop at multiple points to inject discipline and safety:

```mermaid
graph TD
    User([User Request]) --> OP[OpenCode Agent Loop]
    
    subgraph ccx Plugin
        H1[chat.message] -.->|Track File Edits| OP
        H2[chat.system.transform] -.->|Load CLAUDE.md & Context| OP
        H3[chat.params] -.->|Agent-specific Temp/TopP| OP
        
        OP --> ToolCall{Tool Call}
        
        ToolCall -->|Before| H4[tool.execute.before]
        H4 -.->|Risk Guard Warning| ToolCall
        
        ToolCall -->|Execute| Exec[Run Tool]
        
        Exec -->|After| H5[tool.execute.after]
        H5 -.->|Track Edits| OP
        
        OP -->|Context Full| H6[session.compacting]
        H6 -.->|Preserve Plan & Verdict| OP
    end
```

### Primary Agent: `ccx`

The main agent comes with 8 composable system prompt sections derived from Claude Code's prompt architecture:

| Section | What it enforces |
|---------|-----------------|
| **intro** | Agent identity, trust boundary, prompt injection defense |
| **system-rules** | Permission model, context compression, prompt injection awareness |
| **doing-tasks** | Scope control — no unrequested features, no speculative abstractions, verify before declaring done |
| **actions** | Risk classification — reversible vs irreversible, local vs shared, ask before destroying |
| **using-tools** | Dedicated tools over Bash, parallel tool calls, structured progress tracking |
| **tone-style** | Concise output, no emojis, `file:line` references, `owner/repo#N` links |
| **output-efficiency** | Lead with the answer, skip filler, report at milestones not continuously |
| **environment** | Dynamic workspace context — cwd, git status, platform, shell |

### Subagents (Claude-like defaults)

| Agent | Mode | Default | Purpose |
|-------|------|---------|---------|
| **ccx-explore** | read-only | on | Fast codebase search — parallel glob/grep/read across large repos |
| **ccx-plan** | read-only | on | Software architect — produces step-by-step plans with critical file lists |
| **ccx-verification** | read-only | on | Adversarial verifier — VERDICT protocol (PASS/FAIL/PARTIAL), runs real commands, catches self-rationalizations |
| **ccx-general-purpose** | read-write | on | Multi-strategy worker for tasks outside other specialists |
| **ccx-coordinator** | orchestrator | off | Decomposes complex work into Research, Synthesis, Implementation, Verification across parallel workers. Tool surface is restricted to `task` + `question` |

### 12 Runtime Hooks

ccx uses every major hook point in the OpenCode plugin API to dynamically shape agent behavior:

#### Static Hooks (startup)

| Hook | What it does |
|------|-------------|
| **config** | Registers the ccx agent + enabled subagents (coordinator is opt-in) with their system prompts and tool restrictions |
| **tool** | Creates agent dispatch tools for the subagent registry |

#### Per-Turn Hooks (every LLM call)

| Hook | What it does |
|------|-------------|
| **chat.message** | Tracks file edits across the session for verification threshold detection, and routes inline session-workflow commands (`/ccx-fork`, `/ccx-bg`, `/ccx-fullctx`, `/ccx-bg-status`) |
| **chat.params** | Tunes temperature/topP per agent — low for plan/verification (precision), higher for explore (creativity) |
| **experimental.chat.system.transform** | Dynamically injects project instructions (CLAUDE.md), session context (edited files list), and verification reminders into the system prompt |
| **tool.definition** | Appends safety rules to bash/edit/write tool descriptions, usage hints to glob/grep/read |
| **experimental.chat.messages.transform** | Automatically microcompacts older clearable tool outputs (keeps recent 5), trims long tool outputs (>8KB), collapses consecutive reasoning parts to save context |

#### Event Hooks (reactive)

| Hook | What it does |
|------|-------------|
| **tool.execute.before** | Two stages: (1) Context-Bundle injects cwd / git snapshot / recently changed files into `task` tool args so subagents share a baseline; (2) Risk Guard flags `rm -rf`, `git push --force`, `DROP TABLE`, and other destructive patterns |
| **tool.execute.after** | Tracks file edits, feeds the dynamic verification reminder system |
| **experimental.session.compacting** | Customizes context compaction to preserve: original task, implementation plan, edited files, verification status, architectural decisions |

#### Session Workflow Commands

ccx exposes inline commands inside any chat message. They drive the underlying OpenCode session APIs directly so you can branch, dispatch, and replay work without waiting for the main agent to finish its turn:

| Command | Backed by | Purpose |
|---------|-----------|---------|
| `/ccx-fork [messageID]` | `POST /session/{id}/fork` | Fork the current session at the latest message (or at an explicit `messageID`) for what-if branching |
| `/ccx-bg [agent] <prompt>` | `POST /session/{id}/prompt_async` | Queue a background prompt against the current session, optionally targeting a specific agent |
| `/ccx-fullctx <agent> <prompt>` | `POST /session/{id}/fork` + `POST /session/{id}/prompt_async` | Create a fork-child session that inherits full parent context, then dispatch the subtask asynchronously to the named agent |
| `/ccx-bg-status [taskID]` | in-memory task registry + `GET /session/{id}/message` | Show recent background tasks, or inspect one task and refresh its running/completed/failed state |

All commands are opt-in via `subagent_orchestration.session_workflows.enabled` and the literals are configurable.

---

## Claude Code Alignment

ccx was built by studying Claude Code's prompt architecture and adapting its core behavioral principles for OpenCode. Here's what maps and what doesn't:

### What ccx replicates

| Claude Code Feature | ccx Implementation |
|--------------------|--------------------|
| 8-section system prompt | 8 composable prompt sections, near-identical content |
| Agent orchestration guidance | Same guidance style: use specialized subagents when appropriate, avoid overuse, avoid duplicate delegated work |
| Explore escalation threshold | `explore_min_queries=3` default (matches Claude CLI external default) |
| Coordinator default | Disabled by default, opt-in via config |
| Verification contract | Configurable. Strict contract is opt-in (`verification.enforce_contract=true`) |
| VERDICT protocol (PASS/FAIL/PARTIAL) | Identical format and adversarial strategies |
| Project instructions (CLAUDE.md) | Auto-loaded from CLAUDE.md / .claude/instructions.md / AGENTS.md |
| Tool safety hints | `tool.definition` hook appends rules to bash/edit/write descriptions |
| Tool-output microcompact | Older `read/grep/glob/bash/webfetch` results are compacted automatically while preserving recent outputs |
| Context compaction preservation | Custom compaction prompt via `experimental.session.compacting` |
| Trust boundary / prompt injection defense | Explicit section in system prompt |

### What only Claude Code has (engine-level)

| Feature | Why ccx can't replicate it |
|---------|---------------------------|
| Streaming tool execution (run tools while generating) | Engine-level, no plugin hook |
| Model fallback on 529 errors | Engine-level retry logic |
| Fork mode (shared prompt cache across subagents) | Engine-level session management |
| AI-powered safety classifier (YOLO mode) | Would require LLM call in hook, adds latency |
| Plan mode with user approval gate | Requires TUI integration (experimental) |
| AST-level bash command analysis | Possible but high complexity cost |

### Workflow parity summary (current defaults)

With the default ccx config shown below, workflow behavior is aligned to Claude CLI's external/default orchestration style:

- subagents are used when needed, not by default for every task
- broad exploration escalates after directed search becomes insufficient (`explore_min_queries=3`)
- coordinator-style multi-hop orchestration is off by default
- recursive subagent delegation is discouraged by default
- strict mandatory verification contract is off by default (opt-in)
- when enabled, coordinator runs orchestration-only with a constrained tool surface (`task` + `question`)
- every dispatched subagent receives an automatically injected context bundle (cwd / git snapshot / recently changed files) so it starts from the same baseline as the parent
- inline `/ccx-fork`, `/ccx-bg`, `/ccx-fullctx`, and `/ccx-bg-status` commands let users branch sessions, queue background prompts, dispatch full-context fork subtasks, and inspect async task state

This is behavior-level parity, not engine-level identity. Engine internals (runtime schedulers, fork execution model, feature-flag infrastructure) are different and remain outside plugin scope.

---

## The Verification Agent

The most opinionated part of ccx. Key design decisions:

```mermaid
sequenceDiagram
    participant User
    participant CCX as ccx Agent
    participant Plan as ccx-plan
    participant Verify as ccx-verification
    participant OS as Filesystem/Bash
    
    User->>CCX: "Implement X feature"
    CCX->>Plan: delegate(prompt)
    Plan->>OS: Glob/Grep/Read (Read-only)
    Plan-->>CCX: Blueprint & Critical Files
    
    CCX->>OS: Edit/Write (Implementation)
    CCX->>OS: Bash (Tests/Build)
    Note over CCX: > 3 files edited<br>Hook injects: "Must verify"
    
    CCX->>Verify: delegate(files, approach)
    
    loop Verification Cycle
        Verify->>OS: Bash (Run tests, lint, probes)
        OS-->>Verify: Output
        
        alt Fails or Needs Change
            Verify-->>CCX: VERDICT: FAIL + Reproduction
            CCX->>OS: Edit (Fix issues)
            CCX->>Verify: delegate(corrections)
        else Succeeds
            Verify-->>CCX: VERDICT: PASS + Proof
        end
    end
    
    CCX-->>User: "Done. Verification passed."
```

- **Execution over reading** — every check must include a `Command run` block with real terminal output. "I reviewed the code and it looks correct" is rejected.
- **Self-rationalization awareness** — the prompt lists excuses the agent will reach for ("the code looks correct", "the tests already pass", "this would take too long") and instructs it to do the opposite.
- **Type-specific strategies** — different verification approaches for frontend, backend, CLI, infrastructure, database migrations, refactoring, mobile, data pipelines, and more.
- **Adversarial probes required** — before issuing PASS, at least one probe must be attempted: concurrency, boundary values, idempotency, or orphan operations.

Output format:

```
VERDICT: PASS
```

or `FAIL` with reproduction steps, or `PARTIAL` with what couldn't be verified and why.

---

## Configuration

Config is loaded in this order (first hit wins):

1. `.opencode/ccx.json` (project-level)
2. `~/.config/opencode/ccx.json` (global)
3. built-in defaults

Notes:
- The config loader supports JSON with comments (`//` and `/* ... */`).
- Project config overrides global config (it does not deep-merge both files).

Create one of the following files:
- `.opencode/ccx.json` (project-level)
- `~/.config/opencode/ccx.json` (global)

Example:

```json
{
  "enabled": true,
  "disabled_sections": [],
  "disabled_hooks": [],
  "output_style": null,
  "verification": {
    "auto_remind": false,
    "enforce_contract": false,
    "min_file_edits": 3,
    "spot_check_min_commands": 2
  },
  "risk_guard": {
    "enforce_high_risk_confirmation": true
  },
  "subagent_orchestration": {
    "explore_min_queries": 3,
    "coordinator_enabled": false,
    "allow_subagent_delegation": false,
    "context_bundle": {
      "enabled": true,
      "include_cwd": true,
      "include_git": true,
      "include_recent_files": true,
      "max_recent_files": 8
    },
    "session_workflows": {
      "enabled": true,
      "fork_command": "/ccx-fork",
      "background_command": "/ccx-bg",
      "full_context_command": "/ccx-fullctx",
      "status_command": "/ccx-bg-status"
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Master toggle for the entire plugin |
| `disabled_sections` | `string[]` | `[]` | Prompt sections to skip (e.g., `["tone-style"]`) |
| `disabled_hooks` | `string[]` | `[]` | Hooks to disable (e.g., `["risk-guard"]`) |
| `output_style` | `string \| null` | `null` | Custom output style name |
| `verification.auto_remind` | `boolean` | `false` | Auto-nudge verification after edits |
| `verification.enforce_contract` | `boolean` | `false` | Enable strict verification contract wording and reminder logic |
| `verification.min_file_edits` | `number` | `3` | File edit threshold before nudge |
| `verification.spot_check_min_commands` | `number` | `2` | Minimum verifier commands to re-run after PASS spot-check |
| `risk_guard.enforce_high_risk_confirmation` | `boolean` | `true` | Block high-risk commands unless explicit user confirmation is present |
| `subagent_orchestration.explore_min_queries` | `number` | `3` | Escalate to `ccx-explore` when directed lookup likely needs more than this query count |
| `subagent_orchestration.coordinator_enabled` | `boolean` | `false` | Register and advertise `ccx-coordinator` subagent |
| `subagent_orchestration.allow_subagent_delegation` | `boolean` | `false` | Permit subagents to delegate further. When `false`, runtime recursion guard blocks nested `task` delegation from `ccx-*` subagents unless explicit delegation-approval metadata is present |
| `subagent_orchestration.context_bundle.enabled` | `boolean` | `true` | Inject a shared context bundle (cwd, git snapshot, recently changed files) into `task` tool args before execution |
| `subagent_orchestration.context_bundle.include_cwd` | `boolean` | `true` | Include the working directory in the injected bundle |
| `subagent_orchestration.context_bundle.include_git` | `boolean` | `true` | Include the per-session git snapshot in the injected bundle |
| `subagent_orchestration.context_bundle.include_recent_files` | `boolean` | `true` | Include `git ls-files --modified --others` output in the injected bundle |
| `subagent_orchestration.context_bundle.max_recent_files` | `number` | `8` | Cap the number of recent files included in the bundle |
| `subagent_orchestration.session_workflows.enabled` | `boolean` | `true` | Enable inline session workflow commands (fork, background, full-context) in user messages |
| `subagent_orchestration.session_workflows.fork_command` | `string` | `/ccx-fork` | Command literal that triggers `session.fork`. Optional argument: explicit `messageID` to fork at |
| `subagent_orchestration.session_workflows.background_command` | `string` | `/ccx-bg` | Command literal that triggers `session.promptAsync`. Usage: `/ccx-bg [agent] <prompt>` |
| `subagent_orchestration.session_workflows.full_context_command` | `string` | `/ccx-fullctx` | Command literal that forks the session and dispatches a full-context subtask via `session.fork` + `session.promptAsync`. Usage: `/ccx-fullctx <agent> <prompt>` |
| `subagent_orchestration.session_workflows.status_command` | `string` | `/ccx-bg-status` | Command literal that lists background tasks or shows status for one task ID |

---

## Project Structure

```
ccx/
├── src/
│   ├── index.ts              # Plugin entry — composes everything
│   ├── prompts/              # 8 system prompt sections + composer
│   ├── agents/               # 5 subagent definitions with tailored prompts
│   ├── hooks/                # 12 runtime hooks
│   │   ├── config-handler.ts         # Agent registration
│   │   ├── risk-guard.ts             # Destructive command detection
│   │   ├── context-bundle.ts         # Inject cwd/git/recent-files into task tool args
│   │   ├── session-workflows.ts      # /ccx-fork, /ccx-bg, /ccx-fullctx, /ccx-bg-status commands
│   │   ├── bg-tasks.ts               # Background task lifecycle registry
│   │   ├── verification-reminder.ts  # Edit tracking + nudge
│   │   ├── environment-context.ts    # Session environment capture
│   │   ├── dynamic-system-prompt.ts  # Per-turn system prompt injection
│   │   ├── chat-message.ts           # Per-turn message augmentation
│   │   ├── chat-params.ts            # Per-agent LLM parameter tuning
│   │   ├── compaction.ts             # Context compaction customization
│   │   ├── tool-definition.ts        # Tool description enhancement
│   │   └── message-transform.ts      # Message history optimization
│   ├── config/               # Zod schema + JSONC config loader
│   └── plugin/               # OpenCode plugin interface + agent tool registry
├── .github/workflows/
│   └── publish.yml           # Auto-publish to npm on tag push
├── package.json
└── tsconfig.json
```

---

## Contributing

```bash
git clone https://github.com/Rejudge-F/ccx.git
cd ccx
bun install
bun run typecheck    # type check
bun run build        # build to dist/
```

To publish a new version:

```bash
# bump version in package.json, then:
git add -A && git commit -m "chore: bump to x.y.z"
git tag vx.y.z && git push origin main --tags
# GitHub Actions auto-publishes to npm
```

## License

MIT
