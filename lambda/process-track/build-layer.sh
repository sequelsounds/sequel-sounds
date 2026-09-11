#!/usr/bin/env bash
# Builds the ffmpeg layer.
#
# The binary is fetched here rather than committed: it is ~80 MB, it has no
# business in git history, and a published layer means the function zip stays
# a few kilobytes so ordinary code changes deploy in seconds.
#
# Deliberately not a public third-party layer ARN. This binary runs over files
# strangers upload; the supply chain for it should be a source we chose, pinned
# and checksummed, not an ARN belonging to an account we do not control.
set -euo pipefail

VERSION="${FFMPEG_VERSION:-release}"
NAME="ffmpeg-${VERSION}-amd64-static"
URL="https://johnvansickle.com/ffmpeg/releases/${NAME}.tar.xz"
OUT="$(pwd)/ffmpeg-layer.zip"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "downloading $URL"
curl -fsSL "$URL" -o "$WORK/${NAME}.tar.xz"
curl -fsSL "$URL.md5" -o "$WORK/${NAME}.tar.xz.md5" || true

# md5sum is coreutils, md5 is macOS, and the published file names the tarball
# rather than just holding a digest — so compare the digests directly.
if [ -s "$WORK/${NAME}.tar.xz.md5" ]; then
  expected="$(cut -d' ' -f1 "$WORK/${NAME}.tar.xz.md5")"
  actual="$(python3 -c "import hashlib,sys;print(hashlib.md5(open(sys.argv[1],'rb').read()).hexdigest())" "$WORK/${NAME}.tar.xz")"
  if [ "$expected" != "$actual" ]; then
    echo "checksum mismatch: expected $expected, got $actual" >&2
    exit 1
  fi
  echo "checksum ok ($actual)"
else
  echo "WARNING: no published checksum; verify the binary before trusting it" >&2
fi

mkdir -p "$WORK/layer/bin" "$WORK/x"
# The "release" alias unpacks to a versioned directory, so the binaries are
# found rather than assumed. GNU and BSD tar disagree about --wildcards, which
# is the other reason not to name paths here.
tar -xJf "$WORK/${NAME}.tar.xz" -C "$WORK/x"
find "$WORK/x" -type f -name ffmpeg -exec mv {} "$WORK/layer/bin/" \;
find "$WORK/x" -type f -name ffprobe -exec mv {} "$WORK/layer/bin/" \;
[ -f "$WORK/layer/bin/ffmpeg" ] && [ -f "$WORK/layer/bin/ffprobe" ] || {
  echo "ffmpeg or ffprobe missing from the archive" >&2; exit 1; }
chmod +x "$WORK/layer/bin/ffmpeg" "$WORK/layer/bin/ffprobe"

# /opt is where a layer is mounted, so the binaries land at /opt/bin/*.
rm -f "$OUT"
( cd "$WORK/layer" && zip -qr "$OUT" bin )
echo "built $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"
