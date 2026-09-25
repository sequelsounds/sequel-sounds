import Search from '../components/staff/Search'
import TrackTable from '../components/staff/TrackTable'
import { plural } from '../lib/format'
import { useLibraryTracks } from '../lib/queries'
import { Loader } from '../components/Loader'

/** Every track across every project. The second-search tool. */
export default function Library() {
  // The list is unfiltered; the band below the heading searches across
  // everything and navigates, rather than filtering this page.
  const tracks = useLibraryTracks('')

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Everything partners have sent…</div>
        <div className="title-row">
          <h1 className="page-title">Library</h1>
        </div>
        <div className="page-subtitle">
          {tracks.data ? plural(tracks.data.length, 'track') : '\u00a0'}
        </div>
      </div>
      {/* tab_bar_app: its own band between the heading and the list, the
          search taking 40% of it as Form Block 3 does. */}
      <div className="tab-band">
        <div className="tab-band-search">
          <Search />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tracks.isPending && (
          <Loader />
        )}
        {tracks.error && (
          <p className="form-error px-7 py-4">{tracks.error.message}</p>
        )}
        {tracks.data && tracks.data.length === 0 && (
          <p className="px-7 py-6 text-sequel-mid">Nothing matches.</p>
        )}
        {tracks.data && tracks.data.length > 0 && (
          <TrackTable tracks={tracks.data} />
        )}
      </div>
    </>
  )
}
