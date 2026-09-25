import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { useSongs, type SequelSong } from '../lib/xanoMirror'

/**
 * Sequel Track's `/songs`, rebuilt from the page.
 *
 * The songs Sequel composed for a client, which is also the list the PRS
 * registrations are worked from — hence the second tile.
 *
 * Two things to know about how Track does it:
 *
 *  1. **The search diverges from Track, deliberately.** Track puts the match
 *     in each row's visibility rule, over the serialised record, so it also
 *     searches the CAE numbers, the agreement number and the notes — and a
 *     single digit matches almost every song. `/users` matches named fields
 *     instead and its Xano comment says why; this follows `/users`, over the
 *     four columns the row shows plus the project and the Schedule A status.
 *
 *     What is reproduced is the second half of Track's behaviour: the counters
 *     still never move, because they read the whole list rather than what is
 *     on screen.
 *  2. **Both counters are totals.** Tracks is every active song; Awaiting
 *     Registration is the Unregistered ones. Neither follows the search.
 *
 * The order is new on both sides: Get_songs had no sort at all until 13 Sep,
 * so it returned heap order. It now sorts by Track_Title, and this matches it
 * byte for byte — Xano compares by byte, so "FTW" comes before "Featherlight".
 *
 * Read-only. The share and delete marks are drawn and inert.
 */

function ShareIcon() {
  return (
    <svg
      width="1rem"
      height="1rem"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg width="1rem" height="1rem" viewBox="0 0 40 40" fill="currentColor" aria-hidden="true">
      <path d="M21.499 19.994L32.755 8.727a1.064 1.064 0 0 0-.001-1.502c-.398-.396-1.099-.398-1.501.002L20 18.494L8.743 7.224c-.4-.395-1.101-.393-1.499.002a1.05 1.05 0 0 0-.309.751c0 .284.11.55.309.747L18.5 19.993L7.245 31.263a1.064 1.064 0 0 0 .003 1.503c.193.191.466.301.748.301h.006c.283-.001.556-.112.745-.305L20 21.495l11.257 11.27c.199.198.465.308.747.308a1.06 1.06 0 0 0 1.061-1.061c0-.283-.11-.55-.31-.747z" />
    </svg>
  )
}

export default function Songs() {
  const songs = useSongs()
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  const all = useMemo(() => songs.data ?? [], [songs.data])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return all
    return all.filter((s: SequelSong) =>
      [
        s.track_title,
        s.composer,
        s.brand,
        s.registration_status,
        s.project,
        s.schedule_a_status,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [all, q])

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Composition</div>
        <div className="title-row">
          {/* Webflow's source text is "SOngs". The class uppercases it, so
              nobody has ever seen the stray capital. */}
          <h1 className="page-title">Songs</h1>
        </div>
        <div className="page-subtitle">Manage our tracks</div>
      </div>

      <div className="tab-band">
        <div className="tab-band-search is-narrow">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search songs"
            className="project-search"
          />
        </div>
        <div className="tab-band-divider" />
        {/* Off `all`, not `rows`: neither counter moves with the search. */}
        <div className="stat">
          <span className="stat-label">Tracks</span>
          <span className="stat-value">{all.length}</span>
        </div>
        <div className="tab-band-divider" />
        <div className="stat">
          <span className="stat-label">Awaiting Registration</span>
          <span className="stat-value">
            {all.filter((s) => s.registration_status === 'Unregistered').length}
          </span>
        </div>
      </div>

      {/* song_titles_wrap: this page has column headings where the directory
          pages have none. Same grid as the rows, so the two cannot drift. */}
      <div className="song-list-grid song-list-head">
        <span className="project-list-head-cell">Name</span>
        <span className="project-list-head-cell">Composer</span>
        <span className="project-list-head-cell">Brand</span>
        <span className="project-list-head-cell">Status</span>
        <span />
        <span />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {songs.isPending && (
          <Loader />
        )}
        {songs.error && <p className="form-error px-8 py-4">{songs.error.message}</p>}

        {songs.data &&
          rows.map((s) => (
            <div
              key={s.id}
              className="song-list-grid song-list-row"
              onClick={() => navigate(`/songs/${s.uuid}`)}
            >
              <span className="row-title" title={s.track_title ?? undefined}>
                {s.track_title}
              </span>
              {/* The row's own Composer text, which is what Track's column
                  binds to — not the supplier the song is joined to, though on
                  every row today they agree. */}
              <span className="row-field">{s.composer}</span>
              <span className="row-field">{s.brand}</span>
              {/* .row-field, not .row-type: Webflow gives this cell
                  project-row-field on the songs row, where the clients,
                  partners and roster rows use text-block-50 for their fourth
                  column. Same-looking cell, different class, and a 1rem line
                  box rather than 0.8rem. */}
              <span className="row-field">{s.registration_status}</span>
              <span className="row-action is-inert" title="Share — not rebuilt yet">
                <ShareIcon />
              </span>
              <span className="row-action is-inert" title="Archive — not rebuilt yet">
                <ArchiveIcon />
              </span>
            </div>
          ))}

        {songs.data && rows.length === 0 && (
          <div className="no-result-row">No results found</div>
        )}
      </div>
    </>
  )
}
