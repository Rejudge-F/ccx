const MAX_SESSIONS_TRACKED = 256

const sessionAgentById = new Map<string, string>()

function touch(sessionID: string, agent: string): void {
  if (sessionAgentById.has(sessionID)) {
    sessionAgentById.delete(sessionID)
  }
  sessionAgentById.set(sessionID, agent)

  if (sessionAgentById.size > MAX_SESSIONS_TRACKED) {
    const oldestKey = sessionAgentById.keys().next().value
    if (oldestKey !== undefined) {
      sessionAgentById.delete(oldestKey)
    }
  }
}

export function recordSessionAgent(sessionID: string, agent: string | undefined): void {
  if (!sessionID || !agent) return
  touch(sessionID, agent)
}

export function getSessionAgent(sessionID: string): string | undefined {
  return sessionAgentById.get(sessionID)
}

type ChatMessageInput = {
  sessionID?: string
  agent?: string
}

export function createSessionAgentTracker() {
  return async (input: ChatMessageInput, _output: unknown): Promise<void> => {
    if (!input?.sessionID || !input.agent) return
    recordSessionAgent(input.sessionID, input.agent)
  }
}
