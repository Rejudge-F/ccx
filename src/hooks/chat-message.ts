import type { OhMyCCAgentConfig } from "../config/schema"
import { trackFileEdit } from "./dynamic-system-prompt"

type ChatMessageInput = {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
}

type ChatMessageOutput = {
  message: Record<string, unknown>
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
}

const EDIT_TOOLS = new Set(["edit", "write"])
const recentToolCalls = new Map<string, { tool: string; file?: string }[]>()

export function recordToolCall(sessionID: string, tool: string, file?: string) {
  const calls = recentToolCalls.get(sessionID) ?? []
  calls.push({ tool, file })
  if (calls.length > 50) calls.shift()
  recentToolCalls.set(sessionID, calls)
}

export function createChatMessageHook(config: OhMyCCAgentConfig) {
  return async (input: ChatMessageInput, output: ChatMessageOutput): Promise<void> => {
    if (!config.enabled) return

    const { sessionID, agent } = input
    if (!sessionID) return

    const calls = recentToolCalls.get(sessionID)
    if (calls && calls.length > 0) {
      const editedInRecent = calls
        .filter((c) => EDIT_TOOLS.has(c.tool) && c.file)
        .map((c) => c.file!)

      for (const file of editedInRecent) {
        trackFileEdit(sessionID, file)
      }
    }

    if (agent && !agent.startsWith("ccx")) return

    const reminders: string[] = []

    if (
      config.verification.auto_remind &&
      calls &&
      calls.filter((c) => EDIT_TOOLS.has(c.tool)).length >= config.verification.min_file_edits
    ) {
      reminders.push(
        `<system-reminder>You have made file edits. Remember the verification contract: run ccx-verification before declaring completion if you have 3+ file edits, backend/API changes, or infrastructure changes.</system-reminder>`,
      )
    }

    if (reminders.length > 0) {
      output.parts.push({
        type: "text",
        text: reminders.join("\n"),
        sessionID,
        messageID: input.messageID,
      })
    }
  }
}
