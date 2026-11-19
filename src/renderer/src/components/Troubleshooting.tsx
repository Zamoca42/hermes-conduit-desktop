import type { TroubleshootingTopic } from '@shared/ipc'
import { t } from '@shared/i18n'
import { ServerCertificate } from './ServerCertificate'
import { topicName, troubleshootingChecks } from '../state/troubleshooting'

/**
 * The phone's troubleshooting page for a sign-in failure: HTTPS &
 * certificates (with Install this server's certificate when the server's
 * certificate isn't trusted) or Cloudflare Access.
 */
export function Troubleshooting({
  topic,
  onTopic,
  untrusted,
  onBack
}: {
  topic: TroubleshootingTopic
  onTopic: (topic: TroubleshootingTopic) => void
  /** The address whose certificate this computer doesn't trust, if that was the failure. */
  untrusted: string | null
  onBack: () => void
}) {
  return (
    <div className="signin-card troubleshooting">
      <div className="segmented" role="group" aria-label={t('Troubleshoot Connection')}>
        {(['tls', 'cloudflare'] as const).map(each => (
          <button key={each} type="button" aria-pressed={each === topic} onClick={() => onTopic(each)}>
            {topicName(each)}
          </button>
        ))}
      </div>
      <h1>{topicName(topic)}</h1>
      <p>
        {topic === 'tls'
          ? t('Checks for HTTPS and certificate problems when connecting to your dashboard.')
          : t('Checks for Cloudflare Access service-token problems when connecting to your dashboard.')}
      </p>
      <ul className="troubleshooting-checks">
        {troubleshootingChecks(topic, window.conduit.platform).map(check => (
          <li key={check}>{check}</li>
        ))}
      </ul>
      {topic === 'tls' && untrusted ? <ServerCertificate url={untrusted} /> : null}
      <button className="link-button" type="button" onClick={onBack}>
        {t('Back')}
      </button>
    </div>
  )
}
