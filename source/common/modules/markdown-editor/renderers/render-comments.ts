import { StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { documentCommentsField } from '../util/document-comments'

const hiddenComment = Decoration.replace({ inclusive: false })
const annotation = Decoration.mark({ class: 'cm-annotated-text' })

function decorateComments (state: EditorState): DecorationSet {
  const decorations = []
  for (const comment of state.field(documentCommentsField)) {
    if (comment.annotation === true) {
      // Annotation metadata is stored on its own line. Hide its line break too.
      const anchor = comment.anchor
      if (anchor !== undefined && anchor.from < anchor.to) {
        decorations.push(annotation.range(anchor.from, anchor.to))
      }
      const line = state.doc.lineAt(comment.from)
      const start = line.from === comment.from ? Math.max(0, comment.from - 1) : comment.from
      decorations.push(hiddenComment.range(start, comment.to))
    } else if (!state.selection.ranges.some(({ from, to }) => from <= comment.to && to >= comment.from)) {
      // Let the cursor approach a hidden range from either side so it is editable.
      decorations.push(hiddenComment.range(comment.from, comment.to))
    }
  }
  return Decoration.set(decorations, true)
}

export const commentDecorations = StateField.define<DecorationSet>({
  create: decorateComments,
  update (decorations, transaction) {
    if (transaction.docChanged || transaction.selection !== undefined ||
      transaction.startState.field(documentCommentsField) !== transaction.state.field(documentCommentsField)) {
      return decorateComments(transaction.state)
    }
    return decorations
  },
  provide: field => EditorView.decorations.from(field)
})

export const renderComments = [
  commentDecorations,
  EditorView.baseTheme({
    '.cm-annotated-text': { backgroundColor: 'color-mix(in srgb, #e5a624 22%, transparent)' }
  })
]
