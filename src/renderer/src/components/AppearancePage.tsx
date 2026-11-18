import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { ThemeChoice } from '@shared/ipc'
import {
  ACCENTS,
  CHAT_FONTS,
  accentTitle,
  applyAccent,
  applyChatFont,
  chatFontTitle,
  fontFamily,
  readAccent,
  readChatFont,
  swatchColor,
  markColor,
  type AccentChoice,
  type ChatFontStyle
} from '../state/appearance'
import { Icon } from './icons'

const THEMES: ThemeChoice[] = ['dark', 'light', 'system']
const themeTitle = (theme: ThemeChoice) => (theme === 'dark' ? t('Dark') : theme === 'light' ? t('Light') : t('System'))

function useDark(): boolean {
  const query = () => window.matchMedia('(prefers-color-scheme: dark)')
  const [dark, setDark] = useState(() => query().matches)
  useEffect(() => {
    const media = query()
    const changed = () => setDark(media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  return dark
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]

/** Settings > Appearance, after the phone's: theme, accent color and chat text style, all kept on this computer. */
export function AppearancePage({ onBack }: { onBack: () => void }) {
  const [theme, setTheme] = useState<ThemeChoice>(window.conduit.theme)
  const [accent, setAccent] = useState<AccentChoice>(readAccent)
  const [font, setFont] = useState<ChatFontStyle>(readChatFont)
  const dark = useDark()

  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{t('Appearance')}</h1>
      </div>

      <section className="pset-section">
        <h2>{t('Theme')}</h2>
        <p className="meta">{t('Choose how Conduit appears across this device.')}</p>
        <div className="segmented" role="group" aria-label={t('Theme')}>
          {THEMES.map(choice => (
            <button
              key={choice}
              aria-pressed={theme === choice}
              onClick={() => {
                setTheme(choice)
                window.conduit.setTheme(choice)
              }}
            >
              {themeTitle(choice)}
            </button>
          ))}
        </div>
      </section>

      <section className="pset-section">
        <h2>{t('Accent color')}</h2>
        <p className="meta">{t('Choose the color of your own messages and Conduit’s highlights.')}</p>
        <div className="accent-swatches" role="radiogroup" aria-label={t('Accent color')}>
          {ACCENTS.map(choice => {
            const fill = swatchColor(choice, dark)
            const selected = accent === choice
            return (
              <button
                key={choice}
                role="radio"
                aria-checked={selected}
                aria-label={accentTitle(choice)}
                title={accentTitle(choice)}
                className={selected ? 'accent-swatch on' : 'accent-swatch'}
                style={{ background: fill, color: markColor(rgb(fill)) }}
                onClick={() => {
                  setAccent(choice)
                  applyAccent(choice)
                }}
              >
                {selected ? <Icon name="check" /> : null}
              </button>
            )
          })}
        </div>
      </section>

      <section className="pset-section">
        <h2>{t('Chat text style')}</h2>
        <p className="meta">{t('The typeface of messages in a chat. Code stays monospaced, and the rest of the interface keeps the system font.')}</p>
        <div className="segmented" role="group" aria-label={t('Chat text style')}>
          {CHAT_FONTS.map(style => (
            <button
              key={style}
              aria-pressed={font === style}
              onClick={() => {
                setFont(style)
                applyChatFont(style)
              }}
            >
              {chatFontTitle(style)}
            </button>
          ))}
        </div>
        <p className="chat-font-preview" style={{ fontFamily: fontFamily(font) ?? undefined }}>
          {t('Hermes replies like this.')}
        </p>
      </section>
    </div>
  )
}
