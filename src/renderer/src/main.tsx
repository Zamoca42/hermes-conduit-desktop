import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { QuickAsk } from './components/QuickAsk'
import { PictureViewerHost } from './components/Picture'
import './styles/theme.css'
import './styles/app.css'
import { setLanguage } from '@shared/i18n'
import { applyStoredAppearance } from './state/appearance'

setLanguage(window.conduit.language.resolved)
document.documentElement.lang = window.conduit.language.resolved
document.documentElement.dataset.platform = window.conduit.platform
applyStoredAppearance()
// The quick ask window follows an accent or text style picked in the main one.
window.addEventListener('storage', () => applyStoredAppearance())
const quick = window.location.hash === '#quick'
if (quick) document.documentElement.dataset.window = 'quick'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PictureViewerHost>{quick ? <QuickAsk /> : <App />}</PictureViewerHost>
  </StrictMode>
)
