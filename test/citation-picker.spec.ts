import assert from 'node:assert/strict'
import { autocompletion, selectedCompletion, startCompletion } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, runScopeHandlers } from '@codemirror/view'
import { citekeyUpdate, citekeyUpdateField, getCitationPrefix, insertCitation } from '../source/common/modules/markdown-editor/autocomplete/citations'
import { mainEditorKeybindings } from '../source/common/modules/markdown-editor/keymaps/default'
import { configField, configUpdateEffect } from '../source/common/modules/markdown-editor/util/configuration'
import { searchCitations, toCitationPickerResult } from '../source/win-main/util/citation-picker'

describe('Citation picker', () => {
  it('uses CSL authors, title and publication year for the result row', () => {
    const citation = toCitationPickerResult({
      id: 'research2022',
      type: 'article-journal',
      author: [
        { given: 'María', 'non-dropping-particle': 'de', family: 'López' },
        { literal: 'World Health Organization' }
      ],
      title: 'Reporting Across Chapters',
      issued: { 'date-parts': [[2022, 6, 18]] }
    })
    assert.deepEqual(citation, {
      citekey: 'research2022',
      title: 'Reporting Across Chapters',
      authors: 'María de López, World Health Organization',
      year: '2022'
    })
  })

  it('handles missing metadata, editor names and literal dates', () => {
    const citation = toCitationPickerResult({
      id: 'collection',
      type: 'book',
      author: [],
      editor: [{ given: 'Sam', family: 'Ng' }],
      'container-title': 'Collected Studies',
      issued: { literal: 'Spring 1998' }
    })
    assert.deepEqual(citation, {
      citekey: 'collection',
      title: 'Collected Studies',
      authors: 'Sam Ng',
      year: '1998'
    })
    assert.deepEqual(toCitationPickerResult({ id: 'untitled', type: 'book', issued: { 'date-parts': [] } }), {
      citekey: 'untitled',
      title: '',
      authors: '',
      year: ''
    })
  })

  it('matches text across fields and combines dedicated author, year and title filters', () => {
    const entries = [
      { citekey: 'data:2023', title: 'Survey Data', authors: 'Ana García', year: '2023' },
      { citekey: 'g18', title: 'Survey Results', authors: 'Ana García', year: '2018' },
      { citekey: 'ng2023', title: 'Survey Results', authors: 'Anton Ng', year: '2023' }
    ]
    assert.deepEqual(searchCitations(entries, { text: 'garcia data 2023' }, new Set()), [ entries[0] ])
    assert.deepEqual(searchCitations(entries, { text: '@data:2023' }, new Set()), [ entries[0] ])
    assert.deepEqual(searchCitations(entries, { author: 'garcia', year: '2023', title: 'survey' }, new Set()), [ entries[0] ])
    assert.deepEqual(searchCitations(entries, { title: 'garcia' }, new Set()), [])
  })

  it('places matching citations already used in the workspace first', () => {
    const entries = [
      { citekey: 'alpha', title: 'Alpha book', authors: '', year: '' },
      { citekey: 'beta', title: 'Beta article', authors: '', year: '' },
      { citekey: 'zeta', title: 'Zeta book', authors: '', year: '' }
    ]
    const used = new Set([ 'beta', 'zeta' ])
    assert.deepEqual(searchCitations(entries, { text: 'book' }, used), [ entries[2], entries[0] ])
    assert.deepEqual(searchCitations(entries, {}, used), [ entries[1], entries[2], entries[0] ])
    assert.deepEqual(entries.map(citation => citation.citekey), [ 'alpha', 'beta', 'zeta' ])
  })
})

describe('Citation picker insertion', () => {
  const originalRequestFrame = window.requestAnimationFrame
  const originalCancelFrame = window.cancelAnimationFrame
  const originalLanguage = window.config.get('appLang')

  before(() => {
    window.config.set('appLang', 'en')
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 0)
    window.cancelAnimationFrame = id => window.clearTimeout(id)
  })

  after(() => {
    window.config.set('appLang', originalLanguage)
    window.requestAnimationFrame = originalRequestFrame
    window.cancelAnimationFrame = originalCancelFrame
  })

  it('replaces a typed citation fragment and keeps existing brackets', () => {
    const state = EditorState.create({ doc: 'Text [@old]', selection: { anchor: 10 }, extensions: [ configField ] })
    const view = new EditorView({ state })
    try {
      assert.deepEqual(getCitationPrefix(view.state), { from: 7, query: 'old' })
      insertCitation(view, 'smith2024')
      assert.equal(view.state.doc.toString(), 'Text [@smith2024]')
    } finally {
      view.destroy()
    }
  })

  it('respects narrative style and quotes keys that require braces', () => {
    const state = EditorState.create({ doc: '', extensions: [ configField ] })
    const view = new EditorView({ state })
    try {
      view.dispatch({ effects: configUpdateEffect.of({ citeStyle: 'in-text-suffix' }) })
      insertCitation(view, 'Müller 2024')
      assert.equal(view.state.doc.toString(), '@{Müller 2024} []')
      assert.equal(view.state.selection.main.head, view.state.doc.length - 1)
    } finally {
      view.destroy()
    }
  })
  it('uses Enter for inline citations with the general autocomplete preference off', async () => {
    const keys = mainEditorKeybindings([], { autocompleteWithEnter: false, autocompleteWithTab: true })
    const state = EditorState.create({
      doc: '@smi',
      selection: { anchor: 4 },
      extensions: [
        configField,
        citekeyUpdateField,
        keymap.of(keys),
        autocompletion({
          defaultKeymap: false,
          interactionDelay: 0,
          override: [ ctx => ({ from: 1, options: ctx.state.field(citekeyUpdateField) }) ]
        })
      ]
    })
    const view = new EditorView({ state })
    try {
      view.dispatch({ effects: citekeyUpdate.of([
        { citekey: 'smith2024', title: 'Research', authors: 'Smith', year: '2024' }
      ]) })
      await openCompletion(view)
      assert.equal(runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor'), true)
      assert.equal(view.state.doc.toString(), '[@smith2024]')
    } finally {
      view.destroy()
    }
  })

  it('keeps Enter as a newline for other suggestions when the preference is off', async () => {
    const keys = mainEditorKeybindings([], { autocompleteWithEnter: false, autocompleteWithTab: true })
    const state = EditorState.create({
      doc: 'exam',
      selection: { anchor: 4 },
      extensions: [
        configField,
        keymap.of(keys),
        autocompletion({
          defaultKeymap: false,
          interactionDelay: 0,
          override: [ () => ({ from: 0, options: [{ label: 'example' }] }) ]
        })
      ]
    })
    const view = new EditorView({ state })
    try {
      await openCompletion(view)
      assert.equal(runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor'), true)
      assert.equal(view.state.doc.toString(), 'exam\n')
    } finally {
      view.destroy()
    }
  })

})

async function openCompletion (view: EditorView): Promise<void> {
  assert.equal(startCompletion(view), true)
  for (let attempt = 0; attempt < 40 && selectedCompletion(view.state) === null; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.ok(selectedCompletion(view.state))
}
