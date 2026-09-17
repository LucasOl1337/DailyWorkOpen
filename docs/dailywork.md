# Operacao do DailyWork

SOMENTE ao operar dados, dias ou fechamento no `Daily Work app/`.

## Rodar e validar

```bash
cd "Daily Work app"
npm ci
npm run dev
npm test
npm run build
npm run app
```

`npm run dev` serve o app em `http://localhost:5173`. `npm run app` gera o front e abre o Electron.

## Persistencia

- Grave trabalho do dia em `data/dias/AAAA-MM-DD/*.md`.
- Grave conteudo geral do Principal em `data/*.md`.
- Guarde lousas livres em `sessoes/*.tldr` e midias persistentes em `assets/portfolio/`.
- Trate `data/_arquivo/` como arquivo recuperavel e `data/_log.ndjson` como auditoria.
- Edite conhecimento canonico em `LucasOL/Knowledge/`; o Principal apenas projeta esse conteudo.

As datas usam `America/Sao_Paulo`. Prefira o CRUD individual; salvar um snapshot completo arquiva IDs ausentes.

## Operar

Com o app aberto, descubra a API sem copiar tokens:

```bash
node scripts/api.cjs instrucoes
node scripts/api.cjs capacidades
```

O fechamento usa `fluxo:revisar-fechamento` e `fluxo:confirmar-fechamento`. Releia os dados e a auditoria depois da escrita.

Altere fontes em `src/` e `electron/`. Nao edite `dist/`.

## Agenda compartilhada

A programação diária e os comandos manuais integrados ao coordenador estão documentados em [Agenda diária](./agenda.md). A ativação Linux migra o disparador anterior e mantém os históricos especializados deste módulo.

## Navegação e telas operacionais

A pílula flutuante deu lugar a uma **barra lateral** fixa (`src/components/Sidebar.tsx`) com
um nível só: Hoje, Agente, Skills, Principal, Lousas, Site, Fila, Campanhas, Candidaturas,
Conexões, Diário (com dia anterior/próximo/data), Sumário e o zoom no rodapé. Os badges
vêm de `src/lib/estado-global.tsx`, que lê agenda, candidaturas e fila a cada 15 s e deriva
o que precisa do titular, o feed do dia e os contadores. **Hoje** (`src/components/Hoje.tsx`)
é a porta de entrada: três cartões (um por módulo), o feed unificado e o bloco Máquina.

Candidaturas, Campanhas e Fila usam o mesmo vocabulário de `src/components/ui/`: `Pagina`
(cabeçalho com chips e ações), `Faixa` (um formato de status em quatro tons, com o log
técnico atrás de "Detalhe técnico"), `Kpi`, `Bloco`, `Tabela` densa e `Feed`, mais a
`ColunaDia` à direita (Agora · Precisa de você · Dia de todos os módulos). Chips de estado
seguem um vocabulário único: Na fila · Rodando · Comprovado · Precisa de você · Falhou ·
Sem ação sua.
