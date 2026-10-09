#!/bin/bash
# Search Freesound (public HTML, no login) for CC0 sounds and print a compact table.
# Usage: fs_search.sh "query words" [sort] [maxdur] [page] [mindur]
#   sort: one of  rel | dl | rating | short | long | new   (default: dl)
# Env: FS_HTML_DIR  where to cache the HTML pages (default: $TMPDIR/fs_html)
set -euo pipefail
q="$1"; sortk="${2:-dl}"; maxdur="${3:-*}"; page="${4:-1}"; mindur="${5:-0}"
case "$sortk" in
  rel) s="Automatic by relevance";;
  dl) s="Downloads (most first)";;
  rating) s="Rating (highest first)";;
  short) s="Duration (shortest first)";;
  long) s="Duration (longest first)";;
  new) s="Date added (newest first)";;
  *) s="$sortk";;
esac
here="$(cd "$(dirname "$0")" && pwd)"
dir="${FS_HTML_DIR:-${TMPDIR:-/tmp}/fs_html}"
mkdir -p "$dir"
slug="$(printf '%s_%s_%s_%s_%s' "$q" "$sortk" "$maxdur" "$page" "$mindur" | tr -c 'A-Za-z0-9_' '_')"
out="$dir/$slug.html"
if [ ! -s "$out" ]; then
  curl -sSL --max-time 60 -A "Mozilla/5.0 (Macintosh) crunchy-trail-audio-sourcing" -G 'https://freesound.org/search/' \
    --data-urlencode "q=$q" \
    --data-urlencode 'f=license:"Creative Commons 0"' \
    --data-urlencode "s=$s" \
    --data-urlencode "d0=$mindur" --data-urlencode "d1=$maxdur" \
    --data-urlencode "page=$page" \
    --data-urlencode "g=0" \
    -o "$out"
fi
python3 -I "$here/fs_search_parse.py" "$out"
