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

It's not a wrapper or a proxy. It's a complete behavioral framework: 8 composable system prompt sections, 5 specialized subagents, 10 runtime hooks that dynamically adapt the agent's behavior every turn.

**Before ccx:** Agent writes 200 lines, adds 3 helper files, says "done."

**After ccx:** Agent writes 40 lines, runs the tests, spawns a verification agent that tries to break it, then reports the VERDICT.

---

## Quick Start

```bash
opencode plugin @ccx-agent/opencode-ccx
```

That's it. Restart OpenCode, press `@`, select **ccx**.

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

### 5 Specialized Subagents

| Agent | Mode | Purpose |
|-------|------|---------|
| **ccx-explore** | read-only | Fast codebase search — parallel glob/grep/read across large repos |
| **ccx-plan** | read-only | Software architect — produces step-by-step plans with critical file lists |
| **ccx-verification** | read-only | Adversarial verifier — VERDICT protocol (PASS/FAIL/PARTIAL), runs real commands, catches self-rationalizations |
| **ccx-general-purpose** | read-write | Multi-strategy worker for tasks outside other specialists |
| **ccx-coordinator** | orchestrator | Decomposes complex work into Research, Synthesis, Implementation, Verification across parallel workers |

### 10 Runtime Hooks

ccx uses every major hook point in the OpenCode plugin API to dynamically shape agent behavior:

#### Static Hooks (startup)

| Hook | What it does |
|------|-------------|
| **config** | Registers the ccx agent + 5 subagents with their system prompts and tool restrictions |
| **tool** | Creates agent dispatch tools for the subagent registry |

#### Per-Turn Hooks (every LLM call)

| Hook | What it does |
|------|-------------|
| **chat.message** | Injects `<system-reminder>` with verification contract, edit tracking |
| **chat.params** | Tunes temperature/topP per agent — low for plan/verification (precision), higher for explore (creativity) |
| **experimental.chat.system.transform** | Dynamically injects project instructions (CLAUDE.md), session context (edited files list), and verification reminders into the system prompt |
| **tool.definition** | Appends safety rules to bash/edit/write tool descriptions, usage hints to glob/grep/read |
| **experimental.chat.messages.transform** | Trims long tool outputs (>8KB), collapses consecutive reasoning parts to save context |

#### Event Hooks (reactive)

| Hook | What it does |
|------|-------------|
| **tool.execute.before** | Risk Guard — flags `rm -rf`, `git push --force`, `DROP TABLE`, and other destructive patterns |
| **tool.execute.after** | Tracks file edits, feeds the dynamic verification reminder system |
| **experimental.session.compacting** | Customizes context compaction to preserve: original task, implementation plan, edited files, verification status, architectural decisions |

---

## Claude Code Alignment

ccx was built by studying Claude Code's prompt architecture and adapting its core behavioral principles for OpenCode. Here's what maps and what doesn't:

### What ccx replicates

| Claude Code Feature | ccx Implementation |
|--------------------|--------------------|
| 8-section system prompt | 8 composable prompt sections, near-identical content |
| 5 subagent types (explore, plan, verify, general, coordinator) | Same 5 agents with equivalent prompts |
| Verification contract (3+ file edits → mandatory review) | Dynamic system prompt injection + chat.message reminders |
| VERDICT protocol (PASS/FAIL/PARTIAL) | Identical format and adversarial strategies |
| Per-turn `<system-reminder>` attachments | `chat.message` hook injects context each turn |
| Project instructions (CLAUDE.md) | Auto-loaded from CLAUDE.md / .claude/instructions.md / AGENTS.md |
| Tool safety hints | `tool.definition` hook appends rules to bash/edit/write descriptions |
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

---

## The Verification Agent

The most opinionated part of ccx. Key design decisions:

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

Create `~/.config/opencode/ccx.json` (global) or `.opencode/ccx.json` (project-level):

```json
{
  "enabled": true,
  "disabled_sections": [],
  "disabled_hooks": [],
  "output_style": null,
  "verification": {
    "auto_remind": true,
    "min_file_edits": 3
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Master toggle for the entire plugin |
| `disabled_sections` | `string[]` | `[]` | Prompt sections to skip (e.g., `["tone-style"]`) |
| `disabled_hooks` | `string[]` | `[]` | Hooks to disable (e.g., `["risk-guard"]`) |
| `output_style` | `string \| null` | `null` | Custom output style name |
| `verification.auto_remind` | `boolean` | `true` | Auto-nudge verification after edits |
| `verification.min_file_edits` | `number` | `3` | File edit threshold before nudge |

---

## Project Structure

```
ccx/
├── src/
│   ├── index.ts              # Plugin entry — composes everything
│   ├── prompts/              # 8 system prompt sections + composer
│   ├── agents/               # 5 subagent definitions with tailored prompts
│   ├── hooks/                # 10 runtime hooks
│   │   ├── config-handler.ts         # Agent registration
│   │   ├── risk-guard.ts             # Destructive command detection
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
