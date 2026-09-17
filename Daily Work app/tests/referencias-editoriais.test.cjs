const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  chavesDoItem,
  urlCapturavel,
  urlViva,
  urlsDoItem,
  resolverReferencias,
  referenciasDescritas,
  resolverReferenciasComCaptura,
} = require('../electron/lib-referencias-editoriais.cjs')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-refs-'))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
after(() => fs.rmSync(TMP, { recursive: true, force: true }))

function pasta(nome) {
  const dir = path.join(TMP, nome)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

test('chaves saem do projeto, do título e dos aliases', () => {
  assert.deepEqual(chavesDoItem({ origem: { projeto: 'videogen' }, titulo: 'VIDEOGEN' }).sort(), ['videogen'])
  assert.ok(chavesDoItem({ titulo: 'Simpl AI no LinkedIn' }).includes('simpl-ai'))
  assert.ok(chavesDoItem({ fontes: [{ rotulo: 'NexARQ', url: 'https://github.com/x/nexarq' }] }).includes('nexarq'))
  assert.deepEqual(chavesDoItem({ titulo: 'Pauta genérica' }), [])
})

test('pauta recebe só descrições de capturas do projeto cujos bytes foram inspecionados', () => {
  const dataDir = pasta('descricoes')
  const refs = path.join(dataDir, 'editorial/midias/refs')
  fs.mkdirSync(refs, { recursive: true })
  const hash = require('node:crypto').createHash('sha256').update(PNG).digest('hex')
  for (const nome of ['dailywork-fila', 'sonora-mixer']) {
    fs.writeFileSync(path.join(refs, `${nome}.png`), PNG)
    fs.writeFileSync(path.join(refs, `${nome}.png.json`), JSON.stringify({ ambiente: 'produto-real', dados: 'reais', descricao: nome, sha256: hash }))
  }
  const entrada = { item: { origem: { projeto: 'dailywork' } }, dataDir }
  assert.deepEqual(referenciasDescritas(entrada).map(r => r.arquivo), ['midias/refs/dailywork-fila.png'])
  fs.writeFileSync(path.join(refs, 'dailywork-fila.png'), Buffer.concat([PNG, Buffer.from('alteração')]))
  assert.deepEqual(referenciasDescritas(entrada), [], 'descrição antiga não acompanha uma captura alterada')
})

test('urlCapturavel recusa localhost e documentação do GitHub, mas aceita produto público', () => {
  assert.equal(urlCapturavel('https://app.example.test/videogen'), 'https://app.example.test/videogen')
  assert.equal(urlCapturavel('https://github.com/example/videogen'), null)
  assert.equal(urlCapturavel('http://example.test'), null)
  assert.equal(urlCapturavel('https://localhost/x'), null)
})

test('urlViva recusa HTTP de erro e urlsDoItem exige origem explícita do produto real', async () => {
  assert.equal(await urlViva('https://app.example.test/x', async () => ({ ok: false, status: 404 })), false)
  assert.equal(await urlViva('https://app.example.test/x', async () => ({ ok: true, status: 200 })), true)
  assert.deepEqual(urlsDoItem({ fontes: [{ url: 'https://app.example.test/produto' }] }), [])
  assert.deepEqual(urlsDoItem({ fontes: [{ ambiente: 'produto-real', url: 'https://app.example.test/produto' }] }), ['https://app.example.test/produto'])
})

test('resolver usa mídia já anexada sem copiar de fora', () => {
  const dataDir = pasta('item-anexado')
  const rel = 'midias/refs/entrada.png'
  const arquivo = path.join(dataDir, 'editorial', rel)
  fs.mkdirSync(path.dirname(arquivo), { recursive: true })
  fs.writeFileSync(arquivo, PNG)
  const saida = resolverReferencias({
    item: { midias: [{ tipo: 'imagem', arquivo: rel }] },
    dataDir,
    portfolioDir: pasta('vazio-port'),
    acervoDir: pasta('vazio-acervo'),
  })
  assert.deepEqual(saida.references, [rel])
  assert.equal(saida.achados[0].origem, 'item')
})

test('resolver acha screenshot do projeto no acervo e copia para refs', () => {
  const dataDir = pasta('hunt-nexarq')
  const portfolioDir = pasta('port-nexarq')
  const principal = path.join(portfolioDir, 'nexarq-admin-metricas.png')
  fs.writeFileSync(principal, PNG)
  fs.writeFileSync(`${principal}.json`, JSON.stringify({ ambiente: 'produto-real', dados: 'reais', descricao: 'Painel real.', sha256: require('node:crypto').createHash('sha256').update(PNG).digest('hex') }))
  fs.writeFileSync(path.join(portfolioDir, 'outra-coisa.png'), PNG)
  const saida = resolverReferencias({
    item: { origem: { tipo: 'acervo', projeto: 'nexarq' }, titulo: 'NexARQ admin' },
    dataDir,
    portfolioDir,
    acervoDir: pasta('vazio-acervo-nexarq'),
  })
  assert.equal(saida.references.length, 1)
  assert.match(saida.references[0], /midias\/refs\/.*nexarq/)
  assert.equal(saida.achados[0].origem, 'portfolio')
  assert.equal(saida.references.some((arquivo) => arquivo.includes('outra-coisa')), false)
  assert.equal(fs.existsSync(path.join(dataDir, 'editorial', saida.references[0])), true)
})

test('refs de outro projeto não servem de evidência', () => {
  const dataDir = pasta('refs-alheias')
  const refs = path.join(dataDir, 'editorial', 'midias', 'refs')
  fs.mkdirSync(refs, { recursive: true })
  fs.writeFileSync(path.join(refs, 'dailywork-agente-overview.png'), PNG)
  fs.writeFileSync(path.join(refs, 'lojasync-painel.png'), PNG)
  const saida = resolverReferencias({
    item: { origem: { projeto: 'videogen' }, titulo: 'VIDEOGEN', fontes: [{ url: 'https://github.com/example/videogen' }] },
    dataDir,
    portfolioDir: pasta('vazio-port-alheias'),
    acervoDir: pasta('vazio-acervo-alheias'),
  })
  assert.deepEqual(saida.references, [])
})

test('sem chave e sem mídia devolve vazio — não pega imagem alheia', () => {
  const dataDir = pasta('sem-chave')
  const portfolioDir = pasta('port-ruido')
  fs.writeFileSync(path.join(portfolioDir, 'nexarq-admin.png'), PNG)
  const saida = resolverReferencias({
    item: { titulo: 'Pauta de mídia', fontes: [{ rotulo: 'fixture', url: 'https://example.test' }] },
    dataDir,
    portfolioDir,
    acervoDir: pasta('vazio-acervo-ruido'),
  })
  assert.deepEqual(saida.references, [])
})

test('captura do produto público real entra em refs quando o disco está vazio', async () => {
  const dataDir = pasta('captura')
  const destEsperado = []
  const saida = await resolverReferenciasComCaptura({
    item: {
      origem: { projeto: 'videogen' },
      titulo: 'VIDEOGEN',
      fontes: [{ rotulo: 'Produto', ambiente: 'produto-real', url: 'https://videogen.example.test/app' }],
    },
    dataDir,
    portfolioDir: pasta('vazio-port-cap'),
    acervoDir: pasta('vazio-acervo-cap'),
    capturarUrl: async ({ url, dest }) => {
      destEsperado.push({ url, dest })
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, PNG)
      return dest
    },
  })
  assert.equal(destEsperado[0].url, 'https://videogen.example.test/app')
  assert.equal(saida.references.length, 1)
  assert.equal(saida.achados[0].origem, 'captura-fonte')
  assert.equal(fs.existsSync(path.join(dataDir, 'editorial', saida.references[0])), true)
})

test('captura tenta a próxima URL real quando a primeira falha', async () => {
  const dataDir = pasta('captura-fallback')
  const tentadas = []
  const saida = await resolverReferenciasComCaptura({
    item: {
      origem: { projeto: 'the-last-arrow' },
      titulo: 'The Last Arrow',
      fontes: [
        { ambiente: 'produto-real', url: 'https://the-last-arrow.example.test/indisponivel' },
        { ambiente: 'produto-real', url: 'https://the-last-arrow.example.test/app' },
      ],
    },
    dataDir,
    portfolioDir: pasta('vazio-port-fb'),
    acervoDir: pasta('vazio-acervo-fb'),
    capturarUrl: async ({ url, dest }) => {
      tentadas.push(url)
      if (url.endsWith('/app')) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, PNG)
        return dest
      }
      return null
    },
  })
  assert.deepEqual(tentadas, ['https://the-last-arrow.example.test/indisponivel', 'https://the-last-arrow.example.test/app'])
  assert.equal(saida.achados[0].rotulo, 'https://the-last-arrow.example.test/app')
})

test('captura desligada ou falha não inventa referência', async () => {
  const dataDir = pasta('captura-falha')
  const vazio = await resolverReferenciasComCaptura({
    item: { origem: { projeto: 'videogen' }, fontes: [{ url: 'https://github.com/example/videogen' }] },
    dataDir,
    portfolioDir: pasta('vazio-port-falha'),
    acervoDir: pasta('vazio-acervo-falha'),
    capturarUrl: null,
  })
  assert.deepEqual(vazio.references, [])
  const falhou = await resolverReferenciasComCaptura({
    item: { origem: { projeto: 'videogen' }, fontes: [{ url: 'https://github.com/example/videogen' }] },
    dataDir,
    portfolioDir: pasta('vazio-port-falha2'),
    acervoDir: pasta('vazio-acervo-falha2'),
    capturarUrl: async () => null,
  })
  assert.deepEqual(falhou.references, [])
})
