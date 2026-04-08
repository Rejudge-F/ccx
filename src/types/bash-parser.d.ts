declare module "bash-parser" {
  export interface BashParserNode {
    type?: string
    text?: string
    name?: BashParserNode
    suffix?: BashParserNode[]
    prefix?: BashParserNode[]
    commands?: BashParserNode[]
    left?: BashParserNode
    right?: BashParserNode
    expansion?: BashParserNode[]
    command?: BashParserNode
    [key: string]: unknown
  }

  function parse(source: string, options?: Record<string, unknown>): BashParserNode
  export default parse
}
