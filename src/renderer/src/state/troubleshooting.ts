import type { TroubleshootingTopic } from '../../../shared/ipc'
import { t } from '../../../shared/i18n'

export const topicName = (topic: TroubleshootingTopic): string => (topic === 'tls' ? t('HTTPS & certificates') : 'Cloudflare Access')

/** The quick checks for a topic, after the phone's: never exposing the dashboard or weakening HTTPS. */
export function troubleshootingChecks(topic: TroubleshootingTopic, platform: string): string[] {
  if (topic === 'cloudflare') {
    return [
      t('Verify the Client ID and Secret belong to a Cloudflare Access service token for this application.'),
      t('Make sure a Service Auth policy allows that token to reach this Access application.')
    ]
  }
  return [
    platform === 'darwin'
      ? t('If you use your own certificate authority, add its root certificate to Keychain Access, then set it to Always Trust.')
      : t('If you use your own certificate authority, install its root certificate in Trusted Root Certification Authorities.'),
    t('Each computer and phone keeps its own trust: trust the certificate on every device you connect from, even if another one already works.'),
    t('The certificate must name the exact address you entered, as a host name or IP address in its Subject Alternative Name.'),
    t('Check the server certificate’s expiration and validity dates.'),
    t('Confirm this device’s date and time are correct.')
  ]
}
