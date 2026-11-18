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
