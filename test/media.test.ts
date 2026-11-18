import { describe, expect, it } from 'vitest'
import { mediaKind, splitReply } from '../src/renderer/src/state/media'

describe('splitReply', () => {
  it('leaves a reply without tags as one block', () => {
    expect(splitReply('Hello\nthere')).toEqual([{ kind: 'markdown', text: 'Hello\nthere' }])
  })

  it('turns a tag alone on its line into a card, keeping the words around it', () => {
    expect(splitReply('Here is your summary:\nMEDIA:/tmp/hermes/voice 12.ogg\nEnjoy')).toEqual([
      { kind: 'markdown', text: 'Here is your summary:' },
      { kind: 'media', path: '/tmp/hermes/voice 12.ogg' },
      { kind: 'markdown', text: 'Enjoy' }
    ])
  })

  it('takes an unknown extension when the tag has the line to itself', () => {
    expect(splitReply('MEDIA:/srv/out/build.bin')).toEqual([{ kind: 'media', path: '/srv/out/build.bin' }])
  })

  it('finds tags mid-sentence with known extensions', () => {
    expect(splitReply('I saved MEDIA:/tmp/a.png and MEDIA:C:\\out\\b.pdf for you.')).toEqual([
      { kind: 'markdown', text: 'I saved and for you.' },
      { kind: 'media', path: '/tmp/a.png' },
      { kind: 'media', path: 'C:\\out\\b.pdf' }
    ])
  })

  it('reads a Markdown image around a tag, with its label', () => {
    expect(splitReply('![The chart](MEDIA:/tmp/chart.png)')).toEqual([{ kind: 'media', path: '/tmp/chart.png', alt: 'The chart' }])
  })

  it('handles quoted and emphasized tags', () => {
    expect(splitReply('**MEDIA:"/tmp/My File.pdf"**')).toEqual([{ kind: 'media', path: '/tmp/My File.pdf' }])
  })

  it('drops delivery directives', () => {
    expect(splitReply('[[audio_as_voice]]\nMEDIA:/tmp/v.ogg')).toEqual([{ kind: 'media', path: '/tmp/v.ogg' }])
  })

  it('leaves tags in code, fences and quotes as text', () => {
    const text = 'Use `MEDIA:/tmp/a.png` like so\n```\nMEDIA:/tmp/b.png\n```\n> MEDIA:/tmp/c.png'
    expect(splitReply(text)).toEqual([{ kind: 'markdown', text }])
  })

  it('leaves prose with no path alone', () => {
    expect(splitReply('social MEDIA: we are live')).toEqual([{ kind: 'markdown', text: 'social MEDIA: we are live' }])
  })
})

describe('mediaKind', () => {
  it('names images, audio, video and files', () => {
    expect([mediaKind('/a.PNG'), mediaKind('/b.opus'), mediaKind('/c.mov'), mediaKind('/d.zip')]).toEqual(['image', 'audio', 'video', 'file'])
  })
})
