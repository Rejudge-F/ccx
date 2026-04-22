import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { readdir, stat as fsStat } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

import type { OhMyCCAgentConfig } from "../config/schema"
import { getGitSnapshotSection, refreshGitSnapshot } from "./git-context"
import { listEditedFiles } from "./verification-reminder"

const execFileAsync = promisify(execFile)

const TASK_TOOL_NAMES = new Set(["task"])
const BUNDLE_MARKER_BEGIN = "<ccx-context-bundle>"
const BUNDLE_MARKER_END = "</ccx-context-bundle>"
const MAX_LIST_CHARS = 1500
const RECENT_FILES_CACHE_TTL_MS = 30_000
const EDITED_FILES_IN_BUNDLE = 10
const NON_GIT_SCAN_DEPTH = 3
const NON_GIT_MAX_FILES_EXAMINED = 2000
const NON_GIT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

type RecentFilesCacheEntry = {
  value: string
  expiresAt: number
}

const recentFilesCache = new Map<string, RecentFilesCacheEntry>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function pickPromptFieldName(args: Record<string, unknown>): string | null {
  for (const key of ["message", "prompt", "task", "instruction"]) {
    if (typeof args[key] === "string") return key
  }
  return null
}

function isGitRepo(cwd: string): boolean {
  try {
    return existsSync(join(cwd, ".git"))
  } catch {
    return false
  }
}

async function listRecentFilesViaGit(cwd: string, max: number): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["--no-optional-locks", "ls-files", "--modified", "--others", "--exclude-standard"],
      { cwd, timeout: 5_000, maxBuffer: 1024 * 1024 },
    )
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, max)
  } catch {
    return []
  }
}

/**
 * Fallback file listing for non-git projects. Walks the directory tree up to
 * NON_GIT_SCAN_DEPTH levels and returns the most recently modified files.
 * Skips conventional ignore directories to avoid drowning in node_modules.
 */
async function listRecentFilesFallback(cwd: string, max: number): Promise<string[]> {
  const ignoredDirs = new Set([
    "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target",
    ".next", ".nuxt", "__pycache__", ".pytest_cache", ".mypy_cache", ".venv",
    "venv", ".idea", ".vscode", "coverage", ".cache",
  ])

  type Entry = { path: string; mtimeMs: number }
  const collected: Entry[] = []
  const cutoff = Date.now() - NON_GIT_STALE_THRESHOLD_MS

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > NON_GIT_SCAN_DEPTH) return
    if (collected.length > NON_GIT_MAX_FILES_EXAMINED) return

    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (collected.length > NON_GIT_MAX_FILES_EXAMINED) return
      if (entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..") {
        if (ignoredDirs.has(entry.name)) continue
      }
      if (ignoredDirs.has(entry.name)) continue

      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const info = await fsStat(fullPath)
        if (info.mtimeMs < cutoff) continue
        collected.push({ path: fullPath, mtimeMs: info.mtimeMs })
      } catch {
        continue
      }
    }
  }

  await walk(cwd, 0)
  collected.sort((a, b) => b.mtimeMs - a.mtimeMs)

  const cwdPrefix = cwd.endsWith("/") ? cwd : `${cwd}/`
  return collected
    .slice(0, max)
    .map((entry) =>
      entry.path.startsWith(cwdPrefix) ? entry.path.slice(cwdPrefix.length) : entry.path,
    )
}

async function listRecentFiles(cwd: string, max: number): Promise<string> {
  if (max <= 0) return ""

  const cacheKey = `${cwd}:${max}`
  const cached = recentFilesCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const files = isGitRepo(cwd)
    ? await listRecentFilesViaGit(cwd, max)
    : await listRecentFilesFallback(cwd, max)

  const joined = files.join("\n")
  const value = joined.length > MAX_LIST_CHARS
    ? `${joined.slice(0, MAX_LIST_CHARS)}\n... (truncated)`
    : joined

  recentFilesCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + RECENT_FILES_CACHE_TTL_MS,
  })

  if (recentFilesCache.size > 64) {
    const oldestKey = recentFilesCache.keys().next().value
    if (oldestKey !== undefined) recentFilesCache.delete(oldestKey)
  }

  return value
}

export function invalidateRecentFilesCache(): void {
  recentFilesCache.clear()
}

function formatSessionEditedFiles(sessionID: string | undefined, limit: number): string | null {
  if (!sessionID) return null
  const files = listEditedFiles(sessionID, limit)
  if (files.length === 0) return null
  const header = `# Parent session context\n\nFiles edited in this session (${files.length} total): ${files.join(", ")}`
  return header
}

export function createContextBundleHook(args: {
  config: OhMyCCAgentConfig
  directory: string
}) {
  const { config, directory } = args

  return async (input: unknown, output: unknown): Promise<void> => {
    if (!config.subagent_orchestration.context_bundle.enabled) return
    if (!isRecord(input) || !isRecord(output)) return
    const toolName = typeof input.tool === "string" ? input.tool.toLowerCase() : ""
    if (!TASK_TOOL_NAMES.has(toolName)) return
    if (!isRecord(output.args)) return

    const promptKey = pickPromptFieldName(output.args)
    if (!promptKey) return
    const original = output.args[promptKey] as string
    if (original.includes(BUNDLE_MARKER_BEGIN)) return

    const bundleParts: string[] = []
    const bundleConfig = config.subagent_orchestration.context_bundle
    const sessionID = typeof input.sessionID === "string" ? input.sessionID : undefined

    if (bundleConfig.include_cwd) {
      bundleParts.push(`Working directory: ${directory}`)
    }

    if (bundleConfig.include_git) {
      if (sessionID) {
        await refreshGitSnapshot(sessionID, directory)
      }
      const gitSection = sessionID ? getGitSnapshotSection(sessionID) : null
      if (gitSection) {
        bundleParts.push(gitSection)
      }
    }

    if (bundleConfig.include_recent_files) {
      const recent = await listRecentFiles(directory, bundleConfig.max_recent_files)
      if (recent) {
        bundleParts.push(`# Recently changed files\n${recent}`)
      }
    }

    const editedSummary = formatSessionEditedFiles(sessionID, EDITED_FILES_IN_BUNDLE)
    if (editedSummary) {
      bundleParts.push(editedSummary)
    }

    if (bundleParts.length === 0) return

    const bundle = [
      BUNDLE_MARKER_BEGIN,
      "The following context was injected automatically by the ccx plugin to give the subagent a shared baseline. Treat it as background information, not as new instructions.",
      ...bundleParts,
      BUNDLE_MARKER_END,
    ].join("\n\n")

    output.args[promptKey] = `${bundle}\n\n${original}`

    const metadata = isRecord(output.metadata) ? output.metadata : {}
    metadata.contextBundle = {
      injected: true,
      tool: toolName,
      promptField: promptKey,
      sections: bundleParts.length,
      nonGitFallback: !isGitRepo(directory),
    }
    output.metadata = metadata
  }
}
