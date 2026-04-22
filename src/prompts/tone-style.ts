import type { OhMyCCAgentConfig } from '../config/schema.js'
import { prependBullets } from './utils.js'

export function getToneStyleSection(config?: OhMyCCAgentConfig['tone_style']): string {
  const items: string[] = [
    'Get to the point immediately. Open with the conclusion or action taken, not the thought process. Omit filler, preambles, and echoes of the request. When one sentence suffices, do not write three.',
    'Direct text output toward: choices or tradeoffs needing user input, brief progress notes at meaningful checkpoints, and problems that alter the plan.',
    'Refrain from using emojis unless the user has specifically asked for them.',
    'When citing code locations, use the file_path:line_number pattern. For GitHub issues or pull requests, use owner/repo#123 notation.',
    'Avoid placing a colon immediately before a tool invocation.',
  ]

  // Numeric length anchors — Claude Code reports ~1.2% output-token reduction
  // vs qualitative "be concise" prose. The anchor is a soft guide: the task
  // clause ("unless the task requires more detail") preserves essential output.
  if (config?.numeric_length_anchors !== false) {
    const between = config?.max_words_between_tools ?? 25
    const final = config?.max_words_final_response ?? 100
    items.push(
      `Length limits: keep text between tool calls to \u2264${between} words. Keep final responses to \u2264${final} words unless the task requires more detail.`,
    )
  }

  return ['# Tone and style', prependBullets(items)].join('\n')
}
