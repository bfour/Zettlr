import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import markdownParser from '../source/common/modules/markdown-editor/parser/markdown-parser'
import { renderImages } from '../source/common/modules/markdown-editor/renderers/render-images'
import { configField, configUpdateEffect, getDefaultConfig } from '../source/common/modules/markdown-editor/util/configuration'

describe('Inline image previews', () => {
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

  function createPreview (markdown: string): HTMLImageElement {
    const state = EditorState.create({
      doc: 'Chapter text\n\n' + markdown,
      extensions: [ markdownParser(), configField, renderImages ]
    }).update({
      effects: configUpdateEffect.of({
        metadata: { ...getDefaultConfig().metadata, path: '/book.v2/chapters/design.qmd' }
      })
    }).state
    view = new EditorView({ state })

    const img = view.dom.querySelector<HTMLImageElement>('.image-preview img')
    assert(img)
    return img
  }

  function failImageLoad (img: HTMLImageElement): void {
    img.dispatchEvent(new window.Event('error'))
  }

  it('tries PNG and SVG variants relative to the chapter for an extensionless link', () => {
    const markdown = '![Study design](<../generated/fig design>){#fig-design width="100%"}'
    const img = createPreview(markdown)
    const original = 'safe-file:///book.v2/generated/fig%20design'

    assert.equal(img.src, original)
    failImageLoad(img)
    assert.equal(img.src, original + '.png')
    failImageLoad(img)
    assert.equal(img.src, original + '.svg')
    assert.equal(img.dataset.originalUrl, '<../generated/fig design>')
    assert.equal(view?.state.doc.toString(), 'Chapter text\n\n' + markdown)
  })

  for (const source of [ '../generated/missing.svg', 'https://example.com/badge' ]) {
    it('keeps ' + source + ' as the only candidate', () => {
      const img = createPreview('![Diagram](' + source + ')')
      failImageLoad(img)
      assert.match(img.src, /^data:image\/png;base64,/)
      assert.equal(img.onerror, null)
    })
  }
})
