import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Route, Routes } from 'react-router-dom'
import type { PlaylistDetail, PlaylistSummary, ProjectDetail, ProjectSummary, RecentProject, TrackWithUse } from '../lib/queries'
import Library from '../routes/Library'
import Playlists from '../routes/Playlists'
import Project from '../routes/Project'
import Projects from '../routes/Projects'
import StaffLayout from '../routes/StaffLayout'

/**
 * Dev-only. Staff sign-in needs an emailed code, so the shell cannot be
 * driven by an automated check against the live database. This mounts the
 * real components over a query cache seeded with the mockup's content, at
 * /__preview, and is compiled out of production builds.
 */

const P1 = 'p1'
const PL1 = 'pl1'
const PL2 = 'pl2'

let n = 0
function track(
  title: string,
  artist: string,
  album: string,
  seconds: number,
  sub: { id: string; company: string; email: string; name: string; at: string; note: string | null },
  inPlaylists: string[] = [],
  kind: 'audio' | 'video' = 'audio',
): TrackWithUse {
  n += 1
  return {
    id: `t${n}`,
    project_id: P1,
    kind,
    title,
    artist,
    album,
    composer: null,
    publisher: null,
    label: null,
    genre: null,
    bpm: null,
    musical_key: null,
    isrc: null,
    staff_notes: null,
    share_token: `share${n}`,
    duration_seconds: seconds,
    preview_key: null,
    artwork_s3_key: null,
    processing_status: 'ready',
    submitter_name: sub.name,
    submitter_email: sub.email,
    submitter_company: sub.company,
    notes: sub.note,
    submission_id: sub.id,
    created_at: sub.at,
    playlist_tracks: inPlaylists.map((playlist_id) => ({ playlist_id })),
  }
}

const cavendish = {
  id: 's1',
  company: 'Cavendish Music',
  email: 'jess.munro@cavendishmusic.com',
  name: 'Jess Munro',
  at: '2026-09-11T10:12:00Z',
  note: 'Two routes as discussed, B is the braver one',
}
const pink = { id: 's2', company: 'Pink Noise Studio', email: 'tom@pinknoise.co', name: 'Tom', at: '2026-09-10T15:40:00Z', note: null }
const bmg = { id: 's3', company: 'BMG Creative Synch', email: 'sam.h@bmg.com', name: 'Sam H', at: '2026-09-09T09:05:00Z', note: null }

const tracks: TrackWithUse[] = [
  track('WHIP STINGER A --- Killer vintage and raw Old School guitar riff', 'The Ricochets', 'Badass Rock', 62, cavendish, [PL1]),
  track('ENTER THE ZONE --- Instrumental hip hop groove with heavy bass', 'Bad Habit', 'Urban Grit', 134, cavendish, [PL1]),
  track('Slow Water', 'Marla Reyes', 'Blue Hours', 180, cavendish),
  track('Hockey Route 1 — Classic Rock A', 'Cavendish Studio', "Hellmann's search", 161, cavendish, [PL1, PL2]),
  track('Hockey Route 1 — Classic Rock B', 'Cavendish Studio', "Hellmann's search", 159, cavendish),
  track('Gutter Glam', 'Velvet Antler', 'Singles', 202, cavendish, [PL1]),
  track('Riff Raff Riot', 'The Ricochets', 'Badass Rock', 118, cavendish, [PL1]),
  track('Crunch Time', 'Dial Tone', 'Ad Cuts Vol. 4', 59, cavendish, [PL1]),
  track('Big Bite Boogie', 'Dial Tone', 'Ad Cuts Vol. 4', 64, cavendish, [PL1]),
  track('Spice Rack', 'Marla Reyes', 'Blue Hours', 167, cavendish),
  track('Loud Lunch', 'Bad Habit', 'Urban Grit', 125, cavendish),
  track('Salsa Static', 'Velvet Antler', 'Singles', 190, cavendish),
  ...Array.from({ length: 14 }, (_, i) => track(`Pink Noise cue ${i + 1}`, 'Pink Noise', 'Nachips demos', 90 + i * 7, pink)),
  ...Array.from({ length: 9 }, (_, i) => track(`BMG option ${i + 1}`, 'Various', 'BMG Production Music', 100 + i * 5, bmg)),
  track('260911 - NACHOS - OP2 fix2', '', '', 30, bmg, [PL1], 'video'),
  track('260910 - NACHIPS - OP1', '', '', 30, bmg, [PL1], 'video'),
]

const byTitle = (t: string) => tracks.find((x) => x.title.startsWith(t))!

const project: ProjectDetail = {
  id: P1,
  xano_id: '4821',
  xano_uuid: '0b7a1e2c-3d4f-4a5b-8c6d-7e8f9a0b1c2d',
  name: 'Nachips',
  client_name: 'Old El Paso · Hogarth',
  sequel_no: '256-OLD-26-II',
  status: 'active',
  brief: null,
  inboxes: { token: 'previewtoken', is_active: true },
}

const projectSummaries: ProjectSummary[] = [
  { id: P1, xano_id: '4821', name: 'Nachips', client_name: 'Old El Paso · Hogarth', sequel_no: '256-OLD-26-II', status: 'active', created_at: '2026-09-01', tracks: [{ count: tracks.length }], playlists: [{ count: 2 }] },
  { id: 'p2', xano_id: '4822', name: 'Bango Bisma', client_name: 'Bango', sequel_no: '61-COM-25-II', status: 'active', created_at: '2026-08-20', tracks: [{ count: 12 }], playlists: [{ count: 1 }] },
  { id: 'p3', xano_id: '4823', name: "Hellmann's Habs", client_name: 'Unilever · Ogilvy', sequel_no: '118-HEL-26-II', status: 'active', created_at: '2026-08-02', tracks: [{ count: 48 }], playlists: [{ count: 3 }] },
  { id: 'p4', xano_id: '4824', name: 'Flavour Unlocked', client_name: 'Knorr', sequel_no: '227-KNO-26-II', status: 'active', created_at: '2026-07-14', tracks: [{ count: 30 }], playlists: [{ count: 2 }] },
  { id: 'p5', xano_id: '4825', name: 'Sunsilk', client_name: 'Unilever', sequel_no: null, status: 'closed', created_at: '2026-06-01', tracks: [{ count: 7 }], playlists: [{ count: 0 }] },
]

const recent: RecentProject[] = [
  { id: P1, name: '256-OLD-26-II Nachips', hasNew: true },
  { id: 'p2', name: 'Bango Bisma', hasNew: false },
  { id: 'p3', name: "Hellmann's Habs", hasNew: false },
  { id: 'p4', name: '227-KNO-26-II Flavour Unlocked', hasNew: true },
  { id: 'p5', name: 'Sunsilk', hasNew: false },
]

const playlistBase = {
  description: null,
  is_active: true,
  expires_at: null,
  created_by: null,
  created_at: '2026-09-10T09:00:00Z',
  updated_at: '2026-09-11T12:00:00Z',
  video_track_id: null,
  require_sign_in: true,
  visible_to_client: false,
}

const playlists: PlaylistSummary[] = [
  { id: PL1, name: 'Nachips — Round 1', project_id: P1, token: 'tok1', ...playlistBase, playlist_tracks: [{ count: 8 }], projects_mirror: { id: P1, name: project.name } },
  { id: PL2, name: 'Nachips — hockey alts', project_id: P1, token: 'tok2', ...playlistBase, updated_at: '2026-09-09T12:00:00Z', playlist_tracks: [{ count: 1 }], projects_mirror: { id: P1, name: project.name } },
]

const sections = [
  { id: 'sec1', playlist_id: PL1, name: 'Hero options', position: 0, created_at: '' },
  { id: 'sec2', playlist_id: PL1, name: 'Alternates', position: 1, created_at: '' },
  { id: 'sec3', playlist_id: PL1, name: 'Picture', position: 2, created_at: '' },
]

const order: [string, string][] = [
  ['WHIP STINGER', 'sec1'],
  ['Riff Raff', 'sec1'],
  ['Gutter Glam', 'sec1'],
  ['ENTER THE ZONE', 'sec2'],
  ['Crunch Time', 'sec2'],
  ['Big Bite', 'sec2'],
  ['260911', 'sec3'],
  ['260910', 'sec3'],
]

const playlist: PlaylistDetail = {
  id: PL1,
  name: 'Nachips — Round 1',
  project_id: P1,
  token: 'tok1',
  ...playlistBase,
  playlist_sections: sections,
  playlist_tracks: order.map(([t, section_id], position) => {
    const tr = byTitle(t)
    return { id: `pt${position}`, playlist_id: PL1, track_id: tr.id, section_id, position, note: null, sync_offset_seconds: null, created_at: '', tracks: tr }
  }),
  projects_mirror: { id: P1, name: project.name },
  video: null,
}

// A plausible waveform for the first track, so the bar has something to draw.
const peaks = Array.from({ length: 4000 }, (_, i) => {
  const v = 0.15 + Math.abs(Math.sin(i / 60) * 0.5 + Math.sin(i / 23) * 0.25) + ((i * 7919) % 13) / 100
  return i % 2 === 0 ? -Math.min(1, v) : Math.min(1, v)
})

export default function Preview() {
  const client = useMemo(() => {
    // The Creator scopes itself to /projects/:id, which the preview prefix
    // hides from it, so the playlist is opened the way a returning visit is:
    // from the remembered id.
    try {
      localStorage.setItem('sequel.creator.playlist', PL1)
    } catch {
      // fine
    }
    const c = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } },
    })
    c.setQueryData(['projects'], projectSummaries)
    c.setQueryData(['project', P1], project)
    // A project nobody has sent anything to yet — /__preview/projects/p0 —
    // so the empty states are something you can look at rather than reason
    // about.
    c.setQueryData(['project', 'p0'], {
      ...project,
      id: 'p0',
      xano_id: '4830',
      name: 'Veggie Love',
      client_name: 'Knorr',
      sequel_no: '24-COM-25-II',
    })
    c.setQueryData(['tracks', 'project', 'p0'], [])
    c.setQueryData(['playlists', 'p0'], [])
    c.setQueryData(['tracks', 'project', P1], tracks)
    c.setQueryData(['tracks', 'library', ''], tracks)
    c.setQueryData(['playlists', 'all'], playlists)
    c.setQueryData(['playlists', P1], playlists)
    c.setQueryData(['playlist', PL1], playlist)
    c.setQueryData(['recent', undefined], recent)
    c.setQueryData(['peaks', tracks[0].id], peaks)
    // One track carries artwork so the dialog's picture state — the image,
    // and the × that clears it — can be looked at without a signed URL.
    const sleeve = (id: string, bg: string, fg: string) => {
      const key = `tracks/${id.repeat(8)}-0000-0000-0000-${id.repeat(12)}/artwork.jpg`
      c.setQueryData(
        ['media', key, null],
        'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">` +
              `<rect width="300" height="300" fill="${bg}"/>` +
              `<text x="150" y="185" font-size="140" font-style="italic" font-family="Georgia" fill="${fg}" text-anchor="middle">II</text>` +
              `</svg>`,
          ),
      )
      return key
    }
    // One dark sleeve and one light one, so the control that reads the corner
    // it sits on can be seen doing both.
    const darkArt = sleeve('0', '#372b29', '#c98a9a')
    const lightArt = sleeve('1', '#f1f0ee', '#372b29')

    // The details dialog fetches the full row per track; seed the ones the
    // fixture can open so the form is not stuck on "Loading…".
    for (const t of tracks) {
      c.setQueryData(['track-detail', t.id], {
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        composer: t.artist,
        publisher: null,
        label: null,
        grouping: null,
        genre: 'Rock',
        year: 2024,
        release_date: null,
        bpm: 120,
        musical_key: null,
        isrc: 'GB22P1705219',
        track_no: 1,
        disc_no: 1,
        // A real production-library comment, near enough: the ISRC, then a
        // couple of thousand characters of keywords. This is the field that
        // has to scroll.
        comments:
          'ISRC: GB22P1705219, ' +
          'Famous Popular Tunes Well Known Tunes - New Arrangements Classical Songs Famous '.repeat(
            12,
          ),
        staff_notes: null,
        artwork_s3_key: t === tracks[0] ? darkArt : t === tracks[1] ? lightArt : null,
      })
    }
    return c
  }, [])

  return (
    <QueryClientProvider client={client}>
      <Routes>
        <Route element={<StaffLayout />}>
          <Route index element={<Projects />} />
          <Route path="projects/:id" element={<Project />} />
          <Route path="playlists" element={<Playlists />} />
          <Route path="library" element={<Library />} />
        </Route>
      </Routes>
    </QueryClientProvider>
  )
}
