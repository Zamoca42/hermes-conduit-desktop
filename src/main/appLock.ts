/**
 * The computer's own lock for the saved sign-ins, after the phone's Face ID
 * for saved dashboards: when it's on, Conduit opens its saved hosts only
 * after Touch ID (Mac) or Windows Hello, once per launch, for every host.
 * The secrets stay encrypted by the system keychain either way; this keeps
 * them from being used until whoever is at the computer proves it's them.
 */
import { execFile } from 'node:child_process'
import { systemPreferences } from 'electron'
import type { AppLockKind } from '../shared/ipc'

// Windows Hello through WinRT's UserConsentVerifier, from the PowerShell every Windows has.
const HELLO = (call: string) => `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
function Await($operation, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation)); $null = $task.Wait(-1); $task.Result }
${call}`

const CHECK = HELLO(
  `Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])`
)
const VERIFY = HELLO(
  `Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($env:CONDUIT_HELLO_REASON)) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])`
)

function powershell(script: string, env: Record<string, string> = {}, timeout = 120_000): Promise<string> {
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ...env }, timeout, windowsHide: true },
      (error, stdout) => resolve(error ? '' : String(stdout).trim())
    )
  })
}

let checked: Promise<AppLockKind | null> | null = null

/** The lock this computer offers, if any: checked once per launch. */
export function lockKind(): Promise<AppLockKind | null> {
  checked ??= (async () => {
    if (process.platform === 'darwin') return systemPreferences.canPromptTouchID() ? 'touch-id' : null
    if (process.platform === 'win32') return (await powershell(CHECK, {}, 15_000)) === 'Available' ? 'windows-hello' : null
    return null
  })()
  return checked
}

/** Asks for Touch ID or Windows Hello; true once the person proved it's them. */
export async function promptUnlock(reason: string): Promise<boolean> {
  const kind = await lockKind()
  if (kind === 'touch-id') {
    try {
      await systemPreferences.promptTouchID(reason)
      return true
    } catch {
      return false
    }
  }
  if (kind === 'windows-hello') return (await powershell(VERIFY, { CONDUIT_HELLO_REASON: reason })) === 'Verified'
  return false
}
