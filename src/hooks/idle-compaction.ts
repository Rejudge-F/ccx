import type { OhMyCCAgentConfig } from "../config/schema"

type SessionIdleState = {
  lastIdleTimestamp: number
  turnCount: number
  compactedAt: number
}

const sessionStates = new Map<string, SessionIdleState>()
const IDLE_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes
const MIN_TURNS_BEFORE_COMPACT = 10

function getIdleState(sessionID: string): SessionIdleState {
  const existing = sessionStates.get(sessionID)
  if (existing) return existing
  const state: SessionIdleState = {
    lastIdleTimestamp: 0,
    turnCount: 0,
    compactedAt: 0,
  }
  sessionStates.set(sessionID, state)
  return state
}

export function recordSessionIdle(sessionID: string) {
  const state = getIdleState(sessionID)
  state.lastIdleTimestamp = Date.now()
}

export function recordSessionTurn(sessionID: string) {
  getIdleState(sessionID).turnCount++
}

export function shouldCompactOnReturn(sessionID: string): boolean {
  const state = getIdleState(sessionID)
  if (state.lastIdleTimestamp === 0) return false
  if (state.turnCount < MIN_TURNS_BEFORE_COMPACT) return false

  const idleDuration = Date.now() - state.lastIdleTimestamp
  if (idleDuration < IDLE_THRESHOLD_MS) return false

  const turnsSinceCompact = state.turnCount - state.compactedAt
  return turnsSinceCompact >= MIN_TURNS_BEFORE_COMPACT
}

export function markCompacted(sessionID: string) {
  const state = getIdleState(sessionID)
  state.compactedAt = state.turnCount
}

export function createIdleCompactionHook(config: OhMyCCAgentConfig, client: unknown) {
  const typedClient = client as {
    session: {
      summarize: (options: { path: { id: string } }) => Promise<unknown>
    }
  }

  return {
    onEvent: async (event: { type: string; properties?: { sessionID?: string } }) => {
      if (!config.enabled) return
      if (event.type !== "session.idle") return

      const sessionID = event.properties?.sessionID
      if (!sessionID) return

      recordSessionIdle(sessionID)
    },

    onChatMessage: async (sessionID: string) => {
      if (!config.enabled) return
      if (!shouldCompactOnReturn(sessionID)) return

      try {
        await typedClient.session.summarize({ path: { id: sessionID } })
        markCompacted(sessionID)
      } catch {
        // summarize failed — not critical, skip silently
      }
    },
  }
}
