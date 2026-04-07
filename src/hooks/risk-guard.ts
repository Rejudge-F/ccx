import type { OhMyCCAgentConfig } from "../config/schema"
import { getSessionAgent } from "./chat-message"

type RiskLevel = "high" | "medium"

const RISK_RULES: Array<{ pattern: RegExp; level: RiskLevel; name: string }> = [
  { pattern: /rm\s+-rf\b/i, level: "high", name: "rm-rf" },
  { pattern: /git\s+push\s+--force(?:-with-lease)?\b/i, level: "high", name: "git-force-push" },
  { pattern: /git\s+reset\s+--hard\b/i, level: "high", name: "git-hard-reset" },
  { pattern: /drop\s+table\b/i, level: "high", name: "sql-drop-table" },
  { pattern: /truncate\s+table\b/i, level: "high", name: "sql-truncate-table" },
  { pattern: /delete\s+from\b/i, level: "medium", name: "sql-delete" },
]

const TASK_LAUNCH_TOOL_NAMES = new Set(["task"])

function isGuardedSubagentName(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("ccx-") && value !== "ccx-coordinator"
}

function hasExplicitDelegationApproval(value: unknown): boolean {
  if (!isRecord(value)) return false

  if (value.subagentDelegation === true || value.subagentDelegation === "approved") {
    return true
  }
  if (value.allow_subagent_delegation === true || value.allowSubagentDelegation === true) {
    return true
  }
  if (value.ccx_subagent_delegation === true || value.ccxSubagentDelegation === true) {
    return true
  }

  const metadata = isRecord(value.metadata) ? value.metadata : undefined
  if (!metadata) return false

  return metadata.subagentDelegation === true
    || metadata.subagentDelegation === "approved"
    || metadata.allow_subagent_delegation === true
    || metadata.allowSubagentDelegation === true
    || metadata.ccx_subagent_delegation === true
    || metadata.ccxSubagentDelegation === true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function collectRiskText(value: unknown): string[] {
  if (typeof value === "string") {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectRiskText(item))
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap((item) => collectRiskText(item))
  }
  return []
}

function hasExplicitUserConfirmation(value: unknown): boolean {
  if (!isRecord(value)) return false
  const metadata = isRecord(value.metadata) ? value.metadata : undefined
  if (!metadata) return false
  const confirmation = metadata.riskConfirmation
  return confirmation === true || confirmation === "approved"
}

export function createRiskGuard(config: OhMyCCAgentConfig) {
  return async (input: unknown, output: unknown): Promise<void> => {
    if (!isRecord(output)) {
      return
    }

    const toolName = isRecord(input) && typeof input.tool === "string"
      ? input.tool.toLowerCase()
      : ""

    if (!config.subagent_orchestration.allow_subagent_delegation && TASK_LAUNCH_TOOL_NAMES.has(toolName)) {
      const sessionID = isRecord(input) && typeof input.sessionID === "string" ? input.sessionID : undefined
      const directAgent = isRecord(input) && typeof input.agent === "string" ? input.agent : undefined
      const currentAgent = directAgent ?? (sessionID ? getSessionAgent(sessionID) : undefined)
      const approved = hasExplicitDelegationApproval(input) || hasExplicitDelegationApproval(output.args)

      if (isGuardedSubagentName(currentAgent) && !approved) {
        output.blocked = true
        output.warning = "Nested subagent delegation is blocked by runtime policy. Execute directly in the current subagent, or provide explicit delegation approval metadata."
        const metadata = isRecord(output.metadata) ? output.metadata : {}
        metadata.subagentRecursionGuard = {
          flagged: true,
          blocked: true,
          tool: toolName,
          agent: currentAgent,
          reason: "nested-subagent-delegation-blocked",
        }
        output.metadata = metadata
        return
      }
    }

    const argsText = collectRiskText(output.args).join("\n")
    const matchedRule = RISK_RULES.find((rule) => rule.pattern.test(argsText))
    if (!matchedRule) {
      return
    }

    const riskyToolName = isRecord(input) && typeof input.tool === "string" ? input.tool : "tool"
    const warning = matchedRule.level === "high"
      ? `High-risk ${riskyToolName} invocation detected (${matchedRule.name}). Explicit user confirmation is required before execution.`
      : `Potentially destructive ${riskyToolName} invocation detected (${matchedRule.name}). Review arguments carefully before continuing.`

    if (matchedRule.level === "high" && config.risk_guard.enforce_high_risk_confirmation) {
      const confirmed = hasExplicitUserConfirmation(input)
      if (!confirmed) {
        output.blocked = true
      }
    }

    output.warning = warning
    const metadata = isRecord(output.metadata) ? output.metadata : {}
    metadata.riskGuard = {
      flagged: true,
      level: matchedRule.level,
      pattern: matchedRule.pattern.source,
      name: matchedRule.name,
    }
    output.metadata = metadata
  }
}
