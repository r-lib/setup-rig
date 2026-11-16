# setup-rig

A GitHub Action that installs [rig](https://github.com/r-lib/rig), the R
Installation Manager, and R, and caches rig's cache directory. With rig on
the `PATH`, the rest of the workflow uses rig to install packages, Rtools,
or more R versions. Together with a `rig pkg install` or `rig proj sync`
step it replaces `r-lib/actions/setup-r` and
`r-lib/actions/setup-r-dependencies`.

- Installs any R version that rig can: `release`, `devel`, `next`,
  `oldrel/N`, `4.5`, `4.5.2`, on Linux (x86_64, arm64), macOS (arm64,
  x86_64) and Windows (x86_64, arm64), including containers.
- Caches rig's cache directory, so packages that rig built from source are
  not built again.

rig runs in [user mode](https://r-lib.github.io/rig/admin-vs-user-mode.html):
R goes into the home directory, and nothing needs `sudo` except system
packages on Linux.

## R CMD check

```yaml
name: R-CMD-check

on:
  push:
    branches: [main]
  pull_request:

permissions: read-all

jobs:
  R-CMD-check:
    runs-on: ${{ matrix.config.os }}
    name: ${{ matrix.config.os }} (${{ matrix.config.r }})
    strategy:
      fail-fast: false
      matrix:
        config:
          - {os: macos-latest,     r: release}
          - {os: windows-latest,   r: release}
          - {os: ubuntu-latest,    r: devel}
          - {os: ubuntu-latest,    r: release}
          - {os: ubuntu-latest,    r: oldrel/1}
          - {os: ubuntu-24.04-arm, r: release}

    steps:
      - uses: actions/checkout@v5
      - uses: r-lib/actions/setup-pandoc@v2
      - uses: r-lib/setup-rig@v1
        with:
          r-version: ${{ matrix.config.r }}
      - run: rig pkg install --no-install-self --dev . rcmdcheck
      - uses: r-lib/actions/check-r-package@v2
        with:
          upload-snapshots: true
          build_args: 'c("--no-manual","--compact-vignettes=gs+qpdf")'
```

## Installing packages

setup-rig does not install packages. Use rig in a step after it:

- dependencies of a package, including `Suggests`:
  `rig pkg install --no-install-self --dev .`
- a rig project: `rig proj sync`; `rig proj sync --locked` to fail if
  `rproj.lock` is out of date; `rig proj lock --upgrade && rig proj sync`
  to check against the newest versions of the dependencies.
- other packages: `rig pkg install rcmdcheck r-lib/cli`.

Other things you may need:

- Rtools on Windows: `rig rtools add`.
- More repositories: `rig repos enable bioconductor`.
- pak: `rig system add-pak`.
- Tools for `R CMD check --as-cran`: e.g. `sudo apt-get install qpdf` or
  `brew install qpdf`.
- pandoc and Quarto: `r-lib/actions/setup-pandoc`,
  `quarto-dev/quarto-actions/setup`.

rig reads its settings from environment variables, set them for the job to
change them, e.g. `RIG_PREFER_BINARY`, `RIG_EXCLUDE_NEWER`, `RIG_SYSREQS`.
See `rig config --help`.

## Caching

setup-rig caches rig's cache directory (`RIG_CACHE_DIR`), not the package
library. The main step restores it, rig commands in later steps use it and
add to it, and the post step saves it. rig keeps the packages it compiled
there, keyed by platform, R version and the versions they were built
against, so installing from the cache only unpacks them, and an older cache
is always safe to use.

The cache key has the platform, the R minor version, a hash of the files in
`cache-dependency-glob`, and the week, so that the cache is updated at
least weekly even if those files do not change. A new key falls back to the
caches of earlier weeks.

By default the cache is only saved on the default branch (`save-cache:
auto`). Pull requests restore it, but do not save their own, which keeps
the repository's 10 GB cache quota for caches everyone can use. Before
saving, downloaded package files and metadata are removed (`prune-cache`).

## Private git repositories

rig installs packages from git with the system `git`, so set up git
credentials in an earlier step if you need them, e.g.

```yaml
- run: git config --global url."https://x-access-token:${{ secrets.GH_PAT }}@github.com/".insteadOf "https://github.com/"
```

## Inputs

| input | default | |
|---|---|---|
| `rig-version` | `latest` | rig version: `latest`, `nightly` or `x.y.z` |
| `r-version` | | R version; empty means `rproj.lock`, then `renv.lock`, then `release` |
| `r-arch` | | macOS / Windows architecture of R |
| `working-directory` | `.` | where the lock files are, base of the cache globs |
| `enable-cache` | `auto` | on for GitHub-hosted runners |
| `cache-dependency-glob` | `DESCRIPTION`, `rproj.*`, lock files | files in the cache key |
| `cache-suffix` | | extra cache key part |
| `prune-cache` | `true` | keep only built packages in the cache |
| `save-cache` | `auto` | `auto` (default branch only), `true`, `false` |

## Outputs

`rig-version`, `rig-path`, `r-version`, `r-path`, `library`, `cache-hit`,
`cache-key`, `cache-dir`.

## Environment

setup-rig sets these for later steps, unless they are already set:
`RIG_MODE=user`, `RIG_CACHE_DIR`, `RIG_PREFER_BINARY=true`,
`NOT_CRAN=true`, `TZ=UTC`, `_R_CHECK_SYSTEM_CLOCK_=FALSE`.
