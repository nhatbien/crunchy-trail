#!/usr/bin/env python3
"""Generate AUDIO_CREDITS.md from recipe.json + build_report.json + per-source metadata.

Usage: python3 -I tools/audio/credits.py tools/audio/recipe.json [--out AUDIO_CREDITS.md]

Freesound sources: metadata comes from <batch>/<id>.json written by fs_fetch.sh (parsed
from the public sound page, so the license is the one shown on the sound's own page).
"""
import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

LICENSE_SHORT = {
    "http://creativecommons.org/publicdomain/zero/1.0/": "CC0 1.0",
    "https://creativecommons.org/publicdomain/zero/1.0/": "CC0 1.0",
}


def src_meta(raw_root, src):
    base = os.path.splitext(os.path.join(raw_root, src))[0]
    with open(base + ".json") as f:
        d = json.load(f)
    return {
        "id": d["id"],
        "title": d["title"],
        "author": d["username"],
        "url": "https://freesound.org/s/%s/" % d["id"],
        "license": LICENSE_SHORT.get(d["license_url"], d["license"]),
        "license_url": d["license_url"],
        "desc": d.get("description", ""),
        "type": d.get("type", ""),
        "preview": d.get("hq_ogg", ""),
    }


def md_escape(s):
    return s.replace("|", "\\|").replace("\n", " ")


def notes_for(it, gcfg, rep):
    hp = max(40, it.get("hp", gcfg.get("hp", 40)))
    if gcfg.get("kind") == "loop":
        mode = it.get("mode", "xfade")
        parts = ["%s-%s s of source" % (fmt(it.get("start", 0.0)), fmt(it.get("start", 0.0) + it["dur"]))]
        if mode == "xfade":
            parts.append("seamless loop: %.1f s equal-power crossfade of the post-loop tail into the head" % it.get("xfade", 3.0))
        else:
            parts.append("exact musical loop length (8 bars @ 90 BPM), 3 ms edge ramps")
        if rep.get("chan_note") and rep["chan_note"] != "mono source":
            parts.append(rep["chan_note"])
        parts.append("HP %d Hz (4th-order)" % hp)
        for e in it.get("eq", gcfg.get("eq", [])) or []:
            parts.append(eq_str(e))
        parts.append("K-weighted loudness %.1f LUFS, peak %.1f dBFS" % (rep.get("lufs", 0), rep.get("peak_db", 0)))
        parts.append("mono MP3 %s" % it.get("bitrate", gcfg.get("bitrate", "80k")).replace("k", " kbps"))
        return "; ".join(parts)
    parts = ["slice %s-%s s" % (fmt(rep.get("cut_s", 0)), fmt(rep.get("end_s", 0)))]
    if rep.get("chan_note") and rep["chan_note"] != "mono source":
        parts.append(rep["chan_note"])
    parts.append("HP %d Hz (4th-order)" % hp)
    for e in it.get("eq", gcfg.get("eq", [])) or []:
        parts.append(eq_str(e))
    parts.append("DC removed; onset-trimmed (attack at %.1f ms)" % rep.get("onset_ms", 0))
    parts.append("fades %.1f/%d ms" % (it.get("fade_in_ms", gcfg.get("fade_in_ms", 0.6)),
                                         it.get("fade_out_ms", gcfg.get("fade_out_ms", 20))))
    g = rep.get("match_gain_db", 0.0)
    parts.append("peak -1 dBFS" + (", group loudness match %+.1f dB" % g if abs(g) >= 0.05 else ""))
    parts.append("mono MP3 %s" % it.get("bitrate", gcfg.get("bitrate", "128k")).replace("k", " kbps"))
    if "midi" in it:
        parts.append("measured pitch -> MIDI %d" % it["midi"])
    return "; ".join(parts)


def eq_str(e):
    if e[0] == "lp":
        return "LP %d Hz" % e[1]
    if e[0] == "hp":
        return "HP %d Hz" % e[1]
    return "%s %d Hz %+.0f dB" % (e[0], e[1], e[3])


def fmt(x):
    return ("%.3f" % x).rstrip("0").rstrip(".") if x else "0"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("recipe")
    ap.add_argument("--out", default=os.path.join(ROOT, "AUDIO_CREDITS.md"))
    ap.add_argument("--report", default=os.path.join(HERE, "build_report.json"))
    ap.add_argument("--pitch", default=os.path.join(HERE, "kalimba_pitch.json"))
    args = ap.parse_args()
    R = json.load(open(args.recipe))
    rep = json.load(open(args.report))
    pitch = json.load(open(args.pitch)) if os.path.exists(args.pitch) else {}
    raw_root = os.path.join(ROOT, R.get("raw_root", ".audio-src/raw"))
    out = []
    out.append("# Crunchy Trail - Audio Credits\n")
    out.append("All sounds in `public/audio/` are derived from **CC0 1.0 (public domain)** recordings "
               "published on [Freesound.org](https://freesound.org). CC0 allows commercial use, "
               "modification and redistribution without attribution; credit is given here anyway. "
               "No CC-BY / NC / ND / SA material is used. The license of every source was verified on "
               "that sound's own Freesound page (saved with its metadata in `.audio-src/raw/<batch>/<id>.json`).\n")
    out.append("Source audio = Freesound's public high-quality preview (OGG Vorbis, ~q6; fetched from "
               "`cdn.freesound.org` without logging in). The pipeline is reproducible with "
               "`tools/audio/` (see *Pipeline notes* at the end of this file).\n")
    out.append("## Files\n")
    out.append("| File | Source | Author | License | Processing notes |")
    out.append("|---|---|---|---|---|")
    used = {}
    for it in R["items"]:
        gcfg = R["groups"][it["group"]]
        m = src_meta(raw_root, it["src"])
        used.setdefault(m["id"], (m, []))[1].append(it["out"])
        r = rep.get(it["out"], {})
        note = notes_for(it, gcfg, r)
        if it["out"] in pitch:
            note += " (%s)" % pitch[it["out"]]
        out.append("| `%s` | [%s](%s) (Freesound #%s) | %s | [%s](%s) | %s |" % (
            it["out"], md_escape(m["title"]), m["url"], m["id"], md_escape(m["author"]),
            m["license"], m["license_url"], md_escape(note)))
    out.append("")
    out.append("## Source recordings\n")
    out.append("| Freesound # | Title | Author | License | Used for | Uploader's description (excerpt) |")
    out.append("|---|---|---|---|---|---|")
    for sid, (m, files) in used.items():  # recipe (group) order
        desc = m["desc"]
        if len(desc) > 220:
            desc = desc[:217].rsplit(" ", 1)[0] + "..."
        out.append("| [%s](%s) | %s | %s | %s | %s | %s |" % (
            sid, m["url"], md_escape(m["title"]), md_escape(m["author"]), m["license"],
            ", ".join("`%s`" % f for f in files), md_escape(desc)))
    out.append("")
    out.append("## Pipeline notes\n")
    out.append("- `tools/audio/fs_search.sh` / `fs_search_parse.py`: Freesound HTML search (CC0 filter), no login.")
    out.append("- `tools/audio/fs_fetch.sh` / `fs_sound_info.py`: saves each sound page, parses/verifies the license "
               "and downloads the HQ preview into its own batch directory under `.audio-src/raw/` (git-ignored).")
    out.append("- `tools/audio/analyze.py`: stats, hit detection/slicing helpers, spectrogram contact sheets, FFT pitch.")
    out.append("- `tools/audio/build.py tools/audio/recipe.json`: slices, cleans and masters everything, writes "
               "`public/audio/*.mp3`, `manifest.json` and `tools/audio/build_report.json`.")
    out.append("- `tools/audio/verify.py`: checks format, size budget, peaks, onsets and loop seams.")
    out.append("- `tools/audio/credits.py`: regenerates this file.")
    out.append("")
    with open(args.out, "w") as f:
        f.write("\n".join(out))
    print("wrote", args.out, "(%d files, %d sources)" % (len(R["items"]), len(used)))


if __name__ == "__main__":
    main()
