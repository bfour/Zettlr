import assert from 'node:assert/strict'
import { EditorState, Text } from '@codemirror/state'
import { collab, rebaseUpdates, receiveUpdates, sendableUpdates } from '@codemirror/collab'
import { history, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { parser } from '@lezer/markdown'
import { commentDecorations, renderComments } from '../source/common/modules/markdown-editor/renderers/render-comments'
import { documentCommentsField, encodeAnnotation, getDocumentComments } from '../source/common/modules/markdown-editor/util/document-comments'

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

describe('Preview comments and annotations', () => {
  it('hides comment ranges until selected and preserves surrounding prose', () => {
    const doc = 'Text <!-- note -->.\n\n<!-- multiline\ncomment --> trailing prose'
    const state = EditorState.create({ doc, extensions: [ markdown(), documentCommentsField, renderComments ] })
    const [ inline, block ] = state.field(documentCommentsField)
    assert.deepEqual(decoratedRanges(state), [
      [ inline.from, inline.to ],
      [ block.from, block.to ]
    ])

    const selected = state.update({ selection: { anchor: inline.from, head: inline.to } }).state
    assert.deepEqual(decoratedRanges(selected), [[ block.from, block.to ]])
    assert.ok(state.sliceDoc(block.to).includes('trailing prose'))
  })

  it('stores the note separately and maps its span through edits and undo', () => {
    const prose = 'A **selected span**.'
    const doc = prose + '\n\n' + encodeAnnotation(Text.of([ prose ]), 4, 17, 'Review this -->\nsecond line')
    let state = EditorState.create({ doc, extensions: [ markdown(), documentCommentsField, renderComments, history() ] })
    const [ comment ] = state.field(documentCommentsField)
    assert.deepEqual(comment.anchor, { from: 4, to: 17 })
    assert.equal(state.sliceDoc(4, 17), 'selected span')
    assert.equal(comment.text, 'Review this -->\nsecond line')
    assert.deepEqual(decoratedRanges(state), [[ 4, 17 ], [ comment.from - 1, comment.to ]])

    state = state.update({ changes: [
      { from: 0, insert: 'Before ' },
      { from: 13, to: 17, insert: 'words' }
    ] }).state
    const [ edited ] = state.field(documentCommentsField)
    assert.deepEqual(edited.anchor, { from: 11, to: 25 })
    assert.equal(state.sliceDoc(11, 25), 'selected words')

    const reloaded = EditorState.create({ doc: state.doc, extensions: [ markdown(), documentCommentsField ] })
    assert.deepEqual(reloaded.field(documentCommentsField)[0].anchor, edited.anchor)
    assert.equal(undo({ state, dispatch: transaction => { state = transaction.state } }), true)
    assert.equal(state.doc.toString(), doc)
  })

  it('keeps one correctly anchored note when simultaneous edits are rebased', () => {
    const prose = 'Prefix Alpha.'
    const doc = prose + '\n\n' + encodeAnnotation(Text.of([ prose ]), 7, 12, 'Note')
    const makeState = (clientID: string): EditorState =>
      EditorState.create({ doc, extensions: [ markdown(), documentCommentsField, collab({ clientID }) ] })
    const first = makeState('first').update({ changes: { from: 0, insert: 'One ' } }).state
    const second = makeState('second').update({ changes: { from: 3, insert: 'Two ' } }).state
    const accepted = sendableUpdates(first)
    const pending = rebaseUpdates(sendableUpdates(second), accepted)
    const rebased = receiveUpdates(makeState('observer'), [...accepted, ...pending]).state
    const comments = rebased.field(documentCommentsField)
    assert.equal(comments.length, 1)
    const anchor = comments[0].anchor
    assert.ok(anchor)
    assert.equal(rebased.sliceDoc(anchor.from, anchor.to), 'Alpha')
  })

  for (const { name, prefix, suffix, atStart } of [
    { name: 'at the end of the document', prefix: 'Before ', suffix: '', atStart: false },
    { name: 'in the middle of a paragraph', prefix: 'Before ', suffix: ' and more text.', atStart: false },
    { name: 'at the start of the selection', prefix: '', suffix: ' and more text.', atStart: true }
  ]) {
    it(`keeps inserted lines outside the quote ${name}`, () => {
      const quote = 'Selected text'
      const prose = prefix + quote + suffix
      const from = prefix.length
      const to = from + quote.length
      const source = prose + '\n\n' + encodeAnnotation(Text.of([ prose ]), from, to, 'Note')
      const insert = '\nNew line\n'
      const state = EditorState.create({ doc: source, extensions: [ markdown(), documentCommentsField, renderComments ] })
        .update({ changes: { from: atStart ? from : to, insert } }).state
      const shift = atStart ? insert.length : 0
      const expected = { from: from + shift, to: to + shift }
      assert.deepEqual(state.field(documentCommentsField)[0].anchor, expected)
      assert.deepEqual(decoratedRanges(state)[0], [ expected.from, expected.to ])
      const reopened = EditorState.create({ doc: state.doc, extensions: [ markdown(), documentCommentsField ] })
      assert.deepEqual(reopened.field(documentCommentsField)[0].anchor, expected)
    })
  }

  for (const suffix of [ '', ' and more text.' ]) {
    it(`keeps the note without highlighting extra paragraphs when the quote is replaced (suffix length ${suffix.length})`, () => {
      const quote = 'selected text'
      const prose = 'Before ' + quote + suffix
      const from = 'Before '.length
      const to = from + quote.length
      const source = prose + '\n\n' + encodeAnnotation(Text.of([ prose ]), from, to, 'Note')
      const state = EditorState.create({ doc: source, extensions: [ markdown(), documentCommentsField ] })
        .update({ changes: { from, to, insert: 'Rewritten text\n\nA new paragraph.' } }).state
      const [ comment ] = state.field(documentCommentsField)
      assert.equal(comment.text, 'Note')
      assert.equal(comment.anchor, undefined)
    })
  }

})

function decoratedRanges (state: EditorState): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  state.field(commentDecorations).between(0, state.doc.length, (from, to) => {
    ranges.push([ from, to ])
  })
  return ranges
}
