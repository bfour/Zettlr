import { ensureSyntaxTree, language, syntaxTree } from '@codemirror/language'
import type { EditorState, SelectionRange } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { formatPandocAttributes, parsePandocAttributes } from 'source/common/pandoc-util/parse-pandoc-attributes'
import { isColoredHighlightStyle, isHighlightBoundary } from '../util/highlight-style'

interface Span {
  from: number
  to: number
}

interface Edit extends Span {
  insert: string
}

interface Highlight {
  content: Span
  highlightEnd: string
  legacyMarker?: string
  retainedEnd: string
}

function readHighlight (state: EditorState, node: SyntaxNode): Highlight|undefined {
  const isSpan = node.name === 'PandocSpan'
  const [ opening, closing ] = node.getChildren(isSpan ? 'PandocSpanMark' : 'HighlightMark')
  if (opening === undefined || closing === undefined) {
    return undefined
  }

  const content = { from: opening.to, to: closing.from }
  if (!isSpan) {
    return {
      content,
      highlightEnd: ']{.mark}',
      legacyMarker: state.sliceDoc(opening.from, opening.to),
      retainedEnd: ''
    }
  }

  const attributes = node.getChild('PandocAttribute')
  if (attributes === null) {
    return undefined
  }
  const { classes = [], id, properties: { style, ...properties } = {} } = parsePandocAttributes(state.sliceDoc(attributes.from, attributes.to))
  if (!classes.includes('mark')) {
    return undefined
  }

  let highlightStyle: string|undefined
  let retainedStyle: string|undefined = style
  if (isColoredHighlightStyle(style)) {
    highlightStyle = style
    retainedStyle = undefined
  } else if (style !== undefined) {
    const css = document.createElement('span').style
    css.cssText = style
    const priority = css.getPropertyPriority('background-color')
    const color = css.removeProperty('background-color')
    if (color !== '') {
      highlightStyle = `background-color: ${color}${priority === '' ? '' : ' !important'}`
      retainedStyle = css.cssText || undefined
    }
  }

  const retainedClasses = classes.filter(className => className !== 'mark')
  if (retainedStyle !== undefined) {
    properties.style = retainedStyle
  }
  const retainedAttributes = formatPandocAttributes({
    id,
    classes: retainedClasses.length > 0 ? retainedClasses : undefined,
    properties: Object.keys(properties).length > 0 ? properties : undefined
  })
  const highlightAttributes = formatPandocAttributes({
    classes: ['mark'],
    properties: highlightStyle === undefined ? undefined : { style: highlightStyle }
  })

  return {
    content,
    highlightEnd: `]{${highlightAttributes}}`,
    retainedEnd: retainedAttributes === '' ? '' : `]{${retainedAttributes}}`
  }
}

function selectedParts (ranges: readonly SelectionRange[], node: SyntaxNode, content: Span): Span[] {
  if (ranges.some(range => range.empty && range.from > node.from && range.from < node.to)) {
    return [content]
  }

  const syntax = []
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.from >= content.from && child.to <= content.to) {
      syntax.push(child)
    }
  }

  const parts: Span[] = []
  for (const range of ranges) {
    let from = Math.max(content.from, range.from)
    let to = Math.min(content.to, range.to)
    if (from >= to) {
      continue
    }

    // A closing highlight wrapper must never split another inline construct.
    for (const child of syntax) {
      if (child.from < from && child.to > from) {
        from = child.from
      }
      if (child.from < to && child.to > to) {
        to = child.to
      }
    }

    const previous = parts.at(-1)
    if (previous !== undefined && from <= previous.to) {
      previous.to = Math.max(previous.to, to)
    } else {
      parts.push({ from, to })
    }
  }

  return parts
}

function addUnselectedHighlight (
  state: EditorState,
  node: SyntaxNode,
  highlight: Highlight,
  remaining: Span,
  opening: Edit,
  closing: Edit,
  edits: Edit[]
): void {
  const text = state.sliceDoc(remaining.from, remaining.to)
  const trimmed = text.trim()
  if (trimmed === '') {
    return
  }

  const from = remaining.from + text.length - text.trimStart().length
  const to = from + trimmed.length
  const left = from === highlight.content.from ? node.from : from
  const right = to === highlight.content.to ? node.to : to
  // Legacy marks cannot open or close next to a letter outside the mark.
  // A Pandoc span can retain highlighting even after a mid-word selection.
  const marker = highlight.legacyMarker
  const keepLegacy = marker !== undefined &&
    isHighlightBoundary(state.sliceDoc(Math.max(0, left - 1), left)) &&
    !isHighlightBoundary(trimmed[0]) &&
    isHighlightBoundary(state.sliceDoc(right, right + 1))
  const start = keepLegacy ? marker : '['
  const end = keepLegacy ? marker : highlight.highlightEnd

  if (from === highlight.content.from) {
    opening.insert += start
  } else {
    edits.push({ from, to: from, insert: start })
  }
  if (to === highlight.content.to) {
    closing.insert = end + closing.insert
  } else {
    edits.push({ from: to, to, insert: end })
  }
}

/**
 * Clears parsed highlight markup without cutting through other inline syntax.
 */
export function clearHighlight (view: EditorView): boolean {
  const state = view.state
  if (state.readOnly || state.facet(language)?.name !== 'markdown') {
    return false
  }

  const ranges = state.selection.ranges
  const from = ranges[0].from
  const to = ranges[ranges.length - 1].to
  const edits: Edit[] = []

  const tree = ensureSyntaxTree(state, state.doc.lineAt(to).to) ?? syntaxTree(state)
  tree.iterate({
    from,
    to,
    enter ({ node, name }) {
      if ([ 'CodeBlock', 'FencedCode', 'InlineCode', 'YAMLFrontmatter' ].includes(name)) {
        return false
      }
      if (name !== 'HighlightContent' && name !== 'PandocSpan') {
        return
      }
      const highlight = readHighlight(state, node)
      if (highlight === undefined) {
        return
      }

      const parts = selectedParts(ranges, node, highlight.content)
      if (parts.length === 0) {
        return
      }
      const opening = { from: node.from, to: highlight.content.from, insert: highlight.retainedEnd === '' ? '' : '[' }
      const closing = { from: highlight.content.to, to: node.to, insert: highlight.retainedEnd }
      let start = highlight.content.from
      for (const part of parts) {
        addUnselectedHighlight(state, node, highlight, { from: start, to: part.from }, opening, closing, edits)
        start = part.to
      }
      addUnselectedHighlight(state, node, highlight, { from: start, to: highlight.content.to }, opening, closing, edits)
      edits.push(opening, closing)
    }
  })

  if (edits.length === 0) {
    return false
  }

  edits.sort((a, b) => a.from - b.from || a.to - b.to)
  view.dispatch({ changes: edits, userEvent: 'input.format' })
  return true
}
