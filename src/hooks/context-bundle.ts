import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { OhMyCCAgentConfig } from "../config/schema"
import { getGitSnapshotSection } from "./git-context"

const execFileAsync = promisify(execFile)

const TASK_TOOL_NAMES = new Set(["task"])
const BUNDLE_MARKER_BEGIN = "<ccx-context-bundle>"
const BUNDLE_MARKER_END = "</ccx-context-bundle>"
const MAX_LIST_CHARS = 1500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function pickPromptFieldName(args: Record<string, unknown>): string | null {
  for (const key of ["message", "prompt", "task", "instruction"]) {
    if (typeof args[key] === "string") return key
  }
  return null
}

async function listRecentFiles(cwd: string, max: number): Promise<string> {
  if (max <= 0) return ""
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["--no-optional-locks", "ls-files", "--modified", "--others", "--exclude-standard"],
      { cwd, timeout: 5_000, maxBuffer: 1024 * 1024 },
    )
    const files = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, max)
    if (files.length === 0) return ""
    const joined = files.join("\n")
    return joined.length > MAX_LIST_CHARS
      ? `${joined.slice(0, MAX_LIST_CHARS)}\n... (truncated)`
      : joined
  } catch {
    return ""
  }
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

    if (bundleConfig.include_cwd) {
      bundleParts.push(`Working directory: ${directory}`)
    }

    if (bundleConfig.include_git) {
      const sessionID = typeof input.sessionID === "string" ? input.sessionID : undefined
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
    }
    output.metadata = metadata
  }
}
