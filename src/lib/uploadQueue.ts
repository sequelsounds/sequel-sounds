/**
 * Runs async work over a list of ids with a fixed number of workers in flight.
 *
 * Four at once is the useful middle: enough to keep a partner's uplink busy on
 * 50 files, few enough that no single upload is starved and that a stall does
 * not freeze the whole batch.
 */
export async function runQueue(
  ids: string[],
  worker: (id: string) => Promise<void>,
  concurrency = 4,
): Promise<void> {
  let next = 0
  const pump = async () => {
    while (next < ids.length) {
      const id = ids[next++]
      // The worker reports its own failures into component state; one bad file
      // must never stop the other 46.
      await worker(id).catch(() => {})
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, pump),
  )
}
