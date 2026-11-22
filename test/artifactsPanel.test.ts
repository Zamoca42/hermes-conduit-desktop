// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settle } from './hookHarness'

const http = vi.fn()
vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { http: (...args: unknown[]) => http(...args) },
  GatewayError: class extends Error {}
}))

const FAR = 'https://far.example'
const row = (path: string, seconds: number, exists = true) => ({
  kind: 'image',
  source: 'written',
  session_id: 's1',
  session_title: 'Chat',
  message_id: seconds,
  timestamp: seconds,
  path,
  exists
})
let farPaths: string[] = []

beforeEach(() => {
  localStorage.clear()
  http.mockReset()
  farPaths = []
  ;(window as unknown as { conduit: unknown }).conduit = {
    keptHttp: async (_url: string, path: string) => {
      farPaths.push(path)
      if (path === '/api/profiles') return { ok: true, result: { profiles: [{ name: 'default' }] } }
      return { ok: true, result: { ok: true, items: [row('/far/old.png', 1_000)], next_before: null } }
    }
  }
})

describe('the Artifacts page across combined dashboards', () => {
  it("pages this host past a page with none of the chip's before another host's older rows, and hides gone files", async () => {
    // This host's newest page of a long history holds no images; its next one does.
    http.mockImplementation(async (_method: string, path: string) =>
      path.includes('before=30')
        ? { ok: true, items: [row('/here/new.png', 5_000)], next_before: null }
        : { ok: true, items: [], next_before: 30 }
    )
    const path = '../src/renderer/src/components/ArtifactsPanel.tsx'
    const { ArtifactsPanel } = (await import(/* @vite-ignore */ path)) as { ArtifactsPanel: unknown }
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(ArtifactsPanel as never, {
          page: true,
          sessionIds: [],
          kept: [{ url: FAR, state: 'live' }],
          dashboards: [
            { url: 'https://here.example', name: 'Here', badge: null },
            { url: FAR, name: 'Far', badge: null }
          ]
        } as never)
      )
    )
    await settle()
    // Gone files are left out by default, on both hosts.
    expect(http.mock.calls[0]![1]).toContain('missing=hide')
    expect(farPaths.some(p => p.includes('missing=hide'))).toBe(true)
    // The far host's old row waits: this host may hold newer ones.
    expect(host.textContent).not.toContain('old.png')
    const more = [...host.querySelectorAll('button')].find(b => b.textContent === 'Show More')!
    act(() => more.click())
    await settle()
    const names = [...host.querySelectorAll('.artifact-name')].map(n => n.textContent)
    expect(names).toEqual(['new.png', 'old.png'])
    act(() => root.unmount())
  })

  it('lists a file once when the other dashboard is the same Hermes at another address', async () => {
    http.mockImplementation(async () => ({ ok: true, items: [row('/here/new.png', 5_000), row('/far/old.png', 1_000)], next_before: null }))
    const path = '../src/renderer/src/components/ArtifactsPanel.tsx'
    const { ArtifactsPanel } = (await import(/* @vite-ignore */ path)) as { ArtifactsPanel: unknown }
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(ArtifactsPanel as never, {
          page: true,
          sessionIds: [],
          kept: [{ url: FAR, state: 'live' }],
          dashboards: [
            { url: 'https://here.example', name: 'Here', badge: null },
            { url: FAR, name: 'Far', badge: null }
          ]
        } as never)
      )
    )
    await settle()
    expect([...host.querySelectorAll('.artifact-name')].map(n => n.textContent)).toEqual(['new.png', 'old.png'])
    act(() => root.unmount())
  })
})
