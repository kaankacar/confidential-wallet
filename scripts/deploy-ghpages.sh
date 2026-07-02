#!/usr/bin/env bash
# Build the site for the GitHub Pages subpath and publish the prebuilt dist/ to
# the gh-pages branch. We publish PREBUILT output (not a CI build) because
# @ctd/sdk is a local `link:` that only resolves on this machine.
set -euo pipefail

REPO="https://github.com/kaankacar/confidential-wallet.git"
BASE="/confidential-wallet/"
cd "$(dirname "$0")/.."

echo "→ vendoring bb.js + CRS for base $BASE"
PUBLIC_BASE="$BASE" pnpm vendor:bb

echo "→ building"
pnpm exec vite build --base="$BASE"
touch dist/.nojekyll   # let GitHub Pages serve _-prefixed / vendored files as-is

echo "→ publishing dist/ to gh-pages"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo build)"
tmp="$(mktemp -d)"
cp -R dist/. "$tmp/"
(
  cd "$tmp"
  git init -q -b gh-pages
  git add -A
  git -c user.name="Kaan Kacar" -c user.email="kaan.kacar@stellar.org" commit -qm "deploy $SHA"
  git push -f -q "$REPO" gh-pages
)
rm -rf "$tmp"

echo "→ restoring dev vendoring (base /)"
pnpm vendor:bb >/dev/null

echo "✓ published. Live at https://kaankacar.github.io/confidential-wallet/ (first build ~1 min)"
