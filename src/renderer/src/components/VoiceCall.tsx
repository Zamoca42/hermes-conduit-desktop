import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import { useRecorder } from '../state/useRecorder'
import { stopReading } from '../state/readAloud'
import { blobToBase64, speak, spokenText, transcribe } from '../state/voice'
import { callStep, micScale, type CallPhase } from '../state/call'
import { Icon } from './icons'

interface Props {
  profile?: string
  /** Sends what was said as the chat's next message. */
  onSay: (text: string) => void
  /** A reply is running in the chat. */
  running: boolean
  /** Counts the chat's finished turns: the next one after a send is the answer to speak. */
  turnsDone: number
  /** The chat's newest reply, spoken when its turn ends. */
  lastReply: string | null
  /** Stops the running reply. */
  onStop: () => void
  onEnd: () => void
  /** The mode menu under the call's status, which moves the call to another mode. */
  modeMenu?: ReactNode
}

/**
 * A Classic voice call in the open chat, as the phone's Classic mode: it
 * listens until you stop talking, sends what Hermes heard as your message,
 * and speaks the reply with Hermes' voice, then listens again. Every turn is
 * the chat's own, typed or spoken.
 */
export function VoiceCall({ profile, onSay, running, turnsDone, lastReply, onStop, onEnd, modeMenu }: Props) {
  const recorder = useRecorder()
  const [phase, setPhase] = useState<CallPhase>('starting')
  const [muted, setMuted] = useState(false)
  const mutedNow = useRef(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [heard, setHeard] = useState('')
  // A sent turn that never started (Hermes dropped it): after a while, Listen goes on without it.
  const [stalled, setStalled] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const ended = useRef(false)
  const waitingFrom = useRef<number | null>(null)
  const voice = useRef({ heard: false, loudAt: 0, quietSince: 0 })

  const listen = async () => {
    if (ended.current) return
    voice.current = { heard: false, loudAt: 0, quietSince: performance.now() }
    setPhase('listening')
    if (!(await recorder.start())) setPhase('failed')
  }

  // Start listening, and let go of everything on hang-up.
  useEffect(() => {
    stopReading()
    // Classic can't start while a reply runs: it waits for the reply, then listens.
    if (running) {
      waitingFrom.current = turnsDone
      setPhase('thinking')
    } else void listen()
    return () => {
      ended.current = true
      recorder.cancel()
      audio.current?.pause()
    }
  }, [])

  useEffect(() => {
    if (recorder.error === 'denied')
      setProblem(t("Conduit can't use the microphone. Allow it for Conduit in your computer's privacy settings, then try again."))
    else if (recorder.error === 'missing') setProblem(t('No microphone found.'))
    else if (recorder.error) setProblem(recorder.error)
  }, [recorder.error])

  // While listening: the end of what was said is a pause after speech.
  useEffect(() => {
    if (phase !== 'listening' || !recorder.recording) return
    const now = performance.now()
    const step = callStep(voice.current, recorder.level, now, recorder.elapsed)
    voice.current = step.state
    if (step.done) void finishTurn()
  }, [recorder.level, recorder.elapsed, phase, recorder.recording])

  async function finishTurn() {
    setPhase('hearing')
    const recording = await recorder.stop()
    if (ended.current) return
    if (!recording) return void listen()
    try {
      const words = await transcribe(await blobToBase64(recording.blob), recording.mime, profile)
      if (ended.current) return
      // Quiet audio, or Hermes heard nothing: listen again.
      if (!words) return void listen()
      setHeard(words)
      setProblem(null)
      waitingFrom.current = turnsDone
      setPhase('thinking')
      onSay(words)
    } catch (e) {
      if (ended.current) return
      setProblem(t("Hermes couldn't transcribe that: {error}", { error: e instanceof Error ? e.message : String(e) }))
      setPhase('failed')
    }
  }

  // The reply's turn ended: speak it, then listen.
  useEffect(() => {
    if (phase !== 'thinking' || waitingFrom.current === null || turnsDone === waitingFrom.current || running) return
    waitingFrom.current = null
    const words = spokenText(lastReply ?? '')
    if (!words) return void listen()
    setPhase('speaking')
    speak(words, profile)
      .then(url => {
        if (ended.current) return
        const player = new Audio(url)
        audio.current = player
        player.onended = () => {
          audio.current = null
          if (!ended.current && !mutedNow.current) void listen()
          else if (!ended.current) setPhase('muted')
        }
        return player.play()
      })
      .catch(e => {
        if (ended.current) return
        setProblem(t("Hermes couldn't read this aloud: {error}", { error: e instanceof Error ? e.message : String(e) }))
        if (!mutedNow.current) void listen()
        else setPhase('muted')
      })
  }, [turnsDone, running, phase])

  useEffect(() => {
    setStalled(false)
    if (phase !== 'thinking' || running) return
    const timer = window.setTimeout(() => setStalled(true), 8000)
    return () => window.clearTimeout(timer)
  }, [phase, running])

  const interrupt = () => {
    if (phase === 'speaking') {
      audio.current?.pause()
      audio.current = null
      if (mutedNow.current) setPhase('muted')
      else void listen()
    } else if (phase === 'thinking') {
      onStop()
    }
  }

  const toggleMute = () => {
    if (muted) {
      setMuted(false)
      mutedNow.current = false
      if (phase === 'muted') void listen()
      return
    }
    setMuted(true)
    mutedNow.current = true
    if (phase === 'listening') {
      recorder.cancel()
      setPhase('muted')
    }
  }

  const status =
    phase === 'starting'
      ? t('Connecting…')
      : phase === 'listening'
        ? t('Listening')
        : phase === 'hearing' || phase === 'thinking'
          ? t('Thinking')
          : phase === 'speaking'
            ? t('Speaking')
            : phase === 'muted'
              ? t('Muted')
              : t('Interrupted')

  return (
    <div className={`voice-call phase-${phase}`} role="region" aria-label={t('Voice call')}>
      <div className="voice-call-status">
        <span className="voice-call-orb" style={phase === 'listening' ? { transform: `scale(${micScale(recorder.level)})` } : undefined} />
        <div className="voice-call-words">
          <strong>{status}</strong>
          {problem ? (
            <span className="voice-call-problem">{problem}</span>
          ) : heard ? (
            <span className="meta">{heard}</span>
          ) : modeMenu ? null : (
            <span className="meta">{t('Classic voice')}</span>
          )}
          {modeMenu}
        </div>
      </div>
      <div className="voice-call-buttons">
        {phase === 'failed' ? (
          <button className="secondary" onClick={() => void listen()}>
            {t('Try again')}
          </button>
        ) : phase === 'thinking' && !running && stalled ? (
          <button className="secondary" onClick={() => void listen()}>
            {t('Listen')}
          </button>
        ) : null}
        {phase === 'speaking' || (phase === 'thinking' && running) ? (
          <button className="secondary" onClick={interrupt}>
            {t('Interrupt')}
          </button>
        ) : null}
        <button
          className={`voice-call-round${muted ? ' on' : ''}`}
          aria-label={muted ? t('Unmute microphone') : t('Mute microphone')}
          title={muted ? t('Unmute microphone') : t('Mute microphone')}
          onClick={toggleMute}
        >
          <Icon name={muted ? 'micOff' : 'mic'} />
        </button>
        <button className="voice-call-round end" aria-label={t('End call')} title={t('End call')} onClick={onEnd}>
          <Icon name="phoneDown" />
        </button>
      </div>
    </div>
  )
}
