# npm Publishing + GitHub Actions CI/CD

## Context

Karya's SQL refactor is complete. The tool works locally via `bun link` or
`./bin/karya`, but new users must clone the repo to use it. The goal is to
make installation as simple as `npm install -g karya`.

This plan adds:
1. **npm package metadata** — license, engines, repository, prepublishOnly
2. **LICENSE file** — MIT
3. **GitHub Actions** — test on push/PR, publish to npm on version tags
4. **README install section** — document `npm install -g karya`

## Current State

Already working:
- `package.json` has `bin`, `files`, `exports` correctly configured
- `bin/karya` resolves symlinks and finds `dist/` (works with global install)
- `npm pack --dry-run` produces a clean 21 kB tarball (69 files)
- `npm run build` (tsc) succeeds
- `dist/` output includes `.js` + `.d.ts` files

Missing:
- No `LICENSE` file
- No `prepublishOnly` script (dist/ could be stale on publish)
- No `engines` field
- No `repository`/`homepage` fields
- No GitHub Actions workflows
- `data/` directory still in repo (tracked by git)

## Implementation Steps

### Step 1: Update `package.json`

**File:** `package.json`

Add fields:
```jsonc
{
  "license": "MIT",
  "engines": { "node": ">=18.0.0" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ealt/karya.git"
  },
  "homepage": "https://github.com/ealt/karya#readme",
  "scripts": {
    // add to existing scripts:
    "prepublishOnly": "npm run build"
  }
}
```

The `prepublishOnly` script ensures `tsc` runs before every `npm publish`,
so dist/ is never stale.

### Step 2: Create `LICENSE`

**New file:** `LICENSE`

Standard MIT license, copyright holder "Eric Alt" (from git remote
`ealt/karya`), year 2025.

### Step 3: Remove `data/` from git

`data/` is already in `.gitignore` but still tracked. Remove it:

```bash
git rm -r data/
```

This removes example/test data from the repo. Users create their own DB
via `karya config init`.

### Step 4: Create GitHub Actions — test workflow

**New file:** `.github/workflows/test.yml`

Triggers: push to `main`, pull requests to `main`

```yaml
name: Test
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test
```

Tests against Node 18, 20, 22 to match `engines: >=18`. Uses `npm ci`
(not bun) since published package targets npm/node users.

### Step 5: Create GitHub Actions — publish workflow

**New file:** `.github/workflows/publish.yml`

Triggers: push of version tags (`v*`)

```yaml
name: Publish
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write    # for GitHub Release
      id-token: write    # for npm provenance
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2.5.0
        with:
          generate_release_notes: true
```

**Required setup (manual, one-time):**
- Create npm access token at npmjs.com
- Add it as repository secret `NPM_TOKEN` in GitHub Settings > Secrets

**Release workflow:**
1. Update version: `npm version patch` (or minor/major)
2. Push: `git push origin main --tags`
3. GitHub Actions runs tests → publishes to npm → creates GitHub Release

The `--provenance` flag adds npm provenance attestation (proves the
package was built from this repo via CI).

### Step 6: Update README install section

**File:** `README.md`

Replace the current "Quick start" section:

```markdown
## Install

```bash
npm install -g karya
```

Then:

```bash
karya config init
karya add "Ship MVP" -P P1
karya list
```

### From source

```bash
git clone https://github.com/ealt/karya.git
cd karya
bun install && bun link
```
```

This puts the npm install front and center for new users.

## Files Summary

| File | Action |
|------|--------|
| `package.json` | MODIFY — add license, engines, repository, prepublishOnly |
| `LICENSE` | CREATE — MIT license |
| `README.md` | MODIFY — add npm install instructions |
| `.github/workflows/test.yml` | CREATE — CI test workflow |
| `.github/workflows/publish.yml` | CREATE — npm publish + GitHub Release |
| `data/` | DELETE from git (`git rm -r`) |

## Verification

1. `npm run build` — tsc succeeds
2. `npm run lint` — type-check passes
3. `npm test` — all tests pass
4. `npm pack --dry-run` — verify tarball contents (dist/src/, bin/,
   package.json, README.md, LICENSE — no src/, tests/, data/)
5. `npm pack && npm install -g ./karya-0.1.0.tgz` — global install works
6. `karya --help` — prints help from global install
7. `karya config init && karya add "test" && karya list` — end-to-end
8. Verify GitHub Actions:
   - Push to main → test workflow runs (lint + test on Node 18/20/22)
   - `npm version patch && git push --tags` → publish workflow triggers
