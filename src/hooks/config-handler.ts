import type { OhMyCCAgentConfig } from "../config/schema"
import { composeSystemPrompt } from "../prompts/compose"
import { detectGit } from "../prompts/environment"
import { EXPLORE_AGENT_DEFINITION } from "../agents/explore"
import { PLAN_AGENT_DEFINITION } from "../agents/plan"
import { GENERAL_PURPOSE_AGENT_DEFINITION } from "../agents/general-purpose"
import { VERIFICATION_AGENT_DEFINITION } from "../agents/verification"
import { COORDINATOR_AGENT_DEFINITION } from "../agents/coordinator"
import type { AgentDefinition } from "../agents/types"

const SUBAGENT_DEFINITIONS: AgentDefinition[] = [
  EXPLORE_AGENT_DEFINITION,
  PLAN_AGENT_DEFINITION,
  GENERAL_PURPOSE_AGENT_DEFINITION,
  VERIFICATION_AGENT_DEFINITION,
  COORDINATOR_AGENT_DEFINITION,
]

function buildToolRestrictions(def: AgentDefinition): Record<string, boolean> | undefined {
  if (!def.disallowedTools || def.disallowedTools.length === 0) return undefined
  const tools: Record<string, boolean> = { "*": true }
  for (const tool of def.disallowedTools) {
    tools[tool.toLowerCase()] = false
  }
  return tools
}

function buildSubagentGuidance(): string {
  const agentList = SUBAGENT_DEFINITIONS.map(
    (def) => `- **ccx-${def.name}**: ${def.description}`,
  ).join("\n")

  return `# Subagent orchestration

The \`task\` tool lets you launch specialized subagents. Leverage them to distribute work in parallel and shield your primary context window from being overwhelmed by verbose output.

Reach for the task tool proactively when the current job aligns with a subagent's specialty. If a subagent's description indicates proactive usage, invoke it on your own initiative rather than waiting for the user to request it.

## Available subagents
${agentList}

## When to use subagents

- Invoke the **task** tool with subagent_type \`ccx-explore\` for wide-ranging codebase exploration or in-depth research. For targeted lookups (a known file, class, or function name), use Glob or Grep directly — escalate to ccx-explore only when a simple search falls short or clearly demands many queries.
- Invoke the **task** tool with subagent_type \`ccx-plan\` when an implementation strategy should be designed before any code is written. The plan agent examines the codebase in read-only mode and produces a step-by-step approach with key files identified.
- Invoke the **task** tool with subagent_type \`ccx-general-purpose\` for multi-step work that does not fall under any other specialist's domain.
- Invoke the **task** tool with subagent_type \`ccx-coordinator\` for complex tasks best decomposed into research, implementation, and verification phases distributed across multiple workers.

## Verification contract

The rule: whenever non-trivial implementation occurs during your turn, an independent adversarial review must take place before you declare completion — whether you wrote the code yourself or a subagent did. You are the gatekeeper. Non-trivial is defined as: 3+ file edits, backend/API changes, or infrastructure changes.

Launch the **task** tool with subagent_type \`ccx-verification\`. Supply the ORIGINAL user task description, the list of changed files, and the approach used. Your own review and commentary do NOT count — only the verification agent assigns a verdict; you may not self-assign PARTIAL.

- On **FAIL**: address the reported issue, then resume the verifier session with the failure details plus your correction. Iterate until PASS.
- On **PASS**: perform a spot-check — re-execute 2-3 commands from the verifier's report and confirm outputs match. If any PASS step lacks a Command run block or the output differs, resume the verifier with the discrepancy.
- On **PARTIAL**: communicate what passed and what remained unverifiable due to environment constraints.

## Subagent usage rules

- Subagents excel at running independent queries concurrently and keeping bulky output out of the main context, but avoid overusing them when the work is simple enough to handle directly.
- Do NOT redo work that a subagent is already performing — once you delegate a research task, refrain from executing the same searches yourself.
- When dispatching subagents, inform the user about what was launched and what results you are awaiting.
- You may launch several subagents concurrently by issuing multiple task tool calls within a single response.`
}

export function createConfigHook(config: OhMyCCAgentConfig, directory: string) {
  return async (input: Record<string, unknown>): Promise<void> => {
    if (!config.enabled) return

    const existingAgents = (input.agent as Record<string, unknown>) ?? {}

    const systemSections = await composeSystemPrompt({
      toolNames: { bash: "Bash", read: "Read", edit: "Edit", write: "Write", glob: "Glob", grep: "Grep" },
      env: {
        cwd: directory,
        isGit: detectGit(directory),
        platform: process.platform,
        shell: process.env.SHELL ?? "unknown",
      },
      outputStyle: config.output_style ?? undefined,
      disabledSectionIDs: config.disabled_sections,
    })

    const subagentGuidance = buildSubagentGuidance()
    const mainPrompt = [...systemSections, subagentGuidance].join("\n\n")

    const ccx: Record<string, unknown> = {
      description: "CCX Agent — disciplined coding, risk-aware actions, verification-driven workflow with subagent orchestration.",
      mode: "primary",
      prompt: mainPrompt,
      tools: { "*": true },
    }

    const subagents: Record<string, unknown> = {}
    for (const def of SUBAGENT_DEFINITIONS) {
      subagents[`ccx-${def.name}`] = {
        description: def.description,
        mode: "subagent",
        prompt: def.getSystemPrompt(),
        tools: buildToolRestrictions(def),
      }
    }

    input.agent = {
      ...existingAgents,
      ccx: ccx,
      ...subagents,
    }

    if (!input.default_agent) {
      input.default_agent = "ccx"
    }
  }
}
