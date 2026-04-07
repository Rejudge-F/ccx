export type AgentDefinition = {
  name: string
  description: string
  getSystemPrompt: () => string
  allowedTools?: string[]
  disallowedTools?: string[]
  readOnly?: boolean
}
