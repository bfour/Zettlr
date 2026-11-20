import { getBibliographyForDescriptor } from '@common/util/get-bibliography-for-descriptor'
import { isAbsolutePath, resolvePath } from '@common/util/renderer-path-polyfill'
import { CITEPROC_MAIN_DB } from '@dts/common/citeproc'
import type { AnyDescriptor, MDFileDescriptor } from '@dts/common/fsal'

export function getRendererBibliography (descriptor: MDFileDescriptor): string {
  const library = getBibliographyForDescriptor(descriptor)
  return library === CITEPROC_MAIN_DB || isAbsolutePath(library)
    ? library
    : resolvePath(descriptor.dir, library)
}

export function collectWorkspaceCitekeys (
  activeDescriptor: MDFileDescriptor,
  library: string,
  workspaceMap: ReadonlyMap<string, string[]>,
  descriptorMap: ReadonlyMap<string, AnyDescriptor>,
  activeCitekeys: readonly string[],
  modifiedCitekeys: ReadonlyMap<string, readonly string[]> = new Map()
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

  // The editor's citation keys also reflect additions and removals before save.
  const citekeys = new Set(activeCitekeys)
  for (const filePath of workspacePaths) {
    if (filePath === activeDescriptor.path) {
      continue
    }
    const descriptor = descriptorMap.get(filePath)
    if (descriptor?.type === 'file' && getRendererBibliography(descriptor) === library) {
      for (const key of modifiedCitekeys.get(filePath) ?? descriptor.citekeys) {
        citekeys.add(key)
      }
    }
  }

  return citekeys
}
