import Search from '../components/staff/Search'
import TrackTable from '../components/staff/TrackTable'
import { plural } from '../lib/format'
import { useLibraryTracks } from '../lib/queries'

/** Every track across every project. The second-search tool. */
export default function Library() {
  // The list is unfiltered; the band below the heading searches across
  // everything and navigates, rather than filtering this page.
  const tracks = useLibraryTracks('')

  return (
    <>
      <div className="border-b border-sequel-line px-7 pb-[18px] pt-[22px]">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="page-title">
              Library
            </h1>
            <div className="page-subtitle">
              {tracks.data ? plural(tracks.data.length, 'track') : ' '}
            </div>
          </div>
        </div>
      </div>
      {/* Its own band between the heading and the list, with a line of its
          own, so the search belongs to neither and separates the two. */}
      <div className="border-b border-sequel-line px-7 py-4">
        <Search />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tracks.isPending && <p className="px-7 py-4 text-sequel-mid">Loading…</p>}
        {tracks.error && <p className="form-error px-7 py-4">{tracks.error.message}</p>}
        {tracks.data && tracks.data.length === 0 && (
          <p className="px-7 py-6 text-sequel-mid">Nothing matches.</p>
        )}
        {tracks.data && tracks.data.length > 0 && <TrackTable tracks={tracks.data} />}
      </div>
    </>
  )
}
