import type { StagedAttachment } from './attachments'
import type { ReplyReference } from './quote'

/** Unsent words, files and a quoted reply, kept for the chat they were typed in. */
export interface ComposerDraft {
  text: string
  attachments: StagedAttachment[]
  replyTo: ReplyReference | null
}

export const isEmptyDraft = (draft: ComposerDraft) => !draft.text && draft.attachments.length === 0 && !draft.replyTo

/** A draft's key: its host as well as the chat, since two hosts can share profile names and ids. */
export const draftStoreKey = (host: string, chat: string) => `${host}\u0000${chat}`

/** A chat's own draft: its profile and id ('new' before Hermes makes one). */
export const chatDraft = (profile: string | undefined, id: string | null | undefined) => `chat\u0000${profile ?? ''}\u0000${id ?? 'new'}`

/** The phone's ComposerDraftStore: the 12 most recently left drafts, in memory, newest last. */
export class DraftStore {
  private drafts = new Map<string, ComposerDraft>()
  constructor(private capacity = 12) {}

  /** Keeps a draft (an empty one drops what was kept). */
  save(key: string, draft: ComposerDraft): void {
    this.drafts.delete(key)
    if (isEmptyDraft(draft) || this.capacity <= 0) return
    this.drafts.set(key, { text: draft.text, attachments: [...draft.attachments], replyTo: draft.replyTo })
    while (this.drafts.size > this.capacity) this.drafts.delete(this.drafts.keys().next().value as string)
  }

  /** The draft kept for a chat, taken out of the store: the composer holds it now. */
  take(key: string): ComposerDraft | null {
    const draft = this.drafts.get(key) ?? null
    this.drafts.delete(key)
    return draft
  }

  peek(key: string): ComposerDraft | null {
    return this.drafts.get(key) ?? null
  }

  /** A host signed out: its drafts go. */
  dropHost(host: string): void {
    for (const key of [...this.drafts.keys()]) if (key.startsWith(`${host}\u0000`)) this.drafts.delete(key)
  }

  get size(): number {
    return this.drafts.size
  }
}

export const composerDrafts = new DraftStore()
