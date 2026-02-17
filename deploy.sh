#!/bin/bash
# deploy.sh - Push to both Google Apps Script and GitHub
# Only pulls if behind remote, avoids unnecessary rebases

set -e  # Exit on error

echo "📧 Job Co-Pilot Deploy"
echo "═══════════════════════════════════════"

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
  echo ""
  echo "📝 Enter commit message:"
  read MESSAGE

  if [ -z "$MESSAGE" ]; then
    echo "❌ No message provided. Aborting."
    exit 1
  fi

  # Stage and commit local changes
  echo ""
  echo "📦 Committing local changes..."
  git add .
  git commit -m "$MESSAGE"
else
  echo ""
  echo "ℹ️  No local changes to commit."
fi

# Fetch remote to check status (doesn't change anything)
echo ""
echo "🔍 Checking remote..."
git fetch origin main --quiet

# Check if we're behind remote
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
BASE=$(git merge-base HEAD origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "✓ Already up to date with remote."
elif [ "$LOCAL" = "$BASE" ]; then
  # We're behind remote, need to pull
  echo "⬇️  Behind remote. Pulling changes..."
  if ! git pull --rebase origin main; then
    echo ""
    echo "⚠️  Rebase conflict detected!"
    echo ""
    echo "To resolve:"
    echo "  1. Fix conflicts in the listed files"
    echo "  2. git add <fixed-files>"
    echo "  3. git rebase --continue"
    echo "  4. Run ./deploy.sh again"
    echo ""
    echo "Or to abort: git rebase --abort"
    exit 1
  fi
elif [ "$REMOTE" = "$BASE" ]; then
  # Remote is behind us, we're ahead - just push
  echo "✓ Ahead of remote. Will push."
else
  # Diverged - need to rebase
  echo "⬇️  Diverged from remote. Rebasing..."
  if ! git pull --rebase origin main; then
    echo ""
    echo "⚠️  Rebase conflict detected!"
    echo ""
    echo "To resolve:"
    echo "  1. Fix conflicts in the listed files"
    echo "  2. git add <fixed-files>"
    echo "  3. git rebase --continue"
    echo "  4. Run ./deploy.sh again"
    echo ""
    echo "Or to abort: git rebase --abort"
    exit 1
  fi
fi

# Push to GitHub
echo ""
echo "📤 Pushing to GitHub..."
git push origin main

# Push to Google Apps Script
echo ""
echo "📤 Pushing to Google Apps Script..."
clasp push

echo ""
echo "═══════════════════════════════════════"
echo "✅ Deployed successfully!"
echo "═══════════════════════════════════════"
```

---

## Logic

| Situation | What Happens |
|-----------|--------------|
| `LOCAL = REMOTE` | Already synced, just push to clasp |
| `LOCAL = BASE` | We're behind, pull first |
| `REMOTE = BASE` | We're ahead, just push |
| Neither | Diverged, rebase then push |

---

## Flow
```
1. Commit local changes (if any)
2. Fetch remote (check only, no changes)
3. Compare commits:
   - Same? → Skip pull
   - Behind? → Pull with rebase
   - Ahead? → Skip pull
   - Diverged? → Pull with rebase
4. Push to GitHub
5. Push to Apps Script