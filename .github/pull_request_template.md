## Qué cambia · What changes

<!-- Español o inglés · Spanish or English. Link the issue: "Closes #123". -->

## Cómo se ha probado · How it was tested

- [ ] `uv run pytest`, `ruff`, `mypy` (engine)
- [ ] `pnpm lint && pnpm typecheck && pnpm test` (app)
- [ ] `cargo clippy --all-targets -- -D warnings && cargo test` (Rust)
- [ ] Probado a mano · Tried by hand (screenshots in light and dark mode for UI changes)

## Comprobaciones · Checklist

- [ ] Texto visible en `es.json` y `en.json` · Visible text in both i18n files
- [ ] Dependencias nuevas en `docs/third-party.md`, compatibles con AGPL-3.0 · New dependencies recorded and AGPL-3.0 compatible
- [ ] Sin audio con copyright · No copyrighted audio
- [ ] Guía de usuario actualizada si cambia algo visible · User guide updated for visible changes
