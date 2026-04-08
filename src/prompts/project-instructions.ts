import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve, sep } from "node:path"

import type { OhMyCCAgentConfig } from "../config/schema"

export type InstructionSource = {
  path: string
  origin: "global" | "project"
  content: string
}

const GLOBAL_DIR_RELATIVE = [".config", "opencode", "ccx"]
const GLOBAL_FILENAMES = ["CCX.md", "instructions.md", "CLAUDE.md"]

function safeReadText(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null
    const stat = statSync(filePath)
    if (!stat.isFile()) return null
    return readFileSync(filePath, "utf8").trim()
  } catch {
    return null
  }
}

function getHome(): string | null {
  try {
    const home = homedir()
    return home && home.length > 0 ? home : null
  } catch {
    return null
  }
}

function walkUpwards(startDir: string, maxDepth: number): string[] {
  const out: string[] = []
  const home = getHome()
  const root = resolve(startDir)
  let current = root
  let depth = 0

  while (depth < maxDepth) {
    out.push(current)
    if (home && current === home) break
    const parent = dirname(current)
    if (!parent || parent === current) break
    current = parent
    depth += 1
  }

  return out
}

function collectProjectInstructions(
  directory: string,
  filenames: string[],
  maxDepth: number,
): InstructionSource[] {
  if (!isAbsolute(directory)) return []
  const found: InstructionSource[] = []
  const seen = new Set<string>()

  const dirs = walkUpwards(directory, maxDepth)
  // Root-first ordering: more general → more specific (cwd last).
  dirs.reverse()

  for (const dir of dirs) {
    for (const name of filenames) {
      const candidate = join(dir, name)
      const resolved = resolve(candidate)
      if (seen.has(resolved)) continue
      seen.add(resolved)
      const content = safeReadText(resolved)
      if (!content) continue
      found.push({ path: resolved, origin: "project", content })
    }
  }

  return found
}

function collectGlobalInstructions(): InstructionSource[] {
  const home = getHome()
  if (!home) return []
  const globalDir = join(home, ...GLOBAL_DIR_RELATIVE)
  const found: InstructionSource[] = []
  const seen = new Set<string>()

  for (const name of GLOBAL_FILENAMES) {
    const candidate = join(globalDir, name)
    const resolved = resolve(candidate)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    const content = safeReadText(resolved)
    if (!content) continue
    found.push({ path: resolved, origin: "global", content })
  }

  // Backward-compat: also accept a single file at ~/.config/opencode/ccx.md
  if (found.length === 0) {
    const flat = join(home, ".config", "opencode", "ccx.md")
    const resolved = resolve(flat)
    if (!seen.has(resolved)) {
      const content = safeReadText(resolved)
      if (content) found.push({ path: resolved, origin: "global", content })
    }
  }

  return found
}

function describeRelativePath(path: string, directory: string): string {
  const normalizedDir = directory.endsWith(sep) ? directory : `${directory}${sep}`
  if (path.startsWith(normalizedDir)) return `./${path.slice(normalizedDir.length)}`
  return path
}

export type InstructionBundle = {
  sources: InstructionSource[]
  systemPromptSection: string | null
}

export function loadInstructionBundle(
  config: OhMyCCAgentConfig,
  directory: string,
): InstructionBundle {
  if (!config.project_instructions.enabled) {
    return { sources: [], systemPromptSection: null }
  }

  const sources: InstructionSource[] = []

  if (config.project_instructions.global_file) {
    sources.push(...collectGlobalInstructions())
  }

  if (config.project_instructions.recursive) {
    sources.push(
      ...collectProjectInstructions(
        directory,
        config.project_instructions.filenames,
        config.project_instructions.max_depth,
      ),
    )
  } else {
    // Non-recursive legacy behavior: only look in the current directory.
    const local = collectProjectInstructions(
      directory,
      config.project_instructions.filenames,
      1,
    )
    sources.push(...local)
  }

  if (sources.length === 0) return { sources: [], systemPromptSection: null }

  const budget = config.project_instructions.max_total_bytes
  const parts: string[] = []
  const accepted: InstructionSource[] = []
  let used = 0

  for (const source of sources) {
    const header = source.origin === "global"
      ? `## Global instructions (${source.path})`
      : `## Project instructions (${describeRelativePath(source.path, directory)})`
    const block = `${header}\n\n${source.content}`
    const blockBytes = Buffer.byteLength(block, "utf8")
    if (used + blockBytes > budget) {
      const remaining = budget - used
      if (remaining > 500) {
        const truncated = source.content.slice(0, Math.max(0, remaining - header.length - 200))
        parts.push(`${header}\n\n${truncated}\n\n... (truncated by ccx budget)`)
        accepted.push(source)
      }
      break
    }
    parts.push(block)
    accepted.push(source)
    used += blockBytes + 2
  }

  if (parts.length === 0) return { sources: [], systemPromptSection: null }

  const body = parts.join("\n\n---\n\n")
  const intro = accepted.length === 1
    ? "The following project instructions were found and MUST be followed:"
    : `The following ${accepted.length} instruction files were discovered. Later entries are more specific to the current working directory and take precedence when rules conflict:`

  return {
    sources: accepted,
    systemPromptSection: `# Project Instructions\n\n${intro}\n\n${body}`,
  }
}
