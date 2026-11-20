import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { BOTS_META_KEY, keptColor, rosterFromProfiles, type Bot } from '../state/bots'
import {
  MAIN_PROFILE,
  composeSoul,
  createParams,
  isValidSlug,
  modelPinned,
  needsModel,
  nextFreeFace,
  slugFrom,
  titleFor,
  type NewBotDraft
} from '../state/botActions'
import { FACE_COUNT, faceHex, faceName, metaOutcome, normalizedPicture } from '../state/botEditor'
import { starterFace } from '../state/starterFaces'
import { avatarChanged } from '../state/useBots'
import { turnOnPluginForNewBot } from '../state/botPlugin'
import { StarterFaceArt } from './StarterFaceArt'
import { Icon } from './icons'
import { ModelChooser } from './ModelChooser'
import { useModelCatalog } from '../state/modelCatalog'
import { ModelCatalogNote, RefreshModelsButton } from './ModelCatalogNote'
import { mayMove, movingPicture, TooLargeError } from '../state/movingPicture'
import type { HostBadge, NewBotCarry } from '../state/keptHosts'
import { HostBadgeMark } from './CombinedDashboards'

/** A dashboard New Bot can make the bot on, in a combined group: the one on screen and every other kept connected. */
export interface NewBotDashboard {
  url: string
  name: string
  badge: HostBadge | null
  /** The profiles and bots it last listed, which a new name stays clear of. */
  taken: readonly string[]
}

interface Props {
  /** Every bot, hidden ones too: a new name and face stay clear of them. */
  bots: Bot[]
  /** Hermes adds the messaging section to a new bot's SOUL itself. */
  protocol: boolean
  onClose: () => void
  /** The bot was made: `introduce` when it can reach a model and should say hello in its Bot Chat. */
  onCreated: (bot: Bot | null, introduce: boolean, warning: string | null) => void
  /** In a combined group: where the bot can be made, the one on screen first. */
  dashboards?: NewBotDashboard[]
  /** Another dashboard picked: switch there and make the bot with these. */
  onCreateElsewhere?: (url: string, bot: NewBotCarry) => void
  /** Carried over a switch from another dashboard's sheet: filled in, and made at once. */
  carried?: NewBotCarry | null
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * New Bot, after the phone's and Hermes Desktop's: a profile copied from the
 * main one (its keys and accounts shared unless Advanced says otherwise),
 * with a composed SOUL, then its face, color and picture. It says hello in
 * its Bot Chat once its profile can reach a model.
 */
export function NewBot({ bots, protocol, onClose, onCreated, dashboards, onCreateElsewhere, carried }: Props) {
  const [name, setName] = useState(carried?.name ?? '')
  const [description, setDescription] = useState(carried?.description ?? '')
  const [soul, setSoul] = useState(carried?.soul ?? '')
  const [face, setFace] = useState(() => carried?.face ?? nextFreeFace(bots))
  const [picture, setPicture] = useState<string | null>(carried?.picture ?? null)
  const [pick, setPick] = useState('')
  const [cloneFrom, setCloneFrom] = useState(MAIN_PROFILE)
  const [shareAuth, setShareAuth] = useState(carried?.shareAuth ?? true)
  // The dashboard it's made on: the one on screen until another is picked.
  const [target, setTarget] = useState(dashboards?.[0]?.url ?? '')
  const elsewhere = !!dashboards?.length && target !== dashboards[0]!.url ? dashboards.find(d => d.url === target) : undefined
  const [noSkills, setNoSkills] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const movingPicker = useRef<HTMLInputElement>(null)
  const [making, setMaking] = useState(false)
  /** Choose GIF or Video: a picture that moves, or a video, becomes a looping one; a still is used as a photo. */
  const pickMoving = async (file: File) => {
    setMaking(true)
    try {
      setPicture((mayMove(file) ? await movingPicture(file) : null) ?? (await normalizedPicture(file)))
      setError(null)
    } catch (e) {
      setError(e instanceof TooLargeError ? t('That animation is too large. Try a shorter or simpler clip.') : t('That picture could not be used.'))
    } finally {
      setMaking(false)
    }
  }

  const catalog = useModelCatalog(
    useMemo(() => (cloneFrom && cloneFrom !== MAIN_PROFILE ? { explicit_only: true, profile: cloneFrom } : { explicit_only: true }), [cloneFrom])
  )
  const providers = catalog.providers ?? []

  const slug = slugFrom(name)
  const taken = elsewhere ? elsewhere.taken.some(n => n.toLowerCase() === slug) : bots.some(b => b.name.toLowerCase() === slug)
  const nameNote = !name.trim()
    ? null
    : !isValidSlug(slug)
      ? t('Use at least one letter or number.')
      : taken
        ? t('A profile named {name} already exists.', { name: slug })
        : t('Profile ID: {name}', { name: slug })
  const canCreate = !!name.trim() && isValidSlug(slug) && !taken && !saving
  const startFrom = [MAIN_PROFILE, ...bots.filter(b => !b.isDefault && b.name !== MAIN_PROFILE).map(b => b.name)]
  const startTitle = (n: string) => (n === MAIN_PROFILE ? t('Main Profile') : (bots.find(b => b.name === n)?.title ?? n))

  const create = async () => {
    if (!canCreate) return
    if (elsewhere && onCreateElsewhere) {
      // What this sheet read (models, profiles to start from) is this dashboard's, so there it starts from its main profile with its own defaults.
      onCreateElsewhere(elsewhere.url, { name, description: description.trim(), soul, face, picture, shareAuth })
      return
    }
    setSaving(true)
    setError(null)
    const title = titleFor(name)
    const mission = description.trim()
    const [provider = '', model = ''] = pick.split('\n')
    const draft: NewBotDraft = { name, description: mission, soul, provider: pick ? provider : '', model: pick ? model : '', cloneFrom, shareAuth, noSkills }
    const params = createParams(
      slug,
      mission,
      composeSoul({ name: slug, title, description: mission, customSoul: soul, serverInjectsProtocol: protocol, roster: bots }),
      draft
    )
    let created: unknown
    try {
      created = await gateway.rpc('profiles.create', params)
    } catch (e) {
      setError(t('Could not create the bot: {error}', { error: message(e) }))
      setSaving(false)
      return
    }
    const warnings: string[] = []
    // The picture goes first, so the look only claims a photo the store holds.
    let photoSaved = false
    if (picture) {
      try {
        await gateway.rpc('profiles.set_asset', { name: slug, asset: 'avatar', data: picture })
        photoSaved = true
        avatarChanged(slug)
      } catch {
        photoSaved = false
      }
    }
    const meta: Record<string, unknown> = { created: Date.now(), face, color: faceHex(starterFace(face)) }
    if (title) meta.title = title
    if (photoSaved) Object.assign(meta, { imageKind: 'photo', custom: true })
    let lookSaved = true
    try {
      lookSaved = metaOutcome(await gateway.rpc('profiles.configure', { name: slug, ui_meta: { [BOTS_META_KEY]: meta } })) !== 'failed'
    } catch {
      lookSaved = false
    }
    if (!lookSaved || (picture && !photoSaved)) warnings.push(t('The bot was created, but its picture or look was not saved. Edit the bot to try again.'))
    if (!modelPinned(params, created)) warnings.push(t('The model was not saved.'))
    // The bot can use Conduit's features from the start: its profile gets the plugin turned on (issue 2803).
    const pluginWarning = await turnOnPluginForNewBot(gateway.http, slug, !cloneFrom.trim())
    if (pluginWarning) warnings.push(pluginWarning)
    // The hello is a real model turn: a bot that can't reach a model skips it and says so.
    const missing = needsModel(await gateway.rpc('setup.runtime_check', { profile: slug }).catch(() => null))
    if (missing) warnings.push(t('No model is ready for this bot yet, so it skipped its introduction. Edit the bot and pick a model.'))
    const fresh = await gateway
      .rpc('profiles.list', { include_sessions: true })
      .then(body => {
        const roster = rosterFromProfiles(body)
        return [...roster.bots, ...roster.hidden].find(b => b.name === slug) ?? null
      })
      .catch(() => null)
    setSaving(false)
    onCreated(fresh, !missing, warnings.length ? warnings.join(' ') : null)
  }

  // Carried over a switch: made as soon as the sheet opens here; a failure stays on the sheet to try again.
  const madeCarried = useRef(false)
  useEffect(() => {
    if (!carried || madeCarried.current) return
    madeCarried.current = true
    void create()
    // Once, with the carried words.
  }, [])

  const color = keptColor(faceHex(starterFace(face)))

  return (
    <main className="settings bot-editor">
      <div className="pset">
        <div className="pulse-head">
          <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onClose}>
            <Icon name="back" />
          </button>
          <h1>{t('New Bot')}</h1>
          <span className="spacer" />
          <button className="secondary" onClick={onClose} disabled={saving}>
            {t('Cancel')}
          </button>
          <button className="primary" onClick={() => void create()} disabled={!canCreate}>
            {saving ? t('Creating…') : t('Create')}
          </button>
        </div>
        <p className="meta">{t('The bot gets its own Hermes profile, chat, memory and skills.')}</p>
        {error ? <p className="error-text">{error}</p> : null}

        <section className="pset-section">
          <h2>{t('Name')}</h2>
          <input className="pset-note" value={name} autoFocus placeholder={t('Name')} onChange={e => setName(e.target.value)} aria-label={t('Name')} />
          {nameNote ? <p className={taken || !isValidSlug(slug) ? 'error-text' : 'meta'}>{nameNote}</p> : null}
        </section>

        {dashboards?.length ? (
          <section className="pset-section">
            <h2>{t('Dashboard')}</h2>
            <div className="pulse-hosts" role="radiogroup" aria-label={t('Dashboard')}>
              {dashboards.map(d => (
                <button key={d.url} role="radio" aria-checked={target === d.url} className={target === d.url ? 'on' : undefined} onClick={() => setTarget(d.url)} disabled={saving}>
                  {d.badge ? <HostBadgeMark badge={d.badge} /> : null}
                  {d.name}
                </button>
              ))}
            </div>
            {elsewhere ? (
              <p className="meta">{t('Create switches to {host} and makes the bot there, from its main profile with its default model, skills and tools.', { host: elsewhere.name })}</p>
            ) : null}
          </section>
        ) : null}

        <section className="pset-section">
          <h2>{t('Picture')}</h2>
          <div className="bot-editor-picture">
            <span className="bot-avatar" style={{ width: 96, height: 96 }} aria-hidden="true">
              {picture ? <img src={picture} alt="" draggable={false} /> : <StarterFaceArt face={starterFace(face)} background={color} />}
            </span>
            <div className="pset-actions">
              <button className="secondary" onClick={() => picker.current?.click()} disabled={saving || making}>
                {t('Choose Photo')}
              </button>
              <button className="secondary" onClick={() => movingPicker.current?.click()} disabled={saving || making}>
                {making ? t('Working…') : t('Choose GIF or Video')}
              </button>
              {picture ? (
                <button className="secondary" onClick={() => setPicture(null)} disabled={saving}>
                  {t('Remove Photo')}
                </button>
              ) : null}
            </div>
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              onChange={e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file)
                  normalizedPicture(file)
                    .then(setPicture)
                    .catch(() => setError(t('That picture could not be used.')))
              }}
            />
            <input
              ref={movingPicker}
              type="file"
              accept="image/gif,image/webp,image/png,video/mp4,video/quicktime,video/webm"
              hidden
              onChange={e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void pickMoving(file)
              }}
            />
          </div>
          <p className="meta">{t('A GIF, a short video or a picture brought to life moves on Bots Home and in Hermes Desktop.')}</p>
          <div className="bot-faces" role="radiogroup" aria-label={t('Face')}>
            {Array.from({ length: FACE_COUNT }, (_, index) => (
              <button
                key={index}
                role="radio"
                aria-checked={face === index}
                aria-label={faceName(index)}
                title={faceName(index)}
                className={`bot-face${face === index ? ' on' : ''}`}
                onClick={() => setFace(index)}
              >
                <StarterFaceArt face={starterFace(index)} />
              </button>
            ))}
          </div>
          <p className="meta">{t("Shown until the bot has a picture. Its color is the bot's color in Conduit.")}</p>
        </section>

        <section className="pset-section">
          <h2>{t('Description')}</h2>
          <textarea
            className="pset-note"
            rows={2}
            value={description}
            placeholder={t('What this bot is for')}
            onChange={e => setDescription(e.target.value)}
            aria-label={t('Description')}
          />
        </section>

        <section className="pset-section">
          <h2>{t('Personality')}</h2>
          <textarea
            className="pset-note bot-soul"
            rows={6}
            value={soul}
            placeholder={t('Optional. Leave empty to start from a short identity built from the name and description.')}
            onChange={e => setSoul(e.target.value)}
            aria-label={t('Personality')}
          />
          <p className="meta">{t("Saved as the bot's SOUL.md.")}</p>
        </section>

        <section className="pset-section">
          <h2 className="model-section-title">
            {t('Model')}
            <RefreshModelsButton catalog={catalog} />
          </h2>
          <ModelChooser value={pick} onChange={setPick} providers={providers} defaultLabel={t('Default')} label={t('Model')} disabled={!catalog.answered} />
          <ModelCatalogNote catalog={catalog} />
        </section>

        <section className="pset-section">
          <h2>{t('Advanced')}</h2>
          <div className="pset-row">
            <span>{t('Start From')}</span>
            <select className="language-select" value={cloneFrom} aria-label={t('Start From')} onChange={e => setCloneFrom(e.target.value)}>
              {startFrom.map(n => (
                <option key={n} value={n}>
                  {startTitle(n)}
                </option>
              ))}
              <option value="">{t('Fresh Profile')}</option>
            </select>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={shareAuth} onChange={e => setShareAuth(e.target.checked)} />
            {t('Share Keys and Accounts')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={noSkills} onChange={e => setNoSkills(e.target.checked)} />
            {t('Skip Bundled Skills')}
          </label>
          <p className="meta">
            {cloneFrom
              ? t(
                  'Shared keys and accounts stay one set with the main profile, so a sign-in refresh in one never signs the other out. Turn it off for a separate copy.'
                )
              : noSkills
                ? t("A fresh profile starts with Hermes' default tools. Edit the bot afterwards to change them.")
                : t("A fresh profile starts with Hermes' bundled skills and default tools. Edit the bot afterwards to change them.")}
          </p>
        </section>
      </div>
    </main>
  )
}
