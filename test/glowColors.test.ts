import { describe, expect, it } from 'vitest'
import { GOLD, assignGlows, glowFor, hexFromRgb, looksLike, paletteFrom, rgbFromHex, type RGB } from '../src/renderer/src/state/glowColors'

const rgb = (hex: string) => rgbFromHex(hex)!
/** A picture as RGBA pixels: so many of each color. */
function picture(...parts: [string, number][]): number[] {
  return parts.flatMap(([hex, count]) => {
    const { r, g, b } = rgb(hex)
    return Array.from({ length: count }, () => [r * 255, g * 255, b * 255, 255]).flat()
  })
}
const hue = (color: RGB) => {
  const high = Math.max(color.r, color.g, color.b)
  return high === color.r ? 'red' : high === color.g ? 'green' : 'blue'
}

describe('profile glow colors', () => {
  it('reads a picture main colors first, lifted to a glow, leaving out greys and stray pixels', () => {
    const colors = paletteFrom(picture(['#202060', 600], ['#208020', 300], ['#808080', 900], ['#ff0000', 10]))
    expect(colors.map(hue)).toEqual(['blue', 'green'])
    expect(Math.max(colors[0]!.r, colors[0]!.g, colors[0]!.b)).toBeGreaterThanOrEqual(0.75)
    expect(paletteFrom(picture(['#808080', 100]))).toEqual([])
  })

  it('tells close hues and greys apart', () => {
    expect(looksLike(rgb('#ff0000'), rgb('#ff3300'))).toBe(true)
    expect(looksLike(rgb('#ff0000'), rgb('#00ff00'))).toBe(false)
    expect(looksLike(rgb('#777777'), rgb('#7a7a7a'))).toBe(true)
    expect(looksLike(rgb('#777777'), rgb('#ff0000'))).toBe(false)
  })

  it('claims picks first, then gives a later look-alike picture its second color', () => {
    const blue = rgb('#3060ff')
    const green = rgb('#30ff60')
    const red = rgb('#ff3030')
    const glows = assignGlows(['a', 'b', 'c'], { a: [blue], b: [blue, green], c: [red] }, { c: rgb('#3366ff'), gone: red })
    expect(hexFromRgb(glows.c!)).toBe('#3366ff')
    // a's blue looks like c's pick, but a has nothing else: it keeps its main color.
    expect(glows.a).toEqual(blue)
    expect(glows.b).toEqual(green)
    expect(glows.gone).toBeUndefined()
  })

  it('falls back to the bot color, then its face, then gold', () => {
    const bots = [
      { name: 'default', isDefault: true, color: undefined, face: 0 },
      { name: 'furina', isDefault: false, color: '#112233', face: 1 }
    ]
    expect(glowFor('furina', {}, bots)).toBe('#112233')
    expect(glowFor('furina', { furina: rgb('#abcdef') }, bots)).toBe('#abcdef')
    expect(glowFor(null, {}, bots)).toMatch(/^hsl|^#/)
    expect(glowFor('missing', {}, bots)).toBe(GOLD)
    expect(glowFor(null, {}, [])).toBe(GOLD)
  })
})
