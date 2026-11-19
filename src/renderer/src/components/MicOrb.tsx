import { useEffect, useRef } from 'react'
import { micScale } from '../state/call'

/**
 * A call's orb, which grows with the microphone's level while the call
 * listens, so you can see it hears you. Its own analyser, read each frame
 * straight onto the orb's style.
 */
export function MicOrb({ stream, active }: { stream: MediaStream | null; active: boolean }) {
  const orb = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const element = orb.current
    if (!element) return
    if (!stream || !active || !stream.getAudioTracks().some(track => track.readyState === 'live')) {
      element.style.transform = ''
      return
    }
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    const source = context.createMediaStreamSource(stream)
    source.connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    let level = 0
    let frame = 0
    const meter = () => {
      analyser.getByteTimeDomainData(samples)
      let peak = 0
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128)
      level = Math.max(peak, level * 0.85)
      element.style.transform = `scale(${micScale(level)})`
      frame = requestAnimationFrame(meter)
    }
    frame = requestAnimationFrame(meter)
    return () => {
      cancelAnimationFrame(frame)
      source.disconnect()
      void context.close().catch(() => undefined)
      element.style.transform = ''
    }
  }, [stream, active])
  return <span ref={orb} className="voice-call-orb" />
}
