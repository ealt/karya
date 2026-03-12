# Release Automation Plan

## Context

Karya needs official GitHub Releases so users can install it easily. npm
publishing is not desired (requires a public email). GitHub Releases are the
primary distribution channel, with a Homebrew tap for easy install, matching
patterns from garth and the existing `ealt/homebrew-tap`.

## Distribution channels

1. **GitHub Releases** — tarball + SHA256 checksum (primary)
2. **curl | bash** via `install.sh` (existing, downloads from GitHub Releases)
3. **Homebrew** via `ealt/homebrew-tap` (new — `brew install ealt/tap/karya`)
4. **npm publish** — documented as future option only (gated on NPM_TOKEN)

## Changes

### 1. `scripts/release.sh` (NEW) — release automation script

Conventions: bash, `set -euo pipefail`, section comments (matching `bin/karya`,
`install.sh`).

```
Usage: scripts/release.sh <patch|minor|major|X.Y.Z>
```

Steps (in order — smoke test gates commit/tag):
1. **Preflight** — clean tree, on `main` (overridable via `BRANCH=`), up-to-date
   with remote, tag doesn't exist, `[Unreleased]` section non-empty
2. **Local validation** — `npm run lint`, `npm test`, `npm run test:e2e`
3. **Bump version** via `npm version --no-git-tag-version <version>`. Also runs
   `bun install` if available to keep `bun.lock` in sync.
4. **Update CHANGELOG.md** — move `[Unreleased]` contents to new
   `## [X.Y.Z] - YYYY-MM-DD` section, reset `[Unreleased]`, update comparison
   links
5. **Pack + smoke test** — `npm pack`, install tarball to temp prefix, run
   `<prefix>/bin/karya --version`, verify output matches version. Use a
   repo-local temp prefix instead of `/tmp` so the binary remains executable on
   environments that mount `/tmp` with `noexec`. This gates
   the commit — if the tarball is broken, nothing is committed or tagged. On
   failure, automatically clean up with `git restore package.json
   package-lock.json bun.lock CHANGELOG.md` and print the same command for
   manual recovery, since the working tree was already mutated by steps 3-4.
6. **Commit** as `chore: release vX.Y.Z`
7. **Tag** with annotated tag `vX.Y.Z`
8. **Prompt to push** (auto-push if `PUSH=1`)

### 2. `.github/workflows/publish.yml` → `release.yml` (RENAME + REWORK)

Single authoritative build trigger: `prepack` in package.json (see #7). The
workflow calls `npm pack` which triggers the build automatically.

Pipeline:
1. Checkout + setup Node 20
2. `npm ci`
3. **Verify tag matches package.json** (pattern from virgil)
4. `npm run lint`
5. `npm test`
6. `npm run test:e2e`
7. `npm pack` (triggers `prepack` → `npm run build` automatically)
8. **Smoke test** — install tarball in temp prefix, run
   `<prefix>/bin/karya --version`, verify output
9. Compute SHA256 checksum (pattern from garth)
10. Extract release notes from CHANGELOG.md — match `^## \[X.Y.Z\]` header,
    capture everything until the next `^## \[` line, trim leading/trailing
    blank lines
11. Create GitHub Release with tarball + checksum
12. npm publish (conditional, gated on NPM_TOKEN secret)

### 3. `.github/workflows/notify-homebrew-tap.yml` (NEW)

Dispatches to `ealt/homebrew-tap` on release, matching garth's pattern:
- Triggers on `release: types: [published]` + `workflow_dispatch`
- Sends `repository_dispatch` to `ealt/homebrew-tap` with event type
  `karya_release_published` and the tag
- Requires `HOMEBREW_TAP_FINE_GRAINED_PAT` secret

### 4. `.github/workflows/test.yml` (MODIFY)

Add `npm run test:e2e` step.

### 5. `tests/e2e/cli.e2e.test.ts` (MODIFY)

Fix hardcoded `cwd: "/karya-sandbox"` → resolve project root from
`import.meta.url`. Required for e2e tests to pass in GitHub Actions CI.

### 6. `src/cli/index.ts` (MODIFY)

Add `.version()` to Commander program so `karya --version` works. Read version
from package.json using `createRequire` (ESM-compatible). Needed for Homebrew
formula test and smoke tests.

### 7. `package.json` (MODIFY)

- Add `"release": "bash scripts/release.sh"` script
- Change `"prepublishOnly": "npm run build"` → `"prepack": "npm run build"` so
  `npm pack` (not just `npm publish`) triggers the build. This is the single
  authoritative build trigger — no separate `npm run build` step needed in
  workflows.

### 8. `README.md` (MODIFY)

Update install section:
- Add Homebrew: `brew install ealt/tap/karya`
- Keep curl | bash
- Replace "Or with npm (once published)" with note that npm is a future option

### 9. `CONTRIBUTING.md` (MODIFY)

Add "Releasing" section documenting the release script and what happens after
push.

### 10. `CHANGELOG.md` (MODIFY)

Add entries for the new release tooling under `[Unreleased]`.

## Out of scope (separate repo: `ealt/homebrew-tap`)

Needed in the tap repo, documented for follow-up:
- `Formula/karya.rb` — Homebrew formula (`depends_on "node"`, downloads tarball,
  `npm install` to libexec, symlinks bin)
- `.github/workflows/update-karya-formula.yml` — auto-update formula on
  `karya_release_published` dispatch

## Files touched

| File | Action |
|------|--------|
| `scripts/release.sh` | Create |
| `.github/workflows/publish.yml` | Rename to `release.yml` + rework |
| `.github/workflows/notify-homebrew-tap.yml` | Create |
| `.github/workflows/test.yml` | Add e2e step |
| `tests/e2e/cli.e2e.test.ts` | Fix hardcoded cwd |
| `src/cli/index.ts` | Add `--version` flag |
| `package.json` | Add `release` script, `prepack` |
| `bun.lock` | Updated by release script when available |
| `README.md` | Update install section |
| `CONTRIBUTING.md` | Add releasing section |
| `CHANGELOG.md` | Add entries |

## Verification

1. `npm run lint` — type-check passes
2. `npm test` — unit tests pass
3. `npm run test:e2e` — e2e tests pass (validates cwd fix)
4. `bash scripts/release.sh` with no args — shows usage
5. **Smoke test the packaging path end-to-end:**
   - `npm pack` (triggers prepack → build)
   - `npm install -g ./karya-*.tgz --prefix ./.tmp/karya-smoke`
   - `./.tmp/karya-smoke/bin/karya --version` outputs correct version
   - Validates the full install path used by `install.sh`
6. Review workflow YAML for correctness
