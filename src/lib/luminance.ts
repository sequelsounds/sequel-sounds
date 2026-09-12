import { useEffect, useState } from 'react'

/**
 * Is the top-right corner of this image dark?
 *
 * For a control that sits on top of artwork, where the artwork can be
 * anything. Only the corner the control covers is sampled — a dark sleeve
 * with a white corner would give the wrong answer if the whole picture were
 * averaged, and it is the corner the mark has to be legible against.
 *
 * Returns null when it cannot tell: no image, a load failure, or a canvas the
 * browser tainted. Callers should treat null as "keep the default", never as
 * "light" — a wrong guess here makes a control invisible.
 */
export function useCornerIsDark(url: string | null): boolean | null {
  const [dark, setDark] = useState<boolean | null>(null)

  useEffect(() => {
    if (!url) {
      setDark(null)
      return
    }
    let cancelled = false
    const img = new Image()
    // Needed for an untainted canvas. The media bucket's CORS allows GET from
    // this origin (infra/s3-cors.json); a blob: URL from a just-picked file is
    // same-origin and needs no permission at all.
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      if (cancelled) return
      try {
        const SAMPLE = 24
        const canvas = document.createElement('canvas')
        canvas.width = SAMPLE
        canvas.height = SAMPLE
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        const side = Math.max(
          1,
          Math.floor(Math.min(img.naturalWidth, img.naturalHeight) * 0.3),
        )
        ctx.drawImage(img, img.naturalWidth - side, 0, side, side, 0, 0, SAMPLE, SAMPLE)
        const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)

        let total = 0
        for (let i = 0; i < data.length; i += 4) {
          // Rec. 709 luma — weights green the way the eye does, so a mid green
          // is not mistaken for a dark one.
          total += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        }
        const mean = total / (data.length / 4)
        if (!cancelled) setDark(mean < 140)
      } catch {
        // Tainted canvas: readable as a picture, not as pixels.
        if (!cancelled) setDark(null)
      }
    }
    img.onerror = () => {
      if (!cancelled) setDark(null)
    }
    img.src = url

    return () => {
      cancelled = true
    }
  }, [url])

  return dark
}
