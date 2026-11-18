/**
 * Runs in a chat, after the phone's ChatStepGroup and ChatReviewRun: a turn's
 * consecutive thinking and tool rows read as one card, folded to "4 steps ·
 * 12s" once the turn is done; consecutive self-improvement reviews read as
 * one line ("5 self-improvement reviews"), folded until opened (#1518).
 */
import type { ReviewItem, ThinkingItem, ToolItem, TranscriptItem } from './transcript'

export type StepItem = ThinkingItem | ToolItem
export type Row =
  | { type: 'item'; item: TranscriptItem }
  | { type: 'steps'; id: string; items: StepItem[]; trailing: boolean }
  | { type: 'reviews'; id: string; items: ReviewItem[] }

/** A thinking or tool row that joins a run: a clarify reads as its own question, and a board is part of the reply. */
export function isStep(item: TranscriptItem): item is StepItem {
  if (item.kind === 'thinking') return item.text.length > 0
  return item.kind === 'tool' && !item.board && item.name.toLowerCase() !== 'clarify'
}

/** The rows the transcript draws: runs of two or more steps or reviews as one row each. */
export function foldRuns(items: TranscriptItem[]): Row[] {
  const rows: Row[] = []
  let i = 0
  while (i < items.length) {
    const item = items[i]!
    if (isStep(item)) {
      let j = i
      while (j < items.length && isStep(items[j]!)) j++
      const run = items.slice(i, j) as StepItem[]
      if (run.length >= 2) rows.push({ type: 'steps', id: run[0]!.key, items: run, trailing: j === items.length })
      else rows.push({ type: 'item', item })
      i = j
    } else if (item.kind === 'review') {
      let j = i
      while (j < items.length && items[j]!.kind === 'review') j++
      const run = items.slice(i, j) as ReviewItem[]
      if (run.length >= 2) rows.push({ type: 'reviews', id: run[0]!.key, items: run })
      else rows.push({ type: 'item', item })
      i = j
    } else {
      rows.push({ type: 'item', item })
      i++
    }
  }
  return rows
}

/** From the first step's start to the last one's end, in seconds; null without usable times. */
export function span(steps: StepItem[]): number | null {
  let first: number | null = null
  let last: number | null = null
  for (const step of steps) {
    if (step.kind !== 'tool' || step.at == null) continue
    const end = step.at + (step.durationS ?? 0) * 1000
    first = first === null ? step.at : Math.min(first, step.at)
    last = last === null ? end : Math.max(last, end)
  }
  if (first !== null && last !== null) return (last - first) / 1000
  // No row times: the steps' own durations.
  const durations = steps.flatMap(s => (s.kind === 'tool' && s.durationS != null ? [s.durationS] : []))
  return durations.length ? durations.reduce((a, b) => a + b, 0) : null
}

/** "12s", "1m 5s"; null under a second, which reads as no time at all. */
export function spanText(seconds: number | null, locale?: string): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 1) return null
  const total = Math.round(seconds)
  const parts = { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 }
  const Format = (Intl as unknown as { DurationFormat?: new (locale?: string, options?: object) => { format(d: object): string } }).DurationFormat
  if (Format) {
    try {
      return new Format(locale, { style: 'narrow' }).format(Object.fromEntries(Object.entries(parts).filter(([, v]) => v > 0)))
    } catch {
      // The plain form below.
    }
  }
  return [parts.hours ? `${parts.hours}h` : '', parts.minutes ? `${parts.minutes}m` : '', parts.seconds ? `${parts.seconds}s` : ''].filter(Boolean).join(' ')
}
