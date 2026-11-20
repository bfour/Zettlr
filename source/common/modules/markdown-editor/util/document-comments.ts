import { type EditorState, StateField, type Text } from '@codemirror/state'
import { language } from '@codemirror/language'
import type { Parser } from '@lezer/common'

export interface DocumentComment {
  from: number
  to: number
  line: number
  text: string
  annotation?: boolean
  anchor?: { from: number, to: number }
}

/**
 * Find HTML comments in Markdown syntax, excluding literal examples in code.
 */
export function getDocumentComments (doc: Text, parser: Parser): DocumentComment[] {
  const source = doc.toString()
  if (!source.includes('<!--')) {
    return []
  }

  const comments: DocumentComment[] = []
  parser.parse(source).iterate({
    enter ({ name, from, to }) {
      if (name === 'FencedCode' || name === 'CodeBlock' || name === 'YAMLFrontmatter') {
        return false
      }
      if (name !== 'Comment' && name !== 'CommentBlock') {
        return
      }

      // A block node can contain adjacent comments and trailing text on the
      // closing line. Take each leading comment's exact range.
      const markup = source.slice(from, to)
      const adjacentComment = /\s*<!--([\s\S]*?)-->/y
      for (let match = adjacentComment.exec(markup); match !== null; match = adjacentComment.exec(markup)) {
        const commentStart = from + match.index + match[0].indexOf('<!--')
        const text = match[1].trim()
        const annotation = parseAnnotation(text)
        const anchor = annotation === undefined ? undefined : findAnchor(source.slice(0, commentStart), annotation)
        comments.push({
          from: commentStart,
          to: from + adjacentComment.lastIndex,
          line: doc.lineAt(anchor?.from ?? commentStart).number,
          text: annotation?.text ?? text,
          ...(annotation === undefined ? {} : { annotation: true, anchor })
        })
      }
      return false
    }
  })
  return comments
}

const annotationPrefix = 'zettlr-annotation '
const contextLength = 32

interface SavedAnnotation {
  from: number
  quote: string
  before: string
  after: string
  text: string
}

function parseAnnotation (text: string): SavedAnnotation|undefined {
  if (!text.startsWith(annotationPrefix)) {
    return undefined
  }

  try {
    const record: unknown = JSON.parse(text.slice(annotationPrefix.length))
    if (typeof record !== 'object' || record === null ||
      !('from' in record) || !('quote' in record) || !('before' in record) ||
      !('after' in record) || !('text' in record)) {
      return undefined
    }
    const { from, quote, before, after, text: body } = record
    if (typeof from === 'number' && Number.isSafeInteger(from) && from >= 0 &&
      typeof quote === 'string' && quote !== '' && typeof before === 'string' &&
      typeof after === 'string' && typeof body === 'string') {
      return { from, quote, before, after, text: body }
    }
  } catch {
    // A malformed annotation is still an ordinary HTML comment.
  }
  return undefined
}

function findAnchor (source: string, saved: SavedAnnotation): DocumentComment['anchor'] {
  const { from, quote, before, after } = saved
  const availableContext = Number(before !== '') + Number(after !== '')
  const contextScore = (start: number, end: number): number =>
    Number(before !== '' && source.slice(Math.max(0, start - before.length), start) === before) +
    Number(after !== '' && source.startsWith(after, end))

  let best: { from: number, to: number, score: number }|undefined
  let tied = false
  for (let start = source.indexOf(quote); start !== -1; start = source.indexOf(quote, start + 1)) {
    const end = start + quote.length
    const score = contextScore(start, end)
    if (score === availableContext && start === from) {
      return { from: start, to: end }
    }
    if (best === undefined || score > best.score) {
      best = { from: start, to: end, score }
      tied = false
    } else if (score === best.score) {
      tied = true
    }
  }

  // A unique exact match with the recorded context still points to the
  // original selection even when edits have moved it.
  if (best !== undefined && !tied && best.score === availableContext) {
    return { from: best.from, to: best.to }
  }

  // If the selection itself changed, recover its boundaries from the text
  // immediately around it. Require unambiguous boundary matches.
  const left = before === '' ? 0 : uniqueIndexOf(source, before, 0)
  const start = left + before.length
  const end = after === ''
    ? source.length - (source.slice(-2).match(/\n{1,2}$/)?.[0].length ?? 0)
    : uniqueIndexOf(source, after, start)
  if (left >= 0 && end >= start) {
    return { from: start, to: end }
  }

  return best !== undefined && !tied ? { from: best.from, to: best.to } : undefined
}

function uniqueIndexOf (source: string, text: string, from: number): number {
  const index = source.indexOf(text, from)
  return index !== -1 && source.indexOf(text, index + 1) === -1 ? index : -1
}

export function encodeAnnotation (doc: Text, from: number, to: number, text: string): string {
  // Quoted text and context keep annotations with the document even when it
  // moves. Edits don't need to rewrite notes, so concurrent panes can rebase.
  const record = {
    from,
    quote: doc.sliceString(from, to),
    before: doc.sliceString(Math.max(0, from - contextLength), from),
    after: doc.sliceString(to, Math.min(doc.length, to + contextLength)),
    text
  }
  // Keep user-entered comment delimiters inside the JSON string.
  const body = JSON.stringify(record).replace(/--/g, '\\u002d\\u002d')
  return `<!-- ${annotationPrefix}${body} -->`
}

function readComments (state: EditorState): DocumentComment[] {
  const parser = state.facet(language)?.parser
  return parser === undefined ? [] : getDocumentComments(state.doc, parser)
}

export const documentCommentsField = StateField.define<DocumentComment[]>({
  create: readComments,
  update (comments, transaction) {
    if (transaction.docChanged || transaction.startState.facet(language) !== transaction.state.facet(language)) {
      return readComments(transaction.state)
    }
    return comments
  }
})
