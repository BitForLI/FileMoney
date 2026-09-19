import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function createLibraryBackup(libraryPath: string, destinationPath: string): Promise<string> {
  const library = await fs.realpath(libraryPath)
  const destination = await fs.realpath(destinationPath)
  const relative = path.relative(library, destination)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Choose a backup folder outside the current library')
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  const backupPath = path.join(destination, `Pagefold-backup-${stamp}-${randomUUID().slice(0, 8)}`)
  await fs.mkdir(backupPath)
  try {
    await fs.cp(library, backupPath, { recursive: true, force: false, errorOnExist: true, dereference: false })
    return backupPath
  } catch (error) {
    // Only remove the new folder created by this call; never touch the library.
    await fs.rm(backupPath, { recursive: true, force: true })
    throw error
  }
}
