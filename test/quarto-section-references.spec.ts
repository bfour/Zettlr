import assert from 'node:assert/strict'
import { collectQuartoSections } from '../source/common/quarto/section-references'

describe('Quarto section references', () => {
  it('indexes labelled headings and resolves citations across chapters', () => {
    const index = collectQuartoSections([
      {
        path: 'index.qmd',
        content: '# Introduction {#sec-intro .unnumbered}\n\nSee @sec-methods and [@sec-results; @sec-missing].'
      },
      {
        path: 'methods.qmd',
        content: 'Methods {#sec-methods}\n----------------------\n\n## Results {#sec-results} ###\n\nSee @sec-intro.'
      }
    ])

    assert.deepEqual(index.targets, [
      { id: 'sec-intro', title: 'Introduction', path: 'index.qmd', line: 1 },
      { id: 'sec-methods', title: 'Methods', path: 'methods.qmd', line: 1 },
      { id: 'sec-results', title: 'Results', path: 'methods.qmd', line: 4 }
    ])
    assert.deepEqual(index.references, [
      { id: 'sec-methods', path: 'index.qmd', line: 3 },
      { id: 'sec-results', path: 'index.qmd', line: 3 },
      { id: 'sec-missing', path: 'index.qmd', line: 3 },
      { id: 'sec-intro', path: 'methods.qmd', line: 6 }
    ])
    assert.deepEqual(index.unresolved, [{ id: 'sec-missing', path: 'index.qmd', line: 3 }])
    assert.deepEqual(index.duplicateIds, [])
  })

  it('reports duplicate IDs once across the book and retains each definition', () => {
    const index = collectQuartoSections([
      { path: 'index.qmd', content: '# Introduction {#sec-shared}\n\n@sec-shared' },
      { path: 'methods.qmd', content: '# Methods {#sec-shared}\n\n# Follow-up {#sec-shared}' }
    ])

    assert.deepEqual(index.duplicateIds, ['sec-shared'])
    assert.deepEqual(index.targets.map(target => [ target.path, target.line ]), [
      [ 'index.qmd', 1 ],
      [ 'methods.qmd', 1 ],
      [ 'methods.qmd', 3 ]
    ])
    assert.deepEqual(index.unresolved, [])
  })

  it('ignores YAML, code, comments, ordinary citations and unlabelled headings', () => {
    const content = [
      '\uFEFF---',
      'title: "@sec-yaml"',
      '---',
      '',
      '# Sec example',
      '## Ordinary heading {#custom-id}',
      '## Early attribute{#sec-inline} followed by text',
      '',
      '<!--',
      '# Hidden {#sec-comment}',
      'See @sec-comment',
      '-->',
      '',
      '```{python}',
      '# Code example {#sec-fenced}',
      'print("@sec-fenced")',
      '```',
      '',
      '    # Indented code {#sec-indented}',
      '    @sec-indented',
      '',
      'An example `@sec-inline-code` and [@reference2020].',
      '',
      '## Real label {#sec-visible}',
      'See @sec-visible.'
    ].join('\r\n')

    const index = collectQuartoSections([{ path: 'chapter.qmd', content }])
    assert.deepEqual(index.targets, [{ id: 'sec-visible', title: 'Real label', path: 'chapter.qmd', line: 24 }])
    assert.deepEqual(index.references, [{ id: 'sec-visible', path: 'chapter.qmd', line: 25 }])
    assert.deepEqual(index.unresolved, [])
  })
})
