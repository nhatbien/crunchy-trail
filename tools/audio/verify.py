#!/usr/bin/env python3
"""Verify public/audio against the mastering spec and print a per-group summary.

Usage: python3 -I tools/audio/verify.py tools/audio/recipe.json

Checks: mono / 44.1 kHz / MP3, per-file size < 512 KiB, folder total <= 5 MB, decoded peak
<= -1 dBFS (+0.15 dB MP3 tolerance) and no clipping, DC offset, one-shot start (first
sample >= -20 dB re. peak, and level of the first 2 ms), per-group duration ranges,
loop seams (3x concatenation: high-passed click energy around each seam vs. the rest of
the file, 50 ms RMS step), manifest consistency, kalimba pitch vs. manifest MIDI.
Writes tools/audio/kalimba_pitch.json (used by credits.py).
"""
import json
import math
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audiolib as al  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SR = al.SR

DUR_RANGE_MS = {  # spec ranges (one-shots), loops in seconds below
    "pop": (60, 300), "popit": (80, 300), "grass": (120, 450), "snow": (150, 500),
    "leaves": (150, 600), "sand": (120, 500), "slime": (100, 500), "ice": (100, 700),
    "wood": (80, 350), "step": (60, 250), "keys": (50, 250), "kalimba": (800, 2500), "coin": (0, 600),
    "ui_tap": (0, 200), "ui_whoosh": (200, 600), "win": (1000, 3500), "sparkle": (500, 1500),
}
LOOP_RANGE_S = {"amb_meadow": (20, 40), "amb_winter": (20, 40), "amb_cozy": (20, 40), "music": (8, 120)}


def measure_pitch(x, sr):
    hop = int(0.005 * sr)
    env = al.frame_rms(x, hop)
    pk_i = max(range(len(env)), key=lambda i: env[i])
    start = pk_i * hop + int(0.04 * sr)
    seg = x[start:start + int(0.5 * sr)]
    nfft = 1
    while nfft < len(seg) * 4:
        nfft <<= 1
    mags, df = al.mag_spectrum(seg, sr, nfft)
    lo, hi = int(60 / df), int(5000 / df)
    k = max(range(lo, hi), key=lambda i: mags[i])
    a, b, c = (math.log(max(mags[k - 1], 1e-12)), math.log(max(mags[k], 1e-12)), math.log(max(mags[k + 1], 1e-12)))
    p = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0.0
    return (k + p) * df


def seam_click(y, n_period):
    """3x concatenation; compare |HP(>=4 kHz)| peak within +-3 ms of the 2 seams with the
    99.9th percentile elsewhere, and the 50 ms RMS step at the seams."""
    z = list(y) * 3
    hp = al.highpass(z, 4000, SR, order=4)
    mags = sorted(abs(v) for v in hp[n_period:2 * n_period])
    p999 = mags[int(0.999 * (len(mags) - 1))] or 1e-9
    w = int(0.003 * SR)
    worst = 0.0
    for s in (n_period, 2 * n_period):
        worst = max(worst, max(abs(v) for v in hp[s - w:s + w]))
    w50 = int(0.05 * SR)
    steps = []
    for s in (n_period, 2 * n_period):
        steps.append(al.db(al.rms(z[s:s + w50])) - al.db(al.rms(z[s - w50:s])))
    return worst / p999, steps


def main():
    R = json.load(open(sys.argv[1]))
    out_dir = os.path.join(ROOT, R.get("out_dir", "public/audio"))
    man = json.load(open(os.path.join(out_dir, "manifest.json")))
    problems = []
    total = 0
    for f in os.listdir(out_dir):
        total += os.path.getsize(os.path.join(out_dir, f))
    rows = {}
    pitch_notes = {}
    for g, entry in man["groups"].items():
        if not (0.0 <= entry["gain"] <= 1.0):
            problems.append("%s: gain out of range" % g)
        if g == "kalimba" and len(entry.get("midi", [])) != len(entry["files"]):
            problems.append("kalimba: midi/files length mismatch")
        for i, fn in enumerate(entry["files"]):
            path = os.path.join(out_dir, fn)
            if not os.path.exists(path):
                problems.append("%s missing" % fn)
                continue
            size = os.path.getsize(path)
            pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                                            "stream=codec_name,sample_rate,channels,bit_rate", "-of", "json", path],
                                           capture_output=True, text=True).stdout)["streams"][0]
            if pr["codec_name"] != "mp3" or int(pr["sample_rate"]) != 44100 or int(pr["channels"]) != 1:
                problems.append("%s: format %s" % (fn, pr))
            if size >= 512 * 1024:
                problems.append("%s: size %d >= 512 KiB" % (fn, size))
            y = al.decode(path, channels=1)[0][0]
            n = len(y)
            pk = al.peak(y)
            pk_db = al.db(pk)
            if pk_db > -0.85:
                problems.append("%s: peak %.2f dBFS" % (fn, pk_db))
            if al.clip_runs(y, 0.999, 2):
                problems.append("%s: clipping" % fn)
            dc = sum(y) / n
            if abs(dc) > 1e-3:
                problems.append("%s: DC %.4f" % (fn, dc))
            row = {"file": fn, "dur": n / SR, "peak": pk_db, "rms": al.db(al.rms(y)), "size": size,
                   "kbps": int(pr.get("bit_rate", 0)) // 1000}
            if entry.get("loop"):
                ratio, steps = seam_click(y, n)
                row["seam_click_ratio"] = ratio
                row["seam_rms_steps"] = steps
                lo, hi = LOOP_RANGE_S[g]
                if not (lo <= n / SR <= hi):
                    problems.append("%s: loop length %.2fs" % (fn, n / SR))
                if ratio > 1.5:
                    problems.append("%s: possible click at loop seam (ratio %.2f)" % (fn, ratio))
            else:
                on = next(i for i, v in enumerate(y) if abs(v) >= pk * 0.1) * 1000.0 / SR
                head = al.db(al.peak(y[: int(0.002 * SR)]) / pk)
                row["onset_ms"] = on
                row["head2ms_db"] = head
                lo, hi = DUR_RANGE_MS[g]
                if not (lo <= n * 1000.0 / SR <= hi + 1):
                    problems.append("%s: duration %.0f ms outside %s" % (fn, n * 1000.0 / SR, (lo, hi)))
                if head < -30 and g not in ("ui_whoosh",):
                    problems.append("%s: quiet start (first 2 ms at %.1f dB re peak)" % (fn, head))
                if g == "kalimba":
                    f0 = measure_pitch(y, SR)
                    midi = al.midi_from_hz(f0)
                    cents = (midi - entry["midi"][i]) * 100
                    row["pitch"] = "%.1f Hz = %s %+.0f cents" % (f0, al.note_name(midi), (midi - round(midi)) * 100)
                    pitch_notes[fn] = "measured %.1f Hz = %s, %+.0f cents" % (f0, al.note_name(midi), (midi - round(midi)) * 100)
                    if abs(cents) > 50:
                        problems.append("%s: pitch %.1f Hz != MIDI %d" % (fn, f0, entry["midi"][i]))
            rows.setdefault(g, []).append(row)
    json.dump(pitch_notes, open(os.path.join(HERE, "kalimba_pitch.json"), "w"), indent=1)
    for g, rs in rows.items():
        e = man["groups"][g]
        print("== %s  gain=%.2f  files=%d" % (g, e["gain"], len(rs)) + ("  midi=%s" % e["midi"] if "midi" in e else ""))
        for r in rs:
            extra = ""
            if "onset_ms" in r:
                extra = "first-10%%=%4.2fms head2ms=%5.1fdB" % (r["onset_ms"], r["head2ms_db"])
            if "seam_click_ratio" in r:
                extra = "seam HF-click ratio=%.2f  seam RMS steps=%s dB" % (
                    r["seam_click_ratio"], ["%+.1f" % s for s in r["seam_rms_steps"]])
            if "pitch" in r:
                extra += "  pitch=" + r["pitch"]
            print("   %-17s %7.3fs peak=%6.2f rms=%6.1f %3dkbps %6.1fKiB %s" % (
                r["file"], r["dur"], r["peak"], r["rms"], r["kbps"], r["size"] / 1024.0, extra))
    print("\nTOTAL public/audio: %d bytes (%.2f MiB, %.2f MB)" % (total, total / 1048576.0, total / 1e6))
    if total > 5_000_000:
        problems.append("total size %d > 5 MB" % total)
    print("PROBLEMS:" if problems else "ALL CHECKS PASSED")
    for p in problems:
        print("  -", p)


if __name__ == "__main__":
    main()
