import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { SPEECH_OUTPUTS, computerCanSpeak, setSpeechOutput, speechOutput, type SpeechOutput } from '../state/speechOutput'
import { stopReading } from '../state/readAloud'

const title = (output: SpeechOutput) => (output === 'computer' ? t('On this computer') : output === 'server' ? t('Your speech server') : t('Hermes’ speech providers'))

/** Settings > Voice > Read Aloud's voice, after the phone's (hermes-conduit#2876): this profile's, kept on this computer. */
export function ReadAloudVoiceSetting({ profile }: { profile?: string }) {
  const [output, setOutput] = useState<SpeechOutput>(() => speechOutput(profile))
  useEffect(() => setOutput(speechOutput(profile)), [profile])
  const choices = computerCanSpeak() ? SPEECH_OUTPUTS : SPEECH_OUTPUTS.filter(o => o !== 'computer')
  return (
    <>
      <label className="voice-mode-pick">
        <span className="meta">{t('Read Aloud voice')}</span>
        <select
          className="language-select"
          value={output}
          aria-label={t('Read Aloud voice')}
          onChange={e => {
            const next = e.target.value as SpeechOutput
            stopReading()
            setSpeechOutput(profile, next)
            setOutput(next)
          }}
        >
          {choices.map(choice => (
            <option key={choice} value={choice}>
              {title(choice)}
            </option>
          ))}
        </select>
      </label>
      <p className="meta settings-caption">
        {output === 'computer'
          ? t('Replies are read with your computer’s own voices, with nothing to set up on Hermes. Classic voice speaks with it too; the live modes use their own voices.')
          : output === 'server'
            ? t('Replies are read by your own speech server, the one Local Live talks to, set up under Local Live. A reply it can’t read is read with your computer’s voice. Classic voice speaks with it too; the live modes use their own voices.')
            : t('Replies are read with the voice this profile’s speech provider on Hermes gives. Classic voice speaks with it too; the live modes use their own voices.')}
      </p>
    </>
  )
}
