<template>
  <div
    ref="mainEditorWrapper"
    class="main-editor-wrapper"
    role="region"
    v-bind:aria-label="`Markdown Editor: Currently editing file ${pathBasename(props.file.path)}`"
    v-bind:style="{ 'font-size': `${fontSize}px` }"
    v-bind:class="{
      'code-file': !isMarkdown,
      fullscreen: distractionFree
    }"
    v-on:zettlr-annotate-selection="openCommentComposer"
    v-on:zettlr-citation-picker="openCitationPicker"
  >
    <div v-bind:id="`cm-text-${props.leafId}`">
      <!-- This element will be replaced with Codemirror's wrapper element on mount -->
    </div>
    <CitationPicker
      v-if="citationPicker !== undefined"
      v-bind:citations="citationPicker.citations"
      v-bind:used="citationPicker.used"
      v-bind:initial-query="citationPicker.initialQuery"
      v-bind:loading="citationPicker.loading"
      v-bind:error="citationPicker.error"
      v-on:select="selectCitation"
      v-on:close="closeCitationPicker"
    ></CitationPicker>
  </div>
</template>

<script setup lang="ts">

/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Editor
 * CVM-Role:        View
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This displays the main editor for the app. It uses the
 *                  MarkdownEditor class to implement the full CodeMirror editor.
 *
 * END HEADER
 */

import MarkdownEditor, { type EditorViewPersistentState } from '@common/modules/markdown-editor'

import { ref, shallowRef, computed, nextTick, onMounted, onBeforeUnmount, watch, toRef, onUpdated } from 'vue'
import { type EditorCommands } from './App.vue'
import { hasMarkdownExt } from '@common/util/file-extention-checks'
import { DP_EVENTS, type OpenDocument } from '@dts/common/documents'
import { CITEPROC_MAIN_DB } from '@dts/common/citeproc'
import { type EditorConfigOptions } from '@common/modules/markdown-editor/util/configuration'
import type { AnyDescriptor, CodeFileDescriptor, DirDescriptor, MDFileDescriptor } from '@dts/common/fsal'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { documentAuthorityIPCAPI } from '@common/modules/markdown-editor/util/ipc-api'
import { useConfigStore, useDocumentTreeStore, useTagsStore, useWindowStateStore, useWorkspaceStore } from 'source/pinia'
import { pathBasename, pathDirname, resolvePath } from '@common/util/renderer-path-polyfill'
import type { DocumentManagerIPCAPI, DocumentsUpdateContext } from 'source/app/service-providers/documents'
import type { CiteprocProviderIPCAPI } from 'source/app/service-providers/citeproc'
import type { ProjectInfo } from 'source/common/modules/markdown-editor/plugins/project-info-field'
import type { FileContentSearchResult } from 'source/app/service-providers/search'
import type { CustomEditorShortcut } from 'source/common/modules/markdown-editor/keymaps/shortcuts'
import { quartoSectionsField, quartoSectionsUpdate } from '@common/modules/markdown-editor/plugins/quarto-sections'
import { getCitationPrefix, insertCitation } from '@common/modules/markdown-editor/autocomplete/citations'
import { markdownToAST, extractMarkdownCitekeys } from '@common/modules/markdown-utils'
import { getRendererBibliography, collectWorkspaceCitekeys } from './util/workspace-citations'
import { toCitationPickerResult, type CitationPickerResult } from './util/citation-picker'
import CitationPicker from './CitationPicker.vue'
import type { FileRecord } from 'source/common/modules/markdown-editor/autocomplete/files'
import { documentCommentsField, encodeAnnotation } from '@common/modules/markdown-editor/util/document-comments'
import getDocumentTitle from './util/get-document-title'

const ipcRenderer = window.ipc

const props = defineProps<{
  leafId: string
  windowId: string
  activeFile: OpenDocument|null
  editorCommands: EditorCommands
  distractionFree: boolean
  file: OpenDocument
  persistentStateMap: Map<string, EditorViewPersistentState>
}>()

const emit = defineEmits<(e: 'globalSearch', query: string) => void>()

const windowStateStore = useWindowStateStore()
const documentTreeStore = useDocumentTreeStore()
const workspaceStore = useWorkspaceStore()
const configStore = useConfigStore()
const tagStore = useTagsStore()

// UNREFFED STUFF
let currentEditor: MarkdownEditor|null = null

// EVENT LISTENERS
ipcRenderer.on('citeproc-database-updated', (_event, _dbPath: string) => {
  const descriptor = activeFileDescriptor.value

  if (descriptor === undefined || descriptor.type !== 'file') {
    return // Nothing to do
  }

  const library = getRendererBibliography(descriptor, quartoBook.value)
  updateCitationKeys(library).catch(e => {
    console.error('Could not update citation keys', e)
  })
})

ipcRenderer.on('shortcut', (event, command) => {
  if (currentEditor?.hasFocusWithin() !== true) {
    return // None of our business
  }

  if (command === 'save-file') {
    // Main is telling us to save, so tell main to save the current file.
    ipcRenderer.invoke('documents-provider', {
      command: 'save-file',
      payload: { path: props.file.path }
    } as DocumentManagerIPCAPI)
      .then(result => {
        if (result !== true) {
          console.error('Retrieved a falsy result from main, indicating an error with saving the file.')
        }
      })
      .catch(e => console.error(e))
  } else if (command === 'search') {
    currentEditor.toggleSearchPanel()
  } else if (command === 'toggle-typewriter-mode') {
    currentEditor.hasTypewriterMode = !currentEditor.hasTypewriterMode
  } else if (command === 'copy-as-html') {
    currentEditor.copyAsHTML()
  } else if (command === 'paste-as-plain') {
    currentEditor.pasteAsPlainText()
  }
})

ipcRenderer.on('documents-update', (e, payload: { event: DP_EVENTS, context: DocumentsUpdateContext }) => {
  const { event, context } = payload
  if (event === DP_EVENTS.FILE_REMOTELY_CHANGED && context.filePath === props.file.path) {
    // The currently loaded document has been changed remotely. This event indicates
    // that the document provider has already reloaded the document and we only
    // need to tell the main editor to reload it as well.
    currentEditor?.reload().catch(e => console.error(e))
  } else if (event === DP_EVENTS.FILE_SAVED && context.filePath === props.file.path) {
    // The file has been saved to disk. This means we should probably update the
    // descriptor to know of, e.g., library changes.
    ipcRenderer.invoke('fsal', { command: 'get-descriptor', payload: props.file.path })
      .then((descriptor: MDFileDescriptor|CodeFileDescriptor|undefined) => {
        if (descriptor === undefined) {
          throw new Error(`Could not swap document: Could not retrieve descriptor for path ${props.file.path}!`)
        }

        activeFileDescriptor.value = descriptor
        const library = descriptor.type === 'file' ? getRendererBibliography(descriptor, quartoBook.value) : undefined
        if (library !== undefined) {
          updateCitationKeys(library).catch(e => console.error('Could not update citation keys', e))
        }

        // Provide the editor instance with updated metadata
        currentEditor?.setOptions({
          metadata: {
            path: props.file.path,
            id: descriptor.type === 'file' ? descriptor.id : '',
            library: library ?? CITEPROC_MAIN_DB
          }
        })
      })
      .catch(err => console.error(err))
  }
})

ipcRenderer.on('reload-editors', _e => {
  currentEditor?.reload().catch(err => console.error('Failed to reload editor after `reload-editors` event', err))
})

// Update the file database whenever links have been updated
ipcRenderer.on('links', _e => {
  updateFileDatabase().catch(err => console.error('Could not update file database', err))
})

// MOUNTED HOOK
onMounted(() => {
  loadDocument().catch(err => console.error(err))
})

onBeforeUnmount(() => {
  citationPicker.value = undefined
  if (windowStateStore.commentDraft?.leafId === props.leafId) {
    windowStateStore.commentDraft = undefined
  }
  if (currentEditor !== null) {
    if (windowStateStore.commentsByLeaf.get(props.leafId)?.path === currentEditor.documentPath) {
      windowStateStore.commentsByLeaf.delete(props.leafId)
    }
    props.persistentStateMap.set(props.file.path, currentEditor.persistentState)
    // Clear out the table of contents before unmounting the component.
    windowStateStore.tableOfContents = undefined
    currentEditor.unmount()
  }
})

onUpdated(() => {
  // We hook into the onUpdated lifecycle event since that will fire when the
  // data for this component update, which includes visibility with the v-show
  // directive. In case that the editor component is mounted and non-hidden, we
  // will fire
  if (currentEditor === null) {
    return
  }

  const currentFilePath = currentEditor.documentPath
  if (currentFilePath !== props.activeFile?.path) {
    citationPicker.value = undefined
    // File path has changed -> unmount and remount (duplicate code from
    // onMounted and onBeforeUnmount hooks).
    props.persistentStateMap.set(currentFilePath, currentEditor.persistentState)
    currentEditor.unmount()
    loadDocument().catch(err => console.error(err))
  }

  if (citationPicker.value === undefined && !currentEditor.hasFocus()) {
    currentEditor.focus()
  }
})

// DATA SETUP
const mainEditorWrapper = ref<HTMLDivElement|null>(null)
const citationPicker = shallowRef<{
  editor: MarkdownEditor
  citations: CitationPickerResult[]
  used: Set<string>
  initialQuery: string
  loading: boolean
  error: boolean
}>()


// COMPUTED PROPERTIES
const useH1 = computed<boolean>(() => configStore.config.fileNameDisplay.includes('heading'))
const useTitle = computed<boolean>(() => configStore.config.fileNameDisplay.includes('title'))
const fontSize = computed<number>(() => configStore.config.editor.fontSize)
const globalSearchResults = computed(() => windowStateStore.searchResults)
const snippets = computed(() => windowStateStore.snippets)
const tags = computed(() => tagStore.tags)
const isMarkdown = computed(() => hasMarkdownExt(props.file.path))

const activeFileDescriptor = ref<undefined|MDFileDescriptor|CodeFileDescriptor>(undefined)
const quartoBook = computed(() => {
  const project = windowStateStore.quartoProject
  return project?.chapters.some(chapter => chapter.path === props.file.path) === true ? project : undefined
})

watch(quartoBook, () => updateQuartoSections())
watch(() => quartoBook.value?.bibliography[0], () => {
  const descriptor = activeFileDescriptor.value
  if (descriptor?.type !== 'file' || currentEditor?.documentPath !== descriptor.path) {
    return
  }
  const library = getRendererBibliography(descriptor, quartoBook.value)
  currentEditor.setOptions({ metadata: { path: descriptor.path, id: descriptor.id, library } })
  updateCitationKeys(library).catch(error => console.error('Could not update citation keys', error))
})

function updateQuartoSections (): void {
  const editor = currentEditor
  if (editor === null || !isMarkdown.value || (quartoBook.value === undefined &&
    editor.instance.state.field(quartoSectionsField, false) === undefined)) {
    return
  }

  const sections = quartoBook.value?.sections
  const duplicates = new Set(sections?.duplicateIds)
  const labels = sections === undefined
    ? undefined
    : new Map(sections.targets.filter(target => !duplicates.has(target.id)).map(target => [ target.id, target ]))
  editor.instance.dispatch({ effects: quartoSectionsUpdate.of(labels) })
}


const editorConfiguration = computed<EditorConfigOptions>(() => {
  // We update everything, because not so many values are actually updated
  // right after setting the new configurations. Plus, the user won't update
  // everything all the time, but rather do one initial configuration, so
  // even if we incur a performance penalty, it won't be noticed that much.
  const { editor, display, zkn, darkMode, shortcuts, darkModeEditor } = configStore.config
  return {
    indentUnit: editor.indentUnit,
    indentWithTabs: editor.indentWithTabs,
    alwaysIndentLineOnTab: editor.alwaysIndentLineOnTab,
    autoCloseBrackets: editor.autoCloseBrackets,
    autocorrect: {
      active: editor.autoCorrect.active,
      matchWholeWords: editor.autoCorrect.matchWholeWords,
      magicQuotes: {
        primary: editor.autoCorrect.magicQuotes.primary,
        secondary: editor.autoCorrect.magicQuotes.secondary
      },
      replacements: editor.autoCorrect.replacements
    },
    autocompleteSuggestEmojis: editor.autocompleteSuggestEmojis,
    snippetAutocompleteTriggerCharacter: editor.snippetAutocompleteTriggerCharacter,
    autocompleteWithEnter: editor.autocompleteWithEnter,
    autocompleteWithTab: editor.autocompleteWithTab,
    imagePreviewWidth: display.imageWidth,
    imagePreviewHeight: display.imageHeight,
    boldFormatting: editor.boldFormatting,
    italicFormatting: editor.italicFormatting,
    highlightFormatting: editor.highlightFormatting,
    highlightColor: editor.highlightColor,
    muteLines: configStore.config.muteLines,
    citeStyle: editor.citeStyle,
    readabilityAlgorithm: editor.readabilityAlgorithm,
    idRE: zkn.idRE,
    idGen: zkn.idGen,
    previewModeShowSyntaxWhenCursorIsAdjacent: display.previewModeShowSyntaxWhenCursorIsAdjacent,
    renderCitations: display.renderCitations,
    renderingMode: display.renderingMode,
    renderIframes: display.renderIframes,
    renderImages: display.renderImages,
    renderLinks: display.renderLinks,
    renderMath: display.renderMath,
    renderTasks: display.renderTasks,
    renderHeadings: display.renderHTags,
    renderTables: editor.enableTableHelper,
    renderEmphasis: display.renderEmphasis,
    renderPandoc: display.renderPandoc,
    renderAdmonitions: display.renderAdmonitions,
    renderHorizontalRules: display.renderHorizontalRules,
    zknLinkFormat: zkn.linkFormat,
    zknAddFileTitle: zkn.linkAddFileTitle,
    linkWithIDIfPossible: zkn.linkWithIDIfPossible,
    inputMode: editor.inputMode,
    lintMarkdown: editor.lint.markdown,
    // The editor only needs to know if it should use languageTool
    lintLanguageTool: editor.lint.languageTool.active,
    distractionFree: props.distractionFree.valueOf(),
    showStatusbar: editor.showStatusbar,
    showFormattingToolbar: editor.showFormattingToolbar,
    darkMode,
    darkModeEditor,
    theme: display.theme,
    highlightWhitespace: editor.showWhitespace,
    showMarkdownLineNumbers: editor.showMarkdownLineNumbers,
    countChars: editor.countChars,
    shortcuts: Object.entries(shortcuts.editor)
      .map(([ name, shortcut ]) => ({ name, shortcut }))
      .filter((shortcut): shortcut is CustomEditorShortcut => shortcut.shortcut !== undefined)
  } satisfies EditorConfigOptions
})

// BEGIN: PROJECT INFO
function updateProjectInfo (): ProjectInfo|null {
  // If this file is part of a project, the project must be defined in any
  // containing folder -> traverse up the file tree until we have found one.
  let dir = workspaceStore.descriptorMap.get(pathDirname(props.file.path)) as DirDescriptor|undefined

  while (dir !== undefined && dir.settings.project === null) {
    dir = workspaceStore.descriptorMap.get(dir.dir) as DirDescriptor|undefined
  }

  if (dir === undefined || dir.settings.project === null) {
    return null // No project found in the tree
  }

  // Check if this file is part of the project.
  const absPaths = dir.settings.project.files.map(p => resolvePath(dir.path, p))
  if (!absPaths.includes(props.file.path)) {
    return null
  }

  const extractedMetadata = absPaths
    .map(p => {
      return workspaceStore.descriptorMap.get(p)
    })
    .filter (d => d !== undefined && d.type === 'file')
    .map(d => {
      return {
        wordCount: d.wordCount,
        charCount: d.charCount,
        path: d.path,
        displayName: d.yamlTitle ?? d.firstHeading ?? d.name
      }
    })

  // It is! So now we can return the proper project info.
  return {
    name: dir.settings.project.title,
    files: extractedMetadata
      .map(p => ({ path: p.path, displayName: p.displayName })),
    wordCount: extractedMetadata
      .map(p => p.wordCount)
      .reduce((p, c) => p + c, 0),
    charCount: extractedMetadata
      .map(p => p.charCount)
      .reduce((p, c) => p + c, 0)
  }
}

// Update the project info as soon as anything in the workspaces has changed.
workspaceStore.$subscribe(() => {
  if (currentEditor !== null) {
    currentEditor.projectInfo = updateProjectInfo()
  }
})
// END: PROJECT INFO

// External commands/"event" system
watch(toRef(props.editorCommands, 'jumpToLine'), () => {
  const { filePath, lineNumber } = props.editorCommands.data
  // Execute a jtl-command if the current displayed file is the correct one
  if (filePath === props.file.path && typeof lineNumber === 'number') {
    jtl(lineNumber)
  }
})

watch(toRef(props.editorCommands, 'moveSection'), () => {
  if (props.activeFile?.path !== props.file.path || documentTreeStore.lastLeafId !== props.leafId) {
    return
  }

  const { from, to } = props.editorCommands.data
  if (typeof from === 'number' && typeof to === 'number') {
    currentEditor?.moveSection(from, to)
  }
})

watch(toRef(props, 'distractionFree'), () => {
  if (currentEditor !== null && props.activeFile?.path === props.file.path && documentTreeStore.lastLeafId === props.leafId) {
    currentEditor.distractionFree = props.distractionFree
  }
})

watch(toRef(props.editorCommands, 'executeCommand'), () => {
  if (props.activeFile?.path !== props.file.path || currentEditor === null) {
    return
  }

  if (documentTreeStore.lastLeafId !== props.leafId) {
    // This editor, even though it may be focused, was not the last focused
    // See https://github.com/Zettlr/Zettlr/issues/4361
    return
  }

  const command: string = props.editorCommands.data
  if (command === 'markdownCitation') {
    openCitationPicker()
    return
  }
  currentEditor.runCommand(command)
  currentEditor.focus()
})

watch(toRef(props.editorCommands, 'replaceSelection'), () => {
  if (props.activeFile?.path !== props.file.path) {
    return
  }

  if (documentTreeStore.lastLeafId !== props.leafId) {
    // This editor, even though it may be focused, was not the last focused
    // See https://github.com/Zettlr/Zettlr/issues/4361
    return
  }

  const textToInsert: string = props.editorCommands.data
  currentEditor?.replaceSelection(textToInsert)
})

watch(toRef(props.editorCommands, 'insertPandoc'), () => {
  if (props.activeFile?.path !== props.file.path || currentEditor === null) {
    return
  }

  if (documentTreeStore.lastLeafId !== props.leafId) {
    // This editor, even though it may be focused, was not the last focused
    // See https://github.com/Zettlr/Zettlr/issues/4361
    return
  }

  const { type, attributes } = props.editorCommands.data
  if ((type === 'div' || type === 'span') && typeof attributes === 'string') {
    currentEditor?.insertPandocDivOrSpan(type as 'div'|'span', attributes)
    currentEditor?.focus()
  }
})

const fsalFiles = computed<MDFileDescriptor[]>(() => {
  return [...workspaceStore.descriptorMap.values()].filter(d => d.type === 'file')
})

// WATCHERS
watch(useH1, () => { updateFileDatabase().catch(err => console.error('Could not update file database', err)) })
watch(useTitle, () => { updateFileDatabase().catch(err => console.error('Could not update file database', err)) })
watch(fsalFiles, () => { updateFileDatabase().catch(err => console.error('Could not update file database', err)) })

watch(editorConfiguration, (newValue) => {
  currentEditor?.setOptions(newValue)
})

watch(globalSearchResults, () => {
  // TODO: I don't like that we need a timeout here.
  setTimeout(maybeHighlightSearchResults, 200)
})

watch(snippets, (newValue) => {
  currentEditor?.setCompletionDatabase('snippets', newValue)
})

watch(tags, (newValue) => {
  currentEditor?.setCompletionDatabase('tags', newValue)
})

// METHODS
/**
 * Returns a MarkdownEditor for the provided path.
 *
 * @param   {string}          doc  The document to load
 *
 * @return  {MarkdownEditor}       The requested editor
 */
async function getEditorFor (doc: string): Promise<MarkdownEditor> {
  const persistentState = props.persistentStateMap.get(doc)
  const editor = new MarkdownEditor(props.leafId, props.windowId, doc, documentAuthorityIPCAPI, undefined, persistentState)

  // Update the document info on corresponding events
  editor.on('loaded', () => {
    if (currentEditor === editor) {
      updateQuartoSections()
      updateComments(editor)
      windowStateStore.activeDocumentInfo = currentEditor.documentInfo
      windowStateStore.tableOfContents = currentEditor.tableOfContents
    }
  })

  editor.on('change', () => {
    if (currentEditor === editor) {
      updateComments(editor)
      windowStateStore.tableOfContents = currentEditor.tableOfContents
    }
  })

  editor.on('docUpdate', () => {
    if (currentEditor === editor) {
      windowStateStore.activeDocumentInfo = currentEditor.documentInfo
    }
  })

  editor.on('focus', () => {
    ipcRenderer.invoke('documents-provider', {
      command: 'focus-leaf',
      payload: {
        leafId: props.leafId,
        windowId: props.windowId
      }
    } as DocumentManagerIPCAPI).catch(err => console.error(err))

    // NOTE: The lastLeafId will be changed in the documentTreeStore in response
    // to an event from main (DP_EVENTS.ACTIVE_FILE) which will be emitted as a
    // result of our focus-leaf event above.
    if (currentEditor === editor) {
      windowStateStore.tableOfContents = currentEditor.tableOfContents
    }
  })

  editor.on('zettelkasten-link', (linkContents: string) => {
    ipcRenderer.invoke('application', {
      command: 'force-open',
      payload: {
        linkContents,
        newTab: undefined, // let open-file command decide based on preferences
        leafId: props.leafId,
        windowId: props.windowId
      }
    })
      .catch(err => console.error(err))

    if (configStore.config.zkn.autoSearch) {
      emit('globalSearch', linkContents)
    }
  })

  editor.on('zettelkasten-tag', (tag: string) => {
    emit('globalSearch', tag)
  })

  // Supply the configuration object once initially
  editor.setOptions(editorConfiguration.value)
  return editor
}

/**
 * Loads the document for this editor instance.
 */
async function loadDocument (): Promise<void> {
  const newEditor = await getEditorFor(props.file.path)

  mainEditorWrapper.value?.appendChild(newEditor.dom)
  currentEditor = newEditor

  currentEditor.setCompletionDatabase('tags', tags.value)
  currentEditor.setCompletionDatabase('snippets', snippets.value)

  maybeHighlightSearchResults()

  const descriptor: MDFileDescriptor|CodeFileDescriptor|undefined = await ipcRenderer.invoke('fsal', { command: 'get-descriptor', payload: props.file.path })
  if (descriptor === undefined) {
    throw new Error(`Could not swap document: Could not retrieve descriptor for path ${props.file.path}!`)
  }

  activeFileDescriptor.value = descriptor

  const library = descriptor.type === 'file' ? getRendererBibliography(descriptor, quartoBook.value) : undefined
  if (library !== undefined) {
    updateCitationKeys(library).catch(e => console.error('Could not update citation keys', e))
  }

  updateFileDatabase().catch(err => console.error('Could not update file database', err))

  // Provide the editor instance with metadata for the new file
  currentEditor.setOptions({
    metadata: {
      path: props.file.path,
      id: descriptor.type === 'file' ? descriptor.id : '',
      library: library ?? CITEPROC_MAIN_DB
    }
  })
  currentEditor.projectInfo = updateProjectInfo()
}

function updateComments (editor: MarkdownEditor): void {
  if (!isMarkdown.value) {
    return
  }

  const view = editor.instance
  const comments = view.state.field(documentCommentsField, false)
  if (comments === undefined) {
    return
  }

  const doc = view.state.doc
  windowStateStore.commentsByLeaf.set(props.leafId, {
    path: editor.documentPath,
    comments: comments.toSorted((a, b) => (a.anchor?.from ?? a.from) - (b.anchor?.from ?? b.from)),
    selectComment: (comment) => {
      const { from, to } = comment.anchor ?? comment
      if (currentEditor !== editor || view.state.doc !== doc) {
        return
      }

      view.dispatch({
        selection: EditorSelection.single(from, to),
        effects: EditorView.scrollIntoView(from, { y: 'center' })
      })
      view.focus()
    }
  })
}

function openCommentComposer (event: Event): void {
  const editor = currentEditor
  if (editor === null || !isMarkdown.value) {
    return
  }
  const view = editor.instance
  const { doc, readOnly, selection } = view.state
  const { from, to } = selection.main
  if (readOnly || from === to) {
    return
  }

  event.preventDefault()
  windowStateStore.commentDraft = {
    leafId: props.leafId,
    path: editor.documentPath,
    quote: doc.sliceString(from, to),
    submit: text => {
      if (currentEditor !== editor || view.state.doc !== doc || view.state.readOnly) {
        return false
      }

      const lastLine = doc.line(doc.lines)
      const lastComment = view.state.field(documentCommentsField).at(-1)
      const separator = lastComment?.annotation === true && lastComment.to === doc.length - 1
        ? ''
        : lastLine.length === 0 ? '\n' : '\n\n'
      const annotation = encodeAnnotation(doc, from, to, text)
      const transaction = view.state.update({
        changes: { from: doc.length, insert: separator + annotation + '\n' },
        userEvent: 'input'
      })
      const added = transaction.state.field(documentCommentsField).at(-1)
      if (added?.from !== doc.length + separator.length || added.anchor === undefined) {
        return false
      }
      view.dispatch(transaction)
      return true
    }
  }

  configStore.setConfigValue('window.currentSidebarTab', 'comments')
  configStore.setConfigValue('window.sidebarVisible', true)
}

function jtl (lineNumber: number): void {
  currentEditor?.jtl(lineNumber)
}

async function getBibliographyItems (library: string): Promise<CitationPickerResult[]> {
  const items: CSLItem[] = await ipcRenderer.invoke('citeproc-provider', {
    command: 'get-items',
    payload: { database: library }
  } as CiteprocProviderIPCAPI)
  return items.map(toCitationPickerResult)
}

async function updateCitationKeys (library: string): Promise<void> {
  const editor = currentEditor
  const citations = await getBibliographyItems(library)
  const descriptor = activeFileDescriptor.value
  if (editor !== null && currentEditor === editor && descriptor?.type === 'file' && descriptor.path === editor.documentPath &&
    getRendererBibliography(descriptor, quartoBook.value) === library) {
    editor.setCompletionDatabase('citations', citations)
  }
}

function openCitationPicker (event?: Event): void {
  const editor = currentEditor
  if (editor === null || !isMarkdown.value || editor.instance.state.readOnly ||
    editor.documentPath !== props.activeFile?.path || documentTreeStore.lastLeafId !== props.leafId) {
    return
  }

  event?.preventDefault()
  if (citationPicker.value !== undefined) {
    return
  }

  const picker = {
    editor,
    citations: [],
    used: new Set<string>(),
    initialQuery: getCitationPrefix(editor.instance.state)?.query ?? '',
    loading: true,
    error: false
  }
  citationPicker.value = picker
  loadCitationPicker(editor).then(result => {
    if (citationPicker.value === picker) {
      citationPicker.value = { ...picker, ...result, loading: false }
    }
  }).catch(error => {
    console.error('Could not load citation picker', error)
    if (citationPicker.value === picker) {
      citationPicker.value = { ...picker, loading: false, error: true }
    }
  })
}

async function loadCitationPicker (editor: MarkdownEditor): Promise<{ citations: CitationPickerResult[], used: Set<string> }> {
  const path = editor.documentPath
  let descriptor = activeFileDescriptor.value
  if (descriptor?.path !== path) {
    descriptor = await ipcRenderer.invoke('fsal', { command: 'get-descriptor', payload: path })
  }
  if (descriptor?.type !== 'file') {
    throw new Error('Could not read the active Markdown document')
  }
  const book = quartoBook.value
  const library = getRendererBibliography(descriptor, book)
  const descriptors = new Map(workspaceStore.descriptorMap)
  const unavailable = new Set(book?.unreadableChapters)
  const missing = book?.chapters.map(chapter => chapter.path)
    .filter(path => !descriptors.has(path) && !unavailable.has(path)) ?? []
  const [ citations, modifiedCitekeys, additionalDescriptors ] = await Promise.all([
    getBibliographyItems(library),
    ipcRenderer.invoke('documents-provider', { command: 'get-modified-citekeys' } as DocumentManagerIPCAPI) as Promise<Map<string, string[]>>,
    missing.length === 0 ? [] : ipcRenderer.invoke('fsal', { command: 'get-descriptor', payload: missing }) as Promise<AnyDescriptor[]>
  ])
  for (const item of additionalDescriptors) {
    descriptors.set(item.path, item)
  }
  const activeCitekeys = extractMarkdownCitekeys(markdownToAST(editor.instance.state.sliceDoc()))
  const used = collectWorkspaceCitekeys(
    descriptor, library, workspaceStore.workspaceMap, descriptors, activeCitekeys, modifiedCitekeys, book
  )
  return { citations, used }
}

function closeCitationPicker (): void {
  const editor = citationPicker.value?.editor
  citationPicker.value = undefined
  nextTick(() => {
    if (editor !== undefined && citationPicker.value === undefined && currentEditor === editor && editor.documentPath === props.activeFile?.path) {
      editor.focus()
    }
  }).catch(error => console.error(error))
}

function selectCitation (citekey: string): void {
  const picker = citationPicker.value
  if (picker !== undefined && picker.editor === currentEditor &&
    picker.editor.documentPath === props.activeFile?.path && picker.citations.some(citation => citation.citekey === citekey)) {
    insertCitation(picker.editor.instance, citekey)
  }
  closeCitationPicker()
}

async function updateFileDatabase (): Promise<void> {
  // Get all our files ...
  const fileDatabase: FileRecord[] = []

  // ... and the unique links that are part of the link database
  const rawLinks: Record<string, string[]> = await ipcRenderer.invoke('link-provider', { command: 'get-link-database' })
  const linkDatabase = [...new Set(Object.values(rawLinks).flat())]

  // First, add all existing files to the database ...
  for (const file of fsalFiles.value) {
    fileDatabase.push({
      filename: pathBasename(file.name, file.ext),
      displayName: getDocumentTitle(file),
      id: file.id
    })
  }

  // ... before going through the link database to add those links that link to
  // not yet existing files
  for (const link of linkDatabase) {
    const existingFile = fileDatabase.find(file => file.filename === link || file.id === link)
    if (existingFile === undefined) {
      fileDatabase.push({ filename: link, displayName: link, id: '' })
    }
  }

  currentEditor?.setCompletionDatabase('files', fileDatabase)
}

function maybeHighlightSearchResults (): void {
  if (currentEditor === null) {
    return
  }

  const result = globalSearchResults.value.find(r => r.file.path === props.file.path)
  if (result === undefined) {
    currentEditor.highlightRanges([])
    return
  }

  // NOTE: We have to filter out "whole-file" results
  const contentResults = result.result
    .filter((res): res is FileContentSearchResult => {
      return res.type === 'content' && res.line > -1
    })

  // Construct CodeMirror.Ranges from the results
  const rangesToHighlight = []
  const lineCount = currentEditor.instance.state.doc.lines
  for (const { line, ranges } of contentResults) {
    if (line > lineCount) {
      console.warn(`[maybeHighlightSearchResults()] Cannot highlight line ${line}: Document only has ${lineCount} lines.`)
      continue
    }

    const startIdx = currentEditor.instance.state.doc.line(line).from
    for (const { from, to } of ranges) {
      rangesToHighlight.push(EditorSelection.range(startIdx + from, startIdx + to))
    }
  }
  currentEditor.highlightRanges(rangesToHighlight)
}

</script>

<style lang="css">
.main-editor-wrapper {
  /* Editor margins left and right for all breakpoints in both fullscreen and
  normal mode. */
  --editor-margin-fullscreen-sm:  50px;
  --editor-margin-fullscreen-md:   5vw;
  --editor-margin-fullscreen-lg:  10vw;
  --editor-margin-fullscreen-xl:  20vw;
  --editor-margin-fullscreen-xxl: 30vw;
  width: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  background-color: #ffffff;
  transition: 0.2s background-color ease;
  position: relative;

  .cm-editor {
    .cm-scroller { padding: 50px 50px; }
    .cm-content { min-width: 0; }
  }

  /* If a code file is loaded, we need to display the editor contents in monospace. */
  &.code-file .cm-editor {
    font-family: Inconsolata, monospace;

    /* Reset the margins for code files */
    .cm-scroller { padding: 0px; }
  }

  &.fullscreen {
    /* This makes the editor pane show "fullscreen" on top over the rest of the UI
    except the toolbar (due to a position: relative on the window content div). */
    position: absolute;
    z-index: 300;
    top: 0;

    .cm-scroller {
      @media(min-width: 1301px) { padding: 0 var(--editor-margin-fullscreen-xxl); }
      @media(max-width: 1300px) { padding: 0 var(--editor-margin-fullscreen-xl); }
      @media(max-width: 1100px) { padding: 0 var(--editor-margin-fullscreen-lg); }
      @media(max-width: 1000px) { padding: 0 var(--editor-margin-fullscreen-md); }
      @media(max-width:  800px) { padding: 0 var(--editor-margin-fullscreen-sm); }

    }
  }
}

body.dark .main-editor-wrapper {
  background-color: #2b2b2c;
}

body.darwin {
    .main-editor-wrapper.fullscreen {
      border-top: 1px solid #d5d5d5;
  }

  &.dark {
    .main-editor-wrapper.fullscreen {
      border-top-color: #505050;
    }
  }
}

</style>
