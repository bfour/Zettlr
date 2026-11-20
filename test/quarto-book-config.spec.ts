import assert from 'node:assert/strict'
import { parseQuartoBookConfig } from '@common/quarto/book-config'

describe('Quarto book configuration', () => {
  it('preserves chapter, part, reference, and appendix order', () => {
    const config = parseQuartoBookConfig(`
project:
  type: book
book:
  title: A sample book
  chapters:
    - index.qmd
    - part: Part 1
      chapters:
        - chapters/intro.qmd
        - file: chapters/theory.md
          text: The theory
    - part: parts/practice.qmd
      chapters:
        - href: chapters/example.qmd
    - https://example.com/chapter.qmd
    - unsupported.ipynb
  references: references.qmd
  appendices:
    - appendices/data.qmd
bibliography:
  - sources/main.bib
  - ../shared/other.json
`)
    assert.deepEqual(config, {
      title: 'A sample book',
      chapters: [
        { path: 'index.qmd', appendix: false },
        { path: 'chapters/intro.qmd', part: 'Part 1', appendix: false },
        { path: 'chapters/theory.md', title: 'The theory', part: 'Part 1', appendix: false },
        { path: 'parts/practice.qmd', appendix: false },
        { path: 'chapters/example.qmd', part: 'parts/practice.qmd', appendix: false },
        { path: 'references.qmd', appendix: false },
        { path: 'appendices/data.qmd', appendix: true }
      ],
      bibliography: [ 'sources/main.bib', '../shared/other.json' ]
    })
  })

  it('accepts a single bibliography and no configured title', () => {
    assert.deepEqual(parseQuartoBookConfig('project: {type: book}\nbibliography: refs.bib'), {
      chapters: [],
      bibliography: [ 'refs.bib' ]
    })
  })

  it('ignores files that are not Quarto books and surfaces invalid YAML', () => {
    assert.equal(parseQuartoBookConfig('project: {type: website}'), undefined)
    assert.equal(parseQuartoBookConfig(''), undefined)
    assert.throws(() => parseQuartoBookConfig('project: [book'))
  })

  it('avoids cycles without suppressing chapter lists reused in different parts', () => {
    const config = parseQuartoBookConfig(`
project: {type: book}
book:
  chapters:
    - part: First
      chapters: &shared
        - intro.qmd
        - part: Recursive
          chapters: *shared
    - part: Second
      chapters: *shared
`)
    assert.deepEqual(config?.chapters, [
      { path: 'intro.qmd', part: 'First', appendix: false },
      { path: 'intro.qmd', part: 'Second', appendix: false }
    ])
  })
})
