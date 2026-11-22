import { useEffect, useRef, useState } from 'react'
import { language, t } from '@shared/i18n'
import {
  SPEECH_OUTPUTS,
  chooseVoice,
  computerCanSpeak,
  computerVoicePick,
  setComputerVoicePick,
  setSpeechOutput,
  speakOnComputer,
  speechOutput,
  voicesFor,
  type SpeechOutput
} from '../state/speechOutput'
import { stopReading } from '../state/readAloud'
import { HermesSpeechSettings } from './HermesSpeechSettings'
import { Select } from './Select'

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
        <Select
          className="language-select"
          value={output}
          aria-label={t('Read Aloud voice')}
          onChange={picked => {
            const next = picked as SpeechOutput
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
        </Select>
      </label>
      <p className="meta settings-caption">
        {output === 'computer'
          ? t('Replies are read with your computer’s own voices, with nothing to set up on Hermes. Classic voice speaks with it too; the live modes use their own voices.')
          : output === 'server'
            ? t('Replies are read by your own speech server, the one Local Live talks to, set up under Local Live. A reply it can’t read is read with your computer’s voice. Classic voice speaks with it too; the live modes use their own voices.')
            : t('Replies are read with the voice this profile’s speech provider on Hermes gives. Classic voice speaks with it too; the live modes use their own voices.')}
      </p>
      {output === 'computer' ? <ComputerVoicePick /> : output === 'hermes' ? <HermesSpeechSettings key={profile ?? ''} kind="tts" profile={profile} /> : null}
    </>
  )
}

/**
 * The voice this computer speaks the app's language with: automatic (the
 * system's default for it) or one of its installed voices, with a preview.
 * Kept per language on this computer, as the phone's iPhone voice pick.
 */
function ComputerVoicePick() {
  const lang = language()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => window.speechSynthesis.getVoices())
  const [pick, setPick] = useState(() => computerVoicePick(lang))
  const [playing, setPlaying] = useState(false)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => {
    // The system lists its voices late, and again when one is installed.
    const changed = () => setVoices(window.speechSynthesis.getVoices())
    window.speechSynthesis.addEventListener('voiceschanged', changed)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', changed)
      stop.current?.()
    }
  }, [])
  useEffect(() => setPick(computerVoicePick(lang)), [lang])
  const listed = voicesFor(voices, lang)
  const automatic = chooseVoice(voices, lang, '')
  // A picked voice that's gone (uninstalled) shows as automatic.
  const shown = listed.some(v => v.voiceURI === pick) ? pick : ''
  const preview = () => {
    if (playing) {
      stop.current?.()
      return
    }
    stopReading()
    const spoken = speakOnComputer(t('Hi, this is how I sound when I read your replies.'), shown || undefined)
    stop.current = spoken.stop
    setPlaying(true)
    void spoken.done.catch(() => undefined).finally(() => {
      stop.current = null
      setPlaying(false)
    })
  }
  return (
    <>
      <label className="voice-mode-pick">
        <span className="meta">{t('Voice')}</span>
        <Select
          className="language-select"
          value={shown}
          aria-label={t('Voice')}
          onChange={picked => {
            stop.current?.()
            setComputerVoicePick(lang, picked)
            setPick(picked)
          }}
        >
          <option value="">{automatic ? t('Automatic ({voice})', { voice: automatic.name }) : t('Automatic')}</option>
          {listed.map(v => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {listed.some(o => o !== v && o.name === v.name) ? `${v.name} (${v.lang})` : v.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="local-live-buttons">
        <button className="secondary" disabled={!voices.length} onClick={preview}>
          {playing ? t('Stop') : t('Preview')}
        </button>
      </div>
      <p className="meta settings-caption">
        {listed.length
          ? t('The voices this computer shares with apps for the app’s language. To add better ones: on a Mac, System Settings › Accessibility › Spoken Content › System voice › Manage Voices; on Windows, Settings › Time & language › Speech, then restart Conduit.')
          : t('This computer shares no voice for the app’s language, so the system’s default speaks. Add one: on a Mac, System Settings › Accessibility › Spoken Content › System voice › Manage Voices; on Windows, Settings › Time & language › Speech, then restart Conduit.')}
      </p>
    </>
  )
}
