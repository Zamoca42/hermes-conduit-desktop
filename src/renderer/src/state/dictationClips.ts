/**
 * A Hermes dictation's recording, kept on this computer until its words are
 * in a draft, after the phone's DictationClipStore (#1380, #1385): a dropped
 * connection, a failed upload or Conduit closing doesn't lose what was said.
 */

/** A recording whose words haven't reached a draft yet. */
export interface DictationClip {
  id: string
  /** The host and profile it was said to: it's offered only there. */
  host: string
  profile: string
  mime: string
  base64: string
  /** Seconds. */
  duration: number
  /** When it was kept, in ms. */
  created: number
}

/** Kept recordings go once two weeks old, and past twenty the oldest go. */
export const CLIP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
export const CLIP_LIMIT = 20
/** Hermes answering empty for a recording this long or longer keeps it: words were likely said. */
export const KEEP_EMPTY_FROM_S = 10
/** An upload that failed on the connection or a busy host is tried again after these many seconds. */
export const RETRY_DELAYS_S = [5, 15, 30, 60]

/** A dropped connection, a timeout, 408, 429 or a 5xx other than 501 is worth another try; a sign-in, any other 4xx or Hermes' own error isn't. */
export function isTransient(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code !== 'number') {
    const message = error instanceof Error ? error.message : String(error)
    return /timed? ?out|network|ECONN|ENOTFOUND|EAI_AGAIN|socket|fetch failed|disconnected|offline/i.test(message)
  }
  return code === 408 || code === 429 || (code >= 500 && code <= 599 && code !== 501)
}

/** Runs an upload, trying a transient failure again after each delay; the last failure is thrown. */
export async function withRetries<T>(upload: () => Promise<T>, wait: (ms: number) => Promise<void>, delays = RETRY_DELAYS_S): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await upload()
    } catch (e) {
      if (attempt >= delays.length || !isTransient(e)) throw e
      await wait(delays[attempt]! * 1000)
    }
  }
}

/** Whether a recording Hermes answered with `words` for stays kept. */
export const keepsAfter = (words: string, duration: number) => !words && duration >= KEEP_EMPTY_FROM_S

/** The kept clips that stay: under two weeks old, the newest twenty. */
export function pruned(clips: DictationClip[], now = Date.now()): DictationClip[] {
  return clips
    .filter(clip => now - clip.created < CLIP_MAX_AGE_MS)
    .sort((a, b) => b.created - a.created)
    .slice(0, CLIP_LIMIT)
}

export interface ClipStore {
  all(): Promise<DictationClip[]>
  put(clip: DictationClip): Promise<void>
  remove(id: string): Promise<void>
}

/** For tests, and when IndexedDB can't open. */
export function memoryClipStore(): ClipStore {
  const clips = new Map<string, DictationClip>()
  return {
    all: async () => [...clips.values()],
    put: async clip => void clips.set(clip.id, clip),
    remove: async id => void clips.delete(id)
  }
}

/** IndexedDB, so a recording outlives Conduit closing. */
export function indexedClipStore(name = 'conduit-dictation'): ClipStore {
  let opened: Promise<IDBDatabase> | null = null
  const db = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('clips', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }))
  const run = async <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const store = (await db()).transaction('clips', mode).objectStore('clips')
    return new Promise<T>((resolve, reject) => {
      const request = act(store)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return {
    all: () => run<DictationClip[]>('readonly', store => store.getAll() as IDBRequest<DictationClip[]>),
    put: async clip => void (await run('readwrite', store => store.put(clip))),
    remove: async id => void (await run('readwrite', store => store.delete(id)))
  }
}

/** The clips kept on this computer, with the listeners that draw them. */
export class ClipInbox {
  private clips: DictationClip[] = []
  private loaded: Promise<void> | null = null
  private listeners = new Set<() => void>()
  constructor(private store: ClipStore) {}

  load(now = Date.now()): Promise<void> {
    return (this.loaded ??= this.store
      .all()
      .then(async all => {
        this.clips = pruned(all, now)
        for (const gone of all.filter(c => !this.clips.includes(c))) await this.store.remove(gone.id).catch(() => undefined)
        this.changed()
      })
      .catch(() => undefined))
  }

  /** Writes a recording before its upload starts. */
  async keep(clip: DictationClip): Promise<void> {
    await this.load()
    this.clips = [clip, ...this.clips.filter(c => c.id !== clip.id)]
    const kept = pruned(this.clips, clip.created)
    for (const gone of this.clips.filter(c => !kept.includes(c))) await this.store.remove(gone.id).catch(() => undefined)
    this.clips = kept
    await this.store.put(clip).catch(() => undefined)
    this.changed()
  }

  /** Its words reached a draft, or it was deleted. */
  async release(id: string): Promise<void> {
    this.clips = this.clips.filter(c => c.id !== id)
    await this.store.remove(id).catch(() => undefined)
    this.changed()
  }

  /** The clips offered above a composer: its host and profile's, newest first, without those uploading now. */
  offered(host: string, profile: string, busy: ReadonlySet<string> = new Set()): DictationClip[] {
    return this.clips.filter(c => c.host === host && c.profile === profile && !busy.has(c.id))
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** Bumps on every change, for useSyncExternalStore. */
  version = 0
  private changed() {
    this.version++
    for (const listener of this.listeners) listener()
  }
}
