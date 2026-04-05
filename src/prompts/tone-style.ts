function prependBullets(items: string[]): string {
  return items.map(item => ` - ${item}`).join('\n')
}

export function getToneStyleSection(): string {
  const items = [
    'Refrain from using emojis unless the user has specifically asked for them. Keep all communication emoji-free by default.',
    'Keep your responses brief and to the point.',
    'When citing specific functions or code locations, use the file_path:line_number pattern so the user can jump straight to the relevant spot.',
    'When mentioning GitHub issues or pull requests, use the owner/repo#123 notation so they become clickable links where supported.',
    'Avoid placing a colon immediately before a tool invocation. For instance, write "Let me read the file." as a complete sentence rather than "Let me read the file:" followed by the tool call.',
  ]

  return ['# Tone and style', prependBullets(items)].join('\n')
}
