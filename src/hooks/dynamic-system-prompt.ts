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
          const verifierName = `${config.agent_name}-verification`
          return `# Verification Reminder (CONTRACT — YOU OWN THE GATE)

You have edited ${editedFilesCount} file(s) in this session. Per the verification contract, an independent adversarial review MUST occur before you report the task complete.

Action required:
- Launch the **task** tool with subagent_type \`${verifierName}\`. Supply the ORIGINAL user request, the list of changed files, and the implementation approach.
- Your own checks do NOT substitute for the verifier. You may not self-assign PASS, FAIL, or PARTIAL.
- On **FAIL**: fix the issue, then resume the verifier with the details of your fix. Iterate until PASS.
- On **PASS**: spot-check the report — re-run at least ${spotCheckMinCommands} command(s) from the verifier's report and confirm the output matches. If any PASS check lacks a "Command run" block, or the output diverges on replay, resume the verifier with the discrepancy. Do not skip the spot-check.
- On **PARTIAL**: report what passed and what could not be verified, with reasons.

Do NOT report completion to the user without going through this gate.`
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
