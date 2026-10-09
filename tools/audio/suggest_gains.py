#!/usr/bin/env python3
"""Suggest manifest `gain` values from measured loudness (tools/audio/build_report.json).

Usage: python3 -I tools/audio/suggest_gains.py [--write tools/audio/recipe.json]

Files are mastered per group (loudest item peaks at -1 dBFS, others loudness-matched), so
groups differ in level; the gain compensates for that and sets the intended mix balance:
  one-shots: loudness L = mean(s100, m400) of the group's median item (K-weighted max
             100 ms / 400 ms windows); ambience/music: integrated K-weighted loudness.
  target(group) = T_star + offset; gain = 10^((target - L)/20), then all gains scaled so
  that `pop` (quietest star group) gets 0.9.
"""
import argparse
import json
import os
import re
import statistics

HERE = os.path.dirname(os.path.abspath(__file__))

STARS = ["pop", "popit", "grass", "snow", "leaves", "sand", "slime", "ice"]
OFFSET_DB = {  # intended level relative to the surface "star" sounds
    "wood": -6.0,      # coordinator: ~0.5 x stars
    "step": -9.0,      # coordinator: ~0.35 x stars
    "keys": -1.0,      # coordinator: ~0.8 vs stars ~0.9
    "leaves": +2.0,    # in-game feedback: leaves read a bit quiet vs. the rest
    "snow": -2.0,      # in-game feedback: snow reads a bit loud (long, bass-heavy crunches)
    "kalimba": -2.0, "coin": -3.0, "win": -1.0, "sparkle": -3.0,
    "ui_tap": -8.0, "ui_whoosh": -10.0,
    "amb_meadow": -15.0, "amb_winter": -15.0, "amb_cozy": -15.0,  # integrated LUFS vs. star short-term
    "music": -12.0,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", default=os.path.join(HERE, "build_report.json"))
    ap.add_argument("--write", default=None)
    a = ap.parse_args()
    rep = json.load(open(a.report))
    L = {}
    groups = {}
    for f, m in rep.items():
        groups.setdefault(m["group"], []).append(m)
    for g, ms in groups.items():
        if ms[0].get("kind") == "loop":
            L[g] = ms[0]["lufs"]
        else:
            L[g] = statistics.median(0.5 * (m["s100"] + m["m400"]) for m in ms)
    t_star = min(L[g] for g in STARS if g in L)  # quietest star group sets the reference
    raw = {}
    for g in L:
        off = OFFSET_DB.get(g, 0.0 if g in STARS else -6.0)
        raw[g] = 10 ** ((t_star + off - L[g]) / 20.0)
    scale = 0.9 / raw["pop"]
    gains = {g: round(min(1.0, v * scale), 2) for g, v in raw.items()}
    for g in sorted(gains, key=lambda k: -gains[k]):
        print("%-11s L=%6.1f  gain=%.2f" % (g, L[g], gains[g]))
    if a.write:
        # update '"<group>": {... "gain": X' in place to keep the recipe's compact layout
        txt = open(a.write).read()
        for g, v in gains.items():
            txt, n = re.subn(r'("%s":\s*\{[^{}]*?"gain":\s*)[0-9.]+' % re.escape(g), r"\g<1>%.2f" % v, txt, count=1)
            if n != 1:
                raise SystemExit("could not update gain for %s" % g)
        json.loads(txt)  # still valid JSON
        open(a.write, "w").write(txt)
        print("updated", a.write)


if __name__ == "__main__":
    main()
