import type { OhMyCCAgentConfig } from "../config/schema"
import { EXPLORE_AGENT_DEFINITION } from "../agents/explore"
import { PLAN_AGENT_DEFINITION } from "../agents/plan"
import { GENERAL_PURPOSE_AGENT_DEFINITION } from "../agents/general-purpose"
import { VERIFICATION_AGENT_DEFINITION } from "../agents/verification"
import { COORDINATOR_AGENT_DEFINITION } from "../agents/coordinator"
import type { AgentDefinition } from "../agents/types"
import { getSessionAgent } from "./session-agent"
import {
  analyzeBashCommand,
  extractCommandNames,
  pickHighestFinding,
  type RiskFinding,
  type RiskLevel,
} from "./bash-analyzer"

const TASK_LAUNCH_TOOL_NAMES = new Set(["task"])
const BASH_TOOL_NAMES = new Set(["bash", "shell", "sh", "exec"])
const SQL_TOOL_NAMES = new Set(["sql", "query", "db", "database"])

const ALL_AGENT_DEFS: AgentDefinition[] = [
  EXPLORE_AGENT_DEFINITION,
  PLAN_AGENT_DEFINITION,
  GENERAL_PURPOSE_AGENT_DEFINITION,
  VERIFICATION_AGENT_DEFINITION,
  COORDINATOR_AGENT_DEFINITION,
]

/**
 * Read-only shell commands that readOnly-agent may invoke via Bash.
 * Mutating commands (rm, mv, git add, npm install, etc.) are rejected even
 * when not flagged as high-risk by the bash-analyzer.
 */
const READ_ONLY_BASH_COMMANDS = new Set([
  "ls", "pwd", "cd", "echo", "printf", "true", "false", "test", "[",
  "cat", "head", "tail", "less", "more", "bat",
  "grep", "egrep", "fgrep", "rg", "ripgrep", "ag",
  "find", "fd", "locate", "which", "whereis", "type", "command",
  "stat", "file", "du", "df", "wc", "nl", "sort", "uniq", "tr",
  "cut", "awk", "sed", "jq", "yq",
  "date", "hostname", "whoami", "id", "uname", "uptime",
  "git", "hg", "svn",
  "node", "python", "python3", "ruby", "perl",
  "npm", "pnpm", "yarn", "bun", "go", "cargo", "rustc",
  "tsc", "eslint", "prettier", "mypy", "ruff", "pylint", "flake8",
  "pytest", "jest", "vitest", "mocha",
  "curl", "wget", "nc", "ping", "dig", "nslookup", "host",
  "env", "printenv",
  "basename", "dirname", "readlink", "realpath",
  "diff", "comm", "cmp", "xxd", "od", "hexdump",
  "make", "cmake", "ninja",
  "docker", "kubectl", "helm",
  "ps", "top", "htop",
  "tree",
])

const DESTRUCTIVE_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set([
    "add", "commit", "push", "pull", "merge", "rebase", "cherry-pick",
    "reset", "revert", "restore", "checkout", "switch", "branch", "tag",
    "stash", "clean", "gc", "filter-branch", "filter-repo",
    "rm", "mv", "config", "init", "clone", "remote",
  ]),
  npm: new Set(["install", "i", "uninstall", "remove", "rm", "publish", "link", "unlink", "run", "exec"]),
  pnpm: new Set(["install", "i", "add", "remove", "rm", "publish", "link", "unlink", "run", "exec", "dlx"]),
  yarn: new Set(["add", "remove", "install", "publish", "link", "unlink", "dlx"]),
  bun: new Set(["install", "add", "remove", "publish", "link", "unlink", "run", "x"]),
  cargo: new Set(["install", "uninstall", "publish", "run", "new", "init", "add", "remove"]),
  go: new Set(["install", "get", "mod", "run", "build"]),
  make: new Set(["install", "uninstall", "clean", "distclean"]),
  docker: new Set([
    "run", "create", "start", "stop", "kill", "rm", "rmi", "build", "push", "pull",
    "commit", "exec", "prune", "system", "volume", "network",
  ]),
  kubectl: new Set(["apply", "create", "delete", "edit", "patch", "replace", "scale", "rollout", "exec", "cp"]),
  helm: new Set(["install", "uninstall", "upgrade", "rollback", "delete"]),
}

const ALLOWED_WRITE_PATH_PREFIXES = ["/tmp/", "/var/tmp/", "/private/tmp/"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getReadOnlyAgentNames(agentName: string): Set<string> {
  const out = new Set<string>()
  for (const def of ALL_AGENT_DEFS) {
    if (def.readOnly) {
      out.add(`${agentName}-${def.name}`)
    }
  }
  return out
}

function findReadOnlyViolations(bashSource: string): Array<{ reason: string; command: string }> {
  const violations: Array<{ reason: string; command: string }> = []
  const trimmed = bashSource.trim()
  if (!trimmed) return violations

  const commandNames = extractCommandNames(trimmed)
  const tokens = trimmed.split(/\s+/).filter(Boolean)

  for (const name of commandNames) {
    if (!READ_ONLY_BASH_COMMANDS.has(name)) {
      violations.push({
        reason: `command "${name}" is not in the read-only allowlist`,
        command: name,
      })
    }
  }

  const inspectedIndices = new Set<number>()
  for (let i = 0; i < tokens.length; i += 1) {
    const tokenLower = tokens[i].toLowerCase()
    const destructive = DESTRUCTIVE_SUBCOMMANDS[tokenLower]
    if (!destructive) continue
    if (inspectedIndices.has(i)) continue

    let subIndex = i + 1
    while (subIndex < tokens.length && tokens[subIndex].startsWith("-")) {
      subIndex += 1
    }
    if (subIndex >= tokens.length) continue

    const sub = tokens[subIndex].toLowerCase()
    inspectedIndices.add(subIndex)
    if (destructive.has(sub)) {
      violations.push({
        reason: `"${tokenLower} ${sub}" is a destructive subcommand`,
        command: `${tokenLower} ${sub}`,
      })
    }
  }

  const redirectMatches = trimmed.matchAll(/(?:^|\s)(?:\d*>{1,2}|&>|>&)\s*([^\s;|&<>()]+)/g)
  for (const match of redirectMatches) {
    const target = match[1]
    if (!target || target === "/dev/null" || target === "&1" || target === "&2") continue
    const isAllowed = ALLOWED_WRITE_PATH_PREFIXES.some((prefix) => target.startsWith(prefix))
      || target.startsWith("$TMPDIR/")
      || target === "$TMPDIR"
    if (!isAllowed) {
      violations.push({
        reason: `redirection target "${target}" must be inside /tmp, /var/tmp, or $TMPDIR`,
        command: match[0].trim(),
      })
    }
  }

  return violations
}

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
  const readOnlyAgentNames = getReadOnlyAgentNames(config.agent_name)

  return async (input: unknown, output: unknown): Promise<void> => {
    if (!isRecord(output)) {
      return
    }

    const toolName = isRecord(input) && typeof input.tool === "string"
      ? input.tool.toLowerCase()
      : ""

    const sessionID = isRecord(input) && typeof input.sessionID === "string" ? input.sessionID : undefined
    const directAgent = isRecord(input) && typeof input.agent === "string" ? input.agent : undefined
    const currentAgent = directAgent ?? (sessionID ? getSessionAgent(sessionID) : undefined)

    if (!config.subagent_orchestration.allow_subagent_delegation && TASK_LAUNCH_TOOL_NAMES.has(toolName)) {
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

    // Read-only agent enforcement: when a readOnly-declared agent invokes bash,
    // reject mutating commands (outside the allowlist) or redirections to
    // non-temp paths. Prevents the LLM from bypassing Edit/Write restrictions
    // via `bash -c 'cat > /project/file.ts'`.
    if (
      typeof currentAgent === "string"
      && readOnlyAgentNames.has(currentAgent)
      && BASH_TOOL_NAMES.has(toolName)
    ) {
      const bashSources = collectBashSource(output.args)
      const allViolations: Array<{ reason: string; command: string }> = []
      for (const source of bashSources) {
        allViolations.push(...findReadOnlyViolations(source))
      }
      if (allViolations.length > 0) {
        output.blocked = true
        const first = allViolations[0]
        output.warning = `Read-only agent "${currentAgent}" attempted a mutating shell operation: ${first.reason}. If this is intentional, run it from a non-readOnly agent.`
        const metadata = isRecord(output.metadata) ? output.metadata : {}
        metadata.readOnlyAgentGuard = {
          flagged: true,
          blocked: true,
          agent: currentAgent,
          violations: allViolations,
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
