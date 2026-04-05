import { tool } from "@opencode-ai/plugin"

import { COORDINATOR_AGENT_DEFINITION } from "../agents/coordinator"
import { EXPLORE_AGENT_DEFINITION } from "../agents/explore"
import { GENERAL_PURPOSE_AGENT_DEFINITION } from "../agents/general-purpose"
import { PLAN_AGENT_DEFINITION } from "../agents/plan"
import { VERIFICATION_AGENT_DEFINITION } from "../agents/verification"
import type { AgentDefinition } from "../agents/types"

const agentDefinitions = [
  COORDINATOR_AGENT_DEFINITION,
  EXPLORE_AGENT_DEFINITION,
  PLAN_AGENT_DEFINITION,
  GENERAL_PURPOSE_AGENT_DEFINITION,
  VERIFICATION_AGENT_DEFINITION,
] as const satisfies readonly AgentDefinition[]

export type ToolDefinition = ReturnType<typeof tool>

function createAgentTool(definition: AgentDefinition): ToolDefinition {
  return tool({
    description: definition.description,
    args: {
      prompt: tool.schema.string().min(1),
    },
    async execute(args) {
      return [
        `Agent: ${definition.name}`,
        `Read-only: ${definition.readOnly ? "yes" : "no"}`,
        `Disallowed tools: ${(definition.disallowedTools ?? []).join(", ") || "none"}`,
        "System prompt:",
        definition.getSystemPrompt(),
        "User prompt:",
        args.prompt,
      ].join("\n\n")
    },
  })
}

export function createAgentTools(): Record<string, ToolDefinition> {
  return Object.fromEntries(
    agentDefinitions.map((definition) => [definition.name, createAgentTool(definition)]),
  )
}
