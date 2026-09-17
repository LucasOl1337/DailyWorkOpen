# DailyWork

Desktop app for daily work with a person and agents. Days keep an operational
summary; Principal and free boards use a tldraw canvas. Blocks persist as
Markdown. A local API exposes the same services as Electron.

This repository is the **open, reusable copy**. It has the same product as the
original DailyWork app, without personal career files, private knowledge,
credentials, sessions or editorial history.

The folder `LucasOL/` is the bundled **personal workspace** the app reads
(knowledge, CVs, campaign files). The name is historical. Replace the templates
with your own files before using candidacies or campaigns.

## Requirements

- Node.js 22+
- npm
- Linux (Omarchy/Hyprland is the primary target), macOS or Windows
- Optional: a local model gateway such as 9Router for the in-app agent

## Quick start

```bash
git clone https://github.com/LucasOl1337/DailyWorkOpen.git
cd DailyWorkOpen
cd "Daily Work app"
npm ci
npm test
npm run dev      # http://localhost:5173
npm run app      # production build + Electron
```

On Omarchy, `npm run install:linux` installs a launcher and Super+D.

## First run

1. Copy `LucasOL/Portfolio/privacidade/dados-candidatura-canonicos.example.md`
   to `dados-candidatura-canonicos.local.md` and fill **your** facts.
2. Replace the placeholder PDFs in `LucasOL/Portfolio/curriculos/ativos/` with
   your AI Engineer and Software Engineer CVs (same file names).
3. Edit `LucasOL/Portfolio/curriculos/ativos/content.json` and
   `Daily Work app/src/lib/site-publico.json` if you have a public site.
4. Put a photo named `eu.png` in `Daily Work app/assets/` if you want a person
   block on Principal.
5. Connect GitHub / LinkedIn / X / Reddit from **Conexões**, or run
   `Daily Work app/scripts/conectar-contas.sh`.

Personal answers, cookies and OAuth secrets stay in Electron userData
(`~/.config/DailyWork` on Linux) and in `LucasOL/Private/`. They are gitignored.

## Layout

| Path | Role |
| --- | --- |
| `Daily Work app/` | Electron + React app |
| `LucasOL/` | Your knowledge, portfolio and private runtime |
| `docs/` | How to operate days, API, editorial, candidacies, agenda |

See [INDEX.md](./INDEX.md) for when to read each document.

## License

MIT. See [LICENSE](./LICENSE).
