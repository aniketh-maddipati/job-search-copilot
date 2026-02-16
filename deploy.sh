#!/bin/bash
# deploy.sh - Push to both Google Apps Script and GitHub

# Prompt for commit message
echo "📝 Enter commit message:"
read MESSAGE

# Check if message is empty
if [ -z "$MESSAGE" ]; then
  echo "❌ No message provided. Aborting."
  exit 1
fi

echo ""
echo "📤 Pushing to Google Apps Script..."
clasp push

echo ""
echo "📤 Pushing to GitHub..."
git add .
git commit -m "$MESSAGE"
git push

echo ""
echo "✅ Deployed with message: $MESSAGE"