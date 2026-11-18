/**
 * Starter faces, as the phone draws them (StarterFaces.swift): a bot with no
 * picture shows one of twelve small robot faces, each with its own color. The
 * face is `ui_meta['hermes-bots'].face` when the phone wrote one; else the
 * first face no other bot has, in the order the bots were made (the main bot
 * first), so every screen shows the same faces.
 */

export interface StarterFace {
  hue: number
  saturation: number
  antenna: 'none' | 'pair' | 'ball' | 'nub'
  bolts: boolean
  head: 'square' | 'round' | 'wide'
  eyes: 'dots' | 'pills' | 'wideDots' | 'bigDots'
}

const f = (hue: number, saturation: number, antenna: StarterFace['antenna'], bolts: boolean, head: StarterFace['head'], eyes: StarterFace['eyes']): StarterFace => ({
  hue,
  saturation,
  antenna,
  bolts,
  head,
  eyes
})

export const STARTER_FACES: readonly StarterFace[] = [
  f(262, 0.62, 'pair', true, 'square', 'dots'),
  f(205, 0.58, 'none', false, 'square', 'dots'),
  f(12, 0.7, 'ball', true, 'wide', 'pills'),
  f(158, 0.52, 'none', true, 'round', 'dots'),
  f(40, 0.78, 'nub', false, 'square', 'wideDots'),
  f(318, 0.58, 'pair', false, 'round', 'bigDots'),
  f(225, 0.6, 'none', true, 'wide', 'dots'),
  f(180, 0.55, 'ball', false, 'square', 'pills'),
  f(350, 0.72, 'none', false, 'round', 'wideDots'),
  f(95, 0.48, 'pair', true, 'square', 'bigDots'),
  f(290, 0.58, 'nub', true, 'wide', 'dots'),
  f(215, 0.18, 'ball', false, 'round', 'dots')
]

/** Face `index`; past the twelve the parts keep varying and the hue steps by the golden angle. */
export function starterFace(index: number): StarterFace {
  const i = Math.max(0, Math.floor(index))
  if (i < STARTER_FACES.length) return STARTER_FACES[i]!
  const antennas: StarterFace['antenna'][] = ['none', 'pair', 'ball', 'nub']
  const heads: StarterFace['head'][] = ['square', 'round', 'wide']
  const eyes: StarterFace['eyes'][] = ['dots', 'pills', 'wideDots', 'bigDots']
  return {
    hue: (262 + i * 137.508) % 360,
    saturation: 0.6,
    antenna: antennas[i % 4]!,
    bolts: i % 2 === 1,
    head: heads[Math.floor(i / 2) % 3]!,
    eyes: eyes[Math.floor(i / 3) % 4]!
  }
}

const hsl = (hue: number, saturation: number, lightness: number) =>
  `hsl(${Math.round(hue * 10) / 10} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%)`

/** The face's own color, behind the head (a near-gray face a little darker). */
export function faceColor(face: StarterFace): string {
  return hsl(face.hue, face.saturation, face.saturation < 0.3 ? 0.5 : 0.58)
}
export const faceHeadColor = (face: StarterFace) => hsl(face.hue, 0.35, 0.94)
export const faceInkColor = (face: StarterFace) => hsl(face.hue, 0.4, 0.16)

export interface FaceCandidate {
  name: string
  isDefault: boolean
  storedFace?: number
  created?: number
}

/** Each bot's face number: the one it holds, then the first free one for the rest, in the order they were made. */
export function assignFaces(bots: readonly FaceCandidate[]): Map<string, number> {
  const faces = new Map<string, number>()
  const taken = new Set<number>()
  for (const bot of bots) {
    if (bot.storedFace !== undefined) {
      faces.set(bot.name, bot.storedFace)
      taken.add(bot.storedFace)
    }
  }
  const rest = bots.filter(b => !faces.has(b.name)).sort(madeEarlier)
  let next = 0
  for (const bot of rest) {
    while (taken.has(next)) next++
    faces.set(bot.name, next)
    taken.add(next)
  }
  return faces
}

function madeEarlier(a: FaceCandidate, b: FaceCandidate): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
  if (a.created !== undefined && b.created !== undefined && a.created !== b.created) return a.created - b.created
  if (a.created !== undefined && b.created === undefined) return -1
  if (a.created === undefined && b.created !== undefined) return 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}
