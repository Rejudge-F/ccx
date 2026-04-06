import type { OhMyCCAgentConfig } from "../config/schema"

type SessionState = {
  editedFiles: Set<string>
  verificationTriggered: boolean
}

const sessionStateById = new Map<string, SessionState>()
const EDIT_TOOL_NAMES = new Set(["edit", "write"])
const TASK_TOOL_NAMES = new Set(["task", "taskcreate", "task_create"])

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
    verificationTriggered: false,
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
    if (!sessionID || !toolName) {
      return
    }

    if (TASK_TOOL_NAMES.has(toolName)) {
      const rawArgs = isRecord(input.args) ? input.args : {}
      const subagentType = typeof rawArgs.subagent_type === "string"
        ? rawArgs.subagent_type.toLowerCase()
        : typeof rawArgs.subagentType === "string"
          ? rawArgs.subagentType.toLowerCase()
          : ""
      if (subagentType === "ccx-verification" || subagentType === "verification") {
        getSessionState(sessionID).verificationTriggered = true
      }
      return
    }

    if (!EDIT_TOOL_NAMES.has(toolName)) {
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

export function getVerificationState(sessionID: string): {
  editedFilesCount: number
  verificationTriggered: boolean
} {
  const state = getSessionState(sessionID)
  return {
    editedFilesCount: state.editedFiles.size,
    verificationTriggered: state.verificationTriggered,
  }
}

export function listEditedFiles(sessionID: string, limit = 20): string[] {
  const state = getSessionState(sessionID)
  return [...state.editedFiles].slice(-limit)
}

export function requiresVerification(
  sessionID: string,
  minFileEdits: number,
): boolean {
  const state = getSessionState(sessionID)
  return state.editedFiles.size >= minFileEdits && !state.verificationTriggered
}
