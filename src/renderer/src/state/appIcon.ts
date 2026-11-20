/**
 * Settings > Appearance > App icon, as on the phone: dark (the default) or
 * light. The main process shows it on the windows, the taskbar or Dock and the
 * tray; here, the title bar's mark and the picker follow it.
 */
import { useEffect, useState } from 'react'
import type { AppIconChoice } from '@shared/ipc'
import darkIcon from '../assets/app-icon.png'
import lightIcon from '../assets/app-icon-light.png'

export const APP_ICONS: readonly AppIconChoice[] = ['dark', 'light']

export const appIconUrl = (choice: AppIconChoice) => (choice === 'light' ? lightIcon : darkIcon)

const CHANGED = 'conduit-app-icon'
let current: AppIconChoice = window.conduit.appIcon === 'light' ? 'light' : 'dark'

function changed(choice: AppIconChoice) {
  current = choice
  window.dispatchEvent(new Event(CHANGED))
}

// Another window changed it.
window.conduit.onAppIcon(choice => changed(choice === 'light' ? 'light' : 'dark'))

export function chooseAppIcon(choice: AppIconChoice): void {
  window.conduit.setAppIcon(choice)
  changed(choice)
}

export function useAppIcon(): AppIconChoice {
  const [choice, setChoice] = useState(current)
  useEffect(() => {
    const update = () => setChoice(current)
    window.addEventListener(CHANGED, update)
    update()
    return () => window.removeEventListener(CHANGED, update)
  }, [])
  return choice
}
