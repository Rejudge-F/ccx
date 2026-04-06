import type { OhMyCCAgentConfig } from "../config/schema"

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

export function createChatMessageHook(_config: OhMyCCAgentConfig) {
  return async (input: ChatMessageInput, _output: ChatMessageOutput): Promise<void> => {
    if (!_config.enabled) return

    const { sessionID, agent } = input
    if (!sessionID) return

    if (agent && !agent.startsWith("ccx")) return
  }
}
