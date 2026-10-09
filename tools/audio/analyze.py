#!/usr/bin/env python3
"""Analysis helpers for sourcing/slicing (numpy-free).

Usage:
  python3 -I analyze.py stats  <file> [<file> ...]
  python3 -I analyze.py hits   <file> [--thr DB] [--gap MS] [--maxlen MS] [--hp HZ] [--chan mix|left|right]
  python3 -I analyze.py pitch  <file> [--start S] [--len S]
  python3 -I analyze.py spectro <file> <out.png> [--start S] [--dur S] [--w PX] [--h PX]
"""
import argparse
import math
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audiolib as al  # noqa: E402


def cmd_stats(args):
    for path in args.files:
        chans, sr = al.decode(path)
        mono = al.to_mono(chans)
        n = len(mono)
        dur = n / sr
        pk = al.peak(mono)
        r = al.rms(mono)
        hop = int(0.02 * sr)
        env = al.frame_rms(al.highpass(mono, 40, sr), hop)
        envdb = [al.db(e) for e in env]
        floor = al.percentile(envdb, 10)
        p90 = al.percentile(envdb, 90)
        corr = al.correlation(chans[0], chans[1]) if len(chans) > 1 else 1.0
        clips = sum(al.clip_runs(c) for c in chans)
        dc = sum(mono) / max(1, n)
        # hum check: energy near 50/60 Hz and harmonics on the quietest 25% frames
        print("%-40s dur=%6.2fs ch=%d peak=%6.1f rms=%6.1f floor10=%6.1f p90=%6.1f dyn=%5.1f corr=%5.2f clipruns=%d dc=%.4f" % (
            os.path.basename(path)[:40], dur, len(chans), al.db(pk), al.db(r), floor, p90, p90 - floor, corr, clips, dc))


def detect_hits(x, sr, thr_db=None, gap_ms=60, maxlen_ms=700, rise_db=9.0, min_rel_db=-40.0):
    """Return list of hit dicts detected from a fine RMS envelope."""
    hop = max(1, int(0.002 * sr))  # 2 ms
    env = al.frame_rms(x, hop, hop * 2)
    envdb = [al.db(e) for e in env]
    floor = al.percentile(envdb, 10)
    gpk = max(envdb) if envdb else -120
    if thr_db is None:
        thr_db = max(floor + 12.0, gpk + min_rel_db)
    hits = []
    last = -10 ** 9
    look = int(0.03 / 0.002)  # 30 ms lookback for rise test
    gap = int(gap_ms / 2)
    for i in range(1, len(envdb)):
        if envdb[i] < thr_db:
            continue
        lo = min(envdb[max(0, i - look):i]) if i > 0 else envdb[i]
        if envdb[i] - lo >= rise_db and envdb[i - 1] < envdb[i] and i - last >= gap:
            hits.append(i)
            last = i
    out = []
    smooth = al.frame_rms(x, hop, int(0.01 * sr))
    sdb = [al.db(e) for e in smooth]
    for k, i in enumerate(hits):
        nxt = hits[k + 1] if k + 1 < len(hits) else len(envdb)
        # local peak within 40 ms after onset frame
        seg_pk_i = max(range(i, min(len(envdb), i + 20)), key=lambda j: envdb[j])
        seg_pk = envdb[seg_pk_i]
        # end: smoothed env falls below max(floor+6, pk-45) for >= 20 ms, or next hit
        end_thr = max(floor + 6.0, seg_pk - 45.0)
        j = seg_pk_i
        run = 0
        maxj = min(nxt, i + int(maxlen_ms / 2))
        end = maxj
        while j < maxj:
            if sdb[j] < end_thr:
                run += 1
                if run >= 10:
                    end = j - run + 1
                    break
            else:
                run = 0
            j += 1
        # refine onset to sample: first sample in [onset-10ms, onset+6ms] above threshold
        s0 = max(0, (i - 5) * hop)
        s1 = min(len(x), (i + 3) * hop + hop * 2)
        pk_amp = max((abs(v) for v in x[s0:min(len(x), (seg_pk_i + 2) * hop)]), default=0)
        noise_amp = 10 ** (floor / 20.0)
        level = max(noise_amp * 4.0, pk_amp * 0.06)
        on = s0
        for t in range(s0, s1):
            if abs(x[t]) >= level:
                on = t
                break
        pre = x[max(0, on - int(0.03 * sr)):max(0, on - int(0.003 * sr))]
        pre_db = al.db(al.rms(pre)) if len(pre) > 10 else -120.0
        nxt_on = nxt * hop
        seg = x[on:min(len(x), end * hop)]
        tail_gap = (nxt_on - end * hop) / sr * 1000.0 if k + 1 < len(hits) else 9999
        # double-hit check: secondary rise inside the segment
        dbl = 0
        for j2 in range(seg_pk_i + 15, max(seg_pk_i + 15, end)):
            lo2 = min(envdb[max(0, j2 - 8):j2])
            if envdb[j2] - lo2 > 8 and envdb[j2] > seg_pk - 12:
                dbl += 1
                break
        cen = al.spectral_centroid(seg[:2048], sr) if len(seg) > 64 else 0
        out.append({
            "t": on / sr, "end": end * hop / sr, "dur": (end * hop - on) / sr,
            "pk": al.db(max((abs(v) for v in seg), default=0)), "rms": al.db(al.rms(seg)),
            "pre": pre_db, "iso": seg_pk - pre_db, "cen": cen, "gap_next": tail_gap, "dbl": dbl,
        })
    return out, floor


def cmd_hits(args):
    chans, sr = al.decode(args.file)
    x = al.to_mono(chans, args.chan)
    if args.hp:
        x = al.highpass(x, args.hp, sr, order=4)
    hits, floor = detect_hits(x, sr, args.thr, args.gap, args.maxlen, args.rise)
    print("# %s  floor(10%%,4ms)=%.1f dB  hits=%d" % (os.path.basename(args.file), floor, len(hits)))
    print("#  n    start     end   dur_ms  peak   rms    pre   iso  cen_Hz gapnext dbl")
    for n, h in enumerate(hits):
        print("%4d %8.3f %8.3f %7.0f %6.1f %6.1f %6.1f %5.1f %7.0f %7.0f %3d" % (
            n, h["t"], h["end"], h["dur"] * 1000, h["pk"], h["rms"], h["pre"], h["iso"], h["cen"],
            min(h["gap_next"], 9999), h["dbl"]))


def cmd_pitch(args):
    chans, sr = al.decode(args.file, channels=1)
    x = chans[0]
    # find onset = max amplitude frame
    hop = int(0.005 * sr)
    env = al.frame_rms(x, hop)
    pk_i = max(range(len(env)), key=lambda i: env[i])
    start = int(args.start * sr) if args.start is not None else pk_i * hop + int(0.04 * sr)
    n = int(args.len * sr)
    seg = x[start:start + n]
    nfft = 1
    while nfft < len(seg) * 4:
        nfft <<= 1
    mags, df = al.mag_spectrum(seg, sr, nfft)
    lo = int(60 / df)
    hi = int(5000 / df)
    peaks = []
    for k in range(lo + 1, hi):
        if mags[k] > mags[k - 1] and mags[k] >= mags[k + 1]:
            peaks.append((mags[k], k))
    peaks.sort(reverse=True)
    top = peaks[:8]
    mx = top[0][0] if top else 1
    print("# %s  analysis window %.3f-%.3f s" % (os.path.basename(args.file), start / sr, (start + len(seg)) / sr))
    for m, k in top:
        # parabolic interpolation on log magnitude
        a, b, c = (math.log(max(mags[k - 1], 1e-12)), math.log(max(mags[k], 1e-12)), math.log(max(mags[k + 1], 1e-12)))
        p = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0
        f = (k + p) * df
        midi = al.midi_from_hz(f)
        print("  %8.2f Hz  %6.1f dB  midi=%6.2f (%s %+4.0f cents)" % (
            f, 20 * math.log10(m / mx), midi, al.note_name(midi), (midi - round(midi)) * 100))


def cmd_spectro(args):
    w, h = args.w, args.h
    af = []
    if args.start is not None:
        af.append("atrim=start=%f" % args.start)
    if args.dur is not None:
        af.append("atrim=duration=%f" % args.dur)
    pre = (",".join(af) + ",") if af else ""
    tmp_s = args.out + ".s.png"
    tmp_w = args.out + ".w.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", args.file, "-filter_complex",
                    "[0:a]%saformat=channel_layouts=mono,showspectrumpic=s=%dx%d:mode=combined:color=intensity:scale=log:fscale=log:legend=1:drange=100" % (pre, w, h),
                    "-frames:v", "1", tmp_s], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", args.file, "-filter_complex",
                    "[0:a]%saformat=channel_layouts=mono,showwavespic=s=%dx%d:colors=0x66ff99:scale=sqrt[wv];"
                    "color=c=black:s=%dx%d[bg];[bg][wv]overlay=format=auto,format=rgb24" % (pre, w, 160, w, 160),
                    "-frames:v", "1", tmp_w], check=True)
    # Stack: scale waveform to spectrogram image width, align left offset by legend margin
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", tmp_s],
                           capture_output=True, text=True).stdout.strip().split(",")
    sw = int(probe[0])
    left = (sw - w) // 2
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp_w, "-i", tmp_s, "-filter_complex",
                    "[0:v]pad=w=%d:h=ih:x=%d:y=0:color=0x202020[a];[a][1:v]vstack=inputs=2" % (sw, left),
                    "-frames:v", "1", args.out], check=True)
    os.remove(tmp_s)
    os.remove(tmp_w)
    print(args.out)


def cmd_sheet(args):
    """Grid of small waveform+spectrogram tiles, one per hit (row-major order)."""
    if args.times:
        times = [float(t) for t in args.times.split(",") if t.strip()]
    else:
        chans, sr = al.decode(args.file)
        x = al.to_mono(chans, args.chan)
        if args.hp:
            x = al.highpass(x, args.hp, sr, order=4)
        hits, _ = detect_hits(x, sr, args.thr, args.gap, args.maxlen, args.rise)
        times = [h["t"] for h in hits if h["iso"] > args.miniso]
    w, hs, hw = args.tw, args.th, 48
    tiles = []
    tmpdir = args.out + ".tiles"
    os.makedirs(tmpdir, exist_ok=True)
    for i, t in enumerate(times):
        st = max(0.0, t - args.pre)
        trim = "atrim=start=%f:duration=%f,asetpts=PTS-STARTPTS,aformat=channel_layouts=mono" % (st, args.win + args.pre)
        tile = os.path.join(tmpdir, "t%03d.png" % i)
        fc = ("[0:a]%s,apad=whole_dur=%f,asplit=2[a][b];"
              "[a]showspectrumpic=s=%dx%d:mode=combined:color=intensity:scale=log:fscale=log:legend=0:drange=100[s];"
              "[b]showwavespic=s=%dx%d:colors=0x66ff99:scale=sqrt[wv];color=c=black:s=%dx%d[bg];"
              "[bg][wv]overlay=format=auto,format=rgb24[w];"
              "[w][s]vstack=inputs=2,pad=w=iw+4:h=ih+4:x=2:y=2:color=0x404040" % (
                  trim, args.win + args.pre, w, hs, w, hw, w, hw))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", args.file, "-filter_complex", fc,
                        "-frames:v", "1", tile], check=True)
        tiles.append(tile)
    if not tiles:
        print("no tiles")
        return
    cols = min(args.cols, len(tiles))
    tw, th = w + 4, hs + hw + 4
    layout = "|".join("%d_%d" % ((k % cols) * tw, (k // cols) * th) for k in range(len(tiles)))
    inputs = []
    for t in tiles:
        inputs += ["-i", t]
    if len(tiles) == 1:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tiles[0], args.out], check=True)
    else:
        subprocess.run(["ffmpeg", "-v", "error", "-y"] + inputs + [
            "-filter_complex", "%sxstack=inputs=%d:layout=%s:fill=0x202020" % (
                "".join("[%d:v]" % k for k in range(len(tiles))), len(tiles), layout),
            "-frames:v", "1", args.out], check=True)
    for t in tiles:
        os.remove(t)
    os.rmdir(tmpdir)
    print(args.out)
    print("tiles (row-major):", ", ".join("%d:%.3f" % (k, t) for k, t in enumerate(times)))


def cmd_features(args):
    """Per-file timbre/structure summary used to pick varied, clean one-shots."""
    print("%-18s %6s %7s %7s %7s %6s %6s %5s %6s %6s" % (
        "file", "dur", "cen20", "cenAll", "roll85", "lo500", "t60ms", "subs", "tailDb", "hfDb"))
    for path in args.files:
        chans, sr = al.decode(path, channels=1)
        x = chans[0]
        n = len(x)
        pk = al.peak(x) or 1e-9
        head = x[: int(0.02 * sr)]
        cen20 = al.spectral_centroid(head, sr, nfft=1024) if len(head) > 64 else 0
        nfft = 1
        while nfft < min(n, 32768):
            nfft <<= 1
        mags, df = al.mag_spectrum(x[:nfft], sr, nfft)
        pw = [m * m for m in mags]
        tot = sum(pw) or 1e-20
        cen = sum(p * k * df for k, p in enumerate(pw)) / tot
        acc = 0.0
        roll = 0.0
        for k, p in enumerate(pw):
            acc += p
            if acc >= 0.85 * tot:
                roll = k * df
                break
        lo = sum(pw[: int(500 / df)]) / tot
        hf = sum(pw[int(10000 / df):]) / tot
        # decay: time from peak until 5 ms envelope falls 30 dB below peak env
        hop = int(0.005 * sr)
        env = al.frame_rms(x, hop)
        pe = max(env) or 1e-9
        pi = env.index(pe)
        t30 = len(env)
        for k in range(pi, len(env)):
            if env[k] < pe * 10 ** (-30 / 20):
                t30 = k
                break
        # secondary transients: 1 ms peak bins rising >10 dB over previous 5 ms, within 9 dB of peak
        b = int(0.001 * sr)
        bins = [max((abs(v) for v in x[i:i + b]), default=0) for i in range(0, n, b)]
        subs = 0
        for k in range(15, len(bins)):
            prev = max(bins[max(0, k - 5):k])
            if bins[k] > pk * 10 ** (-9 / 20) and bins[k] > 3.16 * prev:
                subs += 1
        tail = al.db(al.rms(x[-int(0.01 * sr):]) / pk) if n > sr * 0.01 else 0
        print("%-18s %5.0fms %6.0fHz %6.0fHz %6.0fHz %5.1f%% %5.0fms %5d %6.1f %6.1f" % (
            os.path.basename(path)[:18], 1000 * n / sr, cen20, cen, roll, 100 * lo,
            (t30 - pi) * 5, subs, tail, 10 * math.log10(max(hf, 1e-12))))


def cmd_tiles(args):
    """Grid of waveform+spectrogram tiles, one per whole file (row-major order)."""
    w, hs, hw = args.tw, args.th, 48
    tmpdir = args.out + ".tiles"
    os.makedirs(tmpdir, exist_ok=True)
    tiles = []
    for i, f in enumerate(args.files):
        tile = os.path.join(tmpdir, "t%03d.png" % i)
        pad = "apad=whole_dur=%f," % args.dur if args.dur else ""
        trim = "atrim=duration=%f," % args.dur if args.dur else ""
        fc = ("[0:a]aformat=channel_layouts=mono,%s%sasplit=2[a][b];"
              "[a]showspectrumpic=s=%dx%d:mode=combined:color=intensity:scale=log:fscale=log:legend=0:drange=100[s];"
              "[b]showwavespic=s=%dx%d:colors=0x66ff99:scale=sqrt[wv];color=c=black:s=%dx%d[bg];"
              "[bg][wv]overlay=format=auto,format=rgb24[w];"
              "[w][s]vstack=inputs=2,pad=w=iw+4:h=ih+4:x=2:y=2:color=0x404040" % (
                  trim, pad, w, hs, w, hw, w, hw))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f, "-filter_complex", fc,
                        "-frames:v", "1", tile], check=True)
        tiles.append(tile)
    cols = min(args.cols, len(tiles))
    tw, th = w + 4, hs + hw + 4
    layout = "|".join("%d_%d" % ((k % cols) * tw, (k // cols) * th) for k in range(len(tiles)))
    inputs = []
    for t in tiles:
        inputs += ["-i", t]
    if len(tiles) == 1:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tiles[0], args.out], check=True)
    else:
        subprocess.run(["ffmpeg", "-v", "error", "-y"] + inputs + [
            "-filter_complex", "%sxstack=inputs=%d:layout=%s:fill=0x202020" % (
                "".join("[%d:v]" % k for k in range(len(tiles))), len(tiles), layout),
            "-frames:v", "1", args.out], check=True)
    for t in tiles:
        os.remove(t)
    os.rmdir(tmpdir)
    print(args.out)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    ft = sub.add_parser("features")
    ft.add_argument("files", nargs="+")
    tl = sub.add_parser("tiles")
    tl.add_argument("out")
    tl.add_argument("files", nargs="+")
    tl.add_argument("--dur", type=float, default=None, help="pad/trim every tile to this many seconds")
    tl.add_argument("--cols", type=int, default=5)
    tl.add_argument("--tw", type=int, default=300)
    tl.add_argument("--th", type=int, default=120)
    sh = sub.add_parser("sheet")
    sh.add_argument("file")
    sh.add_argument("out")
    sh.add_argument("--times", default=None)
    sh.add_argument("--win", type=float, default=0.4)
    sh.add_argument("--pre", type=float, default=0.01)
    sh.add_argument("--cols", type=int, default=6)
    sh.add_argument("--tw", type=int, default=260)
    sh.add_argument("--th", type=int, default=120)
    sh.add_argument("--thr", type=float, default=None)
    sh.add_argument("--gap", type=float, default=60)
    sh.add_argument("--maxlen", type=float, default=700)
    sh.add_argument("--rise", type=float, default=9.0)
    sh.add_argument("--hp", type=float, default=40)
    sh.add_argument("--chan", default="mix")
    sh.add_argument("--miniso", type=float, default=20.0)
    s = sub.add_parser("stats")
    s.add_argument("files", nargs="+")
    h = sub.add_parser("hits")
    h.add_argument("file")
    h.add_argument("--thr", type=float, default=None)
    h.add_argument("--gap", type=float, default=60)
    h.add_argument("--maxlen", type=float, default=700)
    h.add_argument("--rise", type=float, default=9.0)
    h.add_argument("--hp", type=float, default=40)
    h.add_argument("--chan", default="mix")
    pt = sub.add_parser("pitch")
    pt.add_argument("file")
    pt.add_argument("--start", type=float, default=None)
    pt.add_argument("--len", type=float, default=0.5)
    sp = sub.add_parser("spectro")
    sp.add_argument("file")
    sp.add_argument("out")
    sp.add_argument("--start", type=float, default=None)
    sp.add_argument("--dur", type=float, default=None)
    sp.add_argument("--w", type=int, default=1400)
    sp.add_argument("--h", type=int, default=400)
    a = p.parse_args()
    {"stats": cmd_stats, "hits": cmd_hits, "pitch": cmd_pitch, "spectro": cmd_spectro,
     "sheet": cmd_sheet, "tiles": cmd_tiles, "features": cmd_features}[a.cmd](a)


if __name__ == "__main__":
    main()
