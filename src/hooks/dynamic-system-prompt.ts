import type { OhMyCCAgentConfig } from "../config/schema"
import { loadInstructionBundle } from "../prompts/project-instructions"
import { getGitSnapshotSection } from "./git-context"
import { getVerificationState, listEditedFiles, requiresVerification } from "./verification-reminder"
import { createPromptSection, resolvePromptSections } from "../prompts/section-registry"

export function createDynamicSystemPrompt(config: OhMyCCAgentConfig, directory: string) {
  const instructionBundle = loadInstructionBundle(config, directory)

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
        resolve: () => instructionBundle.systemPromptSection ?? null,
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
          if (!config.verification.enforce_contract || !config.verification.auto_remind) return null
          if (!requiresVerification(sessionID, config.verification.min_file_edits)) {
            return null
          }
          const { editedFilesCount } = getVerificationState(sessionID)
          const spotCheckMinCommands = config.verification.spot_check_min_commands
          return `# Verification Reminder\n\nYou have edited ${editedFilesCount} files in this session. It is recommended to run verification (via ${config.agent_name}-verification subagent) before declaring the task complete. If verifier returns PASS, you must re-run at least ${spotCheckMinCommands} commands from the verifier report and confirm outputs match before reporting completion.`
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
