import type { Text } from '@codemirror/state'
import type { Parser } from '@lezer/common'

export interface DocumentComment {
  from: number
  to: number
  line: number
  text: string
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
        comments.push({
          from: commentStart,
          to: from + adjacentComment.lastIndex,
          line: doc.lineAt(commentStart).number,
          text: match[1].trim()
        })
      }
      return false
    }
  })
  return comments
}
