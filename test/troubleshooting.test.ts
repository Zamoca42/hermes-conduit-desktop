import { describe, expect, it } from 'vitest'
import { reachMethods, troubleshootingChecks } from '../src/renderer/src/state/troubleshooting'

describe('Troubleshoot Connection', () => {
  it('gives each computer its own certificate store step', () => {
    expect(troubleshootingChecks('tls', 'darwin')[0]).toMatch(/Keychain Access/)
    expect(troubleshootingChecks('tls', 'win32')[0]).toMatch(/Trusted Root Certification Authorities/)
  })

  it('never suggests weakening HTTPS or exposing the dashboard', () => {
    for (const topic of ['tls', 'cloudflare'] as const) {
      for (const check of troubleshootingChecks(topic, 'win32')) expect(check).not.toMatch(/disable|skip|ignore|public port|http:/i)
    }
    for (const method of reachMethods()) for (const need of method.needs) expect(need).not.toMatch(/disable|skip|ignore|public port|http:/i)
  })

  it('lists the phone’s three ways to reach Hermes, written for this computer', () => {
    const methods = reachMethods()
    expect(methods.map(method => method.title)).toEqual(['Same network as Hermes', 'Reach Hermes with Tailscale', 'Use your existing HTTPS domain'])
    expect(methods[1].numbered).toBe(true)
    expect(methods[1].needs).toContain('Tailscale is installed on this computer.')
    expect(methods.flatMap(method => method.needs).join(' ')).not.toMatch(/iPhone|iPad/)
  })
})
