# Optional public site

The Site view in DailyWork talks to whatever URL is in
`Daily Work app/src/lib/site-publico.json`. This open copy ships
`https://site.example` as a placeholder.

To connect your own site:

1. Edit `site-publico.json` (`host` and `url`).
2. Put a projection JSON at `LucasOL site/src/data/public-projection.json`
   if you want local diff-before-publish. A stub lives in that path.
3. Paste a publication token in the app (Conexões / Site). The token is stored
   encrypted in Electron userData, never in git.

This repository does not include a personal marketing site or Cloudflare
deploy credentials.
