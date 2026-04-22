import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const MAX_STATUS_CHARS = 2000
const SNAPSHOT_TTL_MS = 15_000

type GitSnapshot = {
  branch: string
  mainBranch: string
  status: string
  recentCommits: string
  capturedAt: number
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

async function captureSnapshot(cwd: string): Promise<GitSnapshot | null> {
  try {
    const [branch, mainBranch, statusRaw, recentCommits] = await Promise.all([
      runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
      resolveDefaultBranch(cwd),
      runGit(cwd, ["--no-optional-locks", "status", "--short"]),
      runGit(cwd, ["--no-optional-locks", "log", "--oneline", "-n", "5"]),
    ])

    const status = statusRaw.length > MAX_STATUS_CHARS
      ? `${statusRaw.slice(0, MAX_STATUS_CHARS)}\n... (truncated because it exceeds 2k characters)`
      : statusRaw

    return {
      branch,
      mainBranch,
      status,
      recentCommits,
      capturedAt: Date.now(),
    }
  } catch {
    return null
  }
}

function formatSnapshot(snapshot: GitSnapshot): string {
  const ageSeconds = Math.max(0, Math.round((Date.now() - snapshot.capturedAt) / 1000))
  const freshnessNote = ageSeconds <= 30
    ? "Fresh snapshot."
    : `Snapshot captured ${ageSeconds}s ago — may be slightly stale.`

  return [
    "# Git Context",
    freshnessNote,
    `Current branch: ${snapshot.branch}`,
    `Main branch: ${snapshot.mainBranch}`,
    `Status:\n${snapshot.status || "(clean)"}`,
    `Recent commits:\n${snapshot.recentCommits || "(none)"}`,
  ].join("\n\n")
}

export function getGitSnapshotSection(sessionID: string): string | null {
  const snapshot = snapshotBySession.get(sessionID)
  if (!snapshot) return null
  return formatSnapshot(snapshot)
}

/**
 * Refresh the git snapshot for a session if it's older than SNAPSHOT_TTL_MS.
 * Called lazily from context-bundle so subagents see current git state rather
 * than a stale session.created snapshot from hours ago.
 */
export async function refreshGitSnapshot(
  sessionID: string,
  cwd: string,
): Promise<void> {
  const existing = snapshotBySession.get(sessionID)
  if (existing && Date.now() - existing.capturedAt < SNAPSHOT_TTL_MS) {
    return
  }
  const refreshed = await captureSnapshot(cwd)
  if (refreshed) {
    snapshotBySession.set(sessionID, refreshed)
  }
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

    const snapshot = await captureSnapshot(directory)
    if (snapshot) {
      snapshotBySession.set(sessionID, snapshot)
    }
  }
}
