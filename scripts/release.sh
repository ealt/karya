#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

DEFAULT_BRANCH="${BRANCH:-main}"
CHANGELOG_FILE="CHANGELOG.md"
REPO_URL="https://github.com/ealt/karya"
FILES_TO_RESTORE=(package.json bun.lock CHANGELOG.md)
CLEANUP_REQUIRED=0
PACKED_TARBALL=""
SMOKE_PREFIX=""

usage() {
  cat <<'EOF'
Usage: scripts/release.sh <patch|minor|major|X.Y.Z>
EOF
}

section() {
  printf "\n# --- %s " "$1"
  printf '%0.s-' {1..60}
  printf "\n"
}

cleanup_smoke_artifacts() {
  if [ -n "${PACKED_TARBALL}" ] && [ -f "${PACKED_TARBALL}" ]; then
    rm -f "${PACKED_TARBALL}"
  fi

  if [ -n "${SMOKE_PREFIX}" ] && [ -d "${SMOKE_PREFIX}" ]; then
    rm -rf "${SMOKE_PREFIX}"
  fi
}

restore_release_files() {
  if [ "${CLEANUP_REQUIRED}" -eq 1 ]; then
    git restore "${FILES_TO_RESTORE[@]}" || true
    echo "Release preparation failed. Restored mutated files." >&2
    echo "Manual recovery: git restore ${FILES_TO_RESTORE[*]}" >&2
    CLEANUP_REQUIRED=0
  fi
}

on_error() {
  local status=$?
  cleanup_smoke_artifacts
  restore_release_files
  exit "${status}"
}

trap on_error ERR
trap cleanup_smoke_artifacts EXIT

fail() {
  echo "Error: $*" >&2
  exit 1
}

require_clean_tree() {
  local status
  status="$(git status --porcelain --untracked-files=all)"
  if [ -n "${status}" ]; then
    fail "working tree is not clean"
  fi
}

current_branch() {
  git rev-parse --abbrev-ref HEAD
}

current_version() {
  node -p "require('./package.json').version"
}

resolve_target_version() {
  node - "$1" "$(current_version)" <<'NODE'
const input = process.argv[2];
const current = process.argv[3];

const exactVersion = /^\d+\.\d+\.\d+$/;
if (exactVersion.test(input)) {
  process.stdout.write(input);
  process.exit(0);
}

const match = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!match) {
  console.error(`Unsupported current version: ${current}`);
  process.exit(1);
}

const [major, minor, patch] = match.slice(1).map(Number);

switch (input) {
  case "patch":
    process.stdout.write(`${major}.${minor}.${patch + 1}`);
    break;
  case "minor":
    process.stdout.write(`${major}.${minor + 1}.0`);
    break;
  case "major":
    process.stdout.write(`${major + 1}.0.0`);
    break;
  default:
    console.error(`Unsupported release input: ${input}`);
    process.exit(1);
}
NODE
}

verify_unreleased_section() {
  node - "${CHANGELOG_FILE}" <<'NODE'
const fs = require("node:fs");

const changelogPath = process.argv[2];
const content = fs.readFileSync(changelogPath, "utf8");
const match = content.match(/^## \[Unreleased\]\n([\s\S]*?)(?=^## \[[^\]]+\])/m);

if (!match) {
  console.error("CHANGELOG.md is missing a [Unreleased] section.");
  process.exit(1);
}

const normalized = match[1]
  .replace(/^### .*\n/gm, "")
  .replace(/^\s*[-*]\s+/gm, "")
  .trim();

if (!normalized) {
  console.error("CHANGELOG.md [Unreleased] section is empty.");
  process.exit(1);
}
NODE
}

update_changelog() {
  node - "${CHANGELOG_FILE}" "$1" "$2" "${REPO_URL}" <<'NODE'
const fs = require("node:fs");

const [changelogPath, version, releaseDate, repoUrl] = process.argv.slice(2);
const content = fs.readFileSync(changelogPath, "utf8");
const unreleasedSectionPattern = /^## \[Unreleased\]\n([\s\S]*?)(?=^## \[[^\]]+\])/m;
const sectionMatch = content.match(unreleasedSectionPattern);

if (!sectionMatch) {
  console.error("Unable to locate [Unreleased] section in CHANGELOG.md.");
  process.exit(1);
}

const unreleasedBody = sectionMatch[1].trim();
if (!unreleasedBody) {
  console.error("The [Unreleased] section is empty.");
  process.exit(1);
}

let nextContent = content.replace(
  unreleasedSectionPattern,
  `## [Unreleased]\n\n## [${version}] - ${releaseDate}\n\n${unreleasedBody}\n\n`,
);

const unreleasedLink = `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD`;
if (/^\[Unreleased\]: .*$/m.test(nextContent)) {
  nextContent = nextContent.replace(/^\[Unreleased\]: .*$/m, unreleasedLink);
} else {
  nextContent = `${nextContent.trimEnd()}\n\n${unreleasedLink}\n`;
}

const versionLinkPattern = new RegExp(`^\\[${version.replace(/\./g, "\\.")}\\]: .*$`, "m");
const versionLink = `[${version}]: ${repoUrl}/releases/tag/v${version}`;
if (versionLinkPattern.test(nextContent)) {
  nextContent = nextContent.replace(versionLinkPattern, versionLink);
} else {
  nextContent = `${nextContent.trimEnd()}\n${versionLink}\n`;
}

fs.writeFileSync(changelogPath, nextContent, "utf8");
NODE
}

smoke_test_tarball() {
  local version=$1

  PACKED_TARBALL="$(npm pack --json | node -e 'let input = ""; process.stdin.on("data", (chunk) => { input += chunk; }); process.stdin.on("end", () => { const parsed = JSON.parse(input); process.stdout.write(parsed[0].filename); });')"
  PACKED_TARBALL="${PROJECT_ROOT}/${PACKED_TARBALL}"
  SMOKE_PREFIX="$(mktemp -d "${PROJECT_ROOT}/.karya-smoke.XXXXXX")"

  npm install -g "${PACKED_TARBALL}" --prefix "${SMOKE_PREFIX}" >/dev/null

  local actual_version
  actual_version="$("${SMOKE_PREFIX}/bin/karya" --version)"
  if [ "${actual_version}" != "${version}" ]; then
    fail "smoke test version mismatch: expected ${version}, got ${actual_version}"
  fi

  cleanup_smoke_artifacts
  PACKED_TARBALL=""
  SMOKE_PREFIX=""
}

if [ "${1:-}" = "" ]; then
  usage
  exit 1
fi

if [ "${1}" = "--help" ] || [ "${1}" = "-h" ]; then
  usage
  exit 0
fi

command -v git >/dev/null 2>&1 || fail "git is required"
command -v bun >/dev/null 2>&1 || fail "bun is required"
command -v node >/dev/null 2>&1 || fail "node is required (for npm pack)"
command -v npm >/dev/null 2>&1 || fail "npm is required (for npm pack/version)"

RELEASE_INPUT=$1
TARGET_VERSION="$(resolve_target_version "${RELEASE_INPUT}")"
TAG_NAME="v${TARGET_VERSION}"

section "Preflight"
require_clean_tree
verify_unreleased_section

section "Local validation"
bun run lint
bun run test
bun run test:e2e

section "Version bump"
npm version --no-git-tag-version "${RELEASE_INPUT}" >/dev/null
CLEANUP_REQUIRED=1

if command -v bun >/dev/null 2>&1; then
  bun install >/dev/null
fi

TARGET_VERSION="$(current_version)"
TAG_NAME="v${TARGET_VERSION}"

section "Update changelog"
RELEASE_DATE="$(date -u +%F)"
update_changelog "${TARGET_VERSION}" "${RELEASE_DATE}"

section "Pack and smoke test"
smoke_test_tarball "${TARGET_VERSION}"

section "Commit"
git add package.json bun.lock CHANGELOG.md
git commit -m "chore: prepare release ${TAG_NAME}"
CLEANUP_REQUIRED=0

section "Next steps"
echo "Release preparation commit created on $(current_branch):"
echo "  chore: prepare release ${TAG_NAME}"
echo
echo "Open a pull request or merge this commit into ${DEFAULT_BRANCH}."
echo "The release workflow on ${DEFAULT_BRANCH} will detect ${TAG_NAME}, create the tag if needed,"
echo "publish the GitHub Release, and notify the Homebrew tap automatically."
