import { describe, expect, it } from 'vitest'
import { troubleshootingChecks } from '../src/renderer/src/state/troubleshooting'

describe('Troubleshoot Connection', () => {
  it('gives each computer its own certificate store step', () => {
    expect(troubleshootingChecks('tls', 'darwin')[0]).toMatch(/Keychain Access/)
    expect(troubleshootingChecks('tls', 'win32')[0]).toMatch(/Trusted Root Certification Authorities/)
  })

  it('never suggests weakening HTTPS or exposing the dashboard', () => {
    for (const topic of ['tls', 'cloudflare'] as const) {
      for (const check of troubleshootingChecks(topic, 'win32')) expect(check).not.toMatch(/disable|skip|ignore|public port|http:/i)
    }
  })
})
