import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import type { Bot } from '../state/bots'
import { GOLD, SAMPLE_SIDE, assignGlows, glowFor, paletteFrom, readPicks, rgbFromHex, subscribePicks, type RGB } from '../state/glowColors'
import { readAvatar } from '../state/useBots'

/** A profile's glow color as CSS (no name: the main profile's). */
export type GlowOf = (name?: string | null) => string

export const GlowContext = createContext<GlowOf>(() => GOLD)

const palettes = new Map<string, Promise<RGB[]>>()

/** A picture's main colors, counted from a 32 px copy. */
function paletteOf(url: string): Promise<RGB[]> {
  let pending = palettes.get(url)
  if (!pending) {
    pending = new Promise<RGB[]>(resolve => {
      const image = new Image()
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = SAMPLE_SIDE
          canvas.height = SAMPLE_SIDE
          const context = canvas.getContext('2d', { willReadFrequently: true })
          if (!context) return resolve([])
          context.drawImage(image, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE)
          resolve(paletteFrom(context.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data))
        } catch {
          resolve([])
        }
      }
      image.onerror = () => resolve([])
      image.src = url
    })
    palettes.set(url, pending)
  }
  return pending
}

/** Every bot's glow color, from its pick on this computer, its picture, its Hermes color or its starter face. */
export function useGlowColors(bots: Bot[], host: string): GlowOf {
  const [picks, setPicks] = useState(() => readPicks(host))
  const [found, setFound] = useState<Record<string, RGB[]>>({})

  useEffect(() => {
    setPicks(readPicks(host))
    return subscribePicks((changed, next) => {
      if (changed === host) setPicks(next)
    })
  }, [host])

  const pictured = bots.filter(bot => bot.hasAvatar).map(bot => bot.name)
  const pictureKey = pictured.join('\n')
  useEffect(() => {
    let live = true
    void Promise.all(pictured.map(async name => [name, await readAvatar(name).then(url => (url ? paletteOf(url) : []))] as const)).then(entries => {
      if (live) setFound(Object.fromEntries(entries))
    })
    return () => {
      live = false
    }
    // The pictures are read again when the roster's pictured bots change, or one of them changes (bots reload then).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pictureKey, bots])

  const assigned = useMemo(() => {
    const picked = Object.fromEntries(Object.entries(picks).flatMap(([name, hex]) => (rgbFromHex(hex) ? [[name, rgbFromHex(hex)!]] : [])))
    return assignGlows(
      bots.map(bot => bot.name),
      found,
      picked
    )
  }, [bots, found, picks])

  return useCallback<GlowOf>(name => glowFor(name, assigned, bots), [assigned, bots])
}
