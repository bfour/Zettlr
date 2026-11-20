import assert from 'node:assert/strict'
import type { QuartoProjectInfo } from '@common/quarto/project-info'
import type { AnyDescriptor, DirDescriptor, MDFileDescriptor } from '@dts/common/fsal'
import { collectWorkspaceCitekeys, getRendererBibliography } from '../source/win-main/util/workspace-citations'

describe('Workspace citations', () => {
  it('combines live citations and matching Quarto chapters in the deepest workspace', () => {
    const active = markdownFile('/notes/book/intro.qmd', [ 'removed' ], 'refs.bib')
    const workspaceMap = new Map([
      [ '/notes', [ active.path, '/notes/outside.md' ] ],
      [ '/notes/book', [ active.path, '/notes/book/chapters/one.qmd', '/notes/book/two.md' ] ]
    ])
    const descriptors = new Map<string, AnyDescriptor>([
      [ '/notes', directory('/notes') ],
      [ '/notes/book', directory('/notes/book') ],
      [ active.path, active ],
      [ '/notes/outside.md', markdownFile('/notes/outside.md', [ 'outside' ], 'book/refs.bib') ],
      [ '/notes/book/chapters/one.qmd', markdownFile('/notes/book/chapters/one.qmd', [ 'chapter', 'live' ], '../refs.bib') ],
      [ '/notes/book/two.md', markdownFile('/notes/book/two.md', [ 'other-library' ], 'other.bib') ]
    ])

    const citekeys = collectWorkspaceCitekeys(active, getRendererBibliography(active), workspaceMap, descriptors, [ 'live' ])

    assert.deepEqual(citekeys, new Set([ 'live', 'chapter' ]))

    const modified = new Map([[ '/notes/book/chapters/one.qmd', [ 'draft' ] ]])
    assert.deepEqual(
      collectWorkspaceCitekeys(active, getRendererBibliography(active), workspaceMap, descriptors, [ 'live' ], modified),
      new Set([ 'live', 'draft' ])
    )
  })


  it('inherits a book bibliography and ranks references within the configured chapters', () => {
    const active = markdownFile('/notes/book/index.qmd', [])
    const anotherChapter = markdownFile('/notes/book/chapter.qmd', [ 'book-reference' ])
    const localOverride = markdownFile('/notes/book/afterword.qmd', [ 'other-reference' ], 'other.bib')
    const outside = markdownFile('/notes/book/notes.md', [ 'outside-book' ], 'references.bib')
    const project: QuartoProjectInfo = {
      root: '/notes/book',
      configPath: '/notes/book/_quarto.yaml',
      chapters: [ active, anotherChapter, localOverride ].map(file => ({ path: file.path })),
      bibliography: [ '/notes/book/references.bib' ],
      sections: { targets: [], references: [], duplicateIds: [], unresolved: [] },
      canRender: true
    }
    const descriptors = new Map<string, AnyDescriptor>([
      [ project.root, directory(project.root) ],
      ...[ active, anotherChapter, localOverride, outside ].map(file => [ file.path, file ] as const)
    ])
    const workspaces = new Map([[ project.root, [ ...descriptors.keys() ] ]])

    assert.equal(getRendererBibliography(active, project), '/notes/book/references.bib')
    assert.equal(getRendererBibliography(localOverride, project), '/notes/book/other.bib')
    assert.deepEqual(
      collectWorkspaceCitekeys(active, '/notes/book/references.bib', workspaces, descriptors, [], new Map(), project),
      new Set([ 'book-reference' ])
    )
  })

  it('uses only live citations for a document outside indexed directories', () => {
    const active = markdownFile('/notes/loose.md', [ 'removed' ])
    const workspaceMap = new Map([[ active.path, [ active.path ] ]])
    const descriptors = new Map([[ active.path, active ]])

    const citekeys = collectWorkspaceCitekeys(active, getRendererBibliography(active), workspaceMap, descriptors, [])

    assert.deepEqual(citekeys, new Set())
  })
})

function markdownFile (path: string, citekeys: string[], bibliography?: string): MDFileDescriptor {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    dir: path.slice(0, path.lastIndexOf('/')),
    name,
    ext: name.slice(name.lastIndexOf('.')),
    type: 'file',
    size: 0,
    modtime: 0,
    creationtime: 0,
    id: '',
    tags: [],
    links: [],
    citekeys,
    bom: '',
    wordCount: 0,
    charCount: 0,
    firstHeading: null,
    yamlTitle: undefined,
    frontmatter: bibliography === undefined ? null : { bibliography },
    linefeed: '\n'
  }
}

function directory (path: string): DirDescriptor {
  const split = path.lastIndexOf('/')
  return {
    path,
    dir: path.slice(0, split),
    name: path.slice(split + 1),
    type: 'directory',
    size: 0,
    modtime: 0,
    creationtime: 0,
    settings: { sorting: 'name-up', icon: null, project: null, color: null },
    isGitRepository: false
  }
}
