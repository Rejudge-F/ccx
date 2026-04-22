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

const sessionAgentById = new Map<string, string>()

export function getSessionAgent(sessionID: string): string | undefined {
  return sessionAgentById.get(sessionID)
}

export function createChatMessageHook(_config: OhMyCCAgentConfig) {
  return async (input: ChatMessageInput, _output: ChatMessageOutput): Promise<void> => {
    if (!_config.enabled) return

    const { sessionID, agent } = input
    if (!sessionID) return

    if (agent) {
      sessionAgentById.set(sessionID, agent)
    }

    if (agent && !agent.startsWith(_config.agent_name)) return
  }
}
