import { describe, expect, it } from 'vitest'
import { foldRuns, span, spanText } from '../src/renderer/src/state/runs'
import type { TranscriptItem } from '../src/renderer/src/state/transcript'

const tool = (key: string, at?: number, durationS?: number, name = 'terminal'): TranscriptItem => ({ kind: 'tool', key, toolId: key, name, status: 'done', at, durationS })
const thought = (key: string): TranscriptItem => ({ kind: 'thinking', key, text: 'hmm', streaming: false })
const reply = (key: string): TranscriptItem => ({ kind: 'assistant', key, text: 'ok', streaming: false }) as TranscriptItem
const review = (key: string): TranscriptItem => ({ kind: 'review', key, summary: 's', details: [] })

describe('foldRuns', () => {
  it('folds two or more steps into one run and leaves a single step alone', () => {
    const rows = foldRuns([thought('t1'), tool('a'), tool('b'), reply('r'), tool('c'), reply('r2')])
    expect(rows.map(r => r.type)).toEqual(['steps', 'item', 'item', 'item'])
    expect(rows[0]).toMatchObject({ id: 't1', trailing: false })
  })
  it('keeps a clarify and a board out of a run', () => {
    const board = { ...tool('b'), board: { cards: [], next: [] } } as unknown as TranscriptItem
    expect(foldRuns([tool('a'), tool('q', undefined, undefined, 'clarify'), tool('c')]).map(r => r.type)).toEqual(['item', 'item', 'item'])
    expect(foldRuns([tool('a'), board]).map(r => r.type)).toEqual(['item', 'item'])
  })
  it('marks a run at the end as trailing', () => {
    const rows = foldRuns([reply('r'), tool('a'), tool('b')])
    expect(rows[1]).toMatchObject({ type: 'steps', trailing: true })
  })
  it('folds consecutive reviews', () => {
    expect(foldRuns([review('1'), review('2'), review('3'), reply('r')]).map(r => r.type)).toEqual(['reviews', 'item'])
    expect(foldRuns([review('1'), reply('r')]).map(r => r.type)).toEqual(['item', 'item'])
  })
})

describe('step time', () => {
  it('runs from the first start to the last end', () => {
    expect(span([tool('a', 1000, 2) as never, tool('b', 5000, 3) as never])).toBe(7)
  })
  it('adds the durations without row times', () => {
    expect(span([tool('a', undefined, 2) as never, tool('b', undefined, 1.5) as never])).toBe(3.5)
    expect(span([thought('t') as never])).toBeNull()
  })
  it('reads as the phone writes it', () => {
    expect(spanText(0.4)).toBeNull()
    expect(spanText(12)).toMatch(/12\s?s/)
    expect(spanText(65)).toMatch(/1\s?m.*5\s?s/)
  })
})
