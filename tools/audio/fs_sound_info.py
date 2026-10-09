#!/usr/bin/env python3
"""Extract metadata (license, author, preview URLs, technical info) from a saved
Freesound sound page (https://freesound.org/people/<user>/sounds/<id>/).

Usage: python3 -I fs_sound_info.py page.html  > info.json
The HTML is treated purely as data (regex extraction only).
"""
import html
import json
import re
import sys


def first(pattern, text, flags=0, default=""):
    m = re.search(pattern, text, flags)
    return html.unescape(m.group(1)).strip() if m else default


def main():
    path = sys.argv[1]
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        t = f.read()
    info = {}
    info["id"] = first(r'data-sound-id="(\d+)"', t)
    info["username"] = first(r'<meta property="og:audio:artist" content="([^"]*)"', t) or first(r'data-username="([^"]*)"', t)
    info["user_id"] = first(r'data-user-id="(\d+)"', t)
    info["title"] = first(r'<meta property="og:audio:title" content="([^"]*)"', t)
    info["page_url"] = first(r'data-sound-page-url="([^"]*)"', t)
    info["hq_mp3"] = first(r'data-static-file-url="([^"]*-hq\.mp3)"', t)
    if info["hq_mp3"]:
        info["hq_ogg"] = info["hq_mp3"][:-4] + ".ogg"
    # License: link to the full license text next to the license icon
    lic_url = first(r'<a title="Go to the full license text" href="([^"]+)"', t)
    lic_name = first(r'<a title="Go to the full license text" href="[^"]+"[^>]*>([^<]+)</a>', t)
    info["license_url"] = lic_url
    info["license"] = lic_name
    # Description (first block of <p> inside the description area)
    m = re.search(r'</a></p>\s*<p>(.*?)</div>', t, re.S)
    desc = ""
    m = re.search(r'Subcategory:[^>]*>[^<]*</a>\s*</div>(.*?)<a href="javascript:void\(0\);" title="Flag', t, re.S)
    if m:
        desc = re.sub(r"<[^>]+>", " ", m.group(1))
        desc = re.sub(r"\s+", " ", html.unescape(desc)).strip()
    info["description"] = desc
    # Technical table
    for key in ["Type", "Duration", "File size", "Sample rate", "Bit depth", "Channels"]:
        info[key.lower().replace(" ", "_")] = first(
            r'<p class="text-grey no-margins">%s</p>\s*</div>\s*<div[^>]*>\s*<p class="no-margins">([^<]*)</p>' % re.escape(key),
            t, re.S) or first(r'<p class="text-grey no-margins">%s</p>.{0,200}?<p class="no-margins">([^<]*)</p>' % re.escape(key), t, re.S)
    info["downloads"] = first(r'title="This sound has been downloaded (\d+) times"', t)
    info["rating"] = first(r'aria-label="Average rating of ([0-9.]+)"', t)
    info["tags"] = sorted(set(re.findall(r'href="/browse/tags/([^/"]+)/"', t)))
    info["is_cc0"] = ("publicdomain/zero/1.0" in lic_url)
    info["commercial_ok"] = bool(re.search(r"creativecommons\.org/(publicdomain/zero|licenses/by/)", lic_url)) and "nc" not in lic_url.lower()
    json.dump(info, sys.stdout, indent=1, ensure_ascii=False)
    print()


if __name__ == "__main__":
    main()
