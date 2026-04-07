import { tool } from "@opencode-ai/plugin"

import { COORDINATOR_AGENT_DEFINITION } from "../agents/coordinator"
import { EXPLORE_AGENT_DEFINITION } from "../agents/explore"
import { GENERAL_PURPOSE_AGENT_DEFINITION } from "../agents/general-purpose"
import { PLAN_AGENT_DEFINITION } from "../agents/plan"
import { VERIFICATION_AGENT_DEFINITION } from "../agents/verification"
import type { OhMyCCAgentConfig } from "../config/schema"
import type { AgentDefinition } from "../agents/types"

const BASE_AGENT_DEFINITIONS = [
  EXPLORE_AGENT_DEFINITION,
  PLAN_AGENT_DEFINITION,
  GENERAL_PURPOSE_AGENT_DEFINITION,
  VERIFICATION_AGENT_DEFINITION,
] as const satisfies readonly AgentDefinition[]

function getEnabledAgentDefinitions(config: OhMyCCAgentConfig): readonly AgentDefinition[] {
  if (config.subagent_orchestration.coordinator_enabled) {
    return [...BASE_AGENT_DEFINITIONS, COORDINATOR_AGENT_DEFINITION]
  }
  return BASE_AGENT_DEFINITIONS
}

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
        `Allowed tools: ${(definition.allowedTools ?? []).join(", ") || "all"}`,
        `Disallowed tools: ${(definition.disallowedTools ?? []).join(", ") || "none"}`,
        "System prompt:",
        definition.getSystemPrompt(),
        "User prompt:",
        args.prompt,
      ].join("\n\n")
    },
  })
}

export function createAgentTools(config: OhMyCCAgentConfig): Record<string, ToolDefinition> {
  const agentDefinitions = getEnabledAgentDefinitions(config)
  return Object.fromEntries(
    agentDefinitions.map((definition) => [definition.name, createAgentTool(definition)]),
  )
}
