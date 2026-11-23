import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments stripped, so a commented-out rule doesn't count.
const css = readFileSync(join(__dirname, '../src/renderer/src/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Every declaration block for `selector`, joined. */
function rules(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&').replace(/\s+/g, '\\s*')
  return [...css.matchAll(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'gm'))].map(m => m[1]).join(';')
}

describe('docked Pulse layout', () => {
  // Picking another dashboard's Pulse chip swaps the feed for a frame on its kept connection. The chips over it
  // shrank to their width and centered, and the frame's page added its own padding under them, so the chips
  // and the header moved (Eric, 2026-11-23). They now sit where this dashboard's page draws them.
  it('draws the chip row on the page padding, full width, with one scrollbar gutter', () => {
    const docked = rules('main.docked-pulse')
    expect(docked).toMatch(/padding:\s*0/)
    // Outranks main.pulse-page's stable gutter, which the docked page matches too.
    expect(rules('main.docked-pulse.pulse-page')).toMatch(/scrollbar-gutter:\s*auto/)
    expect(docked).not.toMatch(/scrollbar-gutter/)
    const chips = rules('.docked-pulse-chips')
    expect(chips).toMatch(/padding:\s*var\(--page-pad-top\)\s+var\(--page-pad-x\)\s+0/)
    expect(chips).toMatch(/scrollbar-gutter:\s*stable/)
    expect(rules('main.needs')).toMatch(/padding:\s*var\(--page-pad-top\)\s+var\(--page-pad-x\)/)
  })

  it('starts the frame page header the chips gap below them, and keeps the feeds gutter', () => {
    expect(rules('.docked-pulse-chips .pulse-hosts')).toMatch(/margin-bottom:\s*0/)
    expect(rules('.chat-window-page > main.pulse-page')).toMatch(/padding-top:\s*24px/)
    expect(rules('main.pulse-page')).toMatch(/scrollbar-gutter:\s*stable/)
  })
})
