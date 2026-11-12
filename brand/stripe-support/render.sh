#!/usr/bin/env bash
# Render the four Meeras Support product images from card.html to 1600x1600 JPEG
# (Stripe product images must be JPEG, PNG or WEBP under 2 MB).
#   ./render.sh
# macOS only: uses the system WebKit through render.swift, and sips to resize.
# Needs a network connection (Fraunces and DM Sans come from Google Fonts).
set -euo pipefail
cd "$(dirname "$0")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
swiftc -O render.swift -o "$TMP/render-card"
render() {  # render <variant> <output name without extension>
  "$TMP/render-card" "$1" "$TMP/$2.png" >/dev/null
  sips -Z 1600 -s format jpeg -s formatOptions 92 "$TMP/$2.png" --out "$2.jpg" >/dev/null
  echo "  $2.jpg"
}
render heart  meeras-support
render coffee meeras-support-5-coffee
render domain meeras-support-15-domain
render server meeras-support-50-hosting
