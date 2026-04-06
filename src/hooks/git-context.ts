import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const MAX_STATUS_CHARS = 2000

type GitSnapshot = {
  branch: string
  mainBranch: string
  status: string
  recentCommits: string
}

const snapshotBySession = new Map<string, GitSnapshot>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}

async function resolveDefaultBranch(cwd: string): Promise<string> {
  try {
    const symbolic = await runGit(cwd, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "--short",
    ])
    const parts = symbolic.split("/")
    return parts[parts.length - 1] || "main"
  } catch {
    return "main"
  }
}

export function getGitSnapshotSection(sessionID: string): string | null {
  const snapshot = snapshotBySession.get(sessionID)
  if (!snapshot) return null
  return [
    "# Git Context",
    "This is a snapshot at the start of the session and may be stale now.",
    `Current branch: ${snapshot.branch}`,
    `Main branch: ${snapshot.mainBranch}`,
    `Status:\n${snapshot.status || "(clean)"}`,
    `Recent commits:\n${snapshot.recentCommits || "(none)"}`,
  ].join("\n\n")
}

export function createGitContextHook(directory: string) {
  return async (input: unknown, _output: unknown): Promise<void> => {
    if (!isRecord(input)) return
    const rawEvent = input.event
    if (!isRecord(rawEvent) || rawEvent.type !== "session.created") return

    const sessionID = typeof rawEvent.sessionID === "string"
      ? rawEvent.sessionID
      : typeof rawEvent.sessionId === "string"
        ? rawEvent.sessionId
        : undefined
    if (!sessionID || snapshotBySession.has(sessionID)) return

    try {
      const [branch, mainBranch, statusRaw, recentCommits] = await Promise.all([
        runGit(directory, ["rev-parse", "--abbrev-ref", "HEAD"]),
        resolveDefaultBranch(directory),
        runGit(directory, ["--no-optional-locks", "status", "--short"]),
        runGit(directory, ["--no-optional-locks", "log", "--oneline", "-n", "5"]),
      ])

      const status = statusRaw.length > MAX_STATUS_CHARS
        ? `${statusRaw.slice(0, MAX_STATUS_CHARS)}\n... (truncated because it exceeds 2k characters)`
        : statusRaw

      snapshotBySession.set(sessionID, {
        branch,
        mainBranch,
        status,
        recentCommits,
      })
    } catch {
      // ignore git snapshot failures
    }
  }
}
