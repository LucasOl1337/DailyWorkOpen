# API local do DailyWork

SOMENTE ao integrar um agente com a API local, as operacoes do app ou o canvas.

## Descoberta

Abra o Electron ou `npm run dev` em `Daily Work app/`. O descritor fica em `~/.config/DailyWork/api-local.json` no Linux e tem permissao `0600`.

Use o cliente para manter o token fora do terminal e dos argumentos:

```bash
cd "Daily Work app"
node scripts/api.cjs instrucoes
node scripts/api.cjs capacidades
node scripts/api.cjs openapi
node scripts/api.cjs interface
```

O catalogo devolvido por `capacidades` e o contrato atual. Cada operacao usa `POST /api/v1/operacoes/<grupo>/<acao>` com `{ "args": [...] }` na ordem declarada.

Exemplos:

```bash
node scripts/api.cjs dias:listar
node scripts/api.cjs blocos:listar '["2026-09-13"]'
node scripts/api.cjs canvas-estado principal
```

Passe JSON grande por arquivo com `@caminho.json` ou pela entrada padrao com `-`. Nunca imprima o descritor: ele contem a credencial local.

## Contratos

- Restrinja chamadas a HTTP loopback e envie `Authorization: Bearer <token>`.
- Use a data `AAAA-MM-DD` para o escopo diario; omita-a apenas no Principal.
- Releia o recurso antes de escrever e trate `409 CONFLITO` como pedido de reconciliacao.
- Prefira CRUD de bloco. Use snapshot completo apenas com dry-run e lista integral.
- Mutacoes propostas devolvem um identificador temporario, consumido pela operacao de confirmacao.
- Leia os comandos de canvas em `capacidades`, consulte `canvas-estado` e envie a revisao exata ao propor mudanca.
- Verifique `ok: true`, releia o recurso alterado e confira `data/_log.ndjson`.

Os esquemas vivem em `electron/lib-contratos-api.cjs`; o transporte vive em `electron/lib-api-local.cjs`.
