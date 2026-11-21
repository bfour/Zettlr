import assert from 'node:assert/strict'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { clearHighlight } from '../source/common/modules/markdown-editor/commands/clear-highlight'
import markdownParser from '../source/common/modules/markdown-editor/parser/markdown-parser'

describe('Clear highlight', () => {
  const originalRequestFrame = window.requestAnimationFrame
  const originalCancelFrame = window.cancelAnimationFrame
  let view: EditorView|undefined

  before(() => {
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 0)
    window.cancelAnimationFrame = id => window.clearTimeout(id)
  })

  after(() => {
    window.requestAnimationFrame = originalRequestFrame
    window.cancelAnimationFrame = originalCancelFrame
  })

  afterEach(() => {
    view?.destroy()
    view = undefined
  })

  function edit (doc: string, selection: EditorSelection): EditorView {
    view = new EditorView({
      state: EditorState.create({
        doc,
        selection,
        extensions: [ markdownParser(), EditorState.allowMultipleSelections.of(true) ]
      })
    })
    return view
  }

  it('clears a legacy highlight at the caret and preserves emphasis', () => {
    const source = 'Start ==the **bold** words== end.'
    const cursor = source.indexOf('bold') + 1
    const editor = edit(source, EditorSelection.single(cursor))

    assert.equal(clearHighlight(editor), true)
    assert.equal(editor.state.doc.toString(), 'Start the **bold** words end.')
    assert.equal(editor.state.selection.main.head, cursor - 2)
  })

  it('clears a colored highlight with only its inner text selected', () => {
    const source = '[selected words]{.mark style="background-color: #ffdf8066"}'
    const editor = edit(source, EditorSelection.single(1, 15))

    assert.equal(clearHighlight(editor), true)
    assert.equal(editor.state.doc.toString(), 'selected words')
    assert.deepEqual(editor.state.selection.main.toJSON(), { anchor: 0, head: 14 })
  })

  it('retains the highlight on words outside a partial selection', () => {
    const source = '==first middle last=='
    const from = source.indexOf('middle')
    const editor = edit(source, EditorSelection.single(from, from + 'middle'.length))

    assert.equal(clearHighlight(editor), true)
    assert.equal(editor.state.doc.toString(), '==first== middle ==last==')
    const { from: start, to: end } = editor.state.selection.main
    assert.equal(editor.state.sliceDoc(start, end), 'middle')
  })

  it('keeps partial words highlighted without leaving invalid legacy delimiters', () => {
    const source = '==highlight=='
    const editor = edit(source, EditorSelection.single(6, 7))

    assert.equal(clearHighlight(editor), true)
    assert.equal(editor.state.doc.toString(), '[high]{.mark}l[ight]{.mark}')
  })

  it('does not split nested emphasis to clear a partial selection', () => {
    const source = '==first **bold words** last=='
    const from = source.indexOf('bold')
    const editor = edit(source, EditorSelection.single(from, from + 'bold'.length))

    assert.equal(clearHighlight(editor), true)
    assert.equal(editor.state.doc.toString(), '==first== **bold words** ==last==')
  })

  it('preserves a span ID, unrelated classes and attributes', () => {
    const source = '[**marked**]{#anchor .mark .custom lang=en style="background-color: #79bdff66"}'
    const editor = edit(source, EditorSelection.single(0, source.length))

    assert.equal(clearHighlight(editor), true)
    assert.equal(editor.state.doc.toString(), '[**marked**]{#anchor .custom lang="en"}')
  })

  it('keeps one span ID when clearing multiple ranges within a colored highlight', () => {
    const source = '[one two three four five]{#anchor .mark .custom style="background-color: #79bdff66"}'
    const two = source.indexOf('two')
    const four = source.indexOf('four')
    const editor = edit(source, EditorSelection.create([
      EditorSelection.range(two, two + 3),
      EditorSelection.range(four, four + 4)
    ]))

    assert.equal(clearHighlight(editor), true)
    assert.equal(
      editor.state.doc.toString(),
      '[[one]{.mark style="background-color: #79bdff66"} two [three]{.mark style="background-color: #79bdff66"} four [five]{.mark style="background-color: #79bdff66"}]{#anchor .custom}'
    )
    assert.equal(syntaxTree(editor.state).topNode.getChild('Paragraph')?.getChild('PandocSpan')?.getChildren('PandocSpan').length, 3)
  })

  it('preserves surrounding punctuation and legacy highlight spans', () => {
    const source = '==Alpha, beta!? gamma==.'
    const from = source.indexOf('beta')
    const editor = edit(source, EditorSelection.single(from, from + 'beta!?'.length))

    assert.equal(clearHighlight(editor), true)
    assert.equal(editor.state.doc.toString(), '==Alpha,== beta!? ==gamma==.')
    assert.equal(syntaxTree(editor.state).topNode.getChild('Paragraph')?.getChildren('HighlightContent').length, 2)
  })

  it('clears nested highlights at the caret without leaving their wrappers', () => {
    const source = '[before [inner]{.mark style="background-color: #79bdff66"} after]{.mark}'
    const editor = edit(source, EditorSelection.single(source.indexOf('inner') + 1))

    assert.equal(clearHighlight(editor), true)
    assert.equal(editor.state.doc.toString(), 'before inner after')
  })

  it('clears multiple selections without touching code or unrelated spans', () => {
    const source = '==first== and [second]{.mark}; `==test==` [unrelated]{.custom}'
    const second = source.indexOf('second')
    const editor = edit(source, EditorSelection.create([
      EditorSelection.range(9, 0),
      EditorSelection.range(second, second + 'second'.length),
      EditorSelection.cursor(source.indexOf('test') + 1)
    ]))

    assert.equal(clearHighlight(editor), true)
    assert.equal(editor.state.doc.toString(), 'first and second; `==test==` [unrelated]{.custom}')
    assert.deepEqual(editor.state.selection.ranges[0].toJSON(), { anchor: 5, head: 0 })
  })

  it('does not act outside parsed highlights', () => {
    const source = '`==example==` ordinary'
    const editor = edit(source, EditorSelection.single(0, source.length))

    assert.equal(clearHighlight(editor), false)
    assert.equal(editor.state.doc.toString(), source)
  })
})
