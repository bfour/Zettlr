import type { QuartoSectionIndex } from './section-references'

export interface QuartoProjectInfo {
  root: string
  configPath: string
  title?: string
  chapters: Array<{ path: string, title?: string, part?: string, appendix?: boolean }>
  bibliography: string[]
  sections: QuartoSectionIndex
  canRender: boolean
  unreadableChapters?: string[]
}
