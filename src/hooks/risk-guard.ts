import type { OhMyCCAgentConfig } from "../config/schema"
import { getSessionAgent } from "./chat-message"
import {
  analyzeBashCommand,
  pickHighestFinding,
  type RiskFinding,
  type RiskLevel,
} from "./bash-analyzer"

const TASK_LAUNCH_TOOL_NAMES = new Set(["task"])
const BASH_TOOL_NAMES = new Set(["bash", "shell", "sh", "exec"])
const SQL_TOOL_NAMES = new Set(["sql", "query", "db", "database"])

function isGuardedSubagentName(value: unknown, agentName: string): boolean {
  const prefix = `${agentName}-`
  return typeof value === "string"
    && value.startsWith(prefix)
    && value !== `${agentName}-coordinator`
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

function collectBashSource(args: unknown): string[] {
  if (args === null || args === undefined) return []
  if (typeof args === "string") return [args]
  if (Array.isArray(args)) {
    const out: string[] = []
    for (const item of args) out.push(...collectBashSource(item))
    return out
  }
  if (isRecord(args)) {
    const candidates = ["command", "cmd", "script", "args", "bash", "shell"]
    for (const key of candidates) {
      const value = args[key]
      if (typeof value === "string") return [value]
      if (Array.isArray(value)) {
        return [value.map((entry) => (typeof entry === "string" ? entry : "")).filter(Boolean).join(" ")]
      }
    }
    return []
  }
  return []
}

function collectAllText(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap((item) => collectAllText(item))
  if (isRecord(value)) return Object.values(value).flatMap((item) => collectAllText(item))
  return []
}

function hasExplicitUserConfirmation(value: unknown): boolean {
  if (!isRecord(value)) return false
  const metadata = isRecord(value.metadata) ? value.metadata : undefined
  if (!metadata) return false
  const confirmation = metadata.riskConfirmation
  return confirmation === true || confirmation === "approved"
}

function formatWarning(level: RiskLevel, toolName: string, finding: RiskFinding): string {
  const lead = level === "high"
    ? `High-risk ${toolName} invocation detected`
    : `Potentially destructive ${toolName} invocation detected`
  return `${lead} (${finding.name}): ${finding.message}. Command: ${finding.command}`
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

      if (isGuardedSubagentName(currentAgent, config.agent_name) && !approved) {
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

    const astEnabled = config.risk_guard.ast_analysis
    const bashSources: string[] = BASH_TOOL_NAMES.has(toolName)
      ? collectBashSource(output.args)
      : SQL_TOOL_NAMES.has(toolName)
        ? collectBashSource(output.args)
        : collectAllText(output.args)

    const analyzerOptions = {
      extraBlockedCommands: config.risk_guard.extra_blocked_commands,
      extraAllowedCommands: config.risk_guard.extra_allowed_commands,
    }

    const allFindings: RiskFinding[] = []
    for (const source of bashSources) {
      if (!astEnabled && !BASH_TOOL_NAMES.has(toolName)) {
        // When AST is disabled, only inspect explicit bash commands, not every arg text.
        continue
      }
      const findings = analyzeBashCommand(source, analyzerOptions)
      allFindings.push(...findings)
    }

    const top = pickHighestFinding(allFindings)
    if (!top) return

    const riskyToolName = isRecord(input) && typeof input.tool === "string" ? input.tool : "tool"
    const warning = formatWarning(top.level, riskyToolName, top)

    if (top.level === "high" && config.risk_guard.enforce_high_risk_confirmation) {
      const confirmed = hasExplicitUserConfirmation(input)
      if (!confirmed) {
        output.blocked = true
      }
    }

    output.warning = warning
    const metadata = isRecord(output.metadata) ? output.metadata : {}
    metadata.riskGuard = {
      flagged: true,
      level: top.level,
      name: top.name,
      findings: allFindings.map((finding) => ({
        level: finding.level,
        name: finding.name,
        message: finding.message,
      })),
    }
    output.metadata = metadata
  }
}
