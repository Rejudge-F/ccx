import type { OhMyCCAgentConfig } from "../config/schema"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

type SessionDynamicState = {
  editedFiles: Set<string>
  verificationTriggered: boolean
  turnCount: number
}

const sessionStates = new Map<string, SessionDynamicState>()

function getState(sessionID: string): SessionDynamicState {
  const existing = sessionStates.get(sessionID)
  if (existing) return existing
  const state: SessionDynamicState = {
    editedFiles: new Set(),
    verificationTriggered: false,
    turnCount: 0,
  }
  sessionStates.set(sessionID, state)
  return state
}

export function trackFileEdit(sessionID: string, filePath: string) {
  getState(sessionID).editedFiles.add(filePath)
}

export function markVerificationTriggered(sessionID: string) {
  getState(sessionID).verificationTriggered = true
}

function loadProjectInstructions(directory: string): string | null {
  const candidates = ["CLAUDE.md", ".claude/instructions.md", "AGENTS.md"]
  for (const name of candidates) {
    const fullPath = join(directory, name)
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8").trim()
        if (content) return content
      } catch {
        continue
      }
    }
  }
  return null
}

export function createDynamicSystemPrompt(config: OhMyCCAgentConfig, directory: string) {
  const projectInstructions = loadProjectInstructions(directory)

  return async (
    input: { sessionID?: string; model: unknown },
    output: { system: string[] },
  ): Promise<void> => {
    if (!config.enabled) return

    const sessionID = input.sessionID

    if (projectInstructions) {
      output.system.push(`# Project Instructions\n\nThe following instructions were found in the project root and MUST be followed:\n\n${projectInstructions}`)
    }

    if (sessionID) {
      const state = getState(sessionID)
      state.turnCount++

      if (state.editedFiles.size > 0) {
        const fileList = [...state.editedFiles].slice(-20).join(", ")
        output.system.push(`# Session Context\n\nFiles edited in this session (${state.editedFiles.size} total): ${fileList}`)
      }

      if (
        config.verification.auto_remind &&
        state.editedFiles.size >= config.verification.min_file_edits &&
        !state.verificationTriggered
      ) {
        output.system.push(`# Verification Reminder\n\nYou have edited ${state.editedFiles.size} files in this session. You MUST run verification (via ccx-verification subagent) before declaring the task complete. This is not optional.`)
      }
    }
  }
}
