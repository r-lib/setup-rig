# setup-rig

A GitHub Action that installs [rig](https://github.com/r-lib/rig), the R
Installation Manager, then R, and the package dependencies of your R package
or rig project. It replaces `r-lib/actions/setup-r` and
`r-lib/actions/setup-r-dependencies` with a single step.

- Installs any R version that rig can: `release`, `devel`, `next`,
  `oldrel/N`, `4.5`, `4.5.2`, on Linux (x86_64, arm64), macOS (arm64,
  x86_64) and Windows (x86_64, arm64), including containers.
- Installs Rtools on Windows.
- Installs the dependencies of a package (`DESCRIPTION`) or a rig project
  (`rproj.toml`) with rig, using binary packages from Posit Public Package
  Manager where it can, and the system requirements on Linux.
- Caches rig's cache directory, so packages built from source are not built
  again.

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
          extra-packages: rcmdcheck
          needs: check
      - uses: r-lib/actions/check-r-package@v2
        with:
          upload-snapshots: true
          build_args: 'c("--no-manual","--compact-vignettes=gs+qpdf")'
```

setup-rig does not install pandoc or Quarto; use
`r-lib/actions/setup-pandoc` and `quarto-dev/quarto-actions/setup` for those.

## Dependencies

With the default `install-dependencies: auto`, setup-rig looks at
`working-directory`:

- If there is an `rproj.toml`, it runs `rig proj sync`. With `upgrade: true`
  it runs `rig proj lock --upgrade` first, so you check against the newest
  versions of your dependencies, not the ones in `rproj.lock`. With
  `locked: true` it fails if `rproj.lock` is out of date.
- Otherwise, if there is a `DESCRIPTION`, it runs
  `rig pkg install --no-install-self --dev .`, which installs the
  dependencies of the package, including `Suggests`.
- Otherwise it installs nothing.

`extra-packages` are always installed. Use `install-dependencies: false` for
jobs that do not need packages.

### Passing options to rig

`prefer-binary`, `exclude-newer` and `sysreqs` set rig's `RIG_PREFER_BINARY`,
`RIG_EXCLUDE_NEWER` and `RIG_SYSREQS` environment variables, so they apply to
the action and to rig commands in later steps. `prefer-binary` is on by
default; set it to `false` to always get the newest version of a package,
even if it has to be compiled.

For anything else, `lock-args`, `sync-args` and `install-args` are added to
the `rig proj lock`, `rig proj sync` and `rig pkg install` commands.

## Caching

setup-rig caches rig's cache directory (`RIG_CACHE_DIR`), not the package
library. rig keeps the packages it compiled there, keyed by platform, R
version and the versions they were built against, so installing from the
cache only unpacks them, and an older cache is always safe to use.

The cache key has the platform, the R minor version, and a hash of the files
in `cache-dependency-glob`. If the installed versions can change without
these files changing (a `DESCRIPTION`, `upgrade: true`, no `rproj.lock`,
R-devel) the key also has the week, so the cache is refreshed weekly.

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

See [`action.yml`](action.yml) for all inputs and their defaults.

| input | default | |
|---|---|---|
| `rig-version` | `latest` | rig version |
| `r-version` | | R version; empty means `rproj.lock`, then `renv.lock`, then `release` |
| `r-arch` | | macOS / Windows architecture of R |
| `rtools` | `auto` | Windows: `auto`, `none` or a version, e.g. `45` |
| `pak` | `false` | install pak: `false`, `true`, `stable`, `devel` |
| `working-directory` | `.` | where the package or project is |
| `install-dependencies` | `auto` | `auto`, `true`, `false` |
| `dev-dependencies` | `true` | also install `Suggests` / the `dev` group |
| `needs` | | `Config/Needs/*` groups to install |
| `extra-packages` | | more packages to install |
| `locked` | `false` | `rig proj sync --locked` |
| `upgrade` | `false` | `rig proj lock --upgrade` before syncing |
| `repositories` | | repositories to enable: names, URLs or `name=URL` |
| `use-p3m` | `true` | use Posit Public Package Manager |
| `prefer-binary` | `true` | `RIG_PREFER_BINARY` |
| `exclude-newer` | | `RIG_EXCLUDE_NEWER` |
| `sysreqs` | `true` | `RIG_SYSREQS` |
| `lock-args`, `sync-args`, `install-args` | | extra rig arguments |
| `check-tools` | `auto` | qpdf, ghostscript, checkbashisms, only if needed |
| `macos-fortran` | `auto` | Fortran on macOS, if the package has Fortran code |
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
`RIG_MODE=user`, `RIG_CACHE_DIR`, `RIG_PREFER_BINARY`, `RIG_EXCLUDE_NEWER`,
`RIG_SYSREQS`, `NOT_CRAN=true`, `TZ=UTC`, `_R_CHECK_SYSTEM_CLOCK_=FALSE`.
