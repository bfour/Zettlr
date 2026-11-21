import assert from 'node:assert/strict'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { applyHighlight, applyHighlightColor } from '../source/common/modules/markdown-editor/commands/markdown'
import markdownParser from '../source/common/modules/markdown-editor/parser/markdown-parser'
import { configField, configUpdateEffect } from '../source/common/modules/markdown-editor/util/configuration'
import { md2html } from '../source/common/modules/markdown-utils'

const yellow = '#ffdf8066'
const blue = '#79bdff66'

describe('Highlight colors', () => {
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
        extensions: [ markdownParser(), configField, EditorState.allowMultipleSelections.of(true) ]
      })
    })
    return view
  }

  it('highlights selected text and leaves its emphasis markup intact', () => {
    const prose = 'Read **the result** carefully.'
    const inner = '**the result**'
    const from = prose.indexOf(inner)
    const editor = edit(prose, EditorSelection.single(from, from + inner.length))

    assert.equal(applyHighlightColor(editor, yellow), true)
    assert.equal(editor.state.doc.toString(), `Read [${inner}]{.mark style="background-color: ${yellow}"} carefully.`)
    assert.equal(editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to), inner)
  })

  it('reuses the configured color for toolbar and keyboard highlights', () => {
    const editor = edit('first and second', EditorSelection.single(0, 5))
    editor.dispatch({ effects: configUpdateEffect.of({ highlightColor: blue }) })

    assert.equal(applyHighlightColor(editor), true)
    const from = editor.state.doc.toString().indexOf('second')
    editor.dispatch({ selection: EditorSelection.single(from, from + 6) })
    assert.equal(applyHighlight(editor), true)
    assert.equal(editor.state.doc.toString(), `[first]{.mark style="background-color: ${blue}"} and [second]{.mark style="background-color: ${blue}"}`)

    editor.dispatch({ effects: configUpdateEffect.of({ highlightColor: null }) })
    assert.equal(applyHighlightColor(editor), true)
    assert.equal(editor.state.doc.toString(), `[first]{.mark style="background-color: ${blue}"} and ==second==`)
  })

  it('recolors an existing highlight with only the highlighted text selected', () => {
    const source = `[one passage]{.mark style="background-color: ${yellow}"}`
    const editor = edit(source, EditorSelection.single(1, 1 + 'one passage'.length))

    assert.equal(applyHighlightColor(editor, blue), true)
    assert.equal(editor.state.doc.toString(), `[one passage]{.mark style="background-color: ${blue}"}`)
  })

  it('replaces a fully selected default highlight without nesting its markup', () => {
    const source = '==one passage=='
    const editor = edit(source, EditorSelection.single(0, source.length))

    assert.equal(applyHighlightColor(editor, yellow), true)
    assert.equal(editor.state.doc.toString(), `[one passage]{.mark style="background-color: ${yellow}"}`)
  })

  it('restores the configured default highlight markup', () => {
    const source = `[one passage]{.mark style="background-color: ${yellow}"}`
    const editor = edit(source, EditorSelection.single(0, source.length))

    assert.equal(applyHighlightColor(editor, undefined), true)
    assert.equal(editor.state.doc.toString(), '==one passage==')

    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: source },
      selection: EditorSelection.single(0, source.length),
      effects: configUpdateEffect.of({ highlightFormatting: 'span' })
    })
    assert.equal(applyHighlightColor(editor, undefined), true)
    assert.equal(editor.state.doc.toString(), '[one passage]{.mark}')
  })

  for (const text of [ ' result', 'sul' ]) {
    it(`uses a default Pandoc span when legacy markers cannot wrap "${text}"`, () => {
      const source = 'A result here'
      const from = source.indexOf(text)
      const editor = edit(source, EditorSelection.single(from, from + text.length))

      assert.equal(applyHighlightColor(editor), true)
      assert.equal(editor.state.doc.toString(), source.replace(text, `[${text}]{.mark}`))
      assert.match(syntaxTree(editor.state).toString(), /PandocSpan\(/)
    })
  }

  it('highlights multiple selections, preserving a reversed selection', () => {
    const source = 'first and second'
    const editor = edit(source, EditorSelection.create([
      EditorSelection.range(5, 0),
      EditorSelection.range(10, 16)
    ]))

    assert.equal(applyHighlightColor(editor, blue), true)
    assert.equal(editor.state.doc.toString(), `[first]{.mark style="background-color: ${blue}"} and [second]{.mark style="background-color: ${blue}"}`)
    const [ first, second ] = editor.state.selection.ranges
    assert.equal(first.anchor > first.head, true)
    assert.equal(editor.state.sliceDoc(first.from, first.to), 'first')
    assert.equal(editor.state.sliceDoc(second.from, second.to), 'second')
  })

  it('preserves the selected highlight color in HTML conversion', async () => {
    const result = await md2html(`[**one passage**]{.mark style="background-color: ${blue}"}`, {
      zknLinkFormat: 'link|title',
      onCitation: () => undefined
    })
    const template = document.createElement('template')
    template.innerHTML = result

    const highlight = template.content.querySelector('.mark')
    assert.equal(highlight?.getAttribute('style'), `background-color: ${blue}`)
    assert.equal(highlight?.querySelector('strong')?.textContent, 'one passage')
  })

  it('keeps the paragraph break when a selection spans two paragraphs', () => {
    const source = 'First paragraph.\n\nSecond paragraph.'
    const editor = edit(source, EditorSelection.single(0, source.length))

    assert.equal(applyHighlightColor(editor, blue), true)
    assert.equal(
      editor.state.doc.toString(),
      `[First paragraph.]{.mark style="background-color: ${blue}"}\n\n[Second paragraph.]{.mark style="background-color: ${blue}"}`
    )
  })
})
