export function prependBullets(items: Array<string | string[]>): string {
  return items
    .flatMap(item =>
      Array.isArray(item)
        ? item.map(subitem => `  - ${subitem}`)
        : [` - ${item}`],
    )
    .join('\n')
}
