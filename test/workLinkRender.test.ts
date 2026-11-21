import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  const store = new Map<string, string>()
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window ?? {}, { conduit: new Proxy({ platform: 'linux' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => () => {}) }), addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  })
})

const text = 'Deployed. [Open W19](conduit://session/s19?profile=zhongli) @session:zhongli/s19'

describe('a reply’s work links draw', () => {
  it('as a card where one can open its chat, and as the reply’s words elsewhere', async () => {
    // Paths the node typecheck doesn't follow: the components are the renderer's, checked by tsconfig.web.json.
    const transcript = '../src/renderer/src/components/Transcript.tsx'
    const card = '../src/renderer/src/components/WorkLinkCard.tsx'
    const { Reply } = (await import(/* @vite-ignore */ transcript)) as { Reply: unknown }
    const { WorkLinks } = (await import(/* @vite-ignore */ card)) as { WorkLinks: { Provider: unknown } }
    const reply = createElement(Reply as never, { text })
    const actions = { open: () => {}, item: () => undefined, titleOf: () => undefined }
    const inChat = renderToStaticMarkup(createElement(WorkLinks.Provider as never, { value: actions }, reply))
    expect(inChat).toContain('work-link-card')
    expect(inChat).not.toContain('@session:')
    const elsewhere = renderToStaticMarkup(reply)
    expect(elsewhere).not.toContain('work-link-card')
    expect(elsewhere).toContain('Open W19')
  })
})
