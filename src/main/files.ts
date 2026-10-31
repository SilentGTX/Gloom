// What `@` offers in the composer: the files in a session's working folder, as
// Claude Code lists them (PLAN.md › 10). With nothing typed after the `@`, the
// folder's own top level, everything in it; as you type, every file under it
// and their folders. In a git repository that's what git knows plus the new
// files it doesn't ignore; anywhere else, every file. Only ever the folder the
// session works in: the window names a session, never a path.
import { readdir } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import type { FileListing } from '@shared/live'
import { git } from './git/diff'

/** A folder holding more than this lists this many; typing narrows what's found among them. */
const MAX_FILES = 50_000
/** Outside git, a walk stops after this long and lists what it found. */
const WALK_MS = 3_000
/** `@` asks each time its list opens; a listing this fresh is the answer. */
const FRESH_MS = 10_000

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const listings = new Map<string, { at: number; listing: Promise<FileListing> }>()

export function listFiles(cwd: string): Promise<FileListing> {
  const now = Date.now()
  for (const [key, held] of listings) if (now - held.at >= FRESH_MS) listings.delete(key)
  const key = normalize(cwd).toLowerCase()
  const held = listings.get(key)
  if (held) return held.listing
  const listing = read(cwd)
  listings.set(key, { at: now, listing })
  listing.catch(() => listings.delete(key))
  return listing
}

async function read(cwd: string): Promise<FileListing> {
  const [top, known] = await Promise.all([topLevel(cwd), gitFiles(cwd)])
  const { files, truncated } = known ? { files: known.slice(0, MAX_FILES), truncated: known.length > MAX_FILES } : await walk(cwd)
  // Each file's folders are found too, as Claude Code's own list has them.
  const folders = new Set<string>()
  for (const file of files) {
    for (let slash = file.indexOf('/'); slash > 0; slash = file.indexOf('/', slash + 1)) folders.add(file.slice(0, slash + 1))
  }
  return { top, all: [...folders, ...files], truncated }
}

/** The folder's own entries, A–Z, as a directory listing shows them: hidden and ignored ones too. */
async function topLevel(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(cwd, { withFileTypes: true })
    return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort(collator.compare)
  } catch {
    return []
  }
}

/** git's files under the folder: tracked, and untracked ones it doesn't ignore. Null outside a repository. */
async function gitFiles(cwd: string): Promise<string[] | null> {
  try {
    const out = await git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], 64 * 1024 * 1024)
    return out.split('\0').filter(Boolean)
  } catch {
    return null
  }
}

/** Every file under the folder, nearest first; git's own folders and linked folders aren't entered. */
async function walk(root: string): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = []
  const folders = ['']
  const until = Date.now() + WALK_MS
  for (let next = 0; next < folders.length; next++) {
    if (Date.now() > until) return { files, truncated: true }
    const folder = folders[next]
    let entries
    try {
      entries = await readdir(join(root, folder), { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const path = folder ? `${folder}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (e.name !== '.git') folders.push(path)
      } else {
        files.push(path)
        if (files.length >= MAX_FILES) return { files, truncated: true }
      }
    }
  }
  return { files, truncated: false }
}
