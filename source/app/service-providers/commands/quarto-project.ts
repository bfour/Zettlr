import { spawn } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { trans } from '@common/i18n-main'
import { parseQuartoBookConfig, type QuartoBookConfig } from '@common/quarto/book-config'
import type { QuartoProjectInfo } from '@common/quarto/project-info'
import { collectQuartoSections, type QuartoChapter } from '@common/quarto/section-references'
import type { AppServiceContainer } from 'source/app/app-service-container'
import ZettlrCommand from './zettlr-command'

interface QuartoBook {
  root: string
  configPath: string
  config: QuartoBookConfig
}

const configNames = [ '_quarto.yml', '_quarto.yaml' ]
const chapterExtensions = [ '.md', '.qmd' ]

function isInside (root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

async function findBook (chapterPath: string, read: (file: string) => Promise<string>): Promise<QuartoBook | undefined> {
  let root = dirname(chapterPath)
  while (true) {
    for (const name of configNames) {
      const configPath = join(root, name)
      let contents: string
      try {
        contents = await read(configPath)
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
          continue
        }
        throw error
      }
      // A nested Quarto project takes precedence even if it isn't a book.
      const config = parseQuartoBookConfig(contents)
      return config === undefined ? undefined : { root, configPath, config }
    }
    const parent = dirname(root)
    if (parent === root) {
      return undefined
    }
    root = parent
  }
}

export default class QuartoProject extends ZettlrCommand {
  private readonly rendering = new Set<string>()

  constructor (app: AppServiceContainer) {
    super(app, [ 'quarto-project-get', 'quarto-project-render' ])
  }

  async run (event: string, payload: { path: string }): Promise<QuartoProjectInfo | boolean | undefined> {
    const filePath = payload?.path
    const isRender = event === 'quarto-project-render'
    if (typeof filePath !== 'string' || !isAbsolute(filePath) || !chapterExtensions.includes(extname(filePath).toLowerCase())) {
      return isRender ? false : undefined
    }

    if (isRender) {
      return await this.render(filePath)
    }

    const book = await findBook(filePath, async file => await this.readSource(file))
    if (book !== undefined) {
      return await this.getBookInfo(book)
    }
  }

  private async readSource (filePath: string): Promise<string> {
    if (this._app.documents.isModified(filePath)) {
      const { content } = await this._app.documents.getDocument(filePath)
      return content
    }
    const content = await readFile(filePath, 'utf8')
    return content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  }

  private async getBookInfo ({ root, configPath, config }: QuartoBook): Promise<QuartoProjectInfo> {
    const chapters: QuartoProjectInfo['chapters'] = []
    const contents: QuartoChapter[] = []
    const indexedPaths = new Set<string>()
    const unreadableChapters: string[] = []
    const resolvedRoot = await realpath(root)

    for (const chapter of config.chapters) {
      const filePath = resolve(root, chapter.path)
      if (!isInside(root, filePath) || !chapterExtensions.includes(extname(filePath).toLowerCase())) {
        continue
      }
      if (!indexedPaths.has(filePath)) {
        try {
          const resolvedFile = await realpath(filePath)
          if (!isInside(resolvedRoot, resolvedFile)) {
            continue
          }
          contents.push({ path: filePath, content: await this.readSource(filePath) })
        } catch (error: unknown) {
          unreadableChapters.push(filePath)
          this._app.log.warning(`[Quarto] Could not index chapter ${filePath}`, error)
        }
        indexedPaths.add(filePath)
      }
      chapters.push({ ...chapter, path: filePath })
    }

    return {
      root,
      configPath,
      title: config.title,
      chapters,
      bibliography: config.bibliography
        .filter(file => !/^[a-z][a-z\d+.-]*:\/\//i.test(file))
        .map(file => resolve(root, file)),
      sections: collectQuartoSections(contents),
      unreadableChapters,
      canRender: process.env.QUARTO_SUPPORT === '1'
    }
  }

  private async render (filePath: string): Promise<boolean> {
    const book = await findBook(filePath, async file => await readFile(file, 'utf8'))
    if (book === undefined || process.env.QUARTO_SUPPORT !== '1' || this.rendering.has(book.root)) {
      return false
    }

    const title = book.config.title ?? basename(book.root)
    const task = this._app.lrt.registerTask(trans('Rendering Quarto book'), title)
    this.rendering.add(book.root)

    try {
      const output = await renderBook(book.root)
      this._app.log.info(`[Quarto] Rendered ${title}`, output)
      task.endTask('success')
      return true
    } catch (error: unknown) {
      const failure = error instanceof Error ? error : new Error(String(error))
      this._app.log.error('[Quarto] Rendering failed', failure)
      task.endTask('error', failure)
      this._app.windows.showErrorMessage(trans('Quarto render failed'), failure.message)
      return false
    } finally {
      this.rendering.delete(book.root)
    }
  }
}

async function renderBook (root: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32'
    const child = spawn(isWindows ? 'quarto render "%ZETTLR_QUARTO_BOOK_ROOT%"' : 'quarto', isWindows ? [] : ['render'], {
      cwd: root,
      // Windows ships Quarto as a .cmd launcher. The command and arguments
      // are fixed. The project directory is supplied through the environment
      // so Quarto also gets it when cmd.exe cannot use a UNC cwd.
      shell: isWindows,
      env: isWindows
        ? { ...process.env, NoDefaultCurrentDirectoryInExePath: '1', ZETTLR_QUARTO_BOOK_ROOT: root }
        : process.env,
      windowsHide: true,
      stdio: [ 'ignore', 'pipe', 'pipe' ]
    })
    let output = ''
    for (const stream of [ child.stdout, child.stderr ]) {
      stream.setEncoding('utf8')
      stream.on('data', (data: string) => { output = (output + data).slice(-16000) })
    }
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve(output)
      } else {
        const why = signal ?? String(code)
        reject(new Error(trans('Quarto exited with status %s.', why) + '\n' + output.trim()))
      }
    })
  })
}
