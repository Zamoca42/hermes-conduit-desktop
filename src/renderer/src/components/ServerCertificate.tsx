import { useState } from 'react'
import type { CertificateCheck } from '@shared/ipc'
import { t } from '@shared/i18n'

/** What to ask Hermes, so the fingerprint can be checked before it's trusted. */
export const fingerprintPrompt = () =>
  t(
    "Please tell me the SHA-256 fingerprint of the TLS certificate my Hermes dashboard serves, and of the root certificate that issued it if there is one, so I can check it before I trust it on my computer. Only read the certificates; don't change them. Keep dashboard authentication enabled."
  )

/** The steps after saving, for this computer's certificate store. */
export function installSteps(platform: string): string[] {
  return platform === 'darwin'
    ? [
        t('Open the saved file, and Keychain Access adds it to your login keychain.'),
        t('In Keychain Access, open the certificate, expand Trust, and set When using this certificate to Always Trust.'),
        t('Come back here and connect again.')
      ]
    : [
        t('Open the saved file and choose Install Certificate.'),
        t('Place it in Trusted Root Certification Authorities, then finish the wizard.'),
        t('Come back here and connect again.')
      ]
}

/**
 * Install this server's certificate, after the phone's
 * ServerCertificateSection: reads the root the server sends, shows its
 * fingerprint to check against the server's, and saves it for the person to
 * trust on this computer. Conduit never trusts it on its own.
 */
export function ServerCertificate({ url }: { url: string }) {
  const [check, setCheck] = useState<CertificateCheck | 'checking' | null>(null)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <div className="server-certificate">
      <strong>{t('Install this server’s certificate')}</strong>
      <p className="hint">{t('If your dashboard uses its own certificate authority or a self-signed certificate, Conduit can save its root certificate for you to trust on this computer.')}</p>
      {check === null || (check !== 'checking' && !check.ok && check.reason === 'unreachable') ? (
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            setCheck('checking')
            setCheck(await window.conduit.checkCertificate(url))
          }}
        >
          {t('Check this server’s certificate')}
        </button>
      ) : check === 'checking' ? (
        <button type="button" className="secondary" disabled>
          {t('Checking the certificate…')}
        </button>
      ) : !check.ok ? (
        <p className="hint">
          {t('The server doesn’t send its certificate authority’s root, so Conduit can’t save it. Install the root certificate from wherever you made your certificates, then turn on full trust for it.')}
        </p>
      ) : (
        <>
          <div className="certificate-fingerprint">
            <span className="meta">{t('SHA-256 fingerprint')}</span>
            <code>{check.fingerprint}</code>
          </div>
          <p className="hint">{t('Only install it if this fingerprint matches the one your server reports for this certificate. Anyone between you and the server could present a different one.')}</p>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              window.conduit.copyText(fingerprintPrompt())
              setCopied(true)
            }}
          >
            {copied ? t('Copied') : t('Ask Hermes for the certificate’s fingerprint')}
          </button>
          <button type="button" className="secondary" onClick={async () => setSaved((await window.conduit.saveCertificate(url)) || saved)}>
            {t('Save the certificate')}
          </button>
          {saved ? (
            <ol className="certificate-steps">
              {installSteps(window.conduit.platform).map(step => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </div>
  )
}
