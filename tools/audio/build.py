#!/usr/bin/env python3
"""Crunchy Trail audio build: recipe.json -> public/audio/*.mp3 + manifest.json (+ report).

Usage:
  python3 -I tools/audio/build.py tools/audio/recipe.json [--only GROUP[,GROUP]] [--no-write-meta]
  python3 -I tools/audio/credits.py tools/audio/recipe.json      # -> AUDIO_CREDITS.md

All DSP is plain Python (audiolib.py); ffmpeg decodes sources and encodes MP3.

One-shot chain (per item):
  decode a context window around `t` (44.1 kHz) -> channel mix/select -> 4th-order
  Butterworth highpass (group `hp`, >= 40 Hz) + optional EQ -> DC removal
  -> onset: main transient attack found on a 0.25 ms peak envelope (see find_onset);
     cut `pre_ms` (0.6 ms) before it  [onset_mode "level": first bin above onset_db]
  -> end: last 5 ms frame within `end_db` of the peak frame (or fixed `dur`),
     bounded by `end_max` (next event) and the group's max_ms
  -> 0.6 ms raised-cosine fade-in, `fade_out_ms` raised-cosine fade-out
  -> peak-normalise to -1 dBFS
  -> group loudness match: K-weighted max-400 ms loudness ("m400"); every item louder
     than (quietest + loud_tol) is attenuated down to it (never boosted -> no clipping)
  -> libmp3lame mono 44.1 kHz CBR -> decode back and verify peak <= -1 dBFS (+0.15 dB
     MP3 overshoot tolerance, otherwise re-encode with the measured correction).
Loop chain:
  decode [start, start+dur+xfade) -> HP/EQ -> DC -> equal-power crossfade of the
  post-loop tail into the head (mode "xfade") or exact musical loop (mode "exact",
  3 ms edge ramps) -> K-weighted integrated loudness to `lufs` (peak-limited to -1 dBFS)
  -> MP3 -> decode and check the loop seam (sample step and 50 ms RMS step vs. the
  file's own statistics).
"""
import argparse
import array
import json
import math
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audiolib as al  # noqa: E402

SR = al.SR
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def rc_fade(n, i):
    """Raised-cosine ramp value 0..1 for step i of n."""
    if n <= 0:
        return 1.0
    return 0.5 - 0.5 * math.cos(math.pi * min(max(i, 0), n) / n)


def apply_eq(y, eqs):
    for e in eqs or []:
        kind = e[0]
        if kind == "hp":
            y = al.highpass(y, e[1], SR, order=e[2] if len(e) > 2 else 2)
        elif kind == "lp":
            y = al.lowpass(y, e[1], SR, order=e[2] if len(e) > 2 else 2)
        else:  # ["peak"|"highshelf"|"lowshelf", f, q, gain_db]
            y = al.biquad(y, al.biquad_coeffs(kind, e[1], SR, q=e[2], gain_db=e[3]))
    return y


def stereo_to_mono(l, r, chan):
    """chan: "left" | "right" | "mix" (plain average) | "auto".

    "auto" (default for natural recordings): estimate the inter-channel lag (+-8 samples)
    and correlation on up to 3 s of the segment. Well-correlated pairs (>= 0.6, e.g. XY/MS
    or 1-2 sample offsets) are time-aligned before averaging, so the mono sum has no
    comb-filter notch; poorly correlated pairs (spaced mics, wide reverbs) would comb-filter
    or smear transients when summed, so the louder channel is used alone."""
    if chan in ("left", "right", "mix"):
        return al.to_mono([l, r], chan), {"mix": "L+R average", "left": "left channel", "right": "right channel"}[chan]
    n = min(len(l), len(r))
    m = min(n, 3 * SR)
    best = (-2.0, 0)
    for lag in range(-8, 9):
        sab = saa = sbb = 0.0
        for i in range(16, m - 16, 2):
            a = l[i]
            b = r[i + lag]
            sab += a * b
            saa += a * a
            sbb += b * b
        c = sab / math.sqrt(saa * sbb) if saa > 0 and sbb > 0 else 0.0
        if c > best[0]:
            best = (c, lag)
    corr, lag = best
    if corr >= 0.6:
        out = array.array("f", bytes(4 * n))
        for i in range(n):
            j = i + lag
            out[i] = 0.5 * (l[i] + (r[j] if 0 <= j < n else 0.0))
        return out, "stereo->mono time-aligned sum (lag %+d smp, r=%.2f)" % (lag, corr)
    if al.rms(l[:m]) >= al.rms(r[:m]):
        return array.array("f", l[:n]), "left channel only (stereo r=%.2f)" % corr
    return array.array("f", r[:n]), "right channel only (stereo r=%.2f)" % corr


def load_segment(src, t0, t1, chan="auto"):
    """Decode [t0, t1) of src as mono float at SR. Returns (samples, actual_t0)."""
    t0 = max(0.0, t0)
    try:
        src_ch = int(al.probe(src)["streams"][0].get("channels", 1))
    except Exception:
        src_ch = 1
    nch = 2 if src_ch >= 2 else 1
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-ss", "%.6f" % t0, "-i", src,
           "-t", "%.6f" % (t1 - t0), "-vn", "-ac", str(nch), "-ar", str(SR),
           "-f", "f32le", "-acodec", "pcm_f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    a = array.array("f")
    a.frombytes(raw[: len(raw) - len(raw) % 4])
    if sys.byteorder != "little":
        a.byteswap()
    if nch == 1:
        return a, t0, "mono source"
    mono, desc = stereo_to_mono(a[0::2], a[1::2], chan)
    return mono, t0, desc


def opt(item, gcfg, key, default):
    return item.get(key, gcfg.get(key, default))


# ----------------------------------------------------------------------------
# One-shots
# ----------------------------------------------------------------------------

def find_onset(y, i_t, item, gcfg):
    """Locate the main attack near sample index i_t.

    Envelope = peak |y| per 0.25 ms bin over [t-30 ms, t+search_ms]. P = loudest bin
    (searching from t-20 ms). Default mode: the earliest bin before P where the next
    1 ms reaches `attack_db` (-12 dB) re. P and rises >= `rise_db` (12 dB) over the
    previous 2 ms -> skips low-level pre-noise (finger contact, blade travel).
    Mode "level": earliest bin above `onset_db` (-30 dB) re. P (for swells/whooshes).
    """
    b = 11  # 0.25 ms at 44.1 kHz
    lo = max(0, i_t - int(0.03 * SR))
    hi = min(len(y), i_t + int(opt(item, gcfg, "search_ms", 60) / 1000.0 * SR))
    nb = max(1, (hi - lo) // b)
    e = [max((abs(v) for v in y[lo + k * b: lo + (k + 1) * b]), default=0.0) for k in range(nb)]
    p0 = min(nb - 1, max(0, (i_t - int(0.02 * SR) - lo) // b))
    P = max(range(p0, nb), key=lambda k: e[k])
    eP = e[P] or 1e-9
    if opt(item, gcfg, "onset_mode", "attack") == "level":
        thr = eP * 10 ** (opt(item, gcfg, "onset_db", -30.0) / 20.0)
        for k in range(0, P + 1):
            if e[k] >= thr:
                return lo + k * b
        return lo + P * b
    need = eP * 10 ** (opt(item, gcfg, "attack_db", -12.0) / 20.0)
    rise = 10 ** (opt(item, gcfg, "rise_db", 12.0) / 20.0)
    for k in range(0, P + 1):
        nxt = max(e[k:k + 4])
        prev = max(e[max(0, k - 8):k]) if k > 0 else 0.0
        if k < 8 and lo > 0:
            prev = max(prev, max((abs(v) for v in y[max(0, lo - (8 - k) * b):lo]), default=0.0))
        if nxt >= need and nxt >= rise * prev:
            return lo + k * b
    thr = eP * 10 ** (-24.0 / 20.0)
    for k in range(0, P + 1):
        if e[k] >= thr:
            return lo + k * b
    return lo + P * b


def enforce_lead(y, onset, seg_end, lead_db):
    """Move the onset later (never earlier) until the sound is substantial relative to
    the whole one-shot: the next 1 ms must peak within `lead_db` of the segment's peak
    and the next 3 ms must hold an RMS within lead_db-10 dB. Removes soft lead-ins and
    isolated pre-clicks so the file is audible from its first milliseconds."""
    gpk = max((abs(v) for v in y[onset:seg_end]), default=0.0)
    if gpk <= 0:
        return onset
    thr = gpk * 10 ** (lead_db / 20.0)
    thr_rms = thr * 10 ** (-10.0 / 20.0)
    k = onset
    w1, w3 = int(0.001 * SR), int(0.003 * SR)
    while k < seg_end - w3:
        if max(abs(v) for v in y[k:k + w1]) >= thr and al.rms(y[k:k + w3]) >= thr_rms:
            return k
        k += 11
    return onset


def process_oneshot(item, gcfg, raw_root):
    src = os.path.join(raw_root, item["src"])
    t = float(item.get("t", 0.0))
    min_ms = opt(item, gcfg, "min_ms", 40)
    max_ms = opt(item, gcfg, "max_ms", 500)
    end_max = item.get("end_max")
    ctx0 = t - 0.12
    ctx1 = (end_max if end_max is not None else t + max_ms / 1000.0 + 0.2) + 0.06
    x, t0, chan_note = load_segment(src, ctx0, ctx1, opt(item, gcfg, "chan", "auto"))
    hp = opt(item, gcfg, "hp", 40)
    y = al.highpass(x, max(40, hp), SR, order=4)
    y = apply_eq(y, opt(item, gcfg, "eq", None))
    y = al.remove_dc(y)
    rel = lambda tt: int(round((tt - t0) * SR))  # noqa: E731
    i_t = rel(t)
    onset = find_onset(y, i_t, item, gcfg)
    attack0 = onset  # before lead-in trimming: reference for the background-noise window
    hard_end = len(y) if end_max is None else min(len(y), rel(end_max))
    onset = enforce_lead(y, onset, min(hard_end, onset + int(max_ms / 1000.0 * SR)),
                         opt(item, gcfg, "lead_db", -24.0))
    cut = max(0, onset - int(round(opt(item, gcfg, "pre_ms", 0.6) / 1000.0 * SR)))
    hard_end = min(hard_end, cut + int(max_ms / 1000.0 * SR))
    if item.get("dur") is not None:
        end = min(hard_end, cut + int(float(item["dur"]) * SR))
    else:
        hop = int(0.005 * SR)
        env = al.frame_rms(y[cut:hard_end], hop)
        end = hard_end
        if env:
            pk_env = max(env)
            ref = min(cut, attack0)
            n0 = max(0, ref - int(0.07 * SR))
            n1 = max(0, ref - int(0.02 * SR))
            noise = al.rms(y[n0:n1]) if n1 - n0 > 32 else 0.0
            thr = max(pk_env * 10 ** (-opt(item, gcfg, "end_db", 45.0) / 20.0), noise * 2.0)
            last = max((k for k, e in enumerate(env) if e >= thr), default=0)
            end = min(hard_end, cut + (last + 1) * hop + int(0.004 * SR))
    end = max(end, min(hard_end, cut + int(min_ms / 1000.0 * SR)))
    seg = list(y[cut:end])
    n = len(seg)
    fi = int(round(opt(item, gcfg, "fade_in_ms", 0.6) / 1000.0 * SR))
    fo = int(round(opt(item, gcfg, "fade_out_ms", 20) / 1000.0 * SR))
    fo = min(fo, max(1, int(opt(item, gcfg, "fade_max_frac", 0.35) * n)))
    for k in range(min(fi, n)):
        seg[k] *= rc_fade(fi, k)
    for k in range(fo):
        seg[n - 1 - k] *= rc_fade(fo, k)
    pk = max((abs(v) for v in seg), default=0.0) or 1.0
    g = 10 ** (-1.0 / 20.0) / pk
    seg = [v * g for v in seg]
    return seg, {"cut_s": t0 + cut / SR, "end_s": t0 + end / SR, "chan_note": chan_note}


def oneshot_metrics(x):
    pk = max((abs(v) for v in x), default=0.0)
    on = next((i for i, v in enumerate(x) if abs(v) >= pk * 0.1), 0)
    pk_i = max(range(len(x)), key=lambda i: abs(x[i])) if x else 0
    ld = al.loudness_stats(x, SR)
    return {
        "dur_ms": 1000.0 * len(x) / SR,
        "peak_db": al.db(pk),
        "rms_db": al.db(al.rms(x)),
        "onset_ms": 1000.0 * on / SR,
        "peak_ms": 1000.0 * pk_i / SR,
        "m400": ld["m400"], "s100": ld["s100"],
        "clip": al.clip_runs(x, 0.999, 2),
    }


def encode_verified(x, out_path, bitrate, max_iter=4, allow_over=0.15):
    """Encode; the decoded peak must stay within `allow_over` dB of the pre-encode
    peak (<= -1 dBFS); otherwise scale by the measured overshoot and re-encode."""
    gain = 1.0
    target = min(-1.0, al.db(max((abs(v) for v in x), default=1e-9)))
    y = []
    for _ in range(max_iter):
        al.encode_mp3([v * gain for v in x], out_path, SR, bitrate)
        y = al.decode(out_path, channels=1)[0][0]
        pk = al.db(al.peak(y))
        if pk <= target + allow_over:
            break
        gain *= 10 ** ((target - pk) / 20.0)
    return y, gain


# ----------------------------------------------------------------------------
# Loops
# ----------------------------------------------------------------------------

def integrated_lufs(x):
    k = al.k_weight(x, SR)
    ms = sum(v * v for v in k) / max(1, len(k))
    return -0.691 + 10 * math.log10(max(ms, 1e-12))


def process_loop(item, gcfg, raw_root):
    src = os.path.join(raw_root, item["src"])
    start = float(item.get("start", 0.0))
    D = float(item["dur"])
    mode = item.get("mode", "xfade")
    X = float(item.get("xfade", 3.0)) if mode == "xfade" else 0.0
    x, _, chan_note = load_segment(src, start, start + D + X + 0.05, opt(item, gcfg, "chan", "auto"))
    y = al.highpass(x, max(40, opt(item, gcfg, "hp", 40)), SR, order=4)
    y = apply_eq(y, opt(item, gcfg, "eq", None))
    y = al.remove_dc(y)
    nD = int(round(D * SR))
    nX = int(round(X * SR))
    a = list(y[: nD + nX])
    if len(a) < nD + nX:
        raise RuntimeError("source too short for loop %s" % item["out"])
    out = a[:nD]
    if mode == "xfade":
        # out[0] continues seamlessly from out[-1] (= a[nD-1] -> a[nD]) and then crossfades
        # (equal power, for uncorrelated noise-like material) into the head material.
        for i in range(nX):
            th = (math.pi / 2.0) * (i + 0.5) / nX
            out[i] = a[i] * math.sin(th) + a[nD + i] * math.cos(th)
    else:
        r = int(0.003 * SR)
        for i in range(r):
            out[i] *= rc_fade(r, i)
            out[nD - 1 - i] *= rc_fade(r, i)
    lufs = integrated_lufs(out)
    target = opt(item, gcfg, "lufs", -24.0)
    pk = al.db(max(abs(v) for v in out))
    g_db = min(target - lufs, -1.0 - pk)
    g = 10 ** (g_db / 20.0)
    out = [v * g for v in out]
    return out, {"lufs_before": lufs, "gain_db": g_db, "chan_note": chan_note}


def loop_check(y, sr=SR):
    """Seam check on the decoded loop: the wrap step |y[0]-y[-1]| vs. the file's 99.9th
    percentile sample step, and the 50 ms RMS step across the seam vs. the median
    50 ms RMS step inside the file (a 3x concatenation has exactly these two seams)."""
    n = len(y)
    steps = sorted(abs(y[i + 1] - y[i]) for i in range(n - 1))
    p999 = steps[int(0.999 * (len(steps) - 1))]
    seam = abs(y[0] - y[-1])
    w = int(0.05 * sr)
    jump = al.db(al.rms(y[:w])) - al.db(al.rms(y[-w:]))
    ref = []
    for s in range(w, n - w, max(1, n // 60)):
        ref.append(abs(al.db(al.rms(y[s:s + w])) - al.db(al.rms(y[s - w:s]))))
    ref.sort()
    return {"seam_step": seam, "p999_step": p999, "seam_ratio": seam / (p999 or 1e-9),
            "rms_jump_db": jump, "typ_rms_step_db": ref[len(ref) // 2] if ref else 0.0,
            "p90_rms_step_db": ref[int(0.9 * (len(ref) - 1))] if ref else 0.0}


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("recipe")
    ap.add_argument("--only", default=None)
    ap.add_argument("--no-write-meta", action="store_true")
    ap.add_argument("--report", default=None, help="per-file report JSON (default tools/audio/build_report.json)")
    args = ap.parse_args()
    with open(args.recipe) as f:
        R = json.load(f)
    raw_root = os.path.join(ROOT, R.get("raw_root", ".audio-src/raw"))
    out_dir = os.path.join(ROOT, R.get("out_dir", "public/audio"))
    os.makedirs(out_dir, exist_ok=True)
    only = set(args.only.split(",")) if args.only else None
    report_path = args.report or os.path.join(HERE, "build_report.json")
    report = {}
    if os.path.exists(report_path):
        with open(report_path) as f:
            report = json.load(f)

    by_group = {}
    for it in R["items"]:
        by_group.setdefault(it["group"], []).append(it)

    for gname, items in by_group.items():
        if only and gname not in only:
            continue
        gcfg = R["groups"][gname]
        kind = gcfg.get("kind", "oneshot")
        print("== %s (%s, %d items)" % (gname, kind, len(items)))
        if kind == "loop":
            for it in items:
                out, info = process_loop(it, gcfg, raw_root)
                path = os.path.join(out_dir, it["out"])
                y, eg = encode_verified(out, path, it.get("bitrate", gcfg.get("bitrate", "80k")))
                y = list(y)
                chk = loop_check(y)
                m = {"dur_ms": 1000.0 * len(y) / SR, "peak_db": al.db(al.peak(y)), "rms_db": al.db(al.rms(y)),
                     "lufs": integrated_lufs(y), "size": os.path.getsize(path), "kind": "loop"}
                m.update(chk)
                m.update(info)
                report[it["out"]] = dict(m, group=gname, src=it["src"], start=it.get("start", 0.0),
                                         loop_dur=it["dur"], mode=it.get("mode", "xfade"),
                                         xfade=it.get("xfade", 3.0) if it.get("mode", "xfade") == "xfade" else 0)
                print("  %-16s %.2fs peak=%.1f rms=%.1f lufs=%.1f seam_step=%.4f (p99.9 %.4f) rms_jump=%+.2fdB "
                      "(median %.2f, p90 %.2f) %dKiB" % (
                          it["out"], m["dur_ms"] / 1000, m["peak_db"], m["rms_db"], m["lufs"], chk["seam_step"],
                          chk["p999_step"], chk["rms_jump_db"], chk["typ_rms_step_db"], chk["p90_rms_step_db"],
                          m["size"] // 1024))
            continue
        procs = []
        for it in items:
            seg, info = process_oneshot(it, gcfg, raw_root)
            procs.append((it, seg, info, oneshot_metrics(seg)))
        metric = gcfg.get("loud_metric", "m400")
        tol = gcfg.get("loud_tol", 2.0)
        target = None
        if gcfg.get("loud_match", True) and len(procs) > 1:
            target = min(p[3][metric] for p in procs) + tol
        for it, seg, info, met in procs:
            gdb = (target - met[metric]) if (target is not None and met[metric] > target) else 0.0
            gdb += it.get("gain_db", 0.0)
            seg2 = [v * 10 ** (gdb / 20.0) for v in seg]
            path = os.path.join(out_dir, it["out"])
            y, eg = encode_verified(seg2, path, it.get("bitrate", gcfg.get("bitrate", "128k")))
            m = oneshot_metrics(list(y))
            m["size"] = os.path.getsize(path)
            m["match_gain_db"] = gdb + al.db(eg)
            m["kind"] = "oneshot"
            m.update(info)
            report[it["out"]] = dict(m, group=gname, src=it["src"], t=it.get("t", 0.0))
            print("  %-15s %5.0fms pk=%5.1f rms=%5.1f m400=%5.1f s100=%5.1f onset=%4.2fms gain=%5.1fdB clip=%d "
                  "%4.1fKiB [%s @%.3f-%.3f]" % (
                      it["out"], m["dur_ms"], m["peak_db"], m["rms_db"], m["m400"], m["s100"], m["onset_ms"],
                      m["match_gain_db"], m["clip"], m["size"] / 1024.0, it["src"], info["cut_s"], info["end_s"]))

    with open(report_path, "w") as f:
        json.dump(report, f, indent=1, sort_keys=True)
    if not args.no_write_meta:
        write_manifest(R, out_dir)


def write_manifest(R, out_dir):
    order = R.get("group_order") or list(R["groups"].keys())
    by_group = {}
    for it in R["items"]:
        by_group.setdefault(it["group"], []).append(it)
    groups_out = {}
    for g in order:
        items = [it for it in by_group.get(g, []) if os.path.exists(os.path.join(out_dir, it["out"]))]
        if not items:
            continue
        gc = R["groups"][g]
        entry = {"files": [it["out"] for it in items]}
        if g == "kalimba":
            entry["midi"] = [it["midi"] for it in items]
        if gc.get("kind") == "loop":
            entry["loop"] = True
        entry["gain"] = gc.get("gain", 1.0)
        groups_out[g] = entry
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump({"version": 1, "groups": groups_out}, f, indent=2)
        f.write("\n")
    print("wrote manifest.json with %d groups" % len(groups_out))


if __name__ == "__main__":
    main()
