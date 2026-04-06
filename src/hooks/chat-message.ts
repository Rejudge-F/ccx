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

export function createChatMessageHook(_config: OhMyCCAgentConfig) {
  return async (input: ChatMessageInput, _output: ChatMessageOutput): Promise<void> => {
    if (!_config.enabled) return

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
  }
}
