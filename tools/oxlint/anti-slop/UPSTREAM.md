# Upstream provenance

- Source repository: https://github.com/dmmulroy/anti-slop
- Installed from the `install-anti-slop` skill bundle, which records upstream commit `13909c9` (2026-10-14 UTC) plus the bundle's own local deviations (adds `no-comments` and `no-type-assertions`).
- Installed snapshot: byte-identical to that bundle's `assets/anti-slop/` as of 2026-11-13. Plugin paths: `index.ts` (generic, registered) and `effect/index.ts` (Effect, vendored but not registered).
- Previous installation (2026-11-12) was an unmodified copy of the earlier bundle, so this update replaced it with no local customizations to reconcile.

## Local deviations

None in the vendored files. This directory is excluded from linting in `oxlint.config.ts` because upstream sources contain JSDoc, which `anti-slop/no-comments` rejects.

## Configuration decisions

- Enabled at `error`: all generic rules except `require-readable-spacing` and `require-safety-comment-for-type-assertion`, plus native companion `oxc/no-accumulating-spread`.
- `require-readable-spacing`: not enabled (would add ~13,000 blank-line fixes).
- `require-safety-comment-for-type-assertion`: not enabled; superseded by `no-type-assertions` and incompatible with `no-comments`.
- Effect plugin: not registered. `effect` is a direct dependency of `shared` only for schema validation in one module; the rules produced only false positives here.
