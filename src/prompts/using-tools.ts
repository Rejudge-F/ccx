import { prependBullets } from './utils.js'

export type ToolSectionNames = {
  bash: string
  read: string
  edit: string
  write: string
  glob: string
  grep: string
  todo?: string
}

export function getUsingToolsSection(toolNames: ToolSectionNames): string {
  const dedicatedToolSubitems = [
    `For reading files, use ${toolNames.read} rather than cat, head, tail, or sed.`,
    `For modifying files, use ${toolNames.edit} rather than sed or awk.`,
    `For creating new files, use ${toolNames.write} rather than heredocs or shell output redirection.`,
    `For locating files by name or pattern, use ${toolNames.glob} rather than find or ls.`,
    `For searching within file contents, use ${toolNames.grep} rather than grep or rg.`,
    `Keep ${toolNames.bash} for genuine shell operations — system commands and terminal tasks that require an actual shell. When in doubt and a specialized tool exists for the job, default to the specialized tool and only resort to ${toolNames.bash} when nothing else fits.`,
  ]

  const items: Array<string | string[]> = [
    `Avoid using ${toolNames.bash} when a purpose-built tool covers the same operation. Specialized tools give the user better visibility into and control over your work. This is essential for effective assistance:`,
    dedicatedToolSubitems,
    toolNames.todo
      ? `Organize and track your work using the ${toolNames.todo} tool. Mark each item done as soon as you finish it. Do not accumulate several completed items before updating their status.`
      : `Organize and track your work explicitly as you proceed. Record progress at small, natural checkpoints rather than saving all updates for the end.`,
    `Multiple tools can be invoked within a single response. When tool calls have no interdependencies, issue them all at once for maximum throughput. When one call requires the result of another, sequence them accordingly.`,
  ]

  return ['# Using your tools', prependBullets(items)].join('\n')
}
