#!/bin/bash
set -e
echo "🚀 Syncing..."
[[ -n $(git status -s) ]] && read -p "Commit: " m && git add . && git commit -m "$m"
git push origin main && clasp push && echo "✅ Done!"
