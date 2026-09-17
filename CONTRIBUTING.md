# Contributing

1. Open an issue or a small pull request against `main`.
2. Keep personal CVs, `.local.md`, tokens and session dumps out of the diff.
3. Run the app tests before sending:

```bash
cd "Daily Work app"
npm ci
npm test
npm run build
```

4. Prefer fixtures under `tests/` over real accounts.
5. Do not add hardcoded home paths, emails, phone numbers or CV file names
   that belong to a specific person. Read those from `LucasOL/` or env vars.
