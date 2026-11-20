/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Citation Autocomplete
 * CVM-Role:        Autocomplete Plugin
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This plugin manages citations.
 *
 * END HEADER
 */

import { acceptCompletion, selectedCompletion, type Completion } from '@codemirror/autocomplete'
import { type EditorState, StateEffect, StateField } from '@codemirror/state'
import { type Command, type EditorView } from '@codemirror/view'
import { type AutocompletePlugin } from '.'
import { configField } from '../util/configuration'
import { quartoSectionsField } from '../plugins/quarto-sections'
import { extractCitationNodes, nodeToCiteItem } from '../parser/citation-parser'

/**
 * Describes a Citation Autocomplete record.
 */
export interface CitationRecord {
  citekey: string
  title: string
  authors: string
  year: string
}

/**
 * Use this effect to provide the editor state with a set of new citekeys
 */
export const citekeyUpdate = StateEffect.define<CitationRecord[]>()
export const citekeyUpdateField = StateField.define<Completion[]>({
  create (_state) {
    return []
  },
  update (val, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(citekeyUpdate)) {
        // Convert the citationentries into completion objects
        return effect.value.map(entry => ({
          label: entry.citekey,
          displayLabel: entry.title || entry.citekey,
          detail: [ entry.authors, entry.year ].filter(Boolean).join(' · '),
          info: entry.citekey,
          apply: applyCitationSuggestion
        }))
      }
    }
    return val
  }
})

function applyCitationSuggestion (view: EditorView, completion: Completion, from: number, to: number): void {
  applyCitationCompletion(view, completion.label, from, to)
}

export const acceptCitationCompletion: Command = view => {
  const apply = selectedCompletion(view.state)?.apply
  return (apply === applyCitationSuggestion || apply === applySectionSuggestion) && acceptCompletion(view)
}

function applySectionSuggestion (view: EditorView, completion: Completion, from: number, to: number): void {
  view.dispatch({
    changes: { from, to, insert: completion.label },
    selection: { anchor: from + completion.label.length },
    userEvent: 'input.complete'
  })
}

/**
 * This function takes the citations from the corresponding database and returns
 * them in a sorted fashion based on which citations occur in the document, by
 * count.
 *
 * @param   {EditorState}  state  The editor state
 *
 * @return  {Completion[]}        The sorted completions
 */
function sortCitationKeysByUsage (state: EditorState): Completion[] {
  // First, get our existing entries in the database, and re-transform them into
  // what the update effect expects
  const entries = state.field(citekeyUpdateField)

  const doc = state.sliceDoc()
  const citationNodes = extractCitationNodes(state).map(node => nodeToCiteItem(node, doc))

  // Then, retrieve the already existing citations
  const existingCitations = citationNodes.flatMap(c => c.items.map(item => item.id))

  // Create a counter
  const citationCounts: Record<string, number> = {}
  for (const key of existingCitations) {
    if (!(key in citationCounts)) {
      citationCounts[key] = 0
    }

    citationCounts[key] += 1
  }

  // Now sort the entries based on the existing citation counts
  return entries.toSorted((a, b) => {
    const countA: number = citationCounts[a.label] ?? 0
    const countB: number = citationCounts[b.label] ?? 0
    return countB - countA
  })
}

function formatCitekey (key: string): string {
  return /^[\w:.#$%&+?<>~/-]*[a-zA-Z0-9]$/.test(key) ? key : `{${key}}`
}

function applyCitationCompletion (view: EditorView, citekey: string, from: number, to: number): void {
  const citeStyle = view.state.field(configField).citeStyle
  const key = formatCitekey(citekey)
  const lineObject = view.state.doc.lineAt(from)
  const line = lineObject.text
  const fromCh = from - lineObject.from
  const toCh = to - lineObject.from

  const afterOpen = line.lastIndexOf('[', fromCh) > line.lastIndexOf(']', fromCh)
  const nextOpen = line.indexOf('[', toCh)
  const nextClose = line.indexOf(']', toCh)
  const beforeClose = nextClose !== -1 && (nextOpen === -1 || nextClose < nextOpen)
  const noBrackets = !afterOpen && !beforeClose

  if (citeStyle === 'regular' && noBrackets) {
    const insert = `[@${key}]`
    view.dispatch({
      // Minus 1 is important since we have to overwrite the @-sign with [@
      changes: [{ from: from - 1, to, insert }],
      selection: { anchor: from - 1 + insert.length - 1 } // Between citekey and ]
    })
  } else if (citeStyle === 'in-text-suffix' && noBrackets) {
    // We should add square brackets after the completion text
    const insert = `${key} []`
    view.dispatch({
      changes: [{ from, to, insert }],
      selection: { anchor: from + insert.length - 1 } // Inside []
    })
  } else {
    // Otherwise: citeStyle was in-text or there were brackets surrounding the
    // citekey, so we can simply replace it
    view.dispatch({ changes: { from, to, insert: key }, selection: { anchor: from + key.length } })
  }
}

export function getCitationPrefix (state: EditorState): { from: number, query: string }|undefined {
  const { empty, head } = state.selection.main
  if (!empty) {
    return undefined
  }

  const { from, text } = state.doc.lineAt(head)
  const prefix = /(?:^|[\s[(;-])@([\p{L}\p{N}_:.+/#$%&?<>~-]*)$/u.exec(text.slice(0, head - from))
  return prefix === null ? undefined : { from: head - prefix[1].length, query: prefix[1] }
}

export function insertCitation (view: EditorView, citekey: string): void {
  if (view.state.readOnly) {
    return
  }

  const prefix = getCitationPrefix(view.state)
  const { from, to } = view.state.selection.main
  if (prefix !== undefined) {
    applyCitationCompletion(view, citekey, prefix.from, to)
    return
  }

  const citeStyle = view.state.field(configField).citeStyle
  const key = formatCitekey(citekey)
  const insert = citeStyle === 'regular' ? `[@${key}]`
    : citeStyle === 'in-text-suffix' ? `@${key} []`
      : `@${key}`
  const hasBrackets = citeStyle === 'regular' || citeStyle === 'in-text-suffix'
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length - Number(hasBrackets) },
    userEvent: 'input.complete'
  })
}

export const requestCitationPicker: Command = view => !view.dom.dispatchEvent(
  new Event('zettlr-citation-picker', { bubbles: true, cancelable: true })
)

export const citations: AutocompletePlugin = {
  applies (ctx) {
    // A valid citekey position is: Beginning of the line (citekey without square
    // brackets), after a square bracket open (regular citation without prefix),
    // or after a space (either a standalone citation or within square brackets
    // but with a prefix). Also, the citekey can be prefixed with a -.
    const { text, from } = ctx.state.doc.lineAt(ctx.pos)
    const textBefore = text.slice(0, ctx.pos - from)
    if (text.startsWith('@') && ctx.pos - from === 1) {
      // The line starts with an @ and the cursor is directly behind it
      return ctx.pos
    } else if (/(?<=[-[\s(])@[^[\]]*$/.test(textBefore)) {
      // The text immediately before the cursor matches a valid citation
      return from + textBefore.lastIndexOf('@') + 1
    } else {
      // Nopey
      return false
    }
  },
  entries (ctx, query) {
    query = query.toLowerCase()
    const sections = ctx.state.field(quartoSectionsField, false)
    const matches = sections === undefined ? [] : [...sections.values()]
      .filter(({ id, title }) => id.toLowerCase().includes(query) || title.toLowerCase().includes(query))
      .map(({ id, title }): Completion => ({
        label: id,
        displayLabel: title || id,
        detail: id,
        apply: applySectionSuggestion
      }))
    if (sections !== undefined && query.startsWith('sec-')) {
      return matches
    }

    const entries = sortCitationKeysByUsage(ctx.state)
    return matches.concat(entries.filter(entry => {
      return [ entry.label, entry.displayLabel, entry.detail ].some(value => value?.toLowerCase().includes(query) === true)
    }))
  },
  fields: [ citekeyUpdateField, quartoSectionsField ]
}
