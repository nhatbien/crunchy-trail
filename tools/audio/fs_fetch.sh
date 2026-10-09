#!/bin/bash
# Download Freesound HQ previews (no login) + sound page + parsed metadata into a batch dir.
# Usage: fs_fetch.sh <batch_dir> <sound_id> [<sound_id> ...]
# - <batch_dir> must be a NEW directory (created here) under .audio-src/raw/ or an existing
#   batch dir created by this script.
# - Only CC0 sounds are downloaded (CC-BY is reported but skipped unless ALLOW_BY=1).
# - Writes <id>.html (sound page), <id>.json (metadata), <id>.ogg (HQ Vorbis preview,
#   ~q6/192k nominal, highest-fidelity public preview), falling back to <id>.mp3 (HQ MP3).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
batch="$1"; shift
mkdir -p "$batch"
UA="Mozilla/5.0 (Macintosh) crunchy-trail-audio-sourcing"
for id in "$@"; do
  html="$batch/$id.html"; js="$batch/$id.json"
  if [ ! -s "$html" ]; then
    curl -sSL --max-time 60 -A "$UA" -o "$html" "https://freesound.org/s/$id/" || { echo "$id: page fetch failed"; continue; }
  fi
  python3 -I "$here/fs_sound_info.py" "$html" > "$js" || { echo "$id: parse failed"; continue; }
  read -r cc0 comm ogg mp3 user lic title < <(python3 -I -c '
import json,sys
d=json.load(open(sys.argv[1]))
print(int(d["is_cc0"]), int(d["commercial_ok"]), d.get("hq_ogg") or "-", d.get("hq_mp3") or "-", d["username"].replace(" ","_") or "-", d["license"].replace(" ","_") or "-", d["title"])' "$js")
  if [ "$cc0" != "1" ] && { [ "$comm" != "1" ] || [ "${ALLOW_BY:-0}" != "1" ]; }; then
    echo "$id: SKIP license=$lic user=$user title=$title"
    continue
  fi
  if [ ! -s "$batch/$id.ogg" ] && [ ! -s "$batch/$id.mp3" ]; then
    if ! curl -sSfL --max-time 120 -A "$UA" -o "$batch/$id.ogg" "$ogg"; then
      rm -f "$batch/$id.ogg"
      curl -sSfL --max-time 120 -A "$UA" -o "$batch/$id.mp3" "$mp3" || { rm -f "$batch/$id.mp3"; echo "$id: preview download failed"; continue; }
    fi
  fi
  f="$batch/$id.ogg"; [ -s "$f" ] || f="$batch/$id.mp3"
  dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f")
  echo "$id: OK $lic user=$user dur=${dur}s file=$(basename "$f") title=$title"
done
