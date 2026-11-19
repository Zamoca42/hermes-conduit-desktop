import type { ChatWindowRequest } from './ipc'

/** Chat windows of their own open at once, as the phone's chatWindowLimit. */
export const CHAT_WINDOW_LIMIT = 3

/** The chat a window of its own was opened on, from its page's hash; null for any other page. */
export function chatWindowRequest(hash: string): ChatWindowRequest | null {
  const match = /^#chat=(.+)$/.exec(hash)
  if (!match) return null
  try {
    const raw = JSON.parse(decodeURIComponent(match[1]!)) as Partial<ChatWindowRequest> | null
    if (!raw || typeof raw.id !== 'string' || !raw.id) return null
    return {
      id: raw.id,
      profile: typeof raw.profile === 'string' ? raw.profile : undefined,
      title: typeof raw.title === 'string' ? raw.title : undefined,
      author: typeof raw.author === 'string' ? raw.author : undefined
    }
  } catch {
    return null
  }
}
