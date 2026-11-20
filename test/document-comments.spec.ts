import assert from 'node:assert/strict'
import { Text } from '@codemirror/state'
import { parser } from '@lezer/markdown'
import { getDocumentComments } from '../source/win-main/util/document-comments'

describe('Document comments', () => {
  it('finds inline and adjacent block comments with exact ranges', () => {
    const doc = Text.of([
      'Text <!-- inline -->',
      '',
      '<!-- first',
      'line --><!-- second --> trailing text'
    ])

    const comments = getDocumentComments(doc, parser)

    assert.deepEqual(comments.map(({ line, text }) => ({ line, text })), [
      { line: 1, text: 'inline' },
      { line: 3, text: 'first\nline' },
      { line: 4, text: 'second' }
    ])
    assert.deepEqual(comments.map(({ from, to }) => doc.sliceString(from, to)), [
      '<!-- inline -->',
      '<!-- first\nline -->',
      '<!-- second -->'
    ])
  })

  it('ignores literal code examples and unfinished comments', () => {
    const doc = Text.of([
      '`<!-- inline code -->`',
      '',
      '```markdown',
      '<!-- fenced code -->',
      '```',
      '',
      '<!-- unfinished'
    ])

    assert.deepEqual(getDocumentComments(doc, parser), [])
  })
})
