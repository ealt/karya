#!/usr/bin/env bash
set -euo pipefail

REPO="ealt/karya"

# --- Check runtime ------------------------------------------------------------

if command -v bun >/dev/null 2>&1; then
  INSTALLER="bun"
elif command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "Error: Node.js >= 18 required (found $(node --version)). Install Bun or upgrade Node.js." >&2
    exit 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is not installed. Install Bun (preferred) or npm." >&2
    exit 1
  fi
  INSTALLER="npm"
else
  echo "Error: Bun or Node.js 18+ is required. Install Bun (https://bun.sh) and try again." >&2
  exit 1
fi

# --- Detect latest release ----------------------------------------------------

echo "Fetching latest release..."

RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")
TAG=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*: "//;s/".*//')

if [ -z "$TAG" ]; then
  echo "Error: could not determine latest release tag." >&2
  exit 1
fi

VERSION="${TAG#v}"
TARBALL="karya-${VERSION}.tgz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${TARBALL}"

echo "Installing karya@${VERSION}..."

# --- Download & install -------------------------------------------------------

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL -o "${TMPDIR}/${TARBALL}" "$DOWNLOAD_URL"

if [ "$INSTALLER" = "bun" ]; then
  bun install -g "${TMPDIR}/${TARBALL}"
else
  npm install -g "${TMPDIR}/${TARBALL}"
fi

# --- Done ---------------------------------------------------------------------

echo ""
echo "karya@${VERSION} installed successfully!"
echo ""
echo "Get started:"
echo "  karya config init"
echo "  karya add \"My first task\""
echo "  karya list"
