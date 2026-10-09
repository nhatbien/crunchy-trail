#!/bin/zsh
# Generates game art with Codex CLI image generation, one image per run.
cd "$(dirname "$0")"
gen() {
  local name="$1"; shift
  local prompt="$*"
  [[ -f "raw/$name.png" ]] && { echo "skip $name"; return; }
  echo "=== $name $(date +%T)"
  codex exec -m gpt-5.6-sol --enable image_generation --skip-git-repo-check -s workspace-write -C "$(pwd)" \
    "Read STYLE.md for the art direction. Use your built-in image generation tool (do NOT draw with code, do NOT use python/PIL/svg) to create this image: ${prompt} When done, copy the generated PNG to ./raw/${name}.png (find it wherever the tool saved it, e.g. ~/.codex/generated_images), verify the file exists, and print its absolute path." \
    > "raw/$name.log" 2>&1
  ls -la "raw/$name.png" 2>/dev/null || echo "FAILED $name"
}
gen icon "A square 1024x1024 mobile game APP ICON with NO text and NO letters. Subject: the cute Mochi blob character happily squishing down on a sheet of glossy bubble wrap, two or three bubbles popping with tiny white sparkles, mint-to-sky pastel gradient background, soft clay 3D render, centered, character fills about 65% of the frame, strong readable silhouette at small sizes, full-bleed square (no border, no rounded corners, no transparency)."
gen keyart_land "A wide 1536x1024 landscape key art for a cozy ASMR game, NO text, NO logos, NO UI. A small floating pastel island in a soft sky; the cute Mochi blob character walks along a winding trail and everything it touched is satisfyingly transformed: behind it popped bubble wrap, freshly mowed stripes in lush grass, footprints in fresh snow, crunchy orange autumn leaves scattered, smooth cut lines in pink kinetic sand. Tiny sparkles and particles in the air. Soft clay 3D render, dreamy pastel lighting, high detail, very satisfying, YouTube thumbnail quality."
gen keyart_port "A tall 1024x1536 portrait key art, NO text, NO logos, NO UI. The cute Mochi blob character in the lower-middle area, squishing a glossy jelly cube that wobbles, surrounded by satisfying materials: bubble wrap, rainbow pop-it fidget domes, pastel kalimba keys glowing with notes, icy crystals. The top third is calm soft pastel sky gradient (lilac to peach) left clear for a title. Soft clay 3D render, dreamy, satisfying ASMR vibe."
gen logo "A game title logo that reads exactly CRUNCHY TRAIL (two words, all caps, spelled C-R-U-N-C-H-Y T-R-A-I-L), chunky rounded bubbly 3D letters like soft squishy candy/mochi, cream-white letters with peach and mint glossy shading and a thick soft coral outline, slight playful bounce in letter placement, a tiny cute Mochi blob peeking over the letter Y. Centered on a plain solid pure white background with generous margin, nothing else in the image. 1536x1024."
echo "=== ALL DONE $(date +%T)"
