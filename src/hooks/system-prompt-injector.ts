import type { OhMyCCAgentConfig } from "../config/schema"

import { composeSystemPrompt } from "../prompts/compose"
import { getEnvironmentContext } from "./environment-context"

type TextPart = { type: string; text?: string; [key: string]: unknown }
type ChatMessageOutput = {
  message?: Record<string, unknown>
  parts?: TextPart[]
}

const SECTION_PATTERNS = {
  "intro": "You are an interactive agent",
  "system": "# System",
  "doing-tasks": "# Doing tasks",
  "actions": "# Executing actions with care",
  "using-tools": "# Using your tools",
  "tone-style": "# Tone and style",
  "output-efficiency": "# Output efficiency",
  "environment": "# Environment",
} satisfies Record<string, string>

const initializedSessions = new Set<string>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getTextParts(output: ChatMessageOutput): TextPart[] {
  if (!Array.isArray(output.parts)) {
    output.parts = []
  }
  return output.parts
}

function filterSections(sections: string[], disabledSections: string[]): string[] {
  const disabled = new Set(disabledSections)
  return sections.filter((section) => {
    const matchingEntry = Object.entries(SECTION_PATTERNS).find(([, marker]) =>
      section.startsWith(marker),
    )
    if (!matchingEntry) {
      return true
    }
    return !disabled.has(matchingEntry[0])
  })
}

function prependInstruction(parts: TextPart[], instruction: string): void {
  if (instruction.trim().length === 0) {
    return
  }

  const firstPart = parts[0]
  if (firstPart?.type === "text" && typeof firstPart.text === "string") {
    firstPart.text = `${instruction}\n\n${firstPart.text}`
    return
  }

  parts.unshift({ type: "text", text: instruction })
}

export function createSystemPromptInjector(config: OhMyCCAgentConfig) {
  return async (input: unknown, output: unknown): Promise<void> => {
    if (!isRecord(input) || !isRecord(output)) {
      return
    }

    const sessionID = typeof input.sessionID === "string" ? input.sessionID : undefined
    if (!sessionID || initializedSessions.has(sessionID)) {
      return
    }

    initializedSessions.add(sessionID)
    if (!config.enabled || config.disabled_hooks.includes("system-prompt-injector")) {
      return
    }

    const environment = getEnvironmentContext(sessionID)
    if (!environment) {
      return
    }

    const instruction = filterSections(
      composeSystemPrompt({
        env: environment,
        outputStyle: config.output_style ?? undefined,
        toolNames: {
          bash: "bash",
          read: "read",
          edit: "edit",
          write: "write",
          glob: "glob",
          grep: "grep",
        },
      }),
      config.disabled_sections,
    ).join("\n\n")

    if (config.verification.auto_remind) {
      const minFileEdits = config.verification.min_file_edits
      const reminder = `# Verification\n - Verify changed code before claiming completion.\n - When you edit ${minFileEdits} or more files, explicitly report what you checked.`
      prependInstruction(getTextParts(output), `${instruction}\n\n${reminder}`)
      return
    }

    prependInstruction(getTextParts(output), instruction)
  }
}
