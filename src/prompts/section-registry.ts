export type PromptSectionKind = "static" | "dynamic"

export type PromptSection = {
  id: string
  kind: PromptSectionKind
  resolve: () => string | null | Promise<string | null>
}

export function createPromptSection(args: {
  id: string
  kind: PromptSectionKind
  resolve: () => string | null | Promise<string | null>
}): PromptSection {
  return args
}

export async function resolvePromptSections(args: {
  sections: PromptSection[]
  kind: PromptSectionKind
  disabledSectionIDs?: string[]
}): Promise<string[]> {
  const disabled = new Set(args.disabledSectionIDs ?? [])
  const selected = args.sections.filter((section) => {
    if (section.kind !== args.kind) return false
    if (disabled.has(section.id)) return false
    return true
  })

  const resolved = await Promise.all(selected.map((section) => section.resolve()))
  return resolved.filter((section): section is string => typeof section === "string" && section.length > 0)
}
