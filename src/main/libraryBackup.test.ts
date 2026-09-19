import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createLibraryBackup } from './libraryBackup'

const tempPaths: string[] = []

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

test('copies notes and attachments without changing the source library', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pagefold-backup-test-'))
  tempPaths.push(root)
  const library = path.join(root, 'library')
  const destination = path.join(root, 'external')
  await mkdir(path.join(library, '.assets'), { recursive: true })
  await mkdir(destination)
  await writeFile(path.join(library, 'Hello.md'), '# Hello')
  await writeFile(path.join(library, '.assets', 'image.png'), 'image bytes')

  const backup = await createLibraryBackup(library, destination)

  expect(path.dirname(backup)).toBe(destination)
  expect(await readFile(path.join(backup, 'Hello.md'), 'utf8')).toBe('# Hello')
  expect(await readFile(path.join(backup, '.assets', 'image.png'), 'utf8')).toBe('image bytes')
  expect(await readFile(path.join(library, 'Hello.md'), 'utf8')).toBe('# Hello')
})

test('rejects a destination inside the library to prevent recursive copies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pagefold-backup-test-'))
  tempPaths.push(root)
  const library = path.join(root, 'library')
  const nested = path.join(library, 'backups')
  await mkdir(nested, { recursive: true })

  await expect(createLibraryBackup(library, nested)).rejects.toThrow('outside the current library')
  expect(await readdir(nested)).toEqual([])
})
