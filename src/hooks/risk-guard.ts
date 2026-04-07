import type { OhMyCCAgentConfig } from "../config/schema"

type RiskLevel = "high" | "medium"

const RISK_RULES: Array<{ pattern: RegExp; level: RiskLevel; name: string }> = [
  { pattern: /rm\s+-rf\b/i, level: "high", name: "rm-rf" },
  { pattern: /git\s+push\s+--force(?:-with-lease)?\b/i, level: "high", name: "git-force-push" },
  { pattern: /git\s+reset\s+--hard\b/i, level: "high", name: "git-hard-reset" },
  { pattern: /drop\s+table\b/i, level: "high", name: "sql-drop-table" },
  { pattern: /truncate\s+table\b/i, level: "high", name: "sql-truncate-table" },
  { pattern: /delete\s+from\b/i, level: "medium", name: "sql-delete" },
]

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

    const argsText = collectRiskText(output.args).join("\n")
    const matchedRule = RISK_RULES.find((rule) => rule.pattern.test(argsText))
    if (!matchedRule) {
      return
    }

    const toolName = isRecord(input) && typeof input.tool === "string" ? input.tool : "tool"
    const warning = matchedRule.level === "high"
      ? `High-risk ${toolName} invocation detected (${matchedRule.name}). Explicit user confirmation is required before execution.`
      : `Potentially destructive ${toolName} invocation detected (${matchedRule.name}). Review arguments carefully before continuing.`

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
