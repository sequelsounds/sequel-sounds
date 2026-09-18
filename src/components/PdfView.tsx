import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/**
 * A PDF, drawn page by page onto canvases.
 *
 * ⚠️ NOT AN IFRAME, and this is the second time that has been established. The
 * browser's own viewer differs in every browser and puts its toolbar across the
 * top of the panel: Chrome's `#toolbar=0` hides its own and does nothing at all
 * in Firefox, which shows pdf.js's toolbar instead. The old app reached the
 * same conclusion and its write-up says so — an iframe was tried and dropped.
 *
 * ⚠️ S3 CORS IS REQUIRED, because the bytes are fetched in JS rather than
 * navigated to. sequel-sounds-media already allows it (the contract DOWNLOAD
 * has always fetched the signed url as a blob). `Accept-Ranges` is not among
 * the exposed headers, so the whole file is downloaded rather than streamed by
 * range — invisible on a 40 KB licence, a wait on a 20 MB scan. Exposing
 * Content-Length, Content-Range and Accept-Ranges on the bucket would fix that
 * if it ever matters.
 *
 * ⚠️ RENDER AT THE DEVICE PIXEL RATIO. A canvas sized in CSS pixels on a
 * retina screen looks like a fax.
 */
export default function PdfView({ url, className = '' }: { url: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el || !url) return
    let cancelled = false
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    el.replaceChildren()
    setError(null)

    const task = pdfjs.getDocument({ url })
    task.promise.then(
      async (doc) => {
        const width = el.clientWidth
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelled) return
          const page = await doc.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: width / base.width })
          const canvas = document.createElement('canvas')
          canvas.className = 'pdfv-page'
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.width = '100%'
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          el.appendChild(canvas)
          await page.render({ canvas, canvasContext: ctx, viewport, transform: [dpr, 0, 0, dpr, 0, 0] })
            .promise
        }
      },
      (e: Error) => {
        if (!cancelled) setError(e.message || 'That document could not be displayed.')
      },
    )

    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [url])

  return (
    <div ref={host} className={`pdfv ${className}`}>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
