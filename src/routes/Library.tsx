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
            <h1 className="font-title text-[clamp(18px,2.4vw,28px)] font-normal uppercase leading-[1.1]">
              Library
            </h1>
            {/* Creato Light at full strength. The weight does the quietening,
                so the colour does not have to — a faded grey under a Light
                face reads as washed out rather than secondary. */}
            <div className="-mt-0.5 font-sans text-[14px] font-light leading-[20px] text-sequel-ink">
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
