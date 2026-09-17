#!/usr/bin/env node
// HTML local com stills reais (esquema vitrine). Sem arte inventada da Factory.
const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')

const RAIZ = path.resolve(__dirname, '..')
const DATA = process.env.DAILYWORK_DATA_DIR || path.join(RAIZ, 'data')
const DEST = path.join(RAIZ, 'artifacts', 'provas-midia-2026-09-09')
const REFS = path.join(DATA, 'editorial', 'midias', 'refs')
const PROVA = path.join(DATA, 'editorial', 'midias', 'media-4896bbf6a32284239f2ecdd4', 'editorial-proof.jpg')

function copiar(origem, nome) {
  if (!origem || !fs.existsSync(origem)) return null
  fs.mkdirSync(DEST, { recursive: true })
  fs.copyFileSync(origem, path.join(DEST, nome))
  return nome
}
function escapar(texto) {
  return String(texto || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function stills() {
  return [
    {
      titulo: 'Daily Work · Fila editorial',
      nota: 'Captura isolada agora, mesmo esquema da vitrine. Só cards de projetos recentes (Daily Work, NexARQ, LojaSync, Simpl AI).',
      arquivo: copiar(path.join(REFS, 'dailywork-fila-fonte.png'), 'dailywork-fila-fonte.png')
        || copiar(path.join(DEST, 'dailywork-fila-fonte.png'), 'dailywork-fila-fonte.png'),
    },
    {
      titulo: 'Daily Work · Agente global',
      nota: 'Still da UI real do app neste PC. Não é infográfico gerado.',
      arquivo: copiar(path.join(REFS, 'dailywork-agente-fonte.png'), 'dailywork-agente-fonte.png')
        || copiar(path.join(REFS, 'dailywork-agente-overview.png'), 'dailywork-agente-overview.png'),
    },
    {
      titulo: 'NexARQ · painel admin',
      nota: 'Screenshot do produto em execução. Caso recente e fácil de repetir.',
      arquivo: copiar(path.join(REFS, 'nexarq-admin-metricas.png'), 'nexarq-admin-metricas.png'),
    },
    {
      titulo: 'LojaSync · painel',
      nota: 'Still local do app, já no acervo de refs.',
      arquivo: copiar(path.join(REFS, 'lojasync-painel.png'), 'lojasync-painel.png'),
    },
    {
      titulo: 'Simpl AI · app',
      nota: 'Still local do app, já no acervo de refs.',
      arquivo: copiar(path.join(REFS, 'simpl-ai-app.png'), 'simpl-ai-app.png'),
    },
    {
      titulo: 'Daily Work · peça já na Fila',
      nota: 'Imagem anexada ao card DailyWork: separar produzir de distribuir. Não é The Last Arrow.',
      arquivo: copiar(PROVA, 'dailywork-editorial-proof.jpg'),
    },
  ].filter((item) => item.arquivo)
}

function main() {
  fs.mkdirSync(DEST, { recursive: true })
  const pecas = stills()
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stills reais — Daily Work, 9 set 2026</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-white text-neutral-950">
  <main class="mx-auto max-w-5xl px-6 py-10">
    <p class="text-sm text-neutral-500">Daily Work · captura isolada · ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
    <h1 class="mt-2 text-3xl font-semibold tracking-tight">Stills reais dos projetos recentes</h1>
    <p class="mt-3 max-w-2xl text-neutral-700">Mesmo esquema da vitrine: instância isolada, UI de verdade, zero pixel inventado pela Factory. The Last Arrow e VIDEOGEN saíram do lote automático — são acervo inativo.</p>
    <p class="mt-4 text-sm text-neutral-600">${pecas.length} stills neste PC.</p>
    <ol class="mt-10 space-y-14">
      ${pecas.map((peca) => `
      <li>
        <h2 class="text-xl font-semibold">${escapar(peca.titulo)}</h2>
        <p class="mt-1 text-sm text-neutral-600">${escapar(peca.nota)}</p>
        <figure class="mt-4">
          <img src="${escapar(peca.arquivo)}" alt="${escapar(peca.titulo)}" class="w-full border border-neutral-200 bg-neutral-50">
        </figure>
      </li>`).join('')}
    </ol>
  </main>
</body>
</html>
`
  const saida = path.join(DEST, 'index.html')
  fs.writeFileSync(saida, html)
  process.stdout.write(`${saida}\n`)
  return saida
}

const arquivo = main()
if (process.argv.includes('--abrir')) {
  execFile('xdg-open', [arquivo], { detached: true, stdio: 'ignore' }).unref()
}
