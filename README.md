# ccx — Coding Copilot, eXtended

An [OpenCode](https://opencode.ai) plugin that turns your AI coding agent into a disciplined software engineer. ccx injects a complete behavioral framework — system prompt sections, specialized subagents, and safety hooks — so the agent writes less unnecessary code, verifies its own work, and thinks before running destructive commands.

## Why

Out of the box, LLM coding agents tend to over-engineer, skip verification, and act before thinking. ccx fixes this by injecting a set of behavioral constraints and specialized subagents into your OpenCode session:

- **Writes less, not more** — no speculative abstractions, no unrequested refactors, no gold-plating
- **Verifies before reporting done** — an adversarial verification agent stress-tests implementations with real commands, not code reading
- **Asks before destroying** — a risk guard flags `rm -rf`, `git push --force`, and other irreversible actions before they execute
- **Delegates intelligently** — a coordinator agent decomposes complex tasks into research, implementation, and verification phases across parallel workers

## What You Get

| Component | What it does |
|-----------|-------------|
| **ccx** (primary agent) | Main agent with 7 composable system prompt sections governing coding discipline, risk awareness, tool usage, and output style |
| **ccx-explore** | Read-only codebase search specialist. Fast parallel file/content search across large repos |
| **ccx-plan** | Read-only software architect. Investigates code and produces step-by-step implementation plans with critical file lists |
| **ccx-verification** | Adversarial verifier with VERDICT protocol (PASS/FAIL/PARTIAL). Runs builds, tests, linters, then tries to break things with boundary values, concurrency probes, and idempotency checks |
| **ccx-general-purpose** | Multi-strategy task worker for anything that doesn't fit the specialists |
| **ccx-coordinator** | Multi-agent orchestrator. Decomposes work into Research → Synthesis → Implementation → Verification phases across parallel workers |
| **Risk Guard** | `tool.execute.before` hook that warns on destructive operations |
| **Verification Reminder** | `tool.execute.after` hook that nudges verification after N file edits |

## Install

```bash
bun add ccx
```

Add to your OpenCode config:

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugin": [
    "ccx"
    // ... your other plugins
  ]
}
```

Or use a local build:

```jsonc
{
  "plugin": [
    "file:///path/to/ccx/dist/index.js"
  ]
}
```

Restart OpenCode. Press `@` to see `ccx` in the agent list.

## Configure

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
| `enabled` | boolean | `true` | Master toggle |
| `disabled_sections` | string[] | `[]` | System prompt sections to skip (e.g., `["tone-style", "output-efficiency"]`) |
| `disabled_hooks` | string[] | `[]` | Hooks to disable (e.g., `["risk-guard"]`) |
| `output_style` | string \| null | `null` | Custom output style name |
| `verification.auto_remind` | boolean | `true` | Nudge verification after file edits |
| `verification.min_file_edits` | number | `3` | Edit threshold before nudge |

## How It Works

ccx hooks into OpenCode's plugin lifecycle at two points:

**1. `config` hook** — Injects the `ccx` primary agent (with full system prompt) and 5 subagents into `config.agent`. The primary agent's prompt is composed from 7 independent sections + subagent orchestration guidance.

**2. `tool.execute.before/after` hooks** — Risk Guard scans commands for destructive patterns pre-execution; Verification Reminder tracks file edit count post-execution.

### System Prompt Sections

The primary agent's system prompt is assembled from these composable sections:

| Section | Purpose |
|---------|---------|
| `intro` | Agent identity and trust boundary |
| `system-rules` | Permission model, context compression, prompt injection awareness |
| `doing-tasks` | Coding discipline — scope control, minimal abstraction, honest reporting |
| `actions` | Risk classification for reversible vs irreversible operations |
| `using-tools` | Prefer dedicated tools over Bash, parallel tool call strategy |
| `tone-style` | No emojis, concise output, code reference formatting |
| `output-efficiency` | Lead with answers, skip filler, milestone-based updates |

### Verification Agent

The verification agent is the most opinionated component. Key behaviors:

- **Runs commands, not reads code** — every check must include a `Command run` block with actual terminal output
- **Catches its own rationalizations** — the prompt explicitly lists excuses the agent will reach for ("the code looks correct", "the tests already pass") and instructs it to do the opposite
- **Adapts by change type** — different verification strategies for frontend, backend, CLI, infrastructure, database migrations, refactoring, etc.
- **Requires adversarial probes** — at least one concurrency, boundary value, or idempotency test before issuing PASS

## Project Structure

```
ccx/
├── src/
│   ├── index.ts                  # Plugin entry point
│   ├── prompts/                  # 7 system prompt sections + compose + environment
│   ├── agents/                   # 5 subagent definitions (explore, plan, verification, coordinator, general-purpose)
│   ├── hooks/                    # config-handler, risk-guard, verification-reminder, environment-context, system-prompt-injector
│   ├── config/                   # Zod schema + JSONC config loader
│   └── plugin/                   # OpenCode plugin interface + tool registry
├── package.json
└── tsconfig.json
```

## License

MIT
