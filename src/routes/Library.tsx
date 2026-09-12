import TrackTable from '../components/staff/TrackTable'
import { plural } from '../lib/format'
import { useLibraryTracks } from '../lib/queries'

/** Every track across every project. The second-search tool. */
export default function Library() {
  // Searching is the rail's job — one search box in the app, not two. This
  // page is the full list behind it.
  const tracks = useLibraryTracks('')

  return (
    <>
      <div className="border-b border-sequel-line px-7 pb-[18px] pt-[22px]">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-title text-[clamp(18px,2.4vw,28px)] font-normal uppercase leading-[1.1]">
              Library
            </h1>
            <div className="mt-1 text-sequel-mid">
              {tracks.data ? plural(tracks.data.length, 'track') : ' '}
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tracks.isPending && <p className="px-7 py-4 text-sequel-mid">Loading…</p>}
        {tracks.error && <p className="form-error px-7 py-4">{tracks.error.message}</p>}
        {tracks.data && tracks.data.length === 0 && (
          <p className="px-7 py-6 text-sequel-mid">Nothing matches.</p>
        )}
        {tracks.data && tracks.data.length > 0 && <TrackTable tracks={tracks.data} showProject />}
      </div>
    </>
  )
}
