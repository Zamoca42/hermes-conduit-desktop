import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { pluginName, remarkDesktopCards, richUiContent, richUiId, segments, withSpokenCards } from '../src/renderer/src/state/desktopCards'

// The reply's Markdown as Markdown.tsx draws it, a card standing in for DesktopCard.
const card = ({ node }: { node?: { properties?: Record<string, unknown> } }) =>
  createElement('span', { className: 'desktop-card' }, `${node?.properties?.dataName}:${node?.properties?.dataId}`)
const html = (text: string) =>
  renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkDesktopCards], components: { 'desktop-card': card } as object }, text))

describe('cards made for Hermes Desktop', () => {
  it('reads a directive only at a word’s start, with key="value" attributes', () => {
    const parts = segments('Here: ::richui{id="ru-0123456789ab" v="2"} and more')
    expect(parts[0]).toBe('Here: ')
    expect(parts[1]).toEqual({ name: 'richui', attributes: { id: 'ru-0123456789ab', v: '2' }, source: '::richui{id="ru-0123456789ab" v="2"}' })
    expect(parts[2]).toBe(' and more')
    // CSS, an empty one, no attributes and one still being written stay text.
    expect(segments('::selection{color:red}')).toEqual(['::selection{color:red}'])
    expect(segments('::richui{}')).toEqual(['::richui{}'])
    expect(segments('::richui{id="ru-0123456789ab"')).toEqual(['::richui{id="ru-0123456789ab"'])
    expect(segments('a::richui{id="x"}')).toEqual(['a::richui{id="x"}'])
  })

  it('names the plugin and takes only a well-formed hermes-rich-ui id', () => {
    expect(pluginName('richui')).toBe('hermes-rich-ui')
    expect(pluginName('charts')).toBe('charts')
    expect(richUiId({ name: 'richui', attributes: { id: 'ru-0123456789ab' }, source: '' })).toBe('ru-0123456789ab')
    expect(richUiId({ name: 'richui', attributes: { id: '../etc' }, source: '' })).toBeNull()
    expect(richUiId({ name: 'charts', attributes: { id: 'ru-0123456789ab' }, source: '' })).toBeNull()
  })

  it('shows the card’s own plain-text fallback', () => {
    const surface = (meta: unknown, components: unknown[] = []) => ({ ok: true, card: { surface: { createSurface: { dataModel: { meta }, components } } } })
    expect(richUiContent(surface({ title: ' Trip ', summary: 'Three days in Kyoto' }))).toEqual({ title: 'Trip', summary: 'Three days in Kyoto' })
    expect(richUiContent(surface({}, [{ id: 'root', title: 'Root title' }]))).toEqual({ title: 'Root title', summary: '' })
    expect(richUiContent(surface({}))).toBeNull()
    expect(richUiContent({ ok: false })).toBeNull()
  })

  it('draws a card in the reply, hides the board line, and leaves code, quotes and tables as written', () => {
    const drawn = html('Before\n\n::richui{id="ru-0123456789ab"}\n\nAfter')
    expect(drawn).toContain('<span class="desktop-card">richui:ru-0123456789ab</span>')
    expect(drawn).toContain('Before')
    expect(drawn).not.toContain('::richui')
    const board = html('Here it is.\n\n::conduit-board{id="b1"}')
    expect(board).not.toContain('conduit-board')
    expect(board).toContain('Here it is.')
    expect(html('`::richui{id="x"}`')).toContain('::richui{id=&quot;x&quot;}')
    expect(html('> ::richui{id="x"}')).not.toContain('desktop-card')
    expect(html('| a |\n| - |\n| ::richui{id="x"} |')).not.toContain('desktop-card')
  })

  it('says a card aloud and leaves the board line out', () => {
    expect(withSpokenCards('See ::richui{id="x"} now. ::conduit-board{id="b"}')).toBe('See (There’s a card here for Hermes Desktop.) now. ')
    expect(withSpokenCards('```\n::richui{id="x"}\n```')).toBe('```\n::richui{id="x"}\n```')
  })
})
