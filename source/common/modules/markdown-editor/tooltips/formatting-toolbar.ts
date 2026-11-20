/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Formatting Toolbar
 * CVM-Role:        Extension
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This extension can display a formatting bar for selections.
 *
 * END HEADER
 */

import { EditorView, showTooltip, type Tooltip } from '@codemirror/view'
import { type EditorState, StateField } from '@codemirror/state'
import { applyBold, applyCode, applyComment, applyItalic, applyPandocDivOrSpan, insertImage, insertLink, applyHighlightColor, applyStrikethrough } from '../commands/markdown'
import { trans } from '@common/i18n-renderer'
import { configField } from '../util/configuration'

function getToolbar (state: EditorState): Tooltip[] {
  const { showFormattingToolbar } = state.field(configField)
  const mainSel = state.selection.main
  if (mainSel.empty || !showFormattingToolbar) {
    return []
  }

  // Bold | Italic | Link | Image | Comment | Code

  return [{
    pos: mainSel.head,
    above: mainSel.head < mainSel.anchor,
    strictSide: false,
    arrow: true,
    create: (view) => {
      const dom = document.createElement('div')
      dom.className = 'cm-formatting-bar'

      const buttonWrapper = document.createElement('div')
      buttonWrapper.className = 'button-wrapper'

      const bold = document.createElement('button')
      bold.classList.add('formatting-toolbar-button')
      bold.setAttribute('title', trans('Bold'))
      bold.innerHTML = '<cds-icon shape="bold"></cds-icon>'

      const italic = document.createElement('button')
      italic.classList.add('formatting-toolbar-button')
      italic.setAttribute('title', trans('Italics'))
      italic.innerHTML = '<cds-icon shape="italic"></cds-icon>'

      const underline = document.createElement('button')
      underline.classList.add('formatting-toolbar-button')
      underline.setAttribute('title', trans('Underline'))
      underline.innerHTML = '<cds-icon shape="underline"></cds-icon>'

      const highlight = document.createElement('button')
      highlight.classList.add('formatting-toolbar-button')
      highlight.setAttribute('title', trans('Highlight'))
      highlight.setAttribute('aria-label', trans('Highlight color'))
      highlight.setAttribute('aria-expanded', 'false')
      highlight.innerHTML = '<cds-icon shape="highlighter"></cds-icon>'

      const palette = document.createElement('div')
      palette.className = 'highlight-palette'
      palette.hidden = true
      palette.setAttribute('role', 'group')
      palette.setAttribute('aria-label', trans('Highlight color'))

      const colors = [
        { label: trans('Default') },
        { label: trans('Yellow'), color: '#ffcd3666' },
        { label: trans('Green'), color: '#65d68a66' },
        { label: trans('Blue'), color: '#67bfff66' },
        { label: trans('Pink'), color: '#ff83b466' },
        { label: trans('Purple'), color: '#ba9fff66' }
      ]
      function showPalette (visible: boolean): void {
        palette.hidden = !visible
        highlight.setAttribute('aria-expanded', String(visible))
      }

      for (const { label, color } of colors) {
        const swatch = document.createElement('button')
        swatch.type = 'button'
        swatch.title = label
        swatch.setAttribute('aria-label', label)
        if (color === undefined) {
          swatch.textContent = label
        } else {
          swatch.className = 'highlight-swatch'
          swatch.style.setProperty('--swatch-color', color.slice(0, 7))
        }
        swatch.onmousedown = event => event.preventDefault()
        swatch.onclick = () => {
          showPalette(false)
          applyHighlightColor(view, color)
          view.focus()
        }
        palette.append(swatch)
      }

      palette.onkeydown = event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          showPalette(false)
          highlight.focus()
        }
      }

      const strikethrough = document.createElement('button')
      strikethrough.classList.add('formatting-toolbar-button')
      strikethrough.setAttribute('title', trans('Strikethrough'))
      strikethrough.innerHTML = '<cds-icon shape="strikethrough"></cds-icon>'

      const link = document.createElement('button')
      link.classList.add('formatting-toolbar-button')
      link.setAttribute('title', trans('Link'))
      link.innerHTML = '<cds-icon shape="link"></cds-icon>'

      const image = document.createElement('button')
      image.classList.add('formatting-toolbar-button')
      image.setAttribute('title', trans('Image'))
      image.innerHTML = '<cds-icon shape="image"></cds-icon>'

      const comment = document.createElement('button')
      comment.classList.add('formatting-toolbar-button')
      comment.setAttribute('title', trans('Comment'))
      comment.innerHTML = '<cds-icon shape="chat-bubble"></cds-icon>'

      const code = document.createElement('button')
      code.classList.add('formatting-toolbar-button')
      code.setAttribute('title', trans('Code'))
      code.innerHTML = '<cds-icon shape="code-alt"></cds-icon>'

      buttonWrapper.append(bold, italic, underline, highlight, strikethrough, link, image, comment, code)
      dom.append(buttonWrapper, palette)

      // NOTE: We need to use the onmousedown event here, since the click only
      // triggers after onmouseup, and by that time the editor has gone through
      // a transaction cycle that has re-rendered the tooltip.
      bold.onmousedown = function (event) {
        event.preventDefault()
        applyBold(view)
      }
      italic.onmousedown = function (event) {
        event.preventDefault()
        applyItalic(view)
      }
      underline.onmousedown = function (event) {
        event.preventDefault()
        applyPandocDivOrSpan(view, 'span', { classes: ['underline'] })
      }
      highlight.onmousedown = event => event.preventDefault()
      highlight.onclick = event => {
        showPalette(palette.hidden)
        if (!palette.hidden && event.detail === 0) {
          palette.querySelector('button')?.focus()
        }
      }
      strikethrough.onmousedown = function (event) {
        event.preventDefault()
        applyStrikethrough(view)
      }
      link.onmousedown = function (event) {
        event.preventDefault()
        insertLink(view)
      }
      image.onmousedown = function (event) {
        event.preventDefault()
        insertImage(view)
      }
      comment.onmousedown = function (event) {
        event.preventDefault()
        applyComment(view)
      }
      code.onmousedown = function (event) {
        event.preventDefault()
        applyCode(view)
      }

      return { dom }
    }
  }]
}

const formattingToolbarPlugin = StateField.define<readonly Tooltip[]>({
  create (state) {
    return getToolbar(state)
  },

  update (tooltips, transaction) {
    return getToolbar(transaction.state)
  },

  provide: f => showTooltip.computeN([f], state => state.field(f))
})

export const formattingToolbar = [
  formattingToolbarPlugin,
  EditorView.baseTheme({
    // Formatting bar
    '.cm-tooltip.cm-formatting-bar': {
      borderRadius: '8px',
      maxWidth: 'initial'
    },
    '.cm-tooltip.cm-formatting-bar .button-wrapper': {
      display: 'flex'
    },
    '.cm-tooltip.cm-formatting-bar .highlight-palette:not([hidden])': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '5px',
      padding: '6px',
      borderTop: '1px solid var(--zettlr-editor-border-color, #8885)'
    },
    '.cm-tooltip.cm-formatting-bar button.highlight-swatch': {
      width: '20px',
      height: '20px',
      padding: '0',
      border: '1px solid #2226',
      borderRadius: '4px',
      background: 'var(--swatch-color)'
    },
    '.cm-tooltip.cm-formatting-bar button.formatting-toolbar-button': {
      border: 'none',
      margin: '0',
      backgroundColor: 'transparent',
      borderRadius: '0',
      lineHeight: '30px',
      padding: '0',
      width: '30px'
    },
    '.cm-tooltip.cm-formatting-bar button.formatting-toolbar-button:first-child': {
      borderTopLeftRadius: '8px',
      borderBottomLeftRadius: '8px'
    },
    '.cm-tooltip.cm-formatting-bar button.formatting-toolbar-button:last-child': {
      borderTopRightRadius: '8px',
      borderBottomRightRadius: '8px'
    }
  })
]
