import type { TroubleshootingTopic } from '../../../shared/ipc'
import { t } from '../../../shared/i18n'

export const topicName = (topic: TroubleshootingTopic): string =>
  topic === 'network' ? t('Network & reachability') : topic === 'tls' ? t('HTTPS & certificates') : 'Cloudflare Access'

/** One way this computer can reach Hermes, with what it needs: the phone's setup assistant's access methods. */
export type ReachMethod = { title: string; detail: string; heading?: string; needs: string[]; numbered?: boolean; note?: string }

/**
 * Network & reachability: the phone's three ways to reach a self-hosted
 * dashboard (the same network, Tailscale, an HTTPS domain you already run),
 * each with its checklist. Never a public port, a firewall rule or a skipped
 * certificate check.
 */
export function reachMethods(): ReachMethod[] {
  return [
    {
      title: t('Same network as Hermes'),
      detail: t('Use this when Conduit and the Hermes machine are on the same home or local network.'),
      needs: [
        t('The Hermes dashboard is running.'),
        t('You can sign in to the Hermes dashboard.'),
        t('You know the Hermes machine’s local IP address.'),
        t('You know the dashboard port.'),
        t('This device is on the same reachable network.')
      ]
    },
    {
      title: t('Reach Hermes with Tailscale'),
      detail: t('Use Tailscale when you want to reach Hermes securely while away from home.'),
      numbered: true,
      needs: [
        t('Tailscale is installed on the Hermes machine.'),
        t('Tailscale is installed on this computer.'),
        t('Both are signed in to the same tailnet.'),
        t('The Hermes dashboard is running.'),
        t('Hermes configures Tailscale Serve for the dashboard.'),
        t('Hermes tells you the address to enter into Conduit.')
      ],
      note: t('Conduit never installs or configures Tailscale, and it doesn’t assume an address or port — Hermes tells you what to use.')
    },
    {
      title: t('Use your existing HTTPS domain'),
      detail: t('Use this if you already access Hermes through an HTTPS hostname you manage.'),
      heading: t('You will need:'),
      needs: [
        t('Your existing HTTPS Hermes dashboard URL — for example https://hermes.example.com, https://hermes.example.com:9443, or https://example.com/hermes.'),
        t('Any custom port.'),
        t('Any path prefix your proxy uses.'),
        t('A way to sign in to the dashboard.')
      ],
      note: t('Conduit will not ask you to expose a raw public port, create firewall rules, or bypass certificate checks.')
    }
  ]
}

/** The quick checks for a topic, after the phone's: never exposing the dashboard or weakening HTTPS. */
export function troubleshootingChecks(topic: TroubleshootingTopic, platform: string): string[] {
  if (topic === 'network') return []
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
