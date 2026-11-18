import { faceColor, faceHeadColor, faceInkColor, type StarterFace } from '../state/starterFaces'

/** A starter face in a 100-unit square, as the phone draws it; the caller clips it to a circle. */
export function StarterFaceArt({ face, background }: { face: StarterFace; background?: string }) {
  const head = faceHeadColor(face)
  const ink = faceInkColor(face)
  const width = face.head === 'wide' ? 54 : 46
  const height = 40
  const x = 50 - width / 2
  const y = 34
  const eyeY = y + height / 2 + 1
  const gap = face.eyes === 'wideDots' ? 11 : 8.5
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      <rect width="100" height="100" fill={background ?? faceColor(face)} />
      {face.antenna === 'pair' ? (
        <g stroke={head} strokeWidth={3.4} strokeLinecap="round">
          <line x1={43} y1={y + 1} x2={38} y2={y - 10} />
          <line x1={57} y1={y + 1} x2={62} y2={y - 10} />
        </g>
      ) : face.antenna === 'ball' ? (
        <>
          <line x1={50} y1={y} x2={50} y2={y - 9} stroke={head} strokeWidth={3.2} strokeLinecap="round" />
          <circle cx={50} cy={y - 12} r={4} fill={head} />
        </>
      ) : face.antenna === 'nub' ? (
        <rect x={46} y={y - 6} width={8} height={8} rx={2.5} fill={head} />
      ) : null}
      {face.bolts ? (
        <>
          <rect x={x - 5} y={y + 12} width={8} height={16} rx={3.5} fill={ink} />
          <rect x={x + width - 3} y={y + 12} width={8} height={16} rx={3.5} fill={ink} />
        </>
      ) : null}
      <rect x={x} y={y} width={width} height={height} rx={face.head === 'round' ? 18 : 13} fill={head} />
      {face.eyes === 'pills' ? (
        <>
          <rect x={50 - gap - 3.6} y={eyeY - 6} width={7.2} height={12} rx={3.6} fill={ink} />
          <rect x={50 + gap - 3.6} y={eyeY - 6} width={7.2} height={12} rx={3.6} fill={ink} />
        </>
      ) : face.eyes === 'bigDots' ? (
        <>
          <circle cx={50 - gap - 0.5} cy={eyeY} r={6} fill={ink} />
          <circle cx={50 + gap + 0.5} cy={eyeY} r={6} fill={ink} />
          <circle cx={50 - gap + 1.5} cy={eyeY - 2} r={1.7} fill="#fff" />
          <circle cx={50 + gap + 2.5} cy={eyeY - 2} r={1.7} fill="#fff" />
        </>
      ) : (
        <>
          <circle cx={50 - gap} cy={eyeY} r={4.6} fill={ink} />
          <circle cx={50 + gap} cy={eyeY} r={4.6} fill={ink} />
        </>
      )}
    </svg>
  )
}
