import { describe, expect, it } from 'vitest'
import { accentStyle, fontFamily, hex, markColor, swatchColor } from '../src/renderer/src/state/appearance'

describe('accent', () => {
  it('keeps theme.css for amber', () => {
    expect(accentStyle('amber')).toBe('')
  })
  it('gives each mode its own shade and a readable ink', () => {
    const css = accentStyle('blue')
    expect(css).toContain('--accent: #5494fa;')
    expect(css).toMatch(/prefers-color-scheme: light\) \{ :root \{ --accent: #1f5ccc;/)
    expect(css).toContain('--accent-ink: #000000;')
    expect(css).toContain('--accent-ink: #ffffff;')
  })
  it('shows the swatch in the window mode', () => {
    expect(swatchColor('amber', true)).toBe('#e0ab47')
    expect(swatchColor('green', false)).toBe(hex([0.09, 0.47, 0.27]))
  })
  it('picks the mark with more contrast', () => {
    expect(markColor([1, 1, 1])).toBe('#000000')
    expect(markColor([0.1, 0.1, 0.4])).toBe('#ffffff')
  })
})

describe('chat text style', () => {
  it('leaves the default alone and keeps code monospace for Mono', () => {
    expect(fontFamily('standard')).toBeNull()
    expect(fontFamily('mono')).toBe('var(--mono)')
    expect(fontFamily('serif')).toContain('serif')
  })
})

describe('a color of your own', () => {
  it('keeps a pick that reads and moves one that does not', async () => {
    const { customShades, contrast, accentStyle } = await import('../src/renderer/src/state/appearance')
    const { dark, light } = customShades('#E36140')
    expect(contrast(dark, [0.045, 0.052, 0.072])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(light, [0.94, 0.95, 0.98])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(light, [1, 1, 1])).toBeGreaterThanOrEqual(4.5)
    const yellow = customShades('#FFFF00')
    expect(yellow.dark).toEqual([1, 1, 0])
    expect(contrast(yellow.light, [1, 1, 1])).toBeGreaterThanOrEqual(4.5)
    expect(accentStyle('#E36140')).toContain('--accent-ink: #ffffff;')
  })
})
