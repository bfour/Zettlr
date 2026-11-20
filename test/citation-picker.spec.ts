import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { JSDOM } from 'jsdom'
import { getCitationPrefix, insertCitation } from '../source/common/modules/markdown-editor/autocomplete/citations'
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
  it('replaces a typed citation fragment and keeps existing brackets', () => {
    const state = EditorState.create({ doc: 'Text [@old]', selection: { anchor: 10 }, extensions: [ configField ] })
    const dom = new JSDOM('', { pretendToBeVisual: true })
    const view = new EditorView({ state, parent: dom.window.document.body })
    try {
      assert.deepEqual(getCitationPrefix(view.state), { from: 7, query: 'old' })
      insertCitation(view, 'smith2024')
      assert.equal(view.state.doc.toString(), 'Text [@smith2024]')
    } finally {
      view.destroy()
      dom.window.close()
    }
  })

  it('respects narrative style and quotes keys that require braces', () => {
    const state = EditorState.create({ doc: '', extensions: [ configField ] })
    const dom = new JSDOM('', { pretendToBeVisual: true })
    const view = new EditorView({ state, parent: dom.window.document.body })
    try {
      view.dispatch({ effects: configUpdateEffect.of({ citeStyle: 'in-text-suffix' }) })
      insertCitation(view, 'Müller 2024')
      assert.equal(view.state.doc.toString(), '@{Müller 2024} []')
      assert.equal(view.state.selection.main.head, view.state.doc.length - 1)
    } finally {
      view.destroy()
      dom.window.close()
    }
  })
})
