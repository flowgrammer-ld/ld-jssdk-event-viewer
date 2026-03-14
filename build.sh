#!/usr/bin/env bash
#
# Build script for the LD SDK Event Viewer bookmarklet.
#
# Copies the bookmarklet source files and shared utilities into
# docs/dist/v1/ so they can be served via GitHub Pages at a stable
# versioned path.
#
# Usage:
#   ./build.sh                   # builds to docs/dist/v1
#   ./build.sh v2                # builds to docs/dist/v2
#
set -euo pipefail

VERSION="${1:-v1}"
SRC_DIR="bookmarklet"
SHARED_DIR="shared"
DIST_DIR="docs/dist/${VERSION}"

echo "==> Building bookmarklet assets into ${DIST_DIR}/"

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

# Copy shared utilities
cp "${SHARED_DIR}/ld-utils.js" "${DIST_DIR}/ld-utils.js" && chmod 644 "${DIST_DIR}/ld-utils.js"
echo "    ld-utils.js (shared)"

# Copy bookmarklet modules
for f in loader.js interceptors.js panel-html.js panel.js bookmarklet.css; do
  cp "${SRC_DIR}/${f}" "${DIST_DIR}/${f}" && chmod 644 "${DIST_DIR}/${f}"
  echo "    ${f}"
done

echo "==> Done. Assets available at ${DIST_DIR}/"
echo ""
echo "GitHub Pages URL pattern:"
echo "  https://<user>.github.io/<repo>/dist/${VERSION}/loader.js"
