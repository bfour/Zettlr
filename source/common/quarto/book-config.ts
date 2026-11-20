import { parse } from 'yaml'

export interface QuartoChapterConfig {
  path: string
  title?: string
  part?: string
  appendix: boolean
}

export interface QuartoBookConfig {
  title?: string
  chapters: QuartoChapterConfig[]
  bibliography: string[]
}

function asRecord (value: unknown): Record<string, unknown>|undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

function asText (value: unknown): string|undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    return text === '' ? undefined : text
  }
  return undefined
}

function markdownPath (value: unknown): string|undefined {
  const candidate = asText(value)
  if (candidate !== undefined && /\.(?:qmd|md)$/i.test(candidate) && !/^(?:[\\/]|[a-z][a-z\d+.-]*:)/i.test(candidate)) {
    return candidate
  }
  return undefined
}

/**
 * Reads the static inputs of a Quarto book in their configured order.
 * Paths are relative to the project config and are resolved by the caller.
 */
export function parseQuartoBookConfig (source: string): QuartoBookConfig|undefined {
  const parsed: unknown = parse(source)
  const config = asRecord(parsed)
  if (asRecord(config?.project)?.type !== 'book') {
    return undefined
  }

  const book = asRecord(config?.book)
  const title = asText(book?.title)
  const bibliographyConfig = config?.bibliography
  const bibliographyEntries: unknown[] = Array.isArray(bibliographyConfig)
    ? bibliographyConfig
    : [bibliographyConfig]
  const bibliography = bibliographyEntries.map(asText).filter(value => value !== undefined)

  const chapters: QuartoChapterConfig[] = []
  // YAML aliases can form a cycle. Track only the active path so two parts
  // can still reuse the same chapter list.
  const activeLists = new Set<unknown[]>()
  function readChapters (entries: unknown, appendix: boolean, part?: string): void {
    if (!Array.isArray(entries) || activeLists.has(entries)) {
      return
    }

    activeLists.add(entries)
    for (const entry of entries as unknown[]) {
      const item = asRecord(entry)
      const partName = asText(item?.part)
      const chapterTitle = asText(item?.text) ?? asText(item?.title)
      const chapterPath = markdownPath(entry) ?? markdownPath(partName) ?? markdownPath(item?.href ?? item?.file ?? item?.url)

      if (chapterPath !== undefined) {
        const chapter: QuartoChapterConfig = { path: chapterPath, appendix }
        if (chapterTitle !== undefined) {
          chapter.title = chapterTitle
        }
        if (part !== undefined) {
          chapter.part = part
        }
        chapters.push(chapter)
      }

      readChapters(item?.chapters, appendix, partName ?? part)
    }
    activeLists.delete(entries)
  }

  readChapters(book?.chapters, false)
  readChapters([book?.references], false)
  readChapters(book?.appendices, true)

  return title === undefined ? { chapters, bibliography } : { title, chapters, bibliography }
}
