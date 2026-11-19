/**
 * The wake phrase's offline speech models (Vosk), downloaded for the
 * language the person picks, never bundled: Vosk's own list names each
 * language's small model, its size and checksum. One model is kept at a
 * time, as a gzipped tar the listener loads.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WakeModelChoice } from '../shared/ipc'
import { tarGz, zipEntries } from './wakeArchive'

export const MODELS_URL = 'https://alphacephei.com/vosk/models/'
export const MODEL_LIST = MODELS_URL + 'model-list.json'

/** Each language's small, current model from Vosk's list, in its order. */
export function modelChoices(list: unknown): WakeModelChoice[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const choices: WakeModelChoice[] = []
  for (const row of list) {
    const model = row as Record<string, unknown>
    if (model?.type !== 'small' || String(model.obsolete) !== 'false') continue
    const lang = typeof model.lang === 'string' ? model.lang : ''
    const name = typeof model.name === 'string' ? model.name : ''
    if (!lang || !/^vosk-model-small-[\w.-]+$/.test(name) || seen.has(lang)) continue
    seen.add(lang)
    const size = Number(model.size)
    choices.push({
      lang,
      name,
      label: typeof model.lang_text === 'string' && model.lang_text ? model.lang_text : lang,
      bytes: Number.isFinite(size) && size > 0 ? size : undefined,
      md5: typeof model.md5 === 'string' && /^[0-9a-f]{32}$/i.test(model.md5) ? model.md5.toLowerCase() : undefined
    })
  }
  return choices
}

export interface InstalledModel {
  lang: string
  name: string
  label: string
}

type Fetch = (url: string) => Promise<Response>

export class WakeModels {
  constructor(
    private readonly dir: string,
    private readonly fetchImpl: Fetch
  ) {}

  private get meta() {
    return join(this.dir, 'model.json')
  }
  private get archive() {
    return join(this.dir, 'model.tar.gz')
  }

  async catalog(): Promise<WakeModelChoice[]> {
    const response = await this.fetchImpl(MODEL_LIST)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return modelChoices(await response.json())
  }

  async installed(): Promise<InstalledModel | null> {
    try {
      const meta = JSON.parse(await readFile(this.meta, 'utf8')) as InstalledModel
      return typeof meta.lang === 'string' && typeof meta.name === 'string' ? meta : null
    } catch {
      return null
    }
  }

  /** The kept model, for the listener. */
  read(): Promise<Buffer> {
    return readFile(this.archive)
  }

  /** Downloads `choice`, checks it, and keeps it in place of any other. */
  async download(choice: WakeModelChoice, progress: (received: number, total: number | undefined) => void, signal?: AbortSignal): Promise<InstalledModel> {
    const response = await this.fetchImpl(MODELS_URL + choice.name + '.zip')
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const total = Number(response.headers.get('content-length')) || choice.bytes
    const chunks: Buffer[] = []
    let received = 0
    const reader = response.body.getReader()
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined)
        throw new Error('cancelled')
      }
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(Buffer.from(value))
      received += value.length
      progress(received, total)
    }
    const zip = Buffer.concat(chunks)
    if (choice.md5 && createHash('md5').update(zip).digest('hex') !== choice.md5) throw new Error('the download was damaged')
    const archive = tarGz(zipEntries(zip))
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.archive, archive)
    const meta: InstalledModel = { lang: choice.lang, name: choice.name, label: choice.label }
    await writeFile(this.meta, JSON.stringify(meta))
    return meta
  }

  async remove(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true })
  }
}
