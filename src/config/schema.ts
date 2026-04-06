import { z } from "zod"

const verificationSchema = z.object({
  auto_remind: z.boolean().default(true),
  min_file_edits: z.int().nonnegative().default(3),
})

export const configSchema = z.object({
  enabled: z.boolean().default(true),
  disabled_sections: z.array(z.string()).default([]),
  disabled_hooks: z.array(z.string()).default([]),
  output_style: z.string().min(1).nullable().default(null),
  verification: verificationSchema.default({
    auto_remind: true,
    min_file_edits: 3,
  }),
})

export type OhMyCCAgentConfig = z.infer<typeof configSchema>
