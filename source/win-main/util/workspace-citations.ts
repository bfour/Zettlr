import { getBibliographyForDescriptor } from '@common/util/get-bibliography-for-descriptor'
import { isAbsolutePath, resolvePath } from '@common/util/renderer-path-polyfill'
import type { QuartoProjectInfo } from '@common/quarto/project-info'
import { CITEPROC_MAIN_DB } from '@dts/common/citeproc'
import type { AnyDescriptor, MDFileDescriptor } from '@dts/common/fsal'

export function getRendererBibliography (descriptor: MDFileDescriptor, quarto?: QuartoProjectInfo): string {
  const library = getBibliographyForDescriptor(descriptor)
  if (library === CITEPROC_MAIN_DB) {
    return quarto?.chapters.some(chapter => chapter.path === descriptor.path) === true
      ? quarto.bibliography[0] ?? library
      : library
  }
  return isAbsolutePath(library) ? library : resolvePath(descriptor.dir, library)
}

export function collectWorkspaceCitekeys (
  activeDescriptor: MDFileDescriptor,
  library: string,
  workspaceMap: ReadonlyMap<string, string[]>,
  descriptorMap: ReadonlyMap<string, AnyDescriptor>,
  activeCitekeys: readonly string[],
  modifiedCitekeys: ReadonlyMap<string, readonly string[]> = new Map(),
  quarto?: QuartoProjectInfo
): Set<string> {
  let workspaceRoot = ''
  let workspacePaths: string[] = []
  for (const [ root, paths ] of workspaceMap) {
    if (
      root.length > workspaceRoot.length &&
      descriptorMap.get(root)?.type === 'directory' &&
      paths.includes(activeDescriptor.path)
    ) {
      workspaceRoot = root
      workspacePaths = paths
    }
  }

  if (quarto?.chapters.some(chapter => chapter.path === activeDescriptor.path) === true) {
    workspacePaths = quarto.chapters.map(chapter => chapter.path)
  }

  // The editor's citation keys also reflect additions and removals before save.
  const citekeys = new Set(activeCitekeys)
  for (const filePath of workspacePaths) {
    if (filePath === activeDescriptor.path) {
      continue
    }
    const descriptor = descriptorMap.get(filePath)
    if (descriptor?.type === 'file' && getRendererBibliography(descriptor, quarto) === library) {
      for (const key of modifiedCitekeys.get(filePath) ?? descriptor.citekeys) {
        citekeys.add(key)
      }
    }
  }

  return citekeys
}
