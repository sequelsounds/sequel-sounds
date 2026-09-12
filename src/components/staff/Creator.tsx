import { useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useMatch } from 'react-router-dom'
import { useCreator } from '../../lib/creator'
import type { Tables } from '../../lib/database.types'
import { formatDuration, plural } from '../../lib/format'
import { toPlayerTrack, usePlayer, type PlayerTrack } from '../../lib/player'
import {
  usePlaylist,
  usePlaylistActions,
  usePlaylists,
  useProjects,
  useProjectTracks,
  type PlaylistDetail,
  type Track,
  type TrackWithUse,
} from '../../lib/queries'
import Artwork from './Artwork'
import Menu from './Menu'
import Switch from './Switch'

type Section = Tables<'playlist_sections'>

/** One line in the Creator. `track` is null only for a row whose track vanished. */
type Row = {
  id: string
  track_id: string
  section_id: string | null
  position: number
  track: Track | null
}

type DragData =
  | { type: 'track'; track: TrackWithUse }
  | { type: 'pt'; pt: Row }
  | { type: 'section'; sectionId: string }
  | { type: 'end' }

/**
 * Render order is sections by position, each with its rows by position, then
 * anything unsectioned. Positions are rewritten across the whole list after
 * every change, so "position" is simply "index in this order".
 */
function sortRows(playlist: PlaylistDetail): Row[] {
  const rank = new Map(
    [...playlist.playlist_sections].sort((a, b) => a.position - b.position).map((s, i) => [s.id, i]),
  )
  const rankOf = (r: { section_id: string | null }) =>
    r.section_id != null && rank.has(r.section_id) ? rank.get(r.section_id)! : Number.MAX_SAFE_INTEGER
  return [...playlist.playlist_tracks]
    .map((pt) => ({
      id: pt.id,
      track_id: pt.track_id,
      section_id: pt.section_id,
      position: pt.position,
      track: pt.tracks,
    }))
    .sort((a, b) => rankOf(a) - rankOf(b) || a.position - b.position)
}

/** Stable re-grouping by section, then positions renumbered 0..n-1. */
function normalise(rows: Row[], sections: Section[]): Row[] {
  const rank = new Map(sections.map((s, i) => [s.id, i]))
  const rankOf = (r: Row) =>
    r.section_id != null && rank.has(r.section_id) ? rank.get(r.section_id)! : Number.MAX_SAFE_INTEGER
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rankOf(a.r) - rankOf(b.r) || a.i - b.i)
    .map(({ r }, position) => ({ ...r, position }))
}

export default function Creator() {
  const { playlistId, open, setDropHandler } = useCreator()
  const routeProjectId = useMatch('/projects/:id')?.params.id ?? null
  const playlist = usePlaylist(playlistId)
  const projectPlaylists = usePlaylists(routeProjectId ?? undefined)
  const actions = usePlaylistActions()
  const player = usePlayer()

  const [rows, setRows] = useState<Row[]>([])
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const data = playlist.data ?? null
  const sections = useMemo(
    () => [...(data?.playlist_sections ?? [])].sort((a, b) => a.position - b.position),
    [data],
  )

  // Server truth resets the local order whenever it arrives.
  useEffect(() => {
    setRows(data ? sortRows(data) : [])
    setTitle(data?.name ?? '')
    setEditing(false)
    setPicking(false)
    setAttaching(false)
  }, [data])

  // Scoped to the project on screen: arriving at a project shows its latest
  // playlist unless the one already open belongs to it.
  useEffect(() => {
    if (!routeProjectId || !projectPlaylists.data) return
    if (playlistId && playlist.isPending) return
    const openBelongs = data?.project_id === routeProjectId
    if (openBelongs) return
    open(projectPlaylists.data[0]?.id ?? null)
  }, [routeProjectId, projectPlaylists.data, playlistId, playlist.isPending, data, open])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2500)
    return () => clearTimeout(t)
  }, [notice])

  /**
   * Handles a drop, creating a playlist first if none is open yet. That case
   * used to be a silent no-op: with no playlist, the "No playlist open" state
   * rendered no droppable at all, so a drag onto it had nothing to land on
   * and onDragEnd fired with `over: null`. EmptyDrop below gives that state a
   * real target, and this creates the playlist the drop is clearly asking for
   * rather than discarding it.
   */
  const onDrop = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e
      if (!over) return
      const a = active.data.current as DragData | undefined
      const o = over.data.current as DragData | undefined
      if (!a || !o) return
      if (a.type !== 'track' && a.type !== 'pt') return

      void (async () => {
        let pid = playlistId
        let base = rows
        let secs = sections
        if (!pid) {
          pid = await actions.createPlaylist.mutateAsync({ projectId: routeProjectId })
          open(pid)
          base = []
          secs = []
        }

        let next = [...base]
        let moving: Row
        if (a.type === 'track') {
          if (next.some((r) => r.track_id === a.track.id)) {
            setNotice('Already in this playlist')
            return
          }
          moving = {
            id: crypto.randomUUID(),
            track_id: a.track.id,
            section_id: null,
            position: 0,
            track: a.track,
          }
        } else {
          moving = { ...a.pt }
          next = next.filter((r) => r.id !== moving.id)
        }

        if (o.type === 'pt') {
          if (o.pt.id === moving.id) return
          const idx = next.findIndex((r) => r.id === o.pt.id)
          if (idx < 0) return
          moving.section_id = o.pt.section_id
          const fromAbove =
            a.type === 'pt' &&
            base.findIndex((r) => r.id === moving.id) < base.findIndex((r) => r.id === o.pt.id)
          next.splice(fromAbove ? idx + 1 : idx, 0, moving)
        } else if (o.type === 'section') {
          moving.section_id = o.sectionId
          let last = -1
          next.forEach((r, i) => {
            if (r.section_id === o.sectionId) last = i
          })
          next.splice(last + 1, 0, moving)
        } else {
          // The drop zone at the bottom: the end of the last section, or of
          // the list when there are none.
          moving.section_id = secs[secs.length - 1]?.id ?? null
          next.push(moving)
        }

        const normalised = normalise(next, secs)
        setRows(normalised)
        actions.persistOrder.mutate({
          playlistId: pid,
          rows: normalised.map(({ id, track_id, section_id, position }) => ({
            id,
            track_id,
            section_id,
            position,
          })),
        })
      })()
    },
    [rows, sections, playlistId, routeProjectId, actions, open],
  )

  useEffect(() => {
    setDropHandler(onDrop)
    return () => setDropHandler(null)
  }, [onDrop, setDropHandler])

  // ------------------------------------------------------------ derived

  const grouped = useMemo(() => {
    const groups: { section: Section | null; rows: Row[] }[] = sections.map((s) => ({
      section: s,
      rows: rows.filter((r) => r.section_id === s.id),
    }))
    const loose = rows.filter((r) => !r.section_id || !sections.some((s) => s.id === r.section_id))
    if (loose.length > 0 || sections.length === 0) groups.push({ section: null, rows: loose })
    return groups
  }, [rows, sections])

  const queue = useMemo<PlayerTrack[]>(
    () => rows.filter((r) => r.track).map((r) => toPlayerTrack(r.track!)),
    [rows],
  )
  const totalSeconds = rows.reduce((sum, r) => sum + (r.track?.duration_seconds ?? 0), 0)
  const dirty = !!data && title.trim() !== data.name && title.trim() !== ''

  // ------------------------------------------------------------ actions

  const saveTitle = () => {
    if (!data || !dirty) return
    actions.updatePlaylist.mutate({ id: data.id, name: title.trim() })
  }

  const newPlaylist = async () => {
    const id = await actions.createPlaylist.mutateAsync({ projectId: routeProjectId })
    open(id)
  }

  const share = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(`${location.origin}/p/${data.token}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setNotice('Could not copy — the link is in the address bar of Preview')
    }
  }

  const addSection = async () => {
    if (!data) return
    await actions.addSection.mutateAsync({
      playlistId: data.id,
      name: 'New section',
      position: sections.length,
    })
    setEditing(true)
  }

  const moveSection = (section: Section, dir: -1 | 1) => {
    if (!data) return
    const i = sections.findIndex((s) => s.id === section.id)
    const j = i + dir
    if (j < 0 || j >= sections.length) return
    const next = [...sections]
    ;[next[i], next[j]] = [next[j], next[i]]
    actions.reorderSections.mutate({
      playlistId: data.id,
      rows: next.map((s, position) => ({ id: s.id, name: s.name, position })),
    })
  }

  const remove = (row: Row) => {
    if (!data) return
    const next = normalise(
      rows.filter((r) => r.id !== row.id),
      sections,
    )
    setRows(next)
    actions.removeTrack.mutate({ playlistId: data.id, id: row.id })
  }

  const destroy = async () => {
    if (!data) return
    if (!window.confirm(`Delete "${data.name}"? Viewers with the link will lose access.`)) return
    await actions.deletePlaylist.mutateAsync(data.id)
    open(null)
  }

  const duplicate = async () => {
    if (!data) return
    const id = await actions.duplicatePlaylist.mutateAsync(data)
    open(id)
  }

  const menuItems = [
    { label: 'Add section', onSelect: () => void addSection(), disabled: !data },
    { label: editing ? 'Done editing' : 'Edit all', onSelect: () => setEditing((v) => !v), disabled: !data },
    { label: 'Attach to project…', onSelect: () => setAttaching(true), disabled: !data },
    { label: 'Duplicate', onSelect: () => void duplicate(), disabled: !data },
    { label: 'Delete', onSelect: () => void destroy(), disabled: !data, danger: true },
  ]

  // Running number across sections, computed once per render.
  const numberOf = new Map(rows.map((r, i) => [r.id, i + 1]))

  return (
    <aside className="z-[2] flex min-h-0 min-w-0 flex-col overflow-hidden bg-sequel-white shadow-[-6px_0_24px_rgba(48,47,44,0.18)]">
      <div className="flex items-center justify-between bg-sequel-brown px-[18px] py-[14px] text-sequel-silver">
        <h2 className="font-title text-[15px] font-normal uppercase tracking-[.06em]">Playlist Creator</h2>
        <button
          type="button"
          title="New playlist"
          aria-label="New playlist"
          onClick={() => void newPlaylist()}
          className="grid h-6 w-6 place-items-center border-2 border-sequel-silver text-lg leading-none"
        >
          +
        </button>
      </div>

      {!playlistId ? (
        <EmptyDrop forProject={!!routeProjectId} />
      ) : !data && !playlist.isPending ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-sequel-mid">
          <p>That playlist could not be found.</p>
          <p>Pick another on the Playlists tab.</p>
        </div>
      ) : !data ? (
        <div className="p-[18px] text-[13px] text-sequel-mid">Loading…</div>
      ) : (
        <>
          <div className="flex items-start gap-[10px] border-b border-sequel-line px-[18px] py-[14px]">
            <div className="min-w-0 flex-1">
              <input
                className="creator-title"
                value={title}
                aria-label="Playlist name"
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
              <small className="mt-[3px] block text-xs uppercase tracking-[.04em] text-sequel-mid">
                {plural(rows.length, 'track')} | {formatDuration(totalSeconds)}
              </small>
            </div>
            {editing ? (
              <button type="button" className="btn btn-tool btn-dark" onClick={() => setEditing(false)}>
                Done
              </button>
            ) : (
              <button type="button" className="btn btn-tool btn-outline" disabled={!dirty} onClick={saveTitle}>
                Save
              </button>
            )}
            <Menu
              label="⋮"
              title="Add section · Edit all · Attach to project · Duplicate · Delete"
              buttonClassName="px-2 py-[5px] text-lg leading-none"
              items={menuItems}
            />
          </div>

          {attaching && (
            <AttachPanel
              playlist={data}
              onClose={() => setAttaching(false)}
              onPick={(projectId) => {
                actions.updatePlaylist.mutate({ id: data.id, project_id: projectId })
                setAttaching(false)
              }}
            />
          )}

          <div className="min-h-0 flex-1 overflow-auto py-2">
            {data.video && (
              <>
                <SectionLabel name="Picture" count={1} />
                <div className="creator-track cursor-default">
                  <span className="secondary w-4 text-xs" />
                  <Artwork artworkKey={data.video.artwork_s3_key} kind="video" />
                  <span className="flex-1 truncate">{data.video.title}</span>
                  <span className="pill ml-0">video</span>
                  <button
                    type="button"
                    aria-label="Remove picture"
                    className="px-1 text-sequel-mid hover:text-inherit"
                    onClick={() => actions.updatePlaylist.mutate({ id: data.id, video_track_id: null })}
                  >
                    ×
                  </button>
                </div>
              </>
            )}

            <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              {grouped.map((g, gi) => (
                <Fragment key={g.section?.id ?? 'loose'}>
                  {g.section ? (
                    <SectionHeader
                      section={g.section}
                      count={g.rows.length}
                      editing={editing}
                      first={gi === 0}
                      last={gi === sections.length - 1}
                      onRename={(name) =>
                        actions.updateSection.mutate({ playlistId: data.id, id: g.section!.id, name })
                      }
                      onMove={(dir) => moveSection(g.section!, dir)}
                      onDelete={() => actions.deleteSection.mutate({ playlistId: data.id, id: g.section!.id })}
                    />
                  ) : (
                    sections.length > 0 && g.rows.length > 0 && <SectionLabel name="Tracks" count={g.rows.length} />
                  )}
                  {g.rows.map((row) => {
                    const index = queue.findIndex((q) => q.id === row.track_id)
                    return (
                      <CreatorTrack
                        key={row.id}
                        row={row}
                        number={numberOf.get(row.id) ?? 0}
                        editing={editing}
                        playing={player.isCurrent(row.track_id)}
                        onPlay={() => index >= 0 && player.play(queue, index)}
                        onRemove={() => remove(row)}
                      />
                    )
                  })}
                </Fragment>
              ))}
              <EndDrop empty={rows.length === 0} />
            </SortableContext>
            {notice && <div className="px-[18px] py-2 text-[13px] text-sequel-mid">{notice}</div>}
          </div>

          {picking && (
            <PicturePicker
              projectId={data.project_id}
              currentId={data.video_track_id}
              onClose={() => setPicking(false)}
              onPick={(trackId) => {
                actions.updatePlaylist.mutate({ id: data.id, video_track_id: trackId })
                setPicking(false)
              }}
            />
          )}

          <div className="grid grid-cols-2 gap-2 border-t border-sequel-line px-[18px] py-[14px]">
            <button type="button" className="btn btn-tool btn-dark" onClick={() => void share()}>
              {copied ? 'Copied' : 'Share'}
            </button>
            <button type="button" className="btn btn-tool btn-outline" disabled title="Themes arrive with the viewer page">
              Theme
            </button>
            <button type="button" className="btn btn-tool btn-outline" onClick={() => setPicking((v) => !v)}>
              Add picture
            </button>
            <a
              className="btn btn-tool btn-quiet"
              href={`/p/${data.token}`}
              target="_blank"
              rel="noreferrer"
            >
              Preview as client
            </a>
            <div className="col-span-2 flex items-center justify-between pt-1 text-[13px] text-sequel-mid">
              <span>Visible to client in Sequel Track</span>
              <Switch
                label="Visible to client in Sequel Track"
                checked={data.visible_to_client}
                onChange={(v) => actions.updatePlaylist.mutate({ id: data.id, visible_to_client: v })}
              />
            </div>
            <div className="col-span-2 flex items-center justify-between text-[13px] text-sequel-mid">
              <span>Sign-in required</span>
              <Switch
                label="Sign-in required"
                checked={data.require_sign_in}
                onChange={(v) => actions.updatePlaylist.mutate({ id: data.id, require_sign_in: v })}
              />
            </div>
          </div>
        </>
      )}
    </aside>
  )
}

// ---------------------------------------------------------------- pieces

function SectionLabel({ name, count }: { name: string; count: number }) {
  return (
    <div className="flex justify-between px-[18px] pb-1 pt-[10px] text-xs text-sequel-mid">
      <span>{name}</span>
      <span>{count}</span>
    </div>
  )
}

function SectionHeader({
  section,
  count,
  editing,
  first,
  last,
  onRename,
  onMove,
  onDelete,
}: {
  section: Section
  count: number
  editing: boolean
  first: boolean
  last: boolean
  onRename: (name: string) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `section:${section.id}`,
    data: { type: 'section', sectionId: section.id },
  })
  const [name, setName] = useState(section.name)
  useEffect(() => setName(section.name), [section.name])

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center justify-between gap-2 px-[18px] pb-1 pt-[10px] text-xs text-sequel-mid ${
        isOver ? 'bg-sequel-well' : ''
      }`}
    >
      {editing ? (
        <>
          <input
            className="field-boxed py-0.5! text-xs!"
            value={name}
            aria-label="Section name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== section.name && onRename(name.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
          <button type="button" disabled={first} onClick={() => onMove(-1)} aria-label="Move section up" className="disabled:opacity-30">
            ↑
          </button>
          <button type="button" disabled={last} onClick={() => onMove(1)} aria-label="Move section down" className="disabled:opacity-30">
            ↓
          </button>
          <button type="button" onClick={onDelete} aria-label="Delete section">
            ×
          </button>
        </>
      ) : (
        <>
          <span>{section.name}</span>
          <span>{count}</span>
        </>
      )}
    </div>
  )
}

function CreatorTrack({
  row,
  number,
  editing,
  playing,
  onPlay,
  onRemove,
}: {
  row: Row
  number: number
  editing: boolean
  playing: boolean
  onPlay: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: row.id,
    data: { type: 'pt', pt: row },
  })
  const track = row.track
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onPlay}
      className={`creator-track ${isOver ? 'is-over' : ''} ${isDragging ? 'opacity-40' : ''} ${
        playing ? 'bg-sequel-playing' : ''
      }`}
    >
      <span className="secondary w-4 text-xs">{number}</span>
      <Artwork artworkKey={track?.artwork_s3_key ?? null} kind={track?.kind ?? 'audio'} />
      <span className="flex-1 truncate">{track?.title ?? 'Missing track'}</span>
      {track?.kind === 'video' && <span className="pill ml-0">video</span>}
      {editing && (
        <button
          type="button"
          aria-label="Remove from playlist"
          className="px-1 text-sequel-mid hover:text-inherit"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}

function EmptyDrop({ forProject }: { forProject: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'creator-empty', data: { type: 'end' } })
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[13px] ${
        isOver ? 'bg-sequel-well text-sequel-ink' : 'text-sequel-mid'
      }`}
    >
      <p>No playlist open.</p>
      <p>
        Press + to start one{forProject ? ' for this project' : ''}, drop a track here to start
        one, or pick one on the Playlists tab.
      </p>
    </div>
  )
}

function EndDrop({ empty }: { empty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'creator-end', data: { type: 'end' } })
  return (
    <div
      ref={setNodeRef}
      className={`mx-[18px] my-[10px] border border-dashed p-4 text-center text-[13px] ${
        isOver ? 'border-sequel-brown text-sequel-ink' : 'border-sequel-grey text-sequel-mid'
      }`}
    >
      {empty ? 'Drag tracks here from the inbox or the library' : 'Drop tracks here'}
    </div>
  )
}

function PicturePicker({
  projectId,
  currentId,
  onClose,
  onPick,
}: {
  projectId: string | null
  currentId: string | null
  onClose: () => void
  onPick: (trackId: string) => void
}) {
  const tracks = useProjectTracks(projectId)
  const videos = (tracks.data ?? []).filter((t) => t.kind === 'video')
  return (
    <div className="border-t border-sequel-line px-[18px] py-3 text-[13px]">
      <div className="mb-2 flex items-center justify-between text-sequel-mid">
        <span>Pick the picture</span>
        <button type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {!projectId ? (
        <p className="text-sequel-mid">Attach this playlist to a project first — pictures come from a project.</p>
      ) : videos.length === 0 ? (
        <p className="text-sequel-mid">
          No video in this project yet. Drop one on the inbox link, or send it from Track's assets.
        </p>
      ) : (
        <ul>
          {videos.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onPick(v.id)}
                className={`flex w-full items-center gap-2 py-1 text-left hover:text-sequel-brown ${
                  v.id === currentId ? 'font-medium' : ''
                }`}
              >
                <Artwork artworkKey={v.artwork_s3_key} kind="video" className="h-7! w-7!" />
                <span className="truncate">{v.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AttachPanel({
  playlist,
  onClose,
  onPick,
}: {
  playlist: PlaylistDetail
  onClose: () => void
  onPick: (projectId: string | null) => void
}) {
  const projects = useProjects()
  return (
    <div className="border-b border-sequel-line px-[18px] py-3 text-[13px]">
      <div className="mb-2 flex items-center justify-between text-sequel-mid">
        <span>Attach to project</span>
        <button type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <select
        className="field-boxed"
        value={playlist.project_id ?? ''}
        onChange={(e) => onPick(e.target.value || null)}
      >
        <option value="">Not attached</option>
        {(projects.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  )
}
