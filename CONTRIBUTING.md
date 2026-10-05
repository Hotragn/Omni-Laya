# Contributing

Use the setup instructions in [README.md](README.md). Keep documentation, comments, commit messages and user-facing copy in English. Multilingual search examples and input handling are welcome.

Before opening a pull request:

```bash
pnpm install --frozen-lockfile
pnpm generate-routes
pnpm cf-typegen
pnpm test
pnpm build
```

Keep changes focused. Explain the user-visible problem, the resulting behavior and how you verified it. Add regression coverage for behavioral changes, especially provider failures, cancellation, source selection and ranking. If you change a question sent to Laya or a threshold, check it against a running `laya-serve` and note what you measured in the pull request; the current wording and thresholds come from such probes (see README). Tests should mock network calls and must not require real API keys. For layout changes, check both mobile and desktop widths and include screenshots when possible.

Do not commit `.dev.vars`, `.env`, API keys, provider responses containing private queries, generated build output or local Cloudflare state. Commit `pnpm-lock.yaml` when dependencies change. Generate `worker-configuration.d.ts` rather than editing it manually; route types are generated and ignored.

Source definitions live in `src/lib/sources.ts`. The UI should keep search progress and results aligned, chips stationary as counts update, and result links visually distinct from everything else. See [brand/README.md](brand/README.md) for colour, type and voice. Regenerate the logo files with `python brand/make_logo.py` instead of editing them.

Report ordinary bugs through GitHub issues. Follow [SECURITY.md](SECURITY.md) for sensitive reports.
