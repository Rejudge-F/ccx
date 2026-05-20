import type { OhMyCCAgentConfig } from "../config/schema"

type SessionState = {
  editedFiles: Set<string>
  dirtyFiles: Set<string>
  verificationBaselines: VerificationBaseline[]
  verificationTriggered: boolean
}

type VerificationBaseline = {
  files: string[]
  createdAt: number
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
    dirtyFiles: new Set<string>(),
    verificationBaselines: [],
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
    if (!config.verification.enforce_contract || !config.verification.auto_remind || !isRecord(input)) {
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
      const verificationSubagent = `${config.agent_name}-verification`
      if (subagentType === verificationSubagent || subagentType === "verification") {
        markVerificationStarted(sessionID)
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
    state.dirtyFiles.add(filePath)
  }
}

export function getVerificationState(sessionID: string): {
  editedFilesCount: number
  dirtyFilesCount: number
  verificationTriggered: boolean
} {
  const state = getSessionState(sessionID)
  return {
    editedFilesCount: state.editedFiles.size,
    dirtyFilesCount: state.dirtyFiles.size,
    verificationTriggered: state.verificationTriggered,
  }
}

export function listEditedFiles(sessionID: string, limit = 20): string[] {
  const state = getSessionState(sessionID)
  return [...state.editedFiles].slice(-limit)
}

export function listDirtyFiles(sessionID: string, limit = 20): string[] {
  const state = getSessionState(sessionID)
  return [...state.dirtyFiles].slice(-limit)
}

export function markVerificationStarted(sessionID: string): void {
  const state = getSessionState(sessionID)
  state.verificationTriggered = true

  const files = [...state.dirtyFiles]
  if (files.length === 0) return

  state.verificationBaselines.push({
    files,
    createdAt: Date.now(),
  })
  state.dirtyFiles.clear()

  if (state.verificationBaselines.length > 5) {
    state.verificationBaselines = state.verificationBaselines.slice(-5)
  }
}

export function getIncrementalVerificationContext(sessionID: string): string | null {
  const state = getSessionState(sessionID)
  const dirtyFiles = [...state.dirtyFiles]
  const previousBaselines = state.verificationBaselines.slice(-3)
  if (dirtyFiles.length === 0 && previousBaselines.length === 0) return null

  const lines = [
    "# Incremental Verification Context",
    "Use this to avoid rerunning unrelated full verification. Reuse previous conclusions only when the affected files and commands are unchanged; run fresh checks for dirty files and their dependencies.",
  ]

  if (dirtyFiles.length > 0) {
    lines.push("", `Dirty files since last verification (${dirtyFiles.length}):`, ...dirtyFiles.map((file) => `- ${file}`))
  } else {
    lines.push("", "Dirty files since last verification: none tracked.")
  }

  if (previousBaselines.length > 0) {
    lines.push("", "Previous verification baselines in this session:")
    for (const baseline of previousBaselines) {
      lines.push(
        `- ${new Date(baseline.createdAt).toISOString()}: ${baseline.files.join(", ")}`,
      )
    }
  }

  return lines.join("\n")
}

export function requiresVerification(
  sessionID: string,
  minFileEdits: number,
): boolean {
  const state = getSessionState(sessionID)
  return state.editedFiles.size >= minFileEdits && !state.verificationTriggered
}
