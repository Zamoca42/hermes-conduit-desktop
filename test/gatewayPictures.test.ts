import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Outcome = { ok: true; result: unknown } | { ok: false; error: string; code?: number }
let answers: Outcome[] = []
let asked: string[] = []

beforeEach(() => {
  vi.resetModules()
  answers = []
  asked = []
  ;(globalThis as { window?: unknown }).window = {
    conduit: {
      httpOutcome: async (_method: string, path: string) => {
        asked.push(path)
        return answers.shift() ?? { ok: false, error: 'no answer' }
      }
    }
  }
})
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

const picture = (bytes: string): Outcome => ({ ok: true, result: { dataUrl: `data:image/png;base64,${bytes}` } })
const status = (code: number): Outcome => ({ ok: false, error: `HTTP ${code}`, code })
const load = () => import('../src/renderer/src/state/gatewayPictures')

describe('pictures on the Hermes host, per dashboard (desktop#222)', () => {
  it("never draws one dashboard's picture on another", async () => {
    const pictures = await load()
    pictures.setPictureHost('https://a')
    answers.push(picture('QUFB'))
    expect(await pictures.readGatewayPicture('/tmp/chart.png')).toBe('data:image/png;base64,QUFB')
    pictures.setPictureHost('https://b')
    expect(pictures.keptPicture('/tmp/chart.png')).toBeUndefined()
    answers.push(picture('QkJC'))
    expect(await pictures.readGatewayPicture('/tmp/chart.png')).toBe('data:image/png;base64,QkJC')
    expect(asked).toHaveLength(2)
  })

  it("doesn't keep one dashboard's refusal for another", async () => {
    const pictures = await load()
    pictures.setPictureHost('https://a')
    answers.push(status(404))
    expect(await pictures.readGatewayPicture('/tmp/chart.png')).toBeNull()
    expect(pictures.keptPicture('/tmp/chart.png')).toBeNull()
    pictures.setPictureHost('https://b')
    answers.push(picture('QkJC'))
    expect(await pictures.readGatewayPicture('/tmp/chart.png')).toBe('data:image/png;base64,QkJC')
  })

  it("drops an answer that lands after the switch", async () => {
    const pictures = await load()
    pictures.setPictureHost('https://a')
    answers.push(picture('QUFB'))
    const late = pictures.readGatewayPicture('/tmp/chart.png')
    pictures.setPictureHost('https://b')
    await late
    expect(pictures.keptPicture('/tmp/chart.png')).toBeUndefined()
    pictures.setPictureHost('https://a')
    expect(pictures.keptPicture('/tmp/chart.png')).toBeUndefined()
  })
})

describe('a failure to ask is asked again (desktop#223)', () => {
  it.each([401, 408, 429, 502])('after a %i', async code => {
    const pictures = await load()
    answers.push(status(code), picture('QUFB'))
    expect(await pictures.readGatewayPicture('/h/a.png')).toBeNull()
    expect(pictures.keptPicture('/h/a.png')).toBeUndefined()
    expect(await pictures.readGatewayPicture('/h/a.png')).toBe('data:image/png;base64,QUFB')
  })

  it("keeps a refusal Hermes means", async () => {
    const pictures = await load()
    for (const code of [400, 403, 404, 410, 413, 415]) expect(pictures.refused({ code })).toBe(true)
    answers.push(status(404))
    await pictures.readGatewayPicture('/h/gone.png')
    expect(await pictures.readGatewayPicture('/h/gone.png')).toBeNull()
    expect(asked).toHaveLength(1)
  })
})

describe('how many pictures are kept (desktop#294)', () => {
  it('lets the least recently shown go past the bound, and reads it again when shown', async () => {
    const pictures = await load()
    pictures.setPictureHost('https://a')
    for (let i = 0; i <= pictures.KEPT_PICTURES_MAX; i++) {
      answers.push(picture(`P${i}`))
      await pictures.readGatewayPicture(`/tmp/${i}.png`)
      // The first stays the most recently shown.
      pictures.keptPicture('/tmp/0.png')
    }
    expect(pictures.keptPicture('/tmp/0.png')).toBe('data:image/png;base64,P0')
    expect(pictures.keptPicture('/tmp/1.png')).toBeUndefined()
    expect(pictures.keptPicture(`/tmp/${pictures.KEPT_PICTURES_MAX}.png`)).toBe(`data:image/png;base64,P${pictures.KEPT_PICTURES_MAX}`)
    answers.push(picture('again'))
    expect(await pictures.readGatewayPicture('/tmp/1.png')).toBe('data:image/png;base64,again')
  })

  it('keeps a refusal however many pictures come after it', async () => {
    const pictures = await load()
    pictures.setPictureHost('https://a')
    answers.push(status(404))
    await pictures.readGatewayPicture('/tmp/gone.png')
    for (let i = 0; i <= pictures.KEPT_PICTURES_MAX; i++) {
      answers.push(picture(`P${i}`))
      await pictures.readGatewayPicture(`/tmp/${i}.png`)
    }
    const before = asked.length
    expect(await pictures.readGatewayPicture('/tmp/gone.png')).toBeNull()
    expect(pictures.keptPicture('/tmp/gone.png')).toBeNull()
    expect(asked).toHaveLength(before)
  })

  it('bounds the data URL kept in all, not only the count', async () => {
    const pictures = await load()
    pictures.setPictureHost('https://a')
    // Seven pictures near the 16 MB file limit are over the bound together.
    const big = 'A'.repeat(20 * 1024 * 1024)
    for (let i = 0; i < 7; i++) {
      answers.push(picture(big))
      await pictures.readGatewayPicture(`/tmp/${i}.png`)
    }
    expect(pictures.keptPicture('/tmp/0.png')).toBeUndefined()
    expect(pictures.keptPicture('/tmp/6.png')).toBeDefined()
  })
})
