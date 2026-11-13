#!/usr/bin/env bash
# Render the combined Al-Mawārīth + Meeras promotion material from promo.html.
#   ./render.sh
# Output goes to out/:
#   social-1-know-your-shares.jpg   1080 x 1080
#   social-2-without-a-will.jpg     1080 x 1080
#   social-3-who-inherits.jpg       1080 x 1080
#   story-know-your-shares.jpg      1080 x 1920
#   flyer-a4.png and flyer-a4.pdf   A4 portrait, 2480 x 3508 (300 dpi)
# macOS only: uses the system WebKit and Core Image through render.swift, and sips.
# Needs a network connection (Fraunces and DM Sans come from Google Fonts).
set -euo pipefail
cd "$(dirname "$0")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p out
swiftc -O render.swift -o "$TMP/render-promo"

# QR codes for the flyer. The tags let each site's analytics count visits from the flyer.
"$TMP/render-promo" qr "https://almawarith.com/?utm_source=flyer&utm_medium=print&utm_campaign=au-launch" assets/qr-almawarith.png
"$TMP/render-promo" qr "https://meeras.com.au/?utm_source=flyer&utm_medium=print&utm_campaign=au-launch" assets/qr-meeras.png

jpg() {  # jpg <variant> <css-w> <css-h> <longest side in px> <output name>
  "$TMP/render-promo" page "$1" "$2" "$3" "$TMP/$5.png" >/dev/null
  sips -Z "$4" -s format jpeg -s formatOptions 92 "$TMP/$5.png" --out "out/$5.jpg" >/dev/null
  echo "  out/$5.jpg"
}
jpg hero     1080 1080 1080 social-1-know-your-shares
jpg problem  1080 1080 1080 social-2-without-a-will
jpg question 1080 1080 1080 social-3-who-inherits
jpg story    1080 1920 1920 story-know-your-shares

"$TMP/render-promo" page flyer 1240 1754 "$TMP/flyer.png" >/dev/null
sips -Z 3508 "$TMP/flyer.png" --out out/flyer-a4.png >/dev/null
sips -s format pdf out/flyer-a4.png --out out/flyer-a4.pdf >/dev/null
echo "  out/flyer-a4.png"
echo "  out/flyer-a4.pdf"
