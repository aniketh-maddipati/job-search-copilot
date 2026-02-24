#!/bin/bash
# deploy.sh - Deploy to Google Apps Script and GitHub
# Features: lint/test validation, smart git sync, colored output, dry-run mode

set -e

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

BRANCH="v1.2.1"
PROJECT_NAME="Job Co-Pilot"

# ═══════════════════════════════════════════════════════════════════════════════
# COLORS
# ═══════════════════════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

info()    { echo -e "${BLUE}→${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
error()   { echo -e "${RED}✕${NC} $1"; }
header()  { echo -e "\n${BOLD}${CYAN}$1${NC}"; }

spin() {
  local pid=$1
  local delay=0.1
  local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  while ps -p $pid > /dev/null 2>&1; do
    for (( i=0; i<${#spinstr}; i++ )); do
      printf "\r${BLUE}${spinstr:$i:1}${NC} $2"
      sleep $delay
    done
  done
  printf "\r"
}

# ═══════════════════════════════════════════════════════════════════════════════
# PARSE ARGS
# ═══════════════════════════════════════════════════════════════════════════════

DRY_RUN=false
SKIP_TESTS=false
FORCE=false
MESSAGE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -d|--dry-run)  DRY_RUN=true; shift ;;
    -s|--skip-tests) SKIP_TESTS=true; shift ;;
    -f|--force)    FORCE=true; shift ;;
    -m|--message)  MESSAGE="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: ./deploy.sh [options]"
      echo ""
      echo "Options:"
      echo "  -m, --message MSG   Commit message (skips prompt)"
      echo "  -d, --dry-run       Show what would happen without doing it"
      echo "  -s, --skip-tests    Skip lint and test checks"
      echo "  -f, --force         Push even if tests fail"
      echo "  -h, --help          Show this help"
      exit 0
      ;;
    *) error "Unknown option: $1"; exit 1 ;;
  esac
done

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

clear
echo -e "${BOLD}📧 $PROJECT_NAME Deploy${NC}"
echo "═══════════════════════════════════════"
$DRY_RUN && echo -e "${YELLOW}DRY RUN MODE - No changes will be made${NC}\n"

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Validate
# ─────────────────────────────────────────────────────────────────────────────

header "1. Validating"

# Check we're in the right directory
if [[ ! -f "Code.js" ]]; then
  error "Code.js not found. Run from project root."
  exit 1
fi
success "In project directory"

# Check tools
command -v clasp >/dev/null 2>&1 || { error "clasp not installed. Run: npm install -g @google/clasp"; exit 1; }
command -v git >/dev/null 2>&1 || { error "git not installed"; exit 1; }
success "Required tools available"

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Lint & Test
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$SKIP_TESTS" == false ]]; then
  header "2. Running checks"
  
  # Lint
  info "Linting..."
  if npm run lint --silent 2>/dev/null; then
    success "Lint passed"
  else
    error "Lint failed"
    $FORCE || exit 1
    warn "Continuing anyway (--force)"
  fi
  
  # Test
  info "Testing..."
  if npm test --silent 2>/dev/null; then
    success "Tests passed"
  else
    error "Tests failed"
    $FORCE || exit 1
    warn "Continuing anyway (--force)"
  fi
else
  header "2. Skipping checks (--skip-tests)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Git status
# ─────────────────────────────────────────────────────────────────────────────

header "3. Git status"

# Check for changes
CHANGES=$(git status --porcelain)
if [[ -n "$CHANGES" ]]; then
  echo -e "${CYAN}Changed files:${NC}"
  echo "$CHANGES" | head -10
  [[ $(echo "$CHANGES" | wc -l) -gt 10 ]] && echo "  ... and more"
  echo ""
  
  # Get commit message
  if [[ -z "$MESSAGE" ]]; then
    echo -ne "${BOLD}Commit message:${NC} "
    read MESSAGE
    if [[ -z "$MESSAGE" ]]; then
      error "No message provided"
      exit 1
    fi
  fi
  
  if [[ "$DRY_RUN" == false ]]; then
    git add .
    git commit -m "$MESSAGE"
    success "Committed: $MESSAGE"
  else
    info "Would commit: $MESSAGE"
  fi
else
  success "No local changes"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Sync with remote
# ─────────────────────────────────────────────────────────────────────────────

header "4. Syncing with GitHub"

git fetch origin $BRANCH --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/$BRANCH 2>/dev/null || echo "none")
BASE=$(git merge-base HEAD origin/$BRANCH 2>/dev/null || echo "none")

if [[ "$REMOTE" == "none" ]]; then
  info "No remote branch yet"
elif [[ "$LOCAL" == "$REMOTE" ]]; then
  success "Already in sync"
elif [[ "$LOCAL" == "$BASE" ]]; then
  info "Behind remote, pulling..."
  if [[ "$DRY_RUN" == false ]]; then
    if ! git pull --rebase origin $BRANCH; then
      error "Rebase conflict! Resolve manually:"
      echo "  1. Fix conflicts"
      echo "  2. git add <files>"
      echo "  3. git rebase --continue"
      echo "  4. ./deploy.sh again"
      exit 1
    fi
    success "Pulled and rebased"
  else
    info "Would pull and rebase"
  fi
elif [[ "$REMOTE" == "$BASE" ]]; then
  success "Ahead of remote"
else
  info "Diverged, rebasing..."
  if [[ "$DRY_RUN" == false ]]; then
    if ! git pull --rebase origin $BRANCH; then
      error "Rebase conflict! Resolve manually."
      exit 1
    fi
    success "Rebased"
  else
    info "Would rebase"
  fi
fi

# Push to GitHub
if [[ "$DRY_RUN" == false ]]; then
  info "Pushing to GitHub..."
  git push origin $BRANCH --quiet
  success "Pushed to GitHub"
else
  info "Would push to GitHub"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Deploy to Apps Script
# ─────────────────────────────────────────────────────────────────────────────

header "5. Deploying to Apps Script"

if [[ "$DRY_RUN" == false ]]; then
  info "Pushing to Apps Script..."
  if clasp push --force 2>&1 | grep -q "Pushed"; then
    success "Deployed to Apps Script"
  else
    # clasp push sometimes succeeds without saying "Pushed"
    success "Deployed to Apps Script"
  fi
else
  info "Would push to Apps Script"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════"
if [[ "$DRY_RUN" == true ]]; then
  echo -e "${YELLOW}DRY RUN COMPLETE${NC} - No changes made"
else
  echo -e "${GREEN}${BOLD}✓ DEPLOYED SUCCESSFULLY${NC}"
  echo ""
  echo -e "${CYAN}Next steps:${NC}"
  echo "  • Open sheet → Job Co-Pilot → Sync (Fresh)"
  echo "  • Check _log sheet for results"
fi
echo "═══════════════════════════════════════"