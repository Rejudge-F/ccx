import type { OhMyCCAgentConfig } from "../config/schema"
import {
  createBgTask,
  formatBgTaskLine,
  getBgTask,
  listBgTasksForSession,
  markBgTaskCompleted,
  markBgTaskFailed,
  markBgTaskRunning,
} from "./bg-tasks"

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

type SessionLike = {
  id: string
  parentID?: string
  [key: string]: unknown
}

type MessageEntry = {
  info?: { role?: string; [key: string]: unknown }
  parts?: Array<{ type?: string; text?: string; [key: string]: unknown }>
}

type ClientLike = {
  session?: {
    get?: (options: {
      path: { id: string }
    }) => Promise<{ data?: SessionLike } | unknown>
    fork?: (options: {
      path: { id: string }
      body?: { messageID?: string }
    }) => Promise<{ data?: SessionLike } | unknown>
    promptAsync?: (options: {
      path: { id: string }
      body: {
        messageID?: string
        agent?: string
        parts: Array<{ type: "text"; text: string }>
      }
    }) => Promise<unknown>
    messages?: (options: {
      path: { id: string }
      query?: { limit?: number }
    }) => Promise<
      | {
          data?: MessageEntry[]
        }
      | MessageEntry[]
      | unknown
    >
  }
}

type WorkflowStatus = {
  ok: boolean
  text: string
}

export const FORK_CHILD_MARKER_BEGIN = "<ccx-fork-child>"
export const FORK_CHILD_MARKER_END = "</ccx-fork-child>"
const TASK_STATUS_SCAN_LIMIT = 200

const forkChildSessionIDs = new Set<string>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function createRequestMessageID(): string {
  return `ccx-bg-msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function joinTextParts(parts: ChatMessageOutput["parts"]): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .trim()
}

function findCommandLine(text: string, command: string): string | null {
  if (!text) return null
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === command || trimmed.startsWith(`${command} `)) {
      return trimmed
    }
  }
  return null
}

function parseAgentAndPrompt(rest: string): { agent?: string; prompt: string } {
  const trimmed = rest.trim()
  if (!trimmed) return { prompt: "" }
  const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s+([\s\S]+)$/)
  if (!match) return { prompt: trimmed }
  return { agent: match[1], prompt: match[2].trim() }
}

function appendStatusPart(output: ChatMessageOutput, text: string): void {
  output.parts.push({
    type: "text",
    text: `[ccx session-workflow] ${text}`,
    synthetic: true,
  })
}

function extractSessionFromResponse(result: unknown): SessionLike | undefined {
  if (!isRecord(result)) return undefined
  const data = isRecord(result.data) ? result.data : result
  if (!isRecord(data)) return undefined
  if (typeof data.id !== "string") return undefined
  return data as unknown as SessionLike
}

function extractMessageList(result: unknown): MessageEntry[] {
  if (!result) return []
  if (Array.isArray(result)) return result as MessageEntry[]
  if (isRecord(result) && Array.isArray(result.data)) {
    return result.data as MessageEntry[]
  }
  return []
}

async function getSessionByID(
  client: ClientLike,
  sessionID: string,
): Promise<SessionLike | undefined> {
  if (!client.session?.get) return undefined
  try {
    const result = await client.session.get({ path: { id: sessionID } })
    return extractSessionFromResponse(result)
  } catch {
    return undefined
  }
}

function messagesContainForkMarker(messages: MessageEntry[]): boolean {
  for (const entry of messages) {
    const parts = Array.isArray(entry.parts) ? entry.parts : []
    for (const part of parts) {
      if (!isRecord(part)) continue
      if (typeof part.text === "string" && part.text.includes(FORK_CHILD_MARKER_BEGIN)) {
        return true
      }
    }
  }
  return false
}

function buildForkChildDirective(args: {
  agent?: string
  prompt: string
  parentSessionID: string
  forkCommand: string
  fullContextCommand: string
}): string {
  const agentLine = args.agent ? `Target agent: ${args.agent}` : "Target agent: (inherit)"
  return [
    FORK_CHILD_MARKER_BEGIN,
    "You are a ccx fork-child. You have inherited the full parent session context above.",
    "Rules:",
    "1. Treat the inherited conversation as background. Do NOT re-introduce yourself.",
    `2. Do NOT fork again. Never invoke ${args.forkCommand} or ${args.fullContextCommand} from within this session.`,
    "3. Focus strictly on the directive below. Report back concisely.",
    `Parent session: ${args.parentSessionID}`,
    agentLine,
    FORK_CHILD_MARKER_END,
    "",
    "Directive:",
    args.prompt,
  ].join("\n")
}

async function isCurrentSessionForkChild(
  client: ClientLike,
  sessionID: string,
): Promise<boolean> {
  if (forkChildSessionIDs.has(sessionID)) return true

  const visited = new Set<string>()
  let cursor = sessionID
  for (let depth = 0; depth < 12; depth += 1) {
    if (!cursor || visited.has(cursor)) break
    visited.add(cursor)
    if (forkChildSessionIDs.has(cursor)) {
      forkChildSessionIDs.add(sessionID)
      return true
    }
    const session = await getSessionByID(client, cursor)
    if (!session?.parentID) break
    cursor = session.parentID
  }

  if (!client.session?.messages) return false
  try {
    const messages = await client.session.messages({
      path: { id: sessionID },
    })
    const isForkChild = messagesContainForkMarker(extractMessageList(messages))
    if (isForkChild) forkChildSessionIDs.add(sessionID)
    return isForkChild
  } catch {
    return false
  }
}

async function handleFork(
  client: ClientLike,
  sessionID: string,
  rest: string,
): Promise<WorkflowStatus> {
  if (!client.session?.fork) {
    return { ok: false, text: "Fork is not supported by the current client." }
  }
  if (await isCurrentSessionForkChild(client, sessionID)) {
    return {
      ok: false,
      text: "Fork refused: current session is already a ccx fork-child (recursion guard).",
    }
  }
  const trimmed = rest.trim()
  const messageID = trimmed.length > 0 ? trimmed : undefined
  try {
    const result = await client.session.fork({
      path: { id: sessionID },
      body: messageID ? { messageID } : {},
    })
    const forked = extractSessionFromResponse(result)
    const suffix = forked ? ` New session: ${forked.id}.` : ""
    return {
      ok: true,
      text: messageID
        ? `Forked session at message ${messageID}.${suffix}`
        : `Forked session at the latest message.${suffix}`,
    }
  } catch (error) {
    return {
      ok: false,
      text: `Failed to fork session: ${(error as Error)?.message ?? String(error)}`,
    }
  }
}

async function dispatchBackgroundPrompt(args: {
  client: ClientLike
  targetSessionID: string
  parentSessionID: string
  agent?: string
  prompt: string
  fullContext: boolean
  forkCommand: string
  fullContextCommand: string
}): Promise<WorkflowStatus> {
  const { client, targetSessionID, parentSessionID, agent, prompt, fullContext, forkCommand, fullContextCommand } = args
  if (!client.session?.promptAsync) {
    return {
      ok: false,
      text: "Background prompts are not supported by the current client.",
    }
  }

  const requestMessageID = createRequestMessageID()
  const task = createBgTask({
    parentSessionID,
    targetSessionID,
    requestMessageID,
    agent,
    prompt,
    fullContext,
  })

  const directive = fullContext
    ? buildForkChildDirective({ agent, prompt, parentSessionID, forkCommand, fullContextCommand })
    : prompt

  try {
    await client.session.promptAsync({
      path: { id: targetSessionID },
      body: {
        messageID: requestMessageID,
        agent,
        parts: [{ type: "text", text: directive }],
      },
    })
    markBgTaskRunning(task.id)
    if (fullContext) {
      forkChildSessionIDs.add(targetSessionID)
    }
    const scope = fullContext
      ? `full-context subtask (fork session ${targetSessionID})`
      : agent
        ? `background prompt to agent "${agent}"`
        : "background prompt to the active agent"
    return {
      ok: true,
      text: `${scope} dispatched. task=${task.id} (status: running)`,
    }
  } catch (error) {
    const message = (error as Error)?.message ?? String(error)
    markBgTaskFailed(task.id, message)
    return {
      ok: false,
      text: `Failed to dispatch background prompt: ${message} (task=${task.id})`,
    }
  }
}

async function handleBackground(
  client: ClientLike,
  sessionID: string,
  rest: string,
  commands: { forkCommand: string; fullContextCommand: string },
): Promise<WorkflowStatus> {
  const { agent, prompt } = parseAgentAndPrompt(rest)
  if (!prompt) {
    return { ok: false, text: "Background prompt requires a non-empty prompt body." }
  }
  return dispatchBackgroundPrompt({
    client,
    targetSessionID: sessionID,
    parentSessionID: sessionID,
    agent,
    prompt,
    fullContext: false,
    forkCommand: commands.forkCommand,
    fullContextCommand: commands.fullContextCommand,
  })
}

async function handleFullContext(
  client: ClientLike,
  sessionID: string,
  rest: string,
  commands: { forkCommand: string; fullContextCommand: string },
): Promise<WorkflowStatus> {
  if (!client.session?.fork || !client.session.promptAsync) {
    return {
      ok: false,
      text: "Full-context subtask requires session.fork and session.promptAsync support.",
    }
  }
  if (await isCurrentSessionForkChild(client, sessionID)) {
    return {
      ok: false,
      text: "Full-context refused: current session is already a ccx fork-child (recursion guard).",
    }
  }
  const { agent, prompt } = parseAgentAndPrompt(rest)
  if (!agent || !prompt) {
    return { ok: false, text: "Usage: <command> <agent-name> <prompt>." }
  }

  let forkedSession: SessionLike | undefined
  try {
    const result = await client.session.fork({
      path: { id: sessionID },
      body: {},
    })
    forkedSession = extractSessionFromResponse(result)
  } catch (error) {
    return {
      ok: false,
      text: `Full-context fork failed: ${(error as Error)?.message ?? String(error)}`,
    }
  }

  if (!forkedSession) {
    return {
      ok: false,
      text: "Full-context fork returned no session id.",
    }
  }

  return dispatchBackgroundPrompt({
    client,
    targetSessionID: forkedSession.id,
    parentSessionID: sessionID,
    agent,
    prompt,
    fullContext: true,
    forkCommand: commands.forkCommand,
    fullContextCommand: commands.fullContextCommand,
  })
}

async function refreshBgTaskStatus(
  client: ClientLike,
  task: ReturnType<typeof getBgTask>,
): Promise<void> {
  if (!task || task.status !== "running") return
  if (!client.session?.messages) return
  try {
    const response = await client.session.messages({
      path: { id: task.targetSessionID },
      query: { limit: TASK_STATUS_SCAN_LIMIT },
    })
    const list = extractMessageList(response)
    if (list.length === 0) return

    let info: Record<string, unknown> | undefined
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const candidate = list[index]
      if (!isRecord(candidate?.info)) continue
      const messageInfo = candidate.info as Record<string, unknown>
      if (messageInfo.role !== "assistant") continue
      if (messageInfo.parentID !== task.requestMessageID) continue
      info = messageInfo
      break
    }

    if (!info || info.role !== "assistant") return
    const time = isRecord(info.time) ? (info.time as Record<string, unknown>) : undefined
    const completed = time && typeof time.completed === "number" ? time.completed : undefined
    if (!completed) return
    const errorInfo = isRecord(info.error) ? (info.error as Record<string, unknown>) : undefined
    if (errorInfo) {
      const errorData = isRecord(errorInfo.data) ? (errorInfo.data as Record<string, unknown>) : undefined
      const message = typeof errorData?.message === "string"
        ? (errorData.message as string)
        : typeof errorInfo.name === "string"
          ? (errorInfo.name as string)
          : "assistant reported an error"
      markBgTaskFailed(task.id, message)
      return
    }
    markBgTaskCompleted(task.id)
  } catch {
    // ignore probe failures — task stays in running state
  }
}

async function handleStatus(
  client: ClientLike,
  sessionID: string,
  rest: string,
): Promise<WorkflowStatus> {
  const trimmed = rest.trim()
  if (trimmed) {
    const task = getBgTask(trimmed)
    if (!task) {
      return { ok: false, text: `No background task with id ${trimmed}.` }
    }
    await refreshBgTaskStatus(client, task)
    const errorLine = task.error ? ` error=${task.error}` : ""
    return {
      ok: true,
      text: `${formatBgTaskLine(task)}${errorLine}`,
    }
  }
  const tasks = listBgTasksForSession(sessionID)
  if (tasks.length === 0) {
    return { ok: true, text: "No background tasks recorded for this session." }
  }
  for (const task of tasks) {
    await refreshBgTaskStatus(client, task)
  }
  const lines = tasks.slice(-10).map((task) => formatBgTaskLine(task))
  return { ok: true, text: `Recent background tasks:\n${lines.join("\n")}` }
}

export function createSessionWorkflowsHook(args: {
  config: OhMyCCAgentConfig
  client: unknown
}) {
  const { config } = args
  const client = args.client as ClientLike

  return async (input: ChatMessageInput, output: ChatMessageOutput): Promise<void> => {
    const workflows = config.subagent_orchestration.session_workflows
    if (!workflows.enabled) return
    if (!input?.sessionID) return
    if (!output?.parts) return

    // loader resolves these to non-null strings based on agent_name; narrow for TS.
    const forkCommand = workflows.fork_command ?? `/${config.agent_name}-fork`
    const backgroundCommand = workflows.background_command ?? `/${config.agent_name}-bg`
    const fullContextCommand = workflows.full_context_command ?? `/${config.agent_name}-fullctx`
    const statusCommand = workflows.status_command ?? `/${config.agent_name}-bg-status`

    const text = joinTextParts(output.parts)
    if (!text) return

    const forkLine = findCommandLine(text, forkCommand)
    const backgroundLine = findCommandLine(text, backgroundCommand)
    const fullContextLine = findCommandLine(text, fullContextCommand)
    const statusLine = findCommandLine(text, statusCommand)

    if (!forkLine && !backgroundLine && !fullContextLine && !statusLine) return

    if (forkLine) {
      const rest = forkLine.slice(forkCommand.length)
      const status = await handleFork(client, input.sessionID, rest)
      appendStatusPart(output, status.text)
    }

    if (backgroundLine) {
      const rest = backgroundLine.slice(backgroundCommand.length)
      const status = await handleBackground(client, input.sessionID, rest, { forkCommand, fullContextCommand })
      appendStatusPart(output, status.text)
    }

    if (fullContextLine) {
      const rest = fullContextLine.slice(fullContextCommand.length)
      const status = await handleFullContext(client, input.sessionID, rest, { forkCommand, fullContextCommand })
      appendStatusPart(output, status.text)
    }

    if (statusLine) {
      const rest = statusLine.slice(statusCommand.length)
      const status = await handleStatus(client, input.sessionID, rest)
      appendStatusPart(output, status.text)
    }
  }
}
