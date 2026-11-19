import { useState } from 'react'
import { t } from '@shared/i18n'
import { setTakesOverAutomatically, takesOverAutomatically } from '../state/chatTakeover'

/** Settings > Chat > Chats open on your computer, after the phone's: kept on this computer, on until turned off (#1061). */
export function TakeoverSettings() {
  const [automatic, setAutomatic] = useState(takesOverAutomatically)
  return (
    <section className="pset-section">
      <h2>{t('Chats open on your computer')}</h2>
      <p className="meta">
        {t(
          'Hermes lets one app use a chat at a time. When a chat is open in Hermes Desktop or a terminal, Conduit takes it over when you send. Calls always take it over; turn this off to be asked first when you type.'
        )}
      </p>
      <p className="meta">
        {t('A reply running there always finishes first. If you go back to that app, reopen the chat there to see what you sent from Conduit.')}
      </p>
      <div className="pset-row">
        <span>{t('Take over automatically')}</span>
        <label className="switch-inline">
          <input
            type="checkbox"
            checked={automatic}
            aria-label={t('Take over automatically')}
            onChange={e => {
              setAutomatic(e.target.checked)
              setTakesOverAutomatically(e.target.checked)
            }}
          />
        </label>
      </div>
    </section>
  )
}
