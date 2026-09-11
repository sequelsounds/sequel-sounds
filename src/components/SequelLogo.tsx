type Props = {
  /** Use the SEQUEL wordmark instead of the square II mark. */
  wordmark?: boolean
  className?: string
}

/**
 * The Sequel logo, taken from the same assets the Webflow site serves: the
 * square brown II mark, and the written wordmark.
 */
export default function SequelLogo({ wordmark = false, className = '' }: Props) {
  return wordmark ? (
    <img
      src="/sequel-wordmark.png"
      alt=""
      width={425}
      height={96}
      className={`h-5 w-auto ${className}`}
    />
  ) : (
    <img
      src="/sequel-mark.png"
      alt=""
      width={400}
      height={400}
      className={`h-16 w-16 ${className}`}
    />
  )
}
