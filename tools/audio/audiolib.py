"""Small numpy-free audio helpers for the Crunchy Trail audio pipeline.

All signal processing here is plain Python (array module + math) so the scripts
run with `python3 -I` and no third-party packages. ffmpeg/ffprobe do the
decoding/encoding.
"""
import array
import cmath
import json
import math
import subprocess
import sys

SR = 44100
FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"


# ----------------------------------------------------------------------------
# I/O
# ----------------------------------------------------------------------------

def probe(path):
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries",
         "stream=codec_name,sample_rate,channels,bit_rate:format=duration,bit_rate",
         "-of", "json", path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def decode(path, sr=SR, channels=None, start=None, dur=None):
    """Decode any audio file to float32 PCM at `sr`.

    Returns (list_of_channel_arrays, sr). `channels` None keeps the source
    channel count (max 2)."""
    if channels is None:
        try:
            ch = int(probe(path)["streams"][0].get("channels", 1))
        except Exception:
            ch = 1
        channels = 2 if ch >= 2 else 1
    cmd = [FFMPEG, "-v", "error", "-nostdin"]
    if start is not None:
        cmd += ["-ss", "%.6f" % start]
    cmd += ["-i", path]
    if dur is not None:
        cmd += ["-t", "%.6f" % dur]
    cmd += ["-vn", "-ac", str(channels), "-ar", str(sr), "-f", "f32le", "-acodec", "pcm_f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    a = array.array("f")
    a.frombytes(raw[: len(raw) - len(raw) % 4])
    if sys.byteorder != "little":
        a.byteswap()
    if channels == 1:
        return [a], sr
    chans = [a[i::channels] for i in range(channels)]
    return chans, sr


def to_mono(chans, mode="mix"):
    if len(chans) == 1:
        return array.array("f", chans[0])
    l, r = chans[0], chans[1]
    if mode == "left":
        return array.array("f", l)
    if mode == "right":
        return array.array("f", r)
    return array.array("f", [(a + b) * 0.5 for a, b in zip(l, r)])


def write_f32(path, x):
    a = array.array("f", x)
    if sys.byteorder != "little":
        a.byteswap()
    with open(path, "wb") as f:
        a.tofile(f)


def encode_mp3(x, out_path, sr=SR, bitrate="128k", extra=None):
    """Encode mono float samples to MP3 via ffmpeg/libmp3lame (mono, sr)."""
    a = array.array("f", x)
    if sys.byteorder != "little":
        a.byteswap()
    cmd = [FFMPEG, "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", str(sr), "-ac", "1",
           "-i", "-", "-c:a", "libmp3lame", "-b:a", bitrate, "-ac", "1", "-ar", str(sr)]
    if extra:
        cmd += extra
    cmd += ["-map_metadata", "-1", "-id3v2_version", "0", "-write_id3v1", "0", out_path]
    subprocess.run(cmd, input=a.tobytes(), check=True)


# ----------------------------------------------------------------------------
# Basic measurements
# ----------------------------------------------------------------------------

def db(v, floor=1e-12):
    return 20.0 * math.log10(max(abs(v), floor))


def peak(x):
    return max((abs(v) for v in x), default=0.0)


def rms(x):
    n = len(x)
    if n == 0:
        return 0.0
    return math.sqrt(sum(v * v for v in x) / n)


def frame_rms(x, hop, win=None):
    """RMS envelope with hop `hop` samples and window `win` (default = hop)."""
    win = win or hop
    n = len(x)
    # cumulative sum of squares for O(1) windows
    cs = array.array("d", [0.0]) * (n + 1)
    acc = 0.0
    for i, v in enumerate(x):
        acc += v * v
        cs[i + 1] = acc
    env = []
    i = 0
    while i < n:
        a = i
        b = min(n, i + win)
        e = (cs[b] - cs[a]) / max(1, b - a)
        env.append(math.sqrt(max(e, 0.0)))
        i += hop
    return env


def percentile(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    k = (len(s) - 1) * p / 100.0
    f = math.floor(k)
    c = min(len(s) - 1, f + 1)
    return s[f] + (s[c] - s[f]) * (k - f)


def correlation(a, b):
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    sab = saa = sbb = 0.0
    for i in range(n):
        x = a[i]
        y = b[i]
        sab += x * y
        saa += x * x
        sbb += y * y
    if saa <= 0 or sbb <= 0:
        return 0.0
    return sab / math.sqrt(saa * sbb)


def clip_runs(x, thr=0.999, minrun=3):
    """Count runs of >= minrun consecutive samples at |x| >= thr (clipping)."""
    runs = 0
    cur = 0
    for v in x:
        if abs(v) >= thr:
            cur += 1
        else:
            if cur >= minrun:
                runs += 1
            cur = 0
    if cur >= minrun:
        runs += 1
    return runs


# ----------------------------------------------------------------------------
# Filters
# ----------------------------------------------------------------------------

def biquad_coeffs(kind, f0, sr, q=0.7071, gain_db=0.0):
    """RBJ audio-EQ-cookbook biquad coefficients (b0,b1,b2,a1,a2) normalized."""
    w0 = 2 * math.pi * f0 / sr
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    A = 10 ** (gain_db / 40.0)
    if kind == "highpass":
        b0, b1, b2 = (1 + cw) / 2, -(1 + cw), (1 + cw) / 2
        a0, a1, a2 = 1 + alpha, -2 * cw, 1 - alpha
    elif kind == "lowpass":
        b0, b1, b2 = (1 - cw) / 2, 1 - cw, (1 - cw) / 2
        a0, a1, a2 = 1 + alpha, -2 * cw, 1 - alpha
    elif kind == "highshelf":
        sq = 2 * math.sqrt(A) * alpha
        b0 = A * ((A + 1) + (A - 1) * cw + sq)
        b1 = -2 * A * ((A - 1) + (A + 1) * cw)
        b2 = A * ((A + 1) + (A - 1) * cw - sq)
        a0 = (A + 1) - (A - 1) * cw + sq
        a1 = 2 * ((A - 1) - (A + 1) * cw)
        a2 = (A + 1) - (A - 1) * cw - sq
    elif kind == "lowshelf":
        sq = 2 * math.sqrt(A) * alpha
        b0 = A * ((A + 1) - (A - 1) * cw + sq)
        b1 = 2 * A * ((A - 1) - (A + 1) * cw)
        b2 = A * ((A + 1) - (A - 1) * cw - sq)
        a0 = (A + 1) + (A - 1) * cw + sq
        a1 = -2 * ((A - 1) + (A + 1) * cw)
        a2 = (A + 1) + (A - 1) * cw - sq
    elif kind == "peak":
        b0, b1, b2 = 1 + alpha * A, -2 * cw, 1 - alpha * A
        a0, a1, a2 = 1 + alpha / A, -2 * cw, 1 - alpha / A
    else:
        raise ValueError(kind)
    return (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)


def biquad(x, c):
    b0, b1, b2, a1, a2 = c
    y = array.array("f", bytes(4 * len(x)))
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, v
        y2, y1 = y1, o
        y[i] = o
    return y


def highpass(x, f0, sr=SR, order=2):
    """Butterworth-ish highpass: order 2 (one biquad) or 4 (two biquads)."""
    if order == 4:
        y = biquad(x, biquad_coeffs("highpass", f0, sr, q=0.5412))
        return biquad(y, biquad_coeffs("highpass", f0, sr, q=1.3066))
    return biquad(x, biquad_coeffs("highpass", f0, sr, q=0.7071))


def lowpass(x, f0, sr=SR, order=2):
    if order == 4:
        y = biquad(x, biquad_coeffs("lowpass", f0, sr, q=0.5412))
        return biquad(y, biquad_coeffs("lowpass", f0, sr, q=1.3066))
    return biquad(x, biquad_coeffs("lowpass", f0, sr, q=0.7071))


def remove_dc(x):
    n = len(x)
    if n == 0:
        return x
    m = sum(x) / n
    return array.array("f", [v - m for v in x])


def k_weight(x, sr=SR):
    """ITU-R BS.1770 K-weighting (pre-filter shelf + RLB highpass)."""
    y = biquad(x, biquad_coeffs("highshelf", 1681.974450955533, sr, q=0.7071752369554196,
                                gain_db=3.999843853973347))
    return biquad(y, biquad_coeffs("highpass", 38.13547087602444, sr, q=0.5003270373238773))


def loudness_stats(x, sr=SR):
    """Short-sound loudness proxies on the K-weighted signal (dB, LUFS-like):
    - m400: max 400 ms window mean-square (momentary loudness, BS.1770 style)
    - s100: max 100 ms window
    - act:  mean-square over the region within 20 dB of the max 10 ms frame
    """
    k = k_weight(x, sr)
    sq = [v * v for v in k]
    n = len(sq)
    cs = [0.0] * (n + 1)
    acc = 0.0
    for i, v in enumerate(sq):
        acc += v
        cs[i + 1] = acc

    def maxwin(w):
        w = int(w * sr)
        best = 0.0
        step = max(1, int(0.005 * sr))
        if n <= w:
            return cs[n] / w  # zero-padded window
        for a in range(0, n - w + 1, step):
            e = (cs[a + w] - cs[a]) / w
            if e > best:
                best = e
        return best

    def lufs(ms):
        return -0.691 + 10 * math.log10(max(ms, 1e-12))

    m400 = lufs(maxwin(0.4))
    s100 = lufs(maxwin(0.1))
    hop = int(0.01 * sr)
    frames = [(cs[min(n, i + hop)] - cs[i]) / hop for i in range(0, n, hop)]
    if frames:
        mx = max(frames)
        act = [f for f in frames if f >= mx * 0.01]
        actv = sum(act) / len(act)
    else:
        actv = 0.0
    return {"m400": m400, "s100": s100, "act": lufs(actv)}


# ----------------------------------------------------------------------------
# FFT / spectral helpers
# ----------------------------------------------------------------------------

def fft(a):
    """Iterative radix-2 FFT on a list of complex numbers (len power of two)."""
    n = len(a)
    a = list(a)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j ^= bit
        if i < j:
            a[i], a[j] = a[j], a[i]
    length = 2
    while length <= n:
        ang = -2 * math.pi / length
        wl = cmath.exp(1j * ang)
        half = length // 2
        tw = [1.0 + 0j] * half
        for k in range(1, half):
            tw[k] = tw[k - 1] * wl
        for i in range(0, n, length):
            for k in range(half):
                u = a[i + k]
                v = a[i + k + half] * tw[k]
                a[i + k] = u + v
                a[i + k + half] = u - v
        length <<= 1
    return a


def mag_spectrum(x, sr=SR, nfft=None, window=True):
    n = len(x)
    if nfft is None:
        nfft = 1
        while nfft < n:
            nfft <<= 1
    buf = [0j] * nfft
    for i in range(min(n, nfft)):
        w = 0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1)) if (window and n > 1) else 1.0
        buf[i] = complex(x[i] * w, 0.0)
    X = fft(buf)
    half = nfft // 2
    mags = [abs(X[k]) for k in range(half + 1)]
    return mags, sr / nfft


def spectral_centroid(x, sr=SR, nfft=2048):
    seg = x[:nfft]
    if len(seg) < 32:
        return 0.0
    mags, df = mag_spectrum(seg, sr, nfft)
    num = sum(m * k * df for k, m in enumerate(mags))
    den = sum(mags)
    return num / den if den > 0 else 0.0


def band_energy_db(x, sr, f_lo, f_hi, nfft=8192):
    mags, df = mag_spectrum(x[:nfft], sr, nfft)
    lo = int(f_lo / df)
    hi = min(len(mags) - 1, int(f_hi / df))
    e = sum(m * m for m in mags[lo:hi + 1])
    tot = sum(m * m for m in mags) or 1e-20
    return 10 * math.log10(max(e / tot, 1e-12))


def midi_from_hz(f):
    return 69 + 12 * math.log2(f / 440.0)


NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_name(m):
    m = int(round(m))
    return "%s%d" % (NOTE_NAMES[m % 12], m // 12 - 1)
