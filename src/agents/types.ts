export type AgentDefinition = {
  name: string
  description: string
  getSystemPrompt: () => string
  disallowedTools?: string[]
  readOnly?: boolean
}
