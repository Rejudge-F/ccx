export type BgTaskStatus = "queued" | "running" | "completed" | "failed"

export type BgTaskRecord = {
  id: string
  parentSessionID: string
  targetSessionID: string
  requestMessageID: string
  agent?: string
  prompt: string
  status: BgTaskStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
  fullContext: boolean
}

const MAX_TASKS_PER_SESSION = 50

const tasksBySession = new Map<string, BgTaskRecord[]>()
const tasksById = new Map<string, BgTaskRecord>()

function pushTask(record: BgTaskRecord): void {
  tasksById.set(record.id, record)
  const list = tasksBySession.get(record.parentSessionID) ?? []
  list.push(record)
  if (list.length > MAX_TASKS_PER_SESSION) {
    const evicted = list.splice(0, list.length - MAX_TASKS_PER_SESSION)
    for (const item of evicted) tasksById.delete(item.id)
  }
  tasksBySession.set(record.parentSessionID, list)
}

export function createBgTask(args: {
  parentSessionID: string
  targetSessionID: string
  requestMessageID: string
  agent?: string
  prompt: string
  fullContext: boolean
}): BgTaskRecord {
  const record: BgTaskRecord = {
    id: `ccx-bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    parentSessionID: args.parentSessionID,
    targetSessionID: args.targetSessionID,
    requestMessageID: args.requestMessageID,
    agent: args.agent,
    prompt: args.prompt,
    status: "queued",
    createdAt: Date.now(),
    fullContext: args.fullContext,
  }
  pushTask(record)
  return record
}

export function markBgTaskRunning(id: string): void {
  const task = tasksById.get(id)
  if (!task) return
  task.status = "running"
  task.startedAt = Date.now()
}

export function markBgTaskFailed(id: string, error: string): void {
  const task = tasksById.get(id)
  if (!task) return
  task.status = "failed"
  task.finishedAt = Date.now()
  task.error = error
}

export function markBgTaskCompleted(id: string): void {
  const task = tasksById.get(id)
  if (!task) return
  task.status = "completed"
  task.finishedAt = Date.now()
}

export function getBgTask(id: string): BgTaskRecord | undefined {
  return tasksById.get(id)
}

export function listBgTasksForSession(sessionID: string): BgTaskRecord[] {
  return tasksBySession.get(sessionID)?.slice() ?? []
}

export function formatBgTaskLine(task: BgTaskRecord): string {
  const age = Math.max(0, Math.round((Date.now() - task.createdAt) / 1000))
  const agent = task.agent ? ` agent=${task.agent}` : ""
  const ctx = task.fullContext ? " full-ctx" : ""
  const target = task.targetSessionID === task.parentSessionID
    ? ""
    : ` target=${task.targetSessionID}`
  return `${task.id} ${task.status}${agent}${ctx}${target} age=${age}s`
}
