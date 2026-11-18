import { useCallback, useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { timeLabel } from '../state/chats'
import { createParams, parseProjectChats, parseProjects, type Project, type ProjectChat, type ProjectDetail } from '../state/projects'
import { Icon } from './icons'

interface Props {
  /** The chat list's profile; null reads the active one. */
  profile: string | null
  connected: boolean
  selectedId: string | null
  onSelect: (chat: ProjectChat) => void
  /** A new chat working in the project's folder. */
  onNewChat: (folder: string | undefined, project: Project) => void
  onClose: () => void
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The phone's Chats › Projects: Hermes' projects, then one project's chats by folder. */
export function ProjectsPane({ profile, connected, selectedId, onSelect, onNewChat, onClose }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Project | null>(null)
  const [creating, setCreating] = useState(false)
  const [reload, setReload] = useState(0)
  const withProfile = useCallback((params: Record<string, unknown>) => (profile ? { ...params, profile } : params), [profile])

  useEffect(() => {
    if (!connected) return
    let live = true
    gateway
      .rpc('projects.tree', withProfile({ preview_limit: 3 }))
      .then(response => {
        if (!live) return
        setProjects(parseProjects(response, profile ?? undefined).filter(p => !p.isHome))
        setError(null)
      })
      .catch(e => live && setError(reason(e)))
    return () => {
      live = false
    }
  }, [connected, profile, withProfile, reload])

  // Another profile's projects are its own.
  useEffect(() => setOpen(null), [profile])

  if (open) {
    return (
      <ProjectPage
        project={open}
        connected={connected}
        selectedId={selectedId}
        withProfile={withProfile}
        onSelect={onSelect}
        onNewChat={() => onNewChat(open.path, open)}
        onBack={() => setOpen(null)}
        onChanged={project => {
          setOpen(project)
          setReload(n => n + 1)
        }}
      />
    )
  }
  return (
    <section className="chatlist projects" aria-label={t('Projects')}>
      <div className="chatlist-head">
        <button className="round" aria-label={t('Chats')} title={t('Chats')} onClick={onClose}>
          <Icon name="back" />
        </button>
        <h1>{t('Projects')}</h1>
        <button className="round" aria-label={t('New Project')} title={t('New Project')} onClick={() => setCreating(true)}>
          <Icon name="plus" />
        </button>
      </div>
      {creating ? (
        <ProjectForm
          withProfile={withProfile}
          onDone={project => {
            setCreating(false)
            if (project) {
              setReload(n => n + 1)
              setOpen(project)
            }
          }}
        />
      ) : null}
      <div className="chatlist-scroll">
        {projects === null && !error ? <div className="empty">{t('Loading projects…')}</div> : null}
        {error ? <div className="empty">{`${t('Couldn’t Load Projects')} ${error}`}</div> : null}
        {projects && !projects.length && !creating ? <div className="empty">{t('Projects you make here or in Hermes Desktop show here.')}</div> : null}
        {projects?.map(project => (
          <button key={project.id} className="row project-row" onClick={() => setOpen(project)}>
            <span className="row-top">
              <span className="row-title">
                <Icon name="folder" className="row-pin" />
                {project.title}
              </span>
              <span className="meta row-time">{project.count}</span>
            </span>
            {project.path ? <span className="meta project-path">{project.path}</span> : null}
          </button>
        ))}
      </div>
    </section>
  )
}

function ProjectForm({
  withProfile,
  onDone
}: {
  withProfile: (p: Record<string, unknown>) => Record<string, unknown>
  onDone: (project: Project | null) => void
}) {
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = !!name.trim() && !!folder.trim() && !busy
  async function create() {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const response = (await gateway.rpc('projects.create', withProfile(createParams(name, folder)))) as { project?: Record<string, unknown> }
      const made = parseProjects(response?.project ? [response.project] : [])[0]
      onDone(made ?? null)
    } catch (e) {
      setError(reason(e))
      setBusy(false)
    }
  }
  return (
    <form
      className="project-form"
      onSubmit={e => {
        e.preventDefault()
        void create()
      }}
    >
      <input autoFocus aria-label={t('Project name')} placeholder={t('Project name')} value={name} onChange={e => setName(e.target.value)} />
      <input
        aria-label={t('Folder on the Hermes host')}
        placeholder={t('Folder on the Hermes host')}
        value={folder}
        onChange={e => setFolder(e.target.value)}
      />
      {error ? <div className="meta project-error">{error}</div> : null}
      <div className="project-form-actions">
        <button type="button" className="secondary" onClick={() => onDone(null)}>
          {t('Cancel')}
        </button>
        <button type="submit" className="primary" disabled={!ready}>
          {busy ? t('Creating…') : t('Create')}
        </button>
      </div>
    </form>
  )
}

function ProjectPage({
  project,
  connected,
  selectedId,
  withProfile,
  onSelect,
  onNewChat,
  onBack,
  onChanged
}: {
  project: Project
  connected: boolean
  selectedId: string | null
  withProfile: (p: Record<string, unknown>) => Record<string, unknown>
  onSelect: (chat: ProjectChat) => void
  onNewChat: () => void
  onBack: () => void
  onChanged: (project: Project | null) => void
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)

  useEffect(() => {
    if (!connected) return
    let live = true
    setDetail(null)
    gateway
      .rpc('projects.project_sessions', withProfile({ project_id: project.id }))
      .then(response => {
        if (!live) return
        setDetail(parseProjectChats(response, project.previews[0]?.profile))
        setError(null)
      })
      .catch(e => live && setError(reason(e)))
    return () => {
      live = false
    }
  }, [connected, project.id, project.previews, withProfile])

  async function rename(name: string) {
    setRenaming(null)
    const title = name.trim()
    if (!title || title === project.title) return
    try {
      await gateway.rpc('projects.update', withProfile({ id: project.id, name: title }))
      onChanged({ ...project, title })
    } catch (e) {
      window.alert(t('Couldn’t rename the project: {reason}', { reason: reason(e) }))
    }
  }
  async function remove() {
    if (!window.confirm(`${t('Delete project?')}\n\n${project.title}\n${t('Its folders, files and chats stay where they are.')}`)) return
    try {
      await gateway.rpc('projects.delete', withProfile({ id: project.id }))
      onChanged(null)
    } catch (e) {
      window.alert(t('Couldn’t delete the project: {reason}', { reason: reason(e) }))
    }
  }

  const toggle = (id: string) =>
    setClosed(current => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const lanes = detail?.lanes ?? []
  return (
    <section className="chatlist projects" aria-label={project.title}>
      <div className="chatlist-head">
        <button className="round" aria-label={t('Projects')} title={t('Projects')} onClick={onBack}>
          <Icon name="back" />
        </button>
        {renaming !== null ? (
          <input
            className="row-rename project-rename"
            aria-label={t('Rename')}
            autoFocus
            value={renaming}
            onChange={e => setRenaming(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void rename(renaming)
              else if (e.key === 'Escape') setRenaming(null)
            }}
            onBlur={() => void rename(renaming)}
          />
        ) : (
          <h1 className="project-title" title={project.path}>
            {project.title}
          </h1>
        )}
        <button className="round" aria-label={t('New chat in this project')} title={t('New chat in this project')} disabled={!project.path} onClick={onNewChat}>
          <Icon name="plus" />
        </button>
      </div>
      <div className="project-meta">
        {project.path ? <span className="meta project-path">{project.path}</span> : null}
        {!project.isAuto ? (
          <span className="project-actions">
            <button className="link" onClick={() => setRenaming(project.title)}>
              {t('Rename')}
            </button>
            <button className="link danger" onClick={() => void remove()}>
              {t('Delete')}
            </button>
          </span>
        ) : null}
      </div>
      <div className="chatlist-scroll">
        {!detail && !error ? <div className="empty">{t('Loading chats…')}</div> : null}
        {error ? <div className="empty">{t('Couldn’t load your chats: {error}', { error })}</div> : null}
        {detail && !lanes.length ? <div className="empty">{t('This project does not have any conversations yet.')}</div> : null}
        {lanes.map(lane => {
          const shut = closed.has(lane.id)
          return (
            <div key={lane.id} role="group" aria-label={lane.title}>
              <button className="sect project-lane" aria-expanded={!shut} title={lane.path} onClick={() => toggle(lane.id)}>
                <Icon name={shut ? 'chevron' : 'chevronDown'} />
                <span>{lane.title}</span>
                <span className="meta">{lane.chats.length}</span>
              </button>
              {shut
                ? null
                : lane.chats.map(chat => (
                    <button key={chat.id} className="row" aria-current={chat.id === selectedId ? 'true' : undefined} onClick={() => onSelect(chat)}>
                      <span className="row-top">
                        <span className="row-title">{chat.title}</span>
                        {chat.lastActive ? <span className="meta row-time">{timeLabel(chat.lastActive)}</span> : null}
                      </span>
                      {chat.preview && chat.preview !== chat.title ? <span className="meta">{chat.preview}</span> : null}
                    </button>
                  ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}
