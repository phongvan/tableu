#!/usr/bin/env bash
# Chep CodeMirror 5 tu node_modules vao renderer/vendor/.
# Vi sao khong dung bundler: CSP cua app chi cho 'self', va du an co chu truong
# khong co buoc build. CodeMirror 5 la UMD mot file nen tha vao la chay.
# CodeMirror 6 la ESM nhieu goi -> se ep them bundler, dung nang cap sang.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/node_modules/codemirror"
DST="$ROOT/renderer/vendor/codemirror"

[ -d "$SRC" ] || { echo "Chua co node_modules/codemirror — chay: npm i -D codemirror@5"; exit 1; }

rm -rf "$DST"
for f in lib/codemirror.js lib/codemirror.css \
         mode/sql/sql.js \
         addon/hint/show-hint.js addon/hint/show-hint.css addon/hint/sql-hint.js \
         addon/edit/matchbrackets.js addon/edit/closebrackets.js \
         addon/comment/comment.js addon/display/placeholder.js \
         addon/selection/active-line.js; do
  mkdir -p "$DST/$(dirname "$f")"
  cp "$SRC/$f" "$DST/$f"
done
cp "$SRC/LICENSE" "$DST/LICENSE"
echo "CodeMirror $(node -p "require('$SRC/package.json').version") -> renderer/vendor/codemirror ($(du -sh "$DST" | cut -f1))"
