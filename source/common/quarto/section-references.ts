import { Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { NODES } from '../modules/markdown-editor/parser/citation-parser'
import markdownParser from '../modules/markdown-editor/parser/markdown-parser'
import { parsePandocAttributes } from '../pandoc-util/parse-pandoc-attributes'

export interface QuartoChapter {
  path: string
  content: string
}

export interface QuartoSectionReference {
  id: string
  path: string
  line: number
}

export interface QuartoSectionTarget extends QuartoSectionReference {
  title: string
}

export interface QuartoSectionIndex {
  targets: QuartoSectionTarget[]
  references: QuartoSectionReference[]
  duplicateIds: string[]
  unresolved: QuartoSectionReference[]
}

const { parser } = markdownParser().language

export function isQuartoSectionId (id: string): boolean {
  return /^sec-[\w.-]+$/.test(id)
}

function getHeadingTarget (heading: SyntaxNode, source: string): { id: string, title: string }|undefined {
  const attributes = heading.getChildren('PandocAttribute').at(-1)
  if (attributes === undefined) {
    return undefined
  }

  const marks = heading.getChildren('HeaderMark')
  const setext = heading.name.startsWith('SetextHeading')
  const start = setext ? heading.from : marks[0]?.to ?? heading.from
  const end = setext || marks.length > 1 ? marks.at(-1)?.from ?? heading.to : heading.to

  // For example, an attribute on an image within the heading is not a
  // section ID. Only trailing heading attributes can label the heading.
  if (source.slice(attributes.to, end).trim() !== '') {
    return undefined
  }

  const { id } = parsePandocAttributes(source.slice(attributes.from, attributes.to))
  if (id === undefined || !isQuartoSectionId(id)) {
    return undefined
  }

  return { id, title: source.slice(start, attributes.from).trim() }
}

export function collectQuartoSections (chapters: readonly QuartoChapter[]): QuartoSectionIndex {
  const targets: QuartoSectionTarget[] = []
  const references: QuartoSectionReference[] = []
  const targetIds = new Set<string>()
  const duplicates = new Set<string>()

  for (const { path, content } of chapters) {
    if (!content.includes('sec-')) {
      continue
    }

    const doc = Text.of(content.replace(/^\uFEFF/, '').split(/\r\n|\n\r|\n|\r/))
    const source = doc.toString()

    parser.parse(source).iterate({
      enter (node) {
        if ([ 'FencedCode', 'CodeBlock', 'InlineCode', 'Comment', 'CommentBlock', 'YAMLFrontmatter' ].includes(node.name)) {
          return false
        }

        if (/^(?:ATX|Setext)Heading[1-6]$/.test(node.name)) {
          const target = getHeadingTarget(node.node, source)
          if (target !== undefined) {
            targets.push({ ...target, path, line: doc.lineAt(node.from).number })
            if (targetIds.has(target.id)) {
              duplicates.add(target.id)
            }
            targetIds.add(target.id)
          }
        } else if (node.name === NODES.KEY) {
          const id = source.slice(node.from, node.to)
          if (isQuartoSectionId(id)) {
            references.push({ id, path, line: doc.lineAt(node.from).number })
          }
        }
      }
    })
  }

  return {
    targets,
    references,
    duplicateIds: [...duplicates],
    unresolved: references.filter(reference => !targetIds.has(reference.id))
  }
}
