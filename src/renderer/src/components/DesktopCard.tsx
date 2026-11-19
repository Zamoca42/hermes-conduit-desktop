import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import { pluginName, readRichUiCard, type CardContent } from '../state/desktopCards'

/**
 * A card made for Hermes Desktop, in its directive's place: the plugin's
 * name, hermes-rich-ui's own title and summary when Hermes has the card,
 * else that the chat opens there. A click shows the whole summary and the
 * line the agent wrote. One title line and two summary lines from the
 * first frame, so it never changes height as its text arrives.
 */
export function DesktopCard({ name, source, id }: { name: string; source: string; id: string }) {
  const [content, setContent] = useState<CardContent | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!id) return
    let live = true
    void readRichUiCard(id).then(answer => live && setContent(answer))
    return () => {
      live = false
    }
  }, [id])
  const plugin = pluginName(name)
  return (
    <span className="desktop-card-wrap">
      <button
        type="button"
        className="desktop-card"
        aria-expanded={open}
        title={t('Shows the card’s full summary and the line Hermes wrote.')}
        onClick={() => setOpen(o => !o)}
      >
        <span className="desktop-card-head">
          <span className="desktop-card-plugin">{plugin}</span>
          <span className="desktop-card-kind">{t('Full card in Hermes Desktop')}</span>
        </span>
        <span className="desktop-card-title">{content?.title || t('Card for Hermes Desktop')}</span>
        <span className="desktop-card-summary">{content?.summary || t('Open this chat in Hermes Desktop to see it.')}</span>
      </button>
      {open ? (
        <span className="desktop-card-details">
          {content?.summary ? <span className="desktop-card-full">{content.summary}</span> : null}
          <code>{source}</code>
        </span>
      ) : null}
    </span>
  )
}
