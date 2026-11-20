const { createHash } = require('node:crypto')
const { createReadStream, createWriteStream } = require('node:fs')
const { chmod, mkdtemp, rename, rm, stat, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const AdmZip = require('adm-zip')
const tar = require('tar')
const { EnvHttpProxyAgent, fetch } = require('undici')

const VERSION = '3.14'
const RELEASE_DIRECTORY = `pandoc-${VERSION}`
const RELEASE_URL = `https://github.com/jgm/pandoc/releases/download/${VERSION}/`
const RESOURCES = path.join(__dirname, '..', 'resources')

// Archive names and SHA-256 digests from the assets of the pinned GitHub release.
const ASSETS = {
  'darwin-arm64': {
    suffix: 'arm64-macOS.zip',
    member: `${RELEASE_DIRECTORY}-arm64/bin/pandoc`,
    sha256: '58d6593884fec9d4424b641b92503c316d9c36decb2891ff8d73ae74dd3b6304'
  },
  'darwin-x64': {
    suffix: 'x86_64-macOS.zip',
    member: `${RELEASE_DIRECTORY}-x86_64/bin/pandoc`,
    sha256: '891708579061e7b1c1a6ce0df30ebb3cb2b6d0ca045ed3c8554ab830c1e0c270'
  },
  'linux-arm64': {
    suffix: 'linux-arm64.tar.gz',
    sha256: 'c692f3d78a415741bbbac4cdbbbe26fa7edca1f43d2301b982fbf4009cc8cf7f'
  },
  'linux-x64': {
    suffix: 'linux-amd64.tar.gz',
    sha256: 'c5f4720cdefb3f7bdc5d07202ef579feef0d1370773c873804dd8fdaa8c4f1b8'
  },
  'win32-x64': {
    suffix: 'windows-x86_64.zip',
    sha256: '0144b96e8c7b023fd382ec5ef5bdc475e873f1019d6fa72502492df2c9a94a3b'
  }
}

async function fetchArchive (filename, archivePath) {
  const dispatcher = new EnvHttpProxyAgent()
  try {
    const response = await fetch(new URL(filename, RELEASE_URL), {
      dispatcher,
      signal: AbortSignal.timeout(5 * 60 * 1000)
    })
    if (!response.ok || response.body === null) {
      throw new Error(`Pandoc download failed for ${filename} (HTTP ${response.status})`)
    }

    await pipeline(response.body, createWriteStream(archivePath))
  } finally {
    await dispatcher.destroy()
  }
}

async function downloadPandoc (platform, arch) {
  const asset = ASSETS[`${platform}-${arch}`]
  if (asset === undefined) {
    throw new Error(`No bundled Pandoc release for ${platform}/${arch}`)
  }

  const filename = `${RELEASE_DIRECTORY}-${asset.suffix}`
  const executable = platform === 'win32' ? 'pandoc.exe' : 'pandoc'
  const cachedArch = arch === 'arm64' ? 'arm' : arch
  const extension = platform === 'win32' ? '.exe' : ''
  const destination = path.join(RESOURCES, `pandoc-${platform}-${cachedArch}${extension}`)
  const staging = await mkdtemp(path.join(RESOURCES, 'pandoc-download-'))

  try {
    const archivePath = path.join(staging, filename)
    const binaryPath = path.join(staging, executable)
    await fetchArchive(filename, archivePath)

    const hash = createHash('sha256')
    for await (const chunk of createReadStream(archivePath)) {
      hash.update(chunk)
    }
    if (hash.digest('hex') !== asset.sha256) {
      throw new Error(`Pandoc download checksum mismatch for ${filename}`)
    }

    if (platform === 'linux') {
      await tar.x({
        cwd: staging,
        file: archivePath,
        filter: (name, entry) => name === `${RELEASE_DIRECTORY}/bin/pandoc` && entry.type === 'File',
        strip: 2,
        strict: true
      })
    } else {
      const archive = new AdmZip(archivePath)
      const member = platform === 'darwin'
        ? archive.getEntry(asset.member)
        : archive.getEntry(`${RELEASE_DIRECTORY}/pandoc.exe`) ?? archive.getEntry('pandoc.exe')
      if (member === null || member.isDirectory) {
        throw new Error(`Pandoc executable missing from ${filename}`)
      }
      await writeFile(binaryPath, member.getData())
    }

    const binary = await stat(binaryPath)
    if (!binary.isFile() || binary.size === 0) {
      throw new Error(`Invalid Pandoc executable in ${filename}`)
    }
    if (platform !== 'win32') {
      await chmod(binaryPath, 0o755)
    }

    await rename(binaryPath, destination)
    return destination
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

module.exports = { downloadPandoc }

if (require.main === module) {
  const [ platform = process.platform, architecture = process.arch ] = process.argv.slice(2)
  const arch = architecture === 'arm' ? 'arm64' : architecture
  downloadPandoc(platform, arch).then(
    filename => console.log(`Downloaded ${filename}`),
    error => {
      console.error(error)
      process.exitCode = 1
    }
  )
}
