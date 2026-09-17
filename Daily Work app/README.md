# DailyWork

App desktop para trabalho diario com pessoa e agentes. Dias usam um resumo operacional; o Principal e as sessoes livres usam canvas tldraw. Blocos persistem como Markdown e a API local usa os mesmos servicos do Electron.

## Rodar

```bash
npm ci
npm run dev      # browser em http://localhost:5173
npm run app      # build + Electron
npm test
npm run build
```

Os instaladores locais continuam disponiveis em `npm run install:linux` e `npm run install:windows`.

## Estrutura

| Caminho | Papel |
| --- | --- |
| `src/` | Interface React e integracao tldraw |
| `electron/` | Janela, persistencia, API, agentes e integracoes |
| `data/` | Principal, dias, sumarios, editorial e auditoria (local) |
| `sessoes/` | Lousas livres (local) |
| `assets/` | Midias persistentes; `eu.png` e opcional |
| `tests/` | Testes Node |

O app observa escritas externas em `data/` e recarrega a interface. Use `node scripts/api.cjs instrucoes` para descobrir a API sem expor a credencial local.

O workspace pessoal fica em `../LucasOL/`. Preencha os modelos antes de usar candidaturas.
