import { useQueryClient } from '@tanstack/react-query'
import { useDroppable, type DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMatch } from 'react-router-dom'
import { useCreator } from '../../lib/creator'
import type { Tables } from '../../lib/database.types'
import { formatDuration, plural } from '../../lib/format'
import { toPlayerTrack, usePlayer, type PlayerTrack } from '../../lib/player'
import {
  type PlaylistDetail,
  type Track,
  type TrackWithUse,
  useDeleteTrack,
  useLibraryTracks,
  usePlaylist,
  usePlaylistActions,
  usePlaylists,
  useProjectSearch,
  useProjectTracks,
} from '../../lib/queries'
import { filesFromDrop, isMediaFile } from '../../lib/dropFiles'
import { readTagsAll, type FileTags } from '../../lib/tags'
import { supabase } from '../../lib/supabase'
import { contentTypeFor, putToS3, signUploadAsStaff } from '../../lib/upload'
import { runQueue } from '../../lib/uploadQueue'
import { useSession } from '../../lib/auth'
import Artwork from './Artwork'
import Confirm from './Confirm'
import { MenuIcon, TrashIcon, UploadFileIcon } from './icons'
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

/** A file on its way to S3, shown in the Creator while it goes. */
type Upload = {
  id: string
  file: File
  name: string
  progress: number
  error: string | null
}

const PARALLEL_UPLOADS = 4

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
    [...playlist.playlist_sections]
      .sort((a, b) => a.position - b.position)
      .map((s, i) => [s.id, i]),
  )
  const rankOf = (r: { section_id: string | null }) =>
    r.section_id != null && rank.has(r.section_id)
      ? rank.get(r.section_id)!
      : Number.MAX_SAFE_INTEGER
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
    r.section_id != null && rank.has(r.section_id)
      ? rank.get(r.section_id)!
      : Number.MAX_SAFE_INTEGER
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
  const removeTrack = useDeleteTrack()
  const player = usePlayer()
  const qc = useQueryClient()

  const [rows, setRows] = useState<Row[]>([])
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [addingTracks, setAddingTracks] = useState(false)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [fileOver, setFileOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  // The id of a playlist this panel just made, so its name can be put up
  // for typing the moment it loads. A ref, not state: nothing renders
  // differently because of it.
  const nameOnArrival = useRef<string | null>(null)
  const session = useSession()
  const [attaching, setAttaching] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [destroying, setDestroying] = useState(false)
  const [deletingTrack, setDeletingTrack] = useState<Track | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const data = playlist.data ?? null
  const sections = useMemo(
    () =>
      [...(data?.playlist_sections ?? [])].sort(
        (a, b) => a.position - b.position,
      ),
    [data],
  )

  // Server truth resets the local order whenever it arrives.
  useEffect(() => {
    setRows(data ? sortRows(data) : [])
    setTitle(data?.name ?? '')
    setEditing(false)
    setPicking(false)
    setAttaching(false)
    setAddingTracks(false)

    // A playlist this panel just made: put its name up for typing, whole,
    // so the first keystroke replaces "New playlist" rather than appending
    // to it.
    if (data && nameOnArrival.current === data.id) {
      nameOnArrival.current = null
      titleInput.current?.select()
    }
  }, [data])

  // Scoped to the project on screen: arriving at a project shows its latest
  // playlist unless the one already open belongs to it.
  useEffect(() => {
    if (!routeProjectId || !projectPlaylists.data) return
    if (playlistId && playlist.isPending) return
    const openBelongs = data?.project_id === routeProjectId
    if (openBelongs) return
    open(projectPlaylists.data[0]?.id ?? null)
  }, [
    routeProjectId,
    projectPlaylists.data,
    playlistId,
    playlist.isPending,
    data,
    open,
  ])

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
          pid = await actions.createPlaylist.mutateAsync({
            projectId: routeProjectId,
          })
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
            base.findIndex((r) => r.id === moving.id) <
              base.findIndex((r) => r.id === o.pt.id)
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
        actions.persistOrder.mutate(
          {
            playlistId: pid,
            rows: normalised.map(({ id, track_id, section_id, position }) => ({
              id,
              track_id,
              section_id,
              position,
            })),
          },
          {
            onError: (err) =>
              setNotice(
                err instanceof Error
                  ? `Not saved — ${err.message}`
                  : 'Not saved',
              ),
          },
        )
      })()
    },
    [rows, sections, playlistId, routeProjectId, actions, open],
  )

  useEffect(() => {
    setDropHandler(onDrop)
    return () => setDropHandler(null)
  }, [onDrop, setDropHandler])

  /** Append a track to the end — what clicking a track in the picker does. */
  const addTrack = useCallback(
    async (track: TrackWithUse) => {
      let pid = playlistId
      let base = rows
      let secs = sections
      if (!pid) {
        pid = await actions.createPlaylist.mutateAsync({
          projectId: routeProjectId,
        })
        open(pid)
        base = []
        secs = []
      }
      if (base.some((r) => r.track_id === track.id)) {
        setNotice('Already in this playlist')
        return
      }
      const normalised = normalise(
        [
          ...base,
          {
            id: crypto.randomUUID(),
            track_id: track.id,
            section_id: secs[secs.length - 1]?.id ?? null,
            position: base.length,
            track,
          },
        ],
        secs,
      )
      setRows(normalised)
      actions.persistOrder.mutate(
        {
          playlistId: pid,
          rows: normalised.map(({ id, track_id, section_id, position }) => ({
            id,
            track_id,
            section_id,
            position,
          })),
        },
        {
          onError: (err) =>
            setNotice(
              err instanceof Error ? `Not saved — ${err.message}` : 'Not saved',
            ),
        },
      )
    },
    [rows, sections, playlistId, routeProjectId, actions, open],
  )

  /**
   * Files straight off the desktop, into this playlist.
   *
   * Same three steps as the partner inbox — presign, PUT to S3, then write the
   * row — so a failed upload still leaves no orphan track, and the same Lambda
   * picks the object up and renders the preview and peaks. The difference is
   * only the authorisation: staff have a session rather than an inbox token,
   * so the project is named explicitly.
   */
  const uploadFiles = useCallback(
    async (files: File[]) => {
      const media = files.filter(isMediaFile)
      if (media.length === 0) return

      let pid = playlistId
      if (!pid) {
        pid = await actions.createPlaylist.mutateAsync({
          projectId: routeProjectId,
        })
        open(pid)
      }
      // A playlist attached to a project puts its uploads in that project; one
      // that is not gives them no project at all, which is a real state — the
      // track lives in the library and in this playlist, and in no inbox.
      const projectId = data?.project_id ?? routeProjectId ?? null

      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        setNotice('Your session has expired. Sign in again.')
        return
      }

      const queued: Upload[] = media.map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        progress: 0,
        error: null,
      }))
      setUploads((u) => [...u, ...queued])

      // A first pass at the tags so the row is not called "04 bounce final".
      // The Lambda re-reads the file and overwrites all of it. readTagsAll
      // reports per file rather than returning, so they are collected here.
      const tags: (FileTags | null)[] = media.map(() => null)
      await readTagsAll(media, (index, t) => {
        tags[index] = t
      })
      const submissionId = crypto.randomUUID()
      const who = session?.user.email ?? 'Sequel'

      await runQueue(
        queued.map((q) => q.id),
        async (id) => {
          const item = queued.find((q) => q.id === id)!
          const index = media.indexOf(item.file)
          const patch = (next: Partial<Upload>) =>
            setUploads((u) =>
              u.map((x) => (x.id === id ? { ...x, ...next } : x)),
            )
          try {
            const signed = await signUploadAsStaff(
              item.file,
              projectId,
              accessToken,
            )
            await putToS3(signed.upload_url, item.file, (progress) =>
              patch({ progress }),
            )

            const contentType = contentTypeFor(item.file)
            const t = tags[index] ?? null
            const { error } = await supabase.from('tracks').insert({
              id: signed.track_id,
              project_id: signed.project_id,
              s3_key: signed.key,
              original_filename: item.file.name,
              mime_type: contentType,
              size_bytes: item.file.size,
              kind: contentType.startsWith('video/') ? 'video' : 'audio',
              title: t?.title ?? item.file.name,
              artist: t?.artist ?? null,
              album: t?.album ?? null,
              bpm: t?.bpm ?? null,
              musical_key: t?.musical_key ?? null,
              duration_seconds: t?.duration_seconds ?? null,
              // Staff uploads are not a partner drop, and saying so keeps the
              // inbox honest about where a track came from.
              submitter_name: who,
              submitter_email: session?.user.email ?? null,
              submitter_company: 'Sequel',
              submission_id: submissionId,
            })
            if (error) throw error

            await addTrack({
              id: signed.track_id,
              project_id: signed.project_id,
              kind: contentType.startsWith('video/') ? 'video' : 'audio',
              title: t?.title ?? item.file.name,
              artist: t?.artist ?? null,
              album: t?.album ?? null,
              composer: null,
              publisher: null,
              label: null,
              genre: null,
              bpm: t?.bpm ?? null,
              musical_key: t?.musical_key ?? null,
              isrc: null,
              staff_notes: null,
              duration_seconds: t?.duration_seconds ?? null,
              preview_key: null,
              artwork_s3_key: null,
              processing_status: 'pending',
              submitter_name: who,
              submitter_email: session?.user.email ?? null,
              submitter_company: 'Sequel',
              notes: null,
              submission_id: submissionId,
              share_token: '',
              created_at: new Date().toISOString(),
              playlist_tracks: [],
            })
            setUploads((u) => u.filter((x) => x.id !== id))
          } catch (err) {
            patch({
              error: err instanceof Error ? err.message : 'Upload failed',
            })
          }
        },
        PARALLEL_UPLOADS,
      )
      void qc.invalidateQueries({ queryKey: ['tracks'] })
    },
    [playlistId, routeProjectId, data, actions, open, addTrack, session, qc],
  )

  // ------------------------------------------------------------ derived

  const grouped = useMemo(() => {
    const groups: { section: Section | null; rows: Row[] }[] = sections.map(
      (s) => ({
        section: s,
        rows: rows.filter((r) => r.section_id === s.id),
      }),
    )
    const loose = rows.filter(
      (r) => !r.section_id || !sections.some((s) => s.id === r.section_id),
    )
    if (loose.length > 0 || sections.length === 0)
      groups.push({ section: null, rows: loose })
    return groups
  }, [rows, sections])

  const queue = useMemo<PlayerTrack[]>(
    () => rows.filter((r) => r.track).map((r) => toPlayerTrack(r.track!)),
    [rows],
  )
  const totalSeconds = rows.reduce(
    (sum, r) => sum + (r.track?.duration_seconds ?? 0),
    0,
  )
  const dirty = !!data && title.trim() !== data.name && title.trim() !== ''

  // ------------------------------------------------------------ actions

  // Renaming saves when the field is left, or on Enter, like everything else
  // in this panel. There is no Save button: to click one you have to leave
  // the field first, which saved it — so it was never clickable when it had
  // anything to do. A note in its place says the rename landed.
  const saveTitle = () => {
    if (!data || !dirty) return
    actions.updatePlaylist.mutate({ id: data.id, name: title.trim() })
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  const newPlaylist = async () => {
    const id = await actions.createPlaylist.mutateAsync({
      projectId: routeProjectId,
    })
    // Naming it is the first thing you do — you would rather the list read
    // as itself in the column on the left before tracks start landing in
    // it. So the name is selected and waiting, not something to go and
    // click on afterwards.
    nameOnArrival.current = id
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

  const destroy = () => {
    if (!data) return
    setDestroying(true)
  }

  const duplicate = async () => {
    if (!data) return
    const id = await actions.duplicatePlaylist.mutateAsync(data)
    open(id)
  }

  const menuItems = [
    { label: 'Upload files…', onSelect: () => fileInput.current?.click() },
    {
      label: 'Add from library…',
      onSelect: () => setAddingTracks(true),
      disabled: !data,
    },
    {
      label: 'Add section',
      onSelect: () => void addSection(),
      disabled: !data,
    },
    {
      label: editing ? 'Done editing' : 'Edit all',
      onSelect: () => setEditing((v) => !v),
      disabled: !data,
    },
    {
      label: 'Attach to project…',
      onSelect: () => setAttaching(true),
      disabled: !data,
    },
    { label: 'Duplicate', onSelect: () => void duplicate(), disabled: !data },
    { label: 'Delete', onSelect: destroy, disabled: !data, danger: true },
  ]

  // Running number across sections, computed once per render.
  const numberOf = new Map(rows.map((r, i) => [r.id, i + 1]))

  return (
    <aside
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setFileOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setFileOver(false)
      }}
      onDrop={async (e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setFileOver(false)
        await uploadFiles(await filesFromDrop(e.dataTransfer))
      }}
      className={`relative flex h-full w-96 min-h-0 flex-col overflow-hidden bg-sequel-silver ${
        fileOver
          ? 'outline outline-2 -outline-offset-2 outline-sequel-brown'
          : ''
      }`}
    >
      {/* One input for both the drop zones and the menu item. */}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => {
          void uploadFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <div className="flex items-center justify-between bg-sequel-brown px-[18px] py-[14px] text-sequel-silver">
        {/* Regular, not the 600 the bar asked for until today — that only
            ever rendered as Regular anyway, because Regular was the one
            face Fahkwang had. Now that the other five exist, the value has
            to say what was always on screen. */}
        <h2 className="font-title text-[15px] font-normal uppercase tracking-[.06em]">
          Playlister
        </h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            title="New playlist"
            aria-label="New playlist"
            onClick={() => void newPlaylist()}
            className="grid h-6 w-6 place-items-center border-2 border-sequel-silver text-lg leading-none"
          >
            +
          </button>
          {/* Puts the panel back to "No playlist open". The handle on the
              edge only hides the panel; this is how you finish with a list
              without hiding the thing you build the next one in. */}
          {playlistId && (
            <button
              type="button"
              title="Close this playlist"
              aria-label="Close this playlist"
              onClick={() => open(null)}
              className="grid h-6 w-6 place-items-center text-xl leading-none"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {!playlistId ? (
        <EmptyDrop
          forProject={!!routeProjectId}
          onClick={() => fileInput.current?.click()}
        />
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
                ref={titleInput}
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
              <button
                type="button"
                className="btn btn-tool btn-dark"
                onClick={() => setEditing(false)}
              >
                Done
              </button>
            ) : (
              saved && (
                <span className="mt-[6px] shrink-0 font-mono text-[0.7rem] uppercase text-sequel-mid">
                  Saved
                </span>
              )
            )}
            <Menu
              label={<MenuIcon />}
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
                actions.updatePlaylist.mutate({
                  id: data.id,
                  project_id: projectId,
                })
                setAttaching(false)
              }}
            />
          )}

          <div className="min-h-0 flex-1 overflow-auto py-2">
            {data.video && (
              <>
                <SectionLabel name="Film" count={1} />
                <div className="creator-track cursor-default">
                  <span className="secondary w-4 text-xs" />
                  <Artwork
                    artworkKey={data.video.artwork_s3_key}
                    kind="video"
                  />
                  <span className="flex-1 truncate">{data.video.title}</span>
                  <button
                    type="button"
                    aria-label="Remove film"
                    className="px-1 text-sequel-mid hover:text-inherit"
                    onClick={() =>
                      actions.updatePlaylist.mutate({
                        id: data.id,
                        video_track_id: null,
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              </>
            )}

            <SortableContext
              items={rows.map((r) => r.id)}
              strategy={verticalListSortingStrategy}
            >
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
                        actions.updateSection.mutate({
                          playlistId: data.id,
                          id: g.section!.id,
                          name,
                        })
                      }
                      onMove={(dir) => moveSection(g.section!, dir)}
                      onDelete={() =>
                        actions.deleteSection.mutate({
                          playlistId: data.id,
                          id: g.section!.id,
                        })
                      }
                    />
                  ) : (
                    sections.length > 0 &&
                    g.rows.length > 0 && (
                      <SectionLabel name="Tracks" count={g.rows.length} />
                    )
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
                        onDeleteTrack={() =>
                          row.track && setDeletingTrack(row.track)
                        }
                      />
                    )
                  })}
                </Fragment>
              ))}
              <EndDrop
                empty={rows.length === 0}
                onClick={() => fileInput.current?.click()}
              />
            </SortableContext>
            {uploads.length > 0 && (
              <ul className="border-t border-sequel-line px-[18px] py-2 text-[13px]">
                {uploads.map((u) => (
                  <li key={u.id} className="py-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">{u.name}</span>
                      <span className="shrink-0 tabular-nums text-sequel-mid">
                        {u.error ? 'failed' : `${u.progress}%`}
                      </span>
                    </div>
                    {u.error ? (
                      <p className="form-error">{u.error}</p>
                    ) : (
                      <div className="mt-1 h-[2px] bg-sequel-brown/15">
                        <div
                          className="h-full bg-sequel-brown transition-[width]"
                          style={{ width: `${u.progress}%` }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {notice && (
              <div className="px-[18px] py-2 text-[13px] text-sequel-mid">
                {notice}
              </div>
            )}
          </div>

          {addingTracks && (
            <TrackPicker
              projectId={data.project_id}
              chosen={new Set(rows.map((r) => r.track_id))}
              onClose={() => setAddingTracks(false)}
              onPick={(t) => void addTrack(t)}
            />
          )}

          {picking && (
            <PicturePicker
              projectId={data.project_id}
              currentId={data.video_track_id}
              onClose={() => setPicking(false)}
              onPick={(trackId) => {
                actions.updatePlaylist.mutate({
                  id: data.id,
                  video_track_id: trackId,
                })
                setPicking(false)
              }}
            />
          )}

          <div className="grid grid-cols-2 gap-2 border-t border-sequel-line px-[18px] py-[14px]">
            <button
              type="button"
              className="btn btn-tool btn-dark"
              onClick={() => void share()}
            >
              {copied ? 'Copied' : 'Share'}
            </button>
            <button
              type="button"
              className="btn btn-tool btn-outline"
              disabled
              title="Themes arrive with the viewer page"
            >
              Theme
            </button>
            <button
              type="button"
              className="btn btn-tool btn-outline"
              onClick={() => setPicking((v) => !v)}
            >
              Add film
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
                onChange={(v) =>
                  actions.updatePlaylist.mutate({
                    id: data.id,
                    visible_to_client: v,
                  })
                }
              />
            </div>
            <div className="col-span-2 flex items-center justify-between text-[13px] text-sequel-mid">
              <span>Sign-in required</span>
              <Switch
                label="Sign-in required"
                checked={data.require_sign_in}
                onChange={(v) =>
                  actions.updatePlaylist.mutate({
                    id: data.id,
                    require_sign_in: v,
                  })
                }
              />
            </div>
          </div>
        </>
      )}
      {deletingTrack && (
        <Confirm
          title={`Delete “${deletingTrack.title}”?`}
          body="The audio, preview and artwork are removed from storage as well, and it comes out of every playlist it is in — not just this one."
          confirmLabel="Delete track"
          onConfirm={() => {
            const id = deletingTrack.id
            setDeletingTrack(null)
            removeTrack.mutate(id)
          }}
          onCancel={() => setDeletingTrack(null)}
        />
      )}
      {destroying && data && (
        <Confirm
          title={`Delete “${data.name}”?`}
          body="Viewers holding the link will lose access. The tracks themselves stay where they are."
          confirmLabel="Delete playlist"
          onConfirm={async () => {
            setDestroying(false)
            await actions.deletePlaylist.mutateAsync(data.id)
            open(null)
          }}
          onCancel={() => setDestroying(false)}
        />
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
            onBlur={() =>
              name.trim() &&
              name.trim() !== section.name &&
              onRename(name.trim())
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
          <button
            type="button"
            disabled={first}
            onClick={() => onMove(-1)}
            aria-label="Move section up"
            className="disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={last}
            onClick={() => onMove(1)}
            aria-label="Move section down"
            className="disabled:opacity-30"
          >
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
  onDeleteTrack,
}: {
  row: Row
  number: number
  editing: boolean
  playing: boolean
  onPlay: () => void
  onRemove: () => void
  onDeleteTrack: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
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
      className={`creator-track group/row ${isOver ? 'is-over' : ''} ${isDragging ? 'opacity-40' : ''} ${
        playing ? 'bg-sequel-playing' : ''
      }`}
    >
      <span className="secondary w-4 text-xs">{number}</span>
      <Artwork
        artworkKey={track?.artwork_s3_key ?? null}
        kind={track?.kind ?? 'audio'}
      />
      {/* No "video" tag: the artwork block already renders brown for a film,
          so the label said the same thing a second time, on the rows with
          the least width to spare. */}
      <span className="flex-1 truncate">{track?.title ?? 'Missing track'}</span>
      {/* One control per state, not two side by side. Taking a track out of
          a list is curation, which is what Edit all is for and where the ×
          has always lived. Deleting the track is the thing you reach for
          the moment after dropping the wrong file, so that is what a plain
          hover offers. */}
      {editing ? (
        <button
          type="button"
          aria-label="Remove from playlist"
          title="Remove from this playlist"
          className="shrink-0 px-1 text-lg leading-none"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          ×
        </button>
      ) : (
        track && (
          <button
            type="button"
            aria-label="Delete track"
            title="Delete the track itself"
            className="icon-btn hidden shrink-0 group-hover/row:grid"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteTrack()
            }}
          >
            <TrashIcon />
          </button>
        )
      )}
    </div>
  )
}

function EmptyDrop({
  forProject,
  onClick,
}: {
  forProject: boolean
  onClick: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'creator-empty',
    data: { type: 'end' },
  })
  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={onClick}
      className="flex flex-1 cursor-pointer flex-col items-start p-[18px] text-[13px]"
    >
      {/* The same dashed target as the one at the foot of a playlist, so
          the panel asks for a file the same way whether it is holding a
          list or waiting for its first one. */}
      <span
        className={`flex w-full flex-col items-center justify-center gap-3 border border-dashed px-4 py-10 text-center ${
          isOver
            ? 'border-sequel-brown bg-sequel-well text-sequel-ink'
            : 'border-sequel-line text-sequel-mid'
        }`}
      >
        <UploadFileIcon size="1.5rem" />
        <span>
          Drag files here, or <span className="underline">click to upload</span>
        </span>
        <span className="text-sequel-mid">
          That starts a playlist{forProject ? ' for this project' : ''}. Press +
          for an empty one.
        </span>
      </span>
    </button>
  )
}

function EndDrop({ empty, onClick }: { empty: boolean; onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'creator-end',
    data: { type: 'end' },
  })
  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={onClick}
      className={`mx-[18px] my-[10px] flex w-[calc(100%-36px)] cursor-pointer flex-col items-center justify-center gap-3 border border-dashed px-4 py-10 text-center text-[13px] ${
        isOver
          ? 'border-sequel-brown bg-sequel-well text-sequel-ink'
          : 'border-sequel-line text-sequel-mid'
      }`}
    >
      <UploadFileIcon size="1.5rem" />
      <span>
        {empty ? 'Drag files here, or ' : 'Drag files or tracks here, or '}
        <span className="underline">click to upload</span>
      </span>
    </button>
  )
}

/**
 * Adds tracks without dragging. Scoped to the playlist's project when it has
 * one — that is where a supe is almost always picking from — and to the whole
 * library when it does not.
 */
function TrackPicker({
  projectId,
  chosen,
  onClose,
  onPick,
}: {
  projectId: string | null
  chosen: Set<string>
  onClose: () => void
  onPick: (track: TrackWithUse) => void
}) {
  const [term, setTerm] = useState('')
  const projectTracks = useProjectTracks(projectId)
  const libraryTracks = useLibraryTracks(projectId ? '' : term)

  const results = useMemo(() => {
    const needle = term.trim().toLowerCase()
    const source = projectId
      ? (projectTracks.data ?? [])
      : (libraryTracks.data ?? [])
    if (!projectId || !needle) return source.slice(0, 100)
    return source
      .filter((t) =>
        [t.title, t.artist, t.album, t.submitter_company]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(needle)),
      )
      .slice(0, 100)
  }, [term, projectId, projectTracks.data, libraryTracks.data])

  const pending = projectId ? projectTracks.isPending : libraryTracks.isPending

  return (
    <div className="border-t border-sequel-line px-[18px] py-3 text-[13px]">
      <div className="mb-2 flex items-center justify-between text-sequel-mid">
        <span>
          {projectId ? 'Add from this project' : 'Add from the library'}
        </span>
        <button type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <input
        type="search"
        autoFocus
        className="field-boxed"
        placeholder="Title, artist, album or partner"
        aria-label="Search tracks"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      <ul className="mt-2 max-h-64 overflow-auto">
        {pending && <li className="py-1 text-sequel-mid">Loading…</li>}
        {!pending && results.length === 0 && (
          <li className="py-1 text-sequel-mid">Nothing matches.</li>
        )}
        {results.map((t) => {
          const already = chosen.has(t.id)
          return (
            <li key={t.id}>
              <button
                type="button"
                disabled={already}
                onClick={() => onPick(t)}
                className="flex w-full items-center gap-2 py-1 text-left hover:text-sequel-brown disabled:opacity-40"
              >
                <Artwork
                  artworkKey={t.artwork_s3_key}
                  kind={t.kind}
                  className="h-7! w-7!"
                />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                {already && (
                  <span className="shrink-0 text-sequel-mid">added</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
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
        <span>Pick the film</span>
        <button type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {!projectId ? (
        <p className="text-sequel-mid">
          Attach this playlist to a project first — films come from a project.
        </p>
      ) : videos.length === 0 ? (
        <p className="text-sequel-mid">
          No film in this project yet. Drop one on the inbox link, or send it
          from Track's assets.
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
                <Artwork
                  artworkKey={v.artwork_s3_key}
                  kind="video"
                  className="h-7! w-7!"
                />
                <span className="truncate">{v.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * A search, not a select. There will be thousands of projects, and a dropdown
 * would have to hold every one of them to be usable; this asks the database
 * for the twenty that match what has been typed.
 */
function AttachPanel({
  playlist,
  onClose,
  onPick,
}: {
  playlist: PlaylistDetail
  onClose: () => void
  onPick: (projectId: string | null) => void
}) {
  const [term, setTerm] = useState('')
  const projects = useProjectSearch(term)
  return (
    <div className="border-b border-sequel-line px-[18px] py-3 text-[13px]">
      <div className="mb-2 flex items-center justify-between text-sequel-mid">
        <span>Attach to project</span>
        <button type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <input
        type="search"
        autoFocus
        className="field-boxed"
        placeholder="Search projects"
        aria-label="Search projects"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      <ul className="mt-2 max-h-56 overflow-auto">
        {playlist.project_id && (
          <li>
            <button
              type="button"
              onClick={() => onPick(null)}
              className="w-full py-1 text-left text-sequel-mid hover:text-sequel-brown"
            >
              Detach from {playlist.projects_mirror?.name ?? 'its project'}
            </button>
          </li>
        )}
        {projects.isPending && (
          <li className="py-1 text-sequel-mid">Searching…</li>
        )}
        {projects.data?.length === 0 && (
          <li className="py-1 text-sequel-mid">Nothing matches.</li>
        )}
        {(projects.data ?? []).map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p.id)}
              className={`flex w-full items-baseline gap-2 py-1 text-left hover:text-sequel-brown ${
                p.id === playlist.project_id ? 'font-medium' : ''
              }`}
            >
              <span className="sentence-case truncate">{p.name}</span>
              {p.client_name && (
                <span className="truncate text-sequel-mid">
                  {p.client_name}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
