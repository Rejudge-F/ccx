import type { OhMyCCAgentConfig } from "../config/schema"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getGitSnapshotSection } from "./git-context"
import { getVerificationState, listEditedFiles, requiresVerification } from "./verification-reminder"
import { createPromptSection, resolvePromptSections } from "../prompts/section-registry"

function loadProjectInstructions(directory: string): string | null {
  const candidates = ["CLAUDE.md", ".claude/instructions.md", "AGENTS.md"]
  for (const name of candidates) {
    const fullPath = join(directory, name)
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8").trim()
        if (content) return content
      } catch {
        continue
      }
    }
  }
  return null
}

export function createDynamicSystemPrompt(config: OhMyCCAgentConfig, directory: string) {
  const projectInstructions = loadProjectInstructions(directory)

  return async (
    input: { sessionID?: string; model: unknown },
    output: { system: string[] },
  ): Promise<void> => {
    if (!config.enabled) return

    const sessionID = input.sessionID

    const sections = [
      createPromptSection({
        id: "project-instructions",
        kind: "dynamic",
        resolve: () => {
          if (!projectInstructions) return null
          return `# Project Instructions\n\nThe following instructions were found in the project root and MUST be followed:\n\n${projectInstructions}`
        },
      }),
      createPromptSection({
        id: "git-context",
        kind: "dynamic",
        resolve: () => {
          if (!sessionID) return null
          return getGitSnapshotSection(sessionID)
        },
      }),
      createPromptSection({
        id: "session-context",
        kind: "dynamic",
        resolve: () => {
          if (!sessionID) return null
          const { editedFilesCount } = getVerificationState(sessionID)
          if (editedFilesCount === 0) return null
          const editedFiles = listEditedFiles(sessionID, 20)
          const suffix = editedFilesCount > editedFiles.length
            ? `, ... and ${editedFilesCount - editedFiles.length} more`
            : ""
          return `# Session Context\n\nFiles edited in this session (${editedFilesCount} total): ${editedFiles.join(", ")}${suffix}`
        },
      }),
      createPromptSection({
        id: "verification-reminder",
        kind: "dynamic",
        resolve: () => {
          if (!sessionID) return null
          if (!config.verification.auto_remind) return null
          if (!requiresVerification(sessionID, config.verification.min_file_edits)) {
            return null
          }
          const { editedFilesCount } = getVerificationState(sessionID)
          return `# Verification Reminder\n\nYou have edited ${editedFilesCount} files in this session. It is recommended to run verification (via ccx-verification subagent) before declaring the task complete.`
        },
      }),
    ]

    const dynamicSections = await resolvePromptSections({
      sections,
      kind: "dynamic",
      disabledSectionIDs: config.disabled_sections,
    })

    output.system.push(...dynamicSections)
  }
}
