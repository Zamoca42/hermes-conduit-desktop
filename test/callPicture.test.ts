import { describe, expect, it } from 'vitest'
import {
  dataUrlBlob,
  imageFrame,
  pictureNoteText,
  PICTURE_REMOVED,
  PICTURE_SEEN,
  PICTURE_SHARED,
  SCREENSHOT_REMOVED,
  SCREENSHOT_SEEN,
  SCREENSHOT_SHARED,
  type PictureNote
} from '../src/renderer/src/state/callPicture'
import { QwenAdapter } from '../src/renderer/src/state/qwenLive'

const note = (kind: PictureNote['kind'], change: PictureNote['change']): PictureNote => ({ id: 1, kind, change, frame: null })

describe('showing a call a picture', () => {
  it('tells the call what it has, by whether its model saw the picture', () => {
    expect(pictureNoteText(note('screenshot', 'shown'), false)).toBe(SCREENSHOT_SHARED)
    expect(pictureNoteText(note('screenshot', 'shown'), true)).toBe(SCREENSHOT_SEEN)
    expect(pictureNoteText(note('picture', 'shown'), false)).toBe(PICTURE_SHARED)
    expect(pictureNoteText(note('picture', 'shown'), true)).toBe(PICTURE_SEEN)
    expect(pictureNoteText(note('screenshot', 'removed'), true)).toBe(SCREENSHOT_REMOVED)
    expect(pictureNoteText(note('picture', 'removed'), false)).toBe(PICTURE_REMOVED)
    expect(SCREENSHOT_SHARED).toContain("Don't guess what the screen shows")
  })

  it('sends Gemini the picture as a video frame', () => {
    expect(imageFrame('abc')).toEqual({ realtimeInput: { video: { mimeType: 'image/jpeg', data: 'abc' } } })
  })

  it('sends Qwen the picture after some audio', () => {
    const sent: Record<string, unknown>[] = []
    const qwen = new QwenAdapter('Tina', e => sent.push(e))
    qwen.send(imageFrame('abc'))
    expect(sent.map(e => e.type)).toEqual(['input_audio_buffer.append', 'input_image_buffer.append'])
    expect(sent[1]!.image).toBe('abc')
    sent.length = 0
    qwen.send(imageFrame('def'))
    expect(sent.map(e => e.type)).toEqual(['input_image_buffer.append'])
  })
})

describe('a screenshot from the main process', () => {
  it('turns its data URL into a picture without fetch', async () => {
    const blob = dataUrlBlob('data:image/png;base64,' + btoa('\x89PNG'))
    expect(blob.type).toBe('image/png')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  })
})
