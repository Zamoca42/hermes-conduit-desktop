import { useState } from 'react'
import { t } from '@shared/i18n'
import { MAX_STEPS_RANGE, setSummariesEnabled, setSummaryMaxSteps, summariesEnabled, summaryMaxSteps } from '../state/stepSummaries'

const LIMITS = Array.from({ length: (MAX_STEPS_RANGE[1] - MAX_STEPS_RANGE[0]) / 5 + 1 }, (_, i) => MAX_STEPS_RANGE[0] + i * 5)

/** Settings > Chat > Step summaries, after the phone's: kept on this computer and off by default, since each is one more model call. */
export function StepSummarySettings() {
  const [enabled, setEnabled] = useState(summariesEnabled)
  const [maxSteps, setMaxSteps] = useState(summaryMaxSteps)
  return (
    <section className="pset-section">
      <h2>{t('Step summaries')}</h2>
      <p className="meta">
        {t(
          'When a reply took several steps, Hermes looks back on them in a short paragraph: what it set out to do and why each step came next, shown under the folded steps.'
        )}
      </p>
      <p className="meta">{t("Each summary is one more short request to your model. It reuses the chat's prompt cache and never changes the chat.")}</p>
      <div className="pset-row">
        <span>{t('Describe finished steps')}</span>
        <label className="switch-inline">
          <input
            type="checkbox"
            checked={enabled}
            aria-label={t('Describe finished steps')}
            onChange={e => {
              setEnabled(e.target.checked)
              setSummariesEnabled(e.target.checked)
            }}
          />
        </label>
      </div>
      <div className="pset-row">
        <span>{t('Skip runs over {count} steps', { count: String(maxSteps) })}</span>
        <select
          className="language-select"
          value={maxSteps}
          disabled={!enabled}
          aria-label={t('Skip runs over {count} steps', { count: String(maxSteps) })}
          onChange={e => {
            const value = Number(e.target.value)
            setMaxSteps(value)
            setSummaryMaxSteps(value)
          }}
        >
          {LIMITS.map(limit => (
            <option key={limit} value={limit}>
              {limit}
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}
