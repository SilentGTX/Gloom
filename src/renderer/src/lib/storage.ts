/**
 * The settings Gloom kept when its page was a file:// page come across to
 * app://gloom, once (src/main/storage.ts). main.tsx waits for this before the
 * app loads, so the stores read them as they start. An entry the page already
 * has wins.
 */
export async function takeMovedStorage(): Promise<void> {
  try {
    const entries = await window.gloom?.storageToMove()
    for (const [key, value] of entries ?? []) if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
  } catch {
    // Settings are a convenience: the app starts with its defaults.
  }
}
