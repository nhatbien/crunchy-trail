#!/usr/bin/env python3
"""Parse a saved Freesound search-results HTML page into a compact table.

Usage: python3 -I fs_search_parse.py page.html [page2.html ...]

Prints one line per result:
  id  user  uid  dur(s)  sr  downloads  rating(n)  license  title | description
The HTML is treated purely as data (regex extraction only).
"""
import html
import re
import sys


def attr(block, name):
    m = re.search(r'%s="([^"]*)"' % re.escape(name), block)
    return html.unescape(m.group(1)) if m else ""


def parse(text):
    out = []
    parts = text.split('<div class="bw-search__result"')
    for block in parts[1:]:
        sid = attr(block, "data-sound-id")
        if not sid:
            continue
        rating = ""
        m = re.search(r'aria-label="Average rating of ([0-9.]+)"', block)
        if m:
            rating = m.group(1)
        m = re.search(r'bw-rating__count[^>]*>\(?(\d*)\)?<', block)
        nrat = m.group(1) if m and m.group(1) else "0"
        m = re.search(r'title="License: ([^"]+)"', block)
        lic = m.group(1) if m else "?"
        m = re.search(r'max-h-60px-md-50px[^>]*>\s*(.*?)\s*</div>', block, re.S)
        desc = re.sub(r"<[^>]+>", " ", m.group(1)) if m else ""
        desc = re.sub(r"\s+", " ", html.unescape(desc)).strip()
        tags = re.findall(r'href="/browse/tags/([^/"]+)/"', block)
        out.append({
            "id": sid,
            "user": attr(block, "data-username"),
            "uid": attr(block, "data-user-id"),
            "title": attr(block, "data-title"),
            "dur": attr(block, "data-duration"),
            "sr": attr(block, "data-samplerate").replace(".0", ""),
            "dl": attr(block, "data-num-downloads").strip(),
            "rating": rating,
            "nrat": nrat,
            "lic": lic,
            "desc": desc,
            "tags": tags,
        })
    return out


def main():
    seen = set()
    for path in sys.argv[1:]:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
        for r in parse(text):
            if r["id"] in seen:
                continue
            seen.add(r["id"])
            lic = {"Creative Commons 0": "CC0", "Attribution": "BY",
                   "Attribution NonCommercial": "BY-NC"}.get(r["lic"], r["lic"])
            print("%-7s %-22.22s %-9s %6.1fs %6s dl=%-6s r=%s(%s) %-5s %s | %.160s | tags=%s" % (
                r["id"], r["user"], r["uid"], float(r["dur"] or 0), r["sr"], r["dl"],
                r["rating"] or "-", r["nrat"], lic, r["title"], r["desc"],
                ",".join(r["tags"][:8])))


if __name__ == "__main__":
    main()
