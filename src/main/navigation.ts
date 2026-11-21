/**
 * The link policy every window shares: links open in the browser, never
 * inside the app, and a page Hermes drew stays in its frame.
 */
import { shell, type WebContents } from 'electron'
import { isPageUrl } from './pages'

const isMac = process.platform === 'darwin'

export function confineNavigation(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    // Web pages, and a Pulse card's mail, phone and message links; Maps and Calendar links on a Mac.
    if (/^(https?:\/\/|mailto:|tel:|sms:)/i.test(url) || (isMac && /^(maps:|calshow:|x-apple-reminderkit:)/i.test(url))) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A page Hermes drew stays in its frame: a link it follows opens in the browser.
  contents.on('will-frame-navigate', event => {
    if (event.isMainFrame || isPageUrl(event.url)) return
    event.preventDefault()
    if (/^https?:\/\//.test(event.url)) void shell.openExternal(event.url)
  })
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) {
      event.preventDefault()
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    }
  })
}
