import { existsSync } from "node:fs"
import { join } from "node:path"

type EnvironmentContextValue = {
  cwd: string
  isGit: boolean
  platform: string
  shell: string
}

type SessionCreatedEvent = {
  type?: string
  sessionID?: string
  sessionId?: string
}

const environmentBySession = new Map<string, EnvironmentContextValue>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function getEnvironmentContext(sessionID: string): EnvironmentContextValue | undefined {
  return environmentBySession.get(sessionID)
}

export function createEnvironmentContext(directory: string) {
  return async (input: unknown, output: unknown): Promise<void> => {
    if (!isRecord(input) || !isRecord(output)) {
      return
    }

    const rawEvent = input.event
    if (!isRecord(rawEvent) || rawEvent.type !== "session.created") {
      return
    }

    const event = rawEvent as SessionCreatedEvent
    const sessionID = typeof event.sessionID === "string"
      ? event.sessionID
      : typeof event.sessionId === "string"
        ? event.sessionId
        : undefined

    const environment = {
      cwd: directory,
      isGit: existsSync(join(directory, ".git")),
      platform: process.platform,
      shell: process.env.SHELL ?? "unknown",
    }

    if (sessionID) {
      environmentBySession.set(sessionID, environment)
    }

    const existingContext = isRecord(output.context) ? output.context : {}
    existingContext.environment = environment
    output.context = existingContext
  }
}
