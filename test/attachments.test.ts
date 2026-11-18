import { describe, expect, it } from 'vitest'
import {
  displayName,
  fileReference,
  formatReferenceValue,
  isPastedTextName,
  pastedTextName,
  promptText,
  stagePaste,
  titlePreview,
  tooLargeMessage,
  uploadAttachments,
  type StagedAttachment
} from '../src/renderer/src/state/attachments'
import { uploadTimeoutMs } from '../src/main/connection'
import { addPendingUser, emptyTranscript } from '../src/renderer/src/state/transcript'

const picture = (name = 'cat.png'): StagedAttachment => ({ id: name, name, kind: 'image', mime: 'image/png', size: 3, base64: 'AAA=' })
const doc = (name = 'notes.pdf'): StagedAttachment => ({ id: name, name, kind: 'file', mime: 'application/pdf', size: 3, base64: 'BBB=' })

/** A fake gateway that records calls and answers from a table. */
function gateway(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const rpc = async <T,>(method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push({ method, params })
    const answer = answers[method]
    if (!answer) throw new Error(`unexpected ${method}`)
    return answer(params) as T
  }
  return { rpc, calls }
}

describe('pasted text', () => {
  it('is named the way Hermes Desktop names a paste, and read back as one', () => {
    const name = pastedTextName(new Date(Date.UTC(2026, 10, 18, 5, 7, 9, 42)), 0xab12)
    expect(name).toBe('pasted_content_2026-11-18_05-07-09-042_00ab12.txt')
    expect(isPastedTextName(name)).toBe(true)
    expect(isPastedTextName(`/home/me/.hermes/uploads/x_${name.replace('.txt', '-2.txt')}`)).toBe(true)
    expect(isPastedTextName('pasted_content.txt')).toBe(false)
    expect(displayName(name)).toBe('Pasted text')
    expect(displayName('report.pdf')).toBe('report.pdf')
  })

  it('stages as UTF-8 text and gives the chat its title', () => {
    const paste = stagePaste('héllo ' + 'x'.repeat(1200), 'p')
    expect(paste.kind).toBe('file')
    expect(paste.mime).toBe('text/plain')
    expect(new TextDecoder().decode(Uint8Array.from(atob(paste.base64), c => c.charCodeAt(0)))).toBe(paste.pastedText)
    expect(titlePreview([picture(), paste])).toHaveLength(1000)
    expect(titlePreview([picture()])).toBeUndefined()
  })
})

describe('the prompt', () => {
  it('puts the files ahead of the words', () => {
    expect(promptText('look', ['@file:/a.pdf', '@file:/b.txt'])).toBe('@file:/a.pdf\n@file:/b.txt\n\nlook')
    expect(promptText('  ', ['@file:/a.pdf'])).toBe('@file:/a.pdf')
    expect(promptText('look', [])).toBe('look')
  })

  it('takes the reply’s reference, else builds one from its path', () => {
    expect(fileReference({ ref_text: '@file:/u/a.pdf' })).toBe('@file:/u/a.pdf')
    expect(fileReference({ ref_text: '', path: '/u/my notes.pdf' })).toBe('@file:`/u/my notes.pdf`')
    expect(fileReference({})).toBeNull()
    expect(formatReferenceValue('a`b c')).toBe('"a`b c"')
  })

  it('names the limit that refused a file', () => {
    expect(tooLargeMessage(['big.mov'])).toBe('big.mov is larger than the 16 MB attachment limit.')
    expect(tooLargeMessage(['a', 'b'])).toBe('These files are larger than the 16 MB attachment limit: a, b.')
  })
})

describe('uploadAttachments', () => {
  it('holds pictures on the dashboard and sends files as references', async () => {
    const { rpc, calls } = gateway({
      'image.attach_bytes': () => ({ attached: true, path: '/img/cat.png' }),
      'file.attach': p => ({ attached: true, ref_text: `@file:/up/${p.name}` })
    })
    const out = await uploadAttachments(rpc, 's1', 'work', false, [picture(), doc()])
    expect(out).toEqual({ references: ['@file:/up/notes.pdf'], images: [], heldImagePaths: ['/img/cat.png'] })
    expect(calls[0]).toEqual({ method: 'image.attach_bytes', params: { session_id: 's1', profile: 'work', content_base64: 'AAA=', filename: 'cat.png' } })
    expect(calls[1].params).toMatchObject({ data_url: 'data:application/pdf;base64,BBB=', name: 'notes.pdf', path: '' })
  })

  it('names the session authority’s staged pictures for the prompt', async () => {
    const { rpc } = gateway({ 'image.attach_bytes': () => ({ attached: true, path: '/img/cat.png', mime: 'image/png' }) })
    const out = await uploadAttachments(rpc, 's1', undefined, true, [picture()])
    expect(out.images).toEqual([{ path: '/img/cat.png', mime: 'image/png' }])
    expect(out.heldImagePaths).toEqual([])
  })

  it('sends a picture Hermes refuses as an image as a file', async () => {
    const { rpc, calls } = gateway({
      'image.attach_bytes': () => {
        throw Object.assign(new Error('unsupported image'), { code: 4016 })
      },
      'file.attach': () => ({ attached: true, path: '/up/cat.png' })
    })
    const out = await uploadAttachments(rpc, 's1', undefined, false, [picture()])
    expect(out.references).toEqual(['@file:/up/cat.png'])
    expect(calls.map(c => c.method)).toEqual(['image.attach_bytes', 'file.attach'])
  })

  it('takes back held pictures when a later file fails', async () => {
    const { rpc, calls } = gateway({
      'image.attach_bytes': () => ({ attached: true, path: '/img/cat.png' }),
      'file.attach': () => {
        throw new Error('disk full')
      },
      'image.detach': () => ({ detached: true, count: 0 })
    })
    await expect(uploadAttachments(rpc, 's1', undefined, false, [picture(), doc()])).rejects.toThrow('disk full')
    expect(calls.at(-1)).toEqual({ method: 'image.detach', params: { session_id: 's1', path: '/img/cat.png' } })
  })
})

describe('upload budget', () => {
  it('is two minutes, or about 1 s per 64 KB carried', () => {
    expect(uploadTimeoutMs({ text: 'x'.repeat(10_000_000) })).toBe(120_000)
    expect(uploadTimeoutMs({ content_base64: 'x'.repeat(64_000 * 300) })).toBe(300_000)
    expect(uploadTimeoutMs({ data_url: 'x'.repeat(64_000 * 200) })).toBe(200_000)
  })
})

describe('a sent message’s files', () => {
  it('show on its bubble while it is on its way', () => {
    const state = addPendingUser(emptyTranscript, '', [{ kind: 'image', value: 'cat.png' }])
    expect(state.items.at(-1)).toMatchObject({ kind: 'user', text: '', pending: true, attachments: [{ kind: 'image', value: 'cat.png' }] })
  })
})
