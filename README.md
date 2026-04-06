<p align="center">
  <h1 align="center">ccx</h1>
  <p align="center"><strong>Coding Copilot, eXtended</strong></p>
  <p align="center">
    An <a href="https://opencode.ai">OpenCode</a> plugin that makes your AI coding agent disciplined, verification-driven, and risk-aware.
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/@ccx-agent/opencode-ccx"><img src="https://img.shields.io/npm/v/@ccx-agent/opencode-ccx?style=flat-square&color=blue" alt="npm version"></a>
    <a href="https://github.com/Rejudge-F/ccx/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Rejudge-F/ccx?style=flat-square" alt="license"></a>
  </p>
</p>

---

## The Problem

LLM coding agents tend to over-engineer, skip verification, and run destructive commands without thinking. They add abstractions nobody asked for, report "done" without testing, and `rm -rf` without blinking.

## The Solution

ccx injects a complete behavioral framework into your OpenCode agent — system prompt sections that enforce coding discipline, specialized subagents that verify and plan, and safety hooks that catch dangerous operations before they execute.

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

If you prefer manual setup, add to your `opencode.json`:

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugin": [
    "@ccx-agent/opencode-ccx@0.1.0"
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

The main agent comes with 7 composable system prompt sections:

| Section | What it enforces |
|---------|-----------------|
| **intro** | Agent identity and trust boundary for untrusted content |
| **system-rules** | Permission model, context compression, prompt injection awareness |
| **doing-tasks** | Scope control — no unrequested features, no speculative abstractions, duplicate code > premature abstraction |
| **actions** | Risk classification — reversible vs irreversible, local vs shared, ask before destroying |
| **using-tools** | Dedicated tools over Bash, parallel tool calls, structured progress tracking |
| **tone-style** | Concise output, no emojis, `file:line` references, `owner/repo#N` links |
| **output-efficiency** | Lead with the answer, skip filler, report at milestones not continuously |

### Subagents

| Agent | Mode | Purpose |
|-------|------|---------|
| **ccx-explore** | read-only | Fast codebase search — parallel glob/grep/read across large repos |
| **ccx-plan** | read-only | Software architect — produces step-by-step plans with critical file lists |
| **ccx-verification** | read-only | Adversarial verifier — VERDICT protocol (PASS/FAIL/PARTIAL), runs real commands, catches self-rationalizations |
| **ccx-general-purpose** | read-write | Multi-strategy worker for tasks outside other specialists |
| **ccx-coordinator** | orchestrator | Decomposes complex work into Research, Synthesis, Implementation, Verification across parallel workers |

### Safety Hooks

| Hook | Trigger | Behavior |
|------|---------|----------|
| **Risk Guard** | `tool.execute.before` | Warns on `rm -rf`, `git push --force`, `DROP TABLE`, and other irreversible commands |
| **Verification Reminder** | `tool.execute.after` | Nudges the agent to run `ccx-verification` after N file edits |

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
│   ├── prompts/              # 7 system prompt sections + composer + environment detector
│   ├── agents/               # 5 subagent definitions with tailored prompts
│   ├── hooks/                # config-handler, risk-guard, verification-reminder
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
