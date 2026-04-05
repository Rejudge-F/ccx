const RISK_PATTERNS = [
  /rm\s+-rf\b/i,
  /git\s+push\s+--force(?:-with-lease)?\b/i,
  /git\s+reset\s+--hard\b/i,
  /drop\s+table\b/i,
  /truncate\s+table\b/i,
  /delete\s+from\b/i,
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

export function createRiskGuard() {
  return async (input: unknown, output: unknown): Promise<void> => {
    if (!isRecord(output)) {
      return
    }

    const argsText = collectRiskText(output.args).join("\n")
    const matchedPattern = RISK_PATTERNS.find((pattern) => pattern.test(argsText))
    if (!matchedPattern) {
      return
    }

    const toolName = isRecord(input) && typeof input.tool === "string" ? input.tool : "tool"
    const warning = `Potentially destructive ${toolName} invocation detected. Review arguments carefully before continuing.`

    output.warning = warning
    const metadata = isRecord(output.metadata) ? output.metadata : {}
    metadata.riskGuard = {
      flagged: true,
      pattern: matchedPattern.source,
    }
    output.metadata = metadata
  }
}
