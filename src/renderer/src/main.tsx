import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { QuickAsk } from './components/QuickAsk'
import './styles/theme.css'
import './styles/app.css'

document.documentElement.dataset.platform = window.conduit.platform
const quick = window.location.hash === '#quick'
if (quick) document.documentElement.dataset.window = 'quick'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {quick ? <QuickAsk /> : <App />}
  </StrictMode>
)
