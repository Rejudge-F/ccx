import type { OhMyCCAgentConfig } from "../config/schema"

type SessionState = {
  editedFiles: Set<string>
}

const sessionStateById = new Map<string, SessionState>()
const EDIT_TOOL_NAMES = new Set(["edit", "write"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getSessionState(sessionID: string): SessionState {
  const existing = sessionStateById.get(sessionID)
  if (existing) {
    return existing
  }

  const created = {
    editedFiles: new Set<string>(),
  }
  sessionStateById.set(sessionID, created)
  return created
}

function getFilePath(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const candidates = [value.filePath, value.path, value.filename]
  return candidates.find((candidate): candidate is string => typeof candidate === "string")
}

export function createVerificationReminder(config: OhMyCCAgentConfig) {
  return async (input: unknown, _output: unknown): Promise<void> => {
    if (!config.verification.auto_remind || !isRecord(input)) {
      return
    }

    const sessionID = typeof input.sessionID === "string" ? input.sessionID : undefined
    const toolName = typeof input.tool === "string" ? input.tool.toLowerCase() : undefined
    if (!sessionID || !toolName || !EDIT_TOOL_NAMES.has(toolName)) {
      return
    }

    const filePath = getFilePath(input.args)
    if (!filePath) {
      return
    }

    const state = getSessionState(sessionID)
    state.editedFiles.add(filePath)
  }
}
