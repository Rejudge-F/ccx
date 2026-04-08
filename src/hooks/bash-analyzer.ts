import parse from "bash-parser"
import type { BashParserNode } from "bash-parser"

export type RiskLevel = "high" | "medium" | "low"

export type RiskFinding = {
  level: RiskLevel
  name: string
  message: string
  command: string
}

export type AnalyzerOptions = {
  extraBlockedCommands?: string[]
  extraAllowedCommands?: string[]
}

type ExtractedCommand = {
  name: string
  args: string[]
  raw: string
}

const WRAPPER_COMMANDS = new Set([
  "sudo",
  "doas",
  "env",
  "xargs",
  "timeout",
  "nice",
  "ionice",
  "nohup",
  "time",
  "command",
  "exec",
  "unbuffer",
  "stdbuf",
])

const ALWAYS_BLOCKED_COMMANDS: Record<string, string> = {
  shred: "overwrites files irreversibly",
  mkfs: "formats a filesystem",
  "mkfs.ext4": "formats a filesystem",
  "mkfs.xfs": "formats a filesystem",
  "mkfs.btrfs": "formats a filesystem",
  fdisk: "manipulates disk partitions",
  parted: "manipulates disk partitions",
  wipefs: "erases filesystem signatures",
}

const CRITICAL_PATHS = new Set([
  "/",
  "/*",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/home",
  "/lib",
  "/lib32",
  "/lib64",
  "/opt",
  "/proc",
  "/root",
  "/sbin",
  "/srv",
  "/sys",
  "/usr",
  "/var",
  "~",
  "$HOME",
  "${HOME}",
])

const SQL_DESTRUCTIVE_KEYWORDS: Array<{ pattern: RegExp; name: string; level: RiskLevel; message: string }> = [
  { pattern: /\bdrop\s+(table|database|schema|index|view)\b/i, name: "sql-drop", level: "high", message: "SQL DROP statement is irreversible" },
  { pattern: /\btruncate\s+table\b/i, name: "sql-truncate", level: "high", message: "SQL TRUNCATE wipes all rows" },
  { pattern: /\bdelete\s+from\b(?![\s\S]*\bwhere\b)/i, name: "sql-delete-all", level: "high", message: "DELETE without WHERE affects every row" },
  { pattern: /\bdelete\s+from\b/i, name: "sql-delete", level: "medium", message: "DELETE FROM should be reviewed before execution" },
  { pattern: /\bupdate\s+\w+\s+set\b(?![\s\S]*\bwhere\b)/i, name: "sql-update-all", level: "high", message: "UPDATE without WHERE affects every row" },
]

function nodeText(node: BashParserNode | undefined): string {
  if (!node) return ""
  if (typeof node.text === "string") return node.text
  return ""
}

function collectCommands(root: BashParserNode): ExtractedCommand[] {
  const out: ExtractedCommand[] = []

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return
    const obj = node as BashParserNode
    if (obj.type === "Command" && obj.name) {
      const name = nodeText(obj.name)
      const args = Array.isArray(obj.suffix)
        ? obj.suffix.map((suffix) => nodeText(suffix)).filter((text) => text.length > 0)
        : []
      if (name) {
        out.push({
          name,
          args,
          raw: [name, ...args].join(" "),
        })
      }
    }
    for (const key of Object.keys(obj)) {
      const child = (obj as Record<string, unknown>)[key]
      if (Array.isArray(child)) {
        for (const item of child) visit(item)
      } else if (child && typeof child === "object") {
        visit(child)
      }
    }
  }

  visit(root)
  return out
}

function unwrapWrapper(cmd: ExtractedCommand): ExtractedCommand {
  if (!WRAPPER_COMMANDS.has(cmd.name.toLowerCase())) return cmd
  const flagsStripped = [...cmd.args]
  while (flagsStripped.length > 0) {
    const first = flagsStripped[0]
    if (first.startsWith("-") || /^[A-Z_][A-Z0-9_]*=/i.test(first)) {
      flagsStripped.shift()
      continue
    }
    break
  }
  const [innerName, ...innerArgs] = flagsStripped
  if (!innerName) return cmd
  return {
    name: innerName,
    args: innerArgs,
    raw: [innerName, ...innerArgs].join(" "),
  }
}

function hasFlag(args: string[], flags: string[]): boolean {
  for (const arg of args) {
    for (const flag of flags) {
      if (arg === flag) return true
      if (flag.length > 2 && arg.startsWith(flag)) return true
      if (flag.length === 2 && flag.startsWith("-") && !flag.startsWith("--")) {
        const letter = flag[1]
        if (arg.startsWith("-") && !arg.startsWith("--") && arg.includes(letter)) return true
      }
    }
  }
  return false
}

function argsContainCriticalPath(args: string[]): string | null {
  for (const arg of args) {
    const trimmed = arg.trim()
    if (!trimmed) continue
    if (CRITICAL_PATHS.has(trimmed)) return trimmed
    if (trimmed === "~/" || trimmed === "$HOME/" || trimmed === "${HOME}/") return trimmed
    if (/^\/[^/]*\*/.test(trimmed)) return trimmed
    if (trimmed === "." || trimmed === "./" || trimmed === "..") return trimmed
  }
  return null
}

function analyzeCommand(
  cmd: ExtractedCommand,
  options: AnalyzerOptions,
): RiskFinding[] {
  const findings: RiskFinding[] = []
  const unwrapped = unwrapWrapper(cmd)
  const name = unwrapped.name.toLowerCase()
  const extraBlocked = (options.extraBlockedCommands ?? []).map((entry) => entry.toLowerCase())
  const extraAllowed = new Set((options.extraAllowedCommands ?? []).map((entry) => entry.toLowerCase()))

  if (extraAllowed.has(name)) return findings

  if (ALWAYS_BLOCKED_COMMANDS[name]) {
    findings.push({
      level: "high",
      name: `always-blocked:${name}`,
      message: `${name}: ${ALWAYS_BLOCKED_COMMANDS[name]}`,
      command: unwrapped.raw,
    })
  }

  if (extraBlocked.includes(name)) {
    findings.push({
      level: "high",
      name: `user-blocked:${name}`,
      message: `${name} is in the user-defined blocked commands list`,
      command: unwrapped.raw,
    })
  }

  if (name === "rm") {
    const recursive = hasFlag(unwrapped.args, ["-r", "-R", "--recursive", "-rf", "-fr", "-Rf", "-fR"])
    const force = hasFlag(unwrapped.args, ["-f", "--force", "-rf", "-fr", "-Rf", "-fR"])
    const criticalPath = argsContainCriticalPath(unwrapped.args)
    if (recursive && force) {
      if (criticalPath) {
        findings.push({
          level: "high",
          name: "rm-rf-critical-path",
          message: `rm -rf targets critical path ${criticalPath}`,
          command: unwrapped.raw,
        })
      } else {
        findings.push({
          level: "high",
          name: "rm-rf",
          message: "rm -rf is irreversible",
          command: unwrapped.raw,
        })
      }
    } else if (recursive && criticalPath) {
      findings.push({
        level: "high",
        name: "rm-r-critical-path",
        message: `rm -r targets critical path ${criticalPath}`,
        command: unwrapped.raw,
      })
    }
  }

  if (name === "find") {
    const hasDelete = unwrapped.args.includes("-delete")
    const hasExec = unwrapped.args.some((arg) => arg === "-exec" || arg === "-execdir")
    if (hasDelete) {
      findings.push({
        level: "high",
        name: "find-delete",
        message: "find -delete removes files irreversibly",
        command: unwrapped.raw,
      })
    }
    if (hasExec) {
      const execIdx = unwrapped.args.findIndex((arg) => arg === "-exec" || arg === "-execdir")
      const target = unwrapped.args[execIdx + 1]?.toLowerCase() ?? ""
      if (target === "rm" || target === "/bin/rm" || target === "/usr/bin/rm") {
        findings.push({
          level: "high",
          name: "find-exec-rm",
          message: "find -exec rm runs deletion across matched files",
          command: unwrapped.raw,
        })
      }
    }
  }

  if (name === "git") {
    const sub = (unwrapped.args[0] ?? "").toLowerCase()
    if (sub === "push" && hasFlag(unwrapped.args, ["--force", "-f", "--force-with-lease"])) {
      findings.push({
        level: "high",
        name: "git-force-push",
        message: "git push --force rewrites remote history",
        command: unwrapped.raw,
      })
    }
    if (sub === "reset" && hasFlag(unwrapped.args, ["--hard"])) {
      findings.push({
        level: "high",
        name: "git-hard-reset",
        message: "git reset --hard discards local changes",
        command: unwrapped.raw,
      })
    }
    if (sub === "clean" && hasFlag(unwrapped.args, ["-f", "-fd", "-fdx", "-x", "-d"])) {
      findings.push({
        level: "high",
        name: "git-clean",
        message: "git clean -fdx removes untracked files including ignored",
        command: unwrapped.raw,
      })
    }
    if (sub === "checkout" && (unwrapped.args.includes(".") || unwrapped.args.includes("--"))) {
      findings.push({
        level: "medium",
        name: "git-checkout-discard",
        message: "git checkout . discards local uncommitted changes",
        command: unwrapped.raw,
      })
    }
    if (sub === "branch" && hasFlag(unwrapped.args, ["-D", "-d"])) {
      findings.push({
        level: "medium",
        name: "git-branch-delete",
        message: "git branch delete removes a local branch",
        command: unwrapped.raw,
      })
    }
  }

  if (name === "dd") {
    const ofTarget = unwrapped.args.find((arg) => arg.startsWith("of="))
    if (ofTarget) {
      const target = ofTarget.slice(3)
      if (target.startsWith("/dev/") && target !== "/dev/null" && target !== "/dev/stdout") {
        findings.push({
          level: "high",
          name: "dd-block-device",
          message: `dd writing to block device ${target}`,
          command: unwrapped.raw,
        })
      }
    }
  }

  if (name === "chmod" || name === "chown") {
    if (unwrapped.args.some((arg) => arg === "-R" || arg === "--recursive")) {
      const criticalPath = argsContainCriticalPath(unwrapped.args)
      if (criticalPath) {
        findings.push({
          level: "high",
          name: `${name}-recursive-critical`,
          message: `${name} -R targets critical path ${criticalPath}`,
          command: unwrapped.raw,
        })
      }
    }
    if (name === "chmod" && unwrapped.args.some((arg) => arg === "777" || arg === "-777")) {
      findings.push({
        level: "medium",
        name: "chmod-777",
        message: "chmod 777 grants world-writable permissions",
        command: unwrapped.raw,
      })
    }
  }

  if (name === "curl" || name === "wget") {
    // Detect pipe-to-shell pattern handled at pipeline level; here flag risky flags
    if (name === "curl" && unwrapped.args.some((arg) => arg === "-k" || arg === "--insecure")) {
      findings.push({
        level: "medium",
        name: "curl-insecure",
        message: "curl -k disables TLS verification",
        command: unwrapped.raw,
      })
    }
  }

  if (name === "npm" || name === "pnpm" || name === "yarn") {
    if (unwrapped.args[0] === "publish") {
      findings.push({
        level: "high",
        name: `${name}-publish`,
        message: `${name} publish releases a package to the registry`,
        command: unwrapped.raw,
      })
    }
  }

  if (name === "docker") {
    const sub = (unwrapped.args[0] ?? "").toLowerCase()
    if ((sub === "system" && unwrapped.args[1] === "prune") || sub === "volume" && unwrapped.args[1] === "prune") {
      findings.push({
        level: "high",
        name: "docker-prune",
        message: "docker prune removes containers/volumes irreversibly",
        command: unwrapped.raw,
      })
    }
    if (sub === "rmi" && hasFlag(unwrapped.args, ["-f", "--force"])) {
      findings.push({
        level: "medium",
        name: "docker-rmi-force",
        message: "docker rmi -f force-removes images",
        command: unwrapped.raw,
      })
    }
  }

  if (name === "kubectl") {
    const sub = (unwrapped.args[0] ?? "").toLowerCase()
    if (sub === "delete" && !unwrapped.args.includes("--dry-run=client") && !unwrapped.args.includes("--dry-run=server")) {
      findings.push({
        level: "high",
        name: "kubectl-delete",
        message: "kubectl delete removes cluster resources",
        command: unwrapped.raw,
      })
    }
  }

  if (name === "terraform") {
    const sub = (unwrapped.args[0] ?? "").toLowerCase()
    if (sub === "destroy" || sub === "apply") {
      const autoApprove = unwrapped.args.includes("-auto-approve") || unwrapped.args.includes("--auto-approve")
      if (autoApprove) {
        findings.push({
          level: "high",
          name: `terraform-${sub}-auto`,
          message: `terraform ${sub} -auto-approve bypasses human review`,
          command: unwrapped.raw,
        })
      }
    }
  }

  return findings
}

function analyzePipeToShell(source: string): RiskFinding[] {
  const findings: RiskFinding[] = []
  const pipeShellPattern = /\b(curl|wget|fetch)\b[^|;&]*\|\s*(sh|bash|zsh|fish|dash|ksh|python3?|perl|ruby|php|node)\b/i
  if (pipeShellPattern.test(source)) {
    findings.push({
      level: "high",
      name: "pipe-to-shell",
      message: "Piping remote content directly into an interpreter executes unverified code",
      command: source.trim(),
    })
  }
  const evalCurlPattern = /\beval\s+["`$(]*\s*(curl|wget)/i
  if (evalCurlPattern.test(source)) {
    findings.push({
      level: "high",
      name: "eval-remote",
      message: "eval of a fetched payload executes unverified code",
      command: source.trim(),
    })
  }
  return findings
}

function analyzeSql(source: string): RiskFinding[] {
  const findings: RiskFinding[] = []
  for (const rule of SQL_DESTRUCTIVE_KEYWORDS) {
    if (rule.pattern.test(source)) {
      findings.push({
        level: rule.level,
        name: rule.name,
        message: rule.message,
        command: source.trim(),
      })
    }
  }
  return findings
}

export function analyzeBashCommand(
  source: string,
  options: AnalyzerOptions = {},
): RiskFinding[] {
  const trimmed = source.trim()
  if (!trimmed) return []

  const findings: RiskFinding[] = []

  findings.push(...analyzePipeToShell(trimmed))
  findings.push(...analyzeSql(trimmed))

  let commands: ExtractedCommand[] = []
  try {
    const ast = parse(trimmed)
    commands = collectCommands(ast)
  } catch {
    commands = fallbackTokenize(trimmed)
  }

  for (const cmd of commands) {
    findings.push(...analyzeCommand(cmd, options))
  }

  return dedupe(findings)
}

function fallbackTokenize(source: string): ExtractedCommand[] {
  const statements = source.split(/[;&|]{1,2}/)
  const out: ExtractedCommand[] = []
  for (const statement of statements) {
    const tokens = statement
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0)
    if (tokens.length === 0) continue
    const [name, ...args] = tokens
    out.push({ name, args, raw: tokens.join(" ") })
  }
  return out
}

function dedupe(findings: RiskFinding[]): RiskFinding[] {
  const seen = new Set<string>()
  const out: RiskFinding[] = []
  for (const finding of findings) {
    const key = `${finding.level}|${finding.name}|${finding.command}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(finding)
  }
  return out
}

export function pickHighestFinding(findings: RiskFinding[]): RiskFinding | null {
  if (findings.length === 0) return null
  const order: Record<RiskLevel, number> = { high: 3, medium: 2, low: 1 }
  return [...findings].sort((a, b) => order[b.level] - order[a.level])[0]
}
