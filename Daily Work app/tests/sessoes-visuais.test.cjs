const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { criarServicoSessoes } = require('../electron/sessoes/servico.cjs')
const { criarRegistroIntegracoes } = require('../electron/integracoes/registro.cjs')
const { criarFilaEditorial } = require('../electron/lib-fila-editorial.cjs')
const URL_PERFIL = 'https://www.linkedin.com/in/teste'
async function fixture(t, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-sessoes-'))
  let relogio = 1000,
    envios = 0
  const driver = {
    disponivel: async () => 'livre',
    verificar: async () => ({
      sessao: 'autenticada',
      contaVerificada: { perfilUrl: URL_PERFIL, nome: 'Teste' },
    }),
    preparar: async () => ({ preparado: true }),
    enviar: async (p) => {
      envios++
      return {
        id: 'urn:li:activity:123',
        url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/',
        perfilUrl: p.perfilUrl,
        texto: p.texto,
      }
    },
    consultar: async () => ({ texto: 'Perfil' }),
    ...extra,
  }
  const opcoes = { dataDir, driver, now: () => relogio }
  const s = criarServicoSessoes(opcoes)
  t.after(() => {
    s.fechar()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })
  await s.vincular({ perfilUrl: URL_PERFIL })
  const publicar = (texto = 'Texto aprovado') => s.confirmar({ proposalId: s.preparar({ texto }).proposalId })
  return { dataDir, s, driver, opcoes, publicar, avancar: (ms) => (relogio += ms), envios: () => envios }
}
test('aprovação enfileira, duplicata retorna o mesmo job, apenas recibo remoto publica', async (t) => {
  const f = await fixture(t)
  const p = f.s.preparar({ texto: 'Texto aprovado' })
  const j = f.s.confirmar(p)
  assert.equal(j.estado, 'aguardando_executor')
  assert.equal(f.envios(), 0)
  assert.equal(f.s.confirmar(p).id, j.id)
  await f.s.processar()
  await f.s.processar()
  assert.equal(f.envios(), 1)
  assert.equal(f.s.obterJob(j.id).estado, 'publicado')
  const log = fs.readFileSync(path.join(f.dataDir, '_log.ndjson'), 'utf8')
  assert.match(log, /integracoes:publicar/)
  assert.doesNotMatch(log, /Texto aprovado/)
})
test('proposta não confirmada, vencida e mídia não disparam envio', async (t) => {
  const f = await fixture(t)
  const p = f.s.preparar({ texto: 'Teste' })
  await f.s.processar()
  assert.equal(f.envios(), 0)
  f.avancar(600001)
  assert.throws(
    () => f.s.confirmar(p),
    (e) => e.codigo === 'PROPOSTA_EXPIRADA',
  )
  assert.throws(
    () => f.s.preparar({ texto: 'Teste', midias: [{ id: 'm' }] }),
    (e) => e.codigo === 'MIDIA_NAO_SUPORTADA',
  )
})
test('sessão visual do LinkedIn preserva as imagens aprovadas até o recibo remoto', async (t) => {
  const f = await fixture(t)
  const pasta = path.join(f.dataDir, 'editorial/midias/teste')
  fs.mkdirSync(pasta, { recursive: true })
  const arquivo = path.join(pasta, 'cena.png')
  fs.writeFileSync(arquivo, 'imagem aprovada')
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex')
  f.driver.preparar = async (entrada) => ({ preparado: true, midias: entrada.midias.length })
  f.driver.enviar = async (entrada) => ({
    id: 'urn:li:activity:123',
    url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/',
    perfilUrl: entrada.perfilUrl,
    texto: entrada.texto,
    midias: entrada.midias.length,
  })
  const proposta = f.s.preparar({
    texto: 'Texto com imagem',
    formato: 'imagem',
    midias: [{ id: 'm1', tipo: 'imagem', mime: 'image/png', arquivo: 'midias/teste/cena.png', sha256 }],
  })
  const job = f.s.confirmar(proposta)
  await f.s.processar()
  assert.equal(f.s.obterJob(job.id).estado, 'publicado')
  assert.equal((await f.s.obterEstado()).capacidades.publicarImagem, true)
})
test('cancelar durante preparação impede clique, inclusive com outro cliente', async (t) => {
  const f = await fixture(t)
  const j = f.publicar()
  const outro = criarServicoSessoes(f.opcoes)
  f.driver.preparar = async () => {
    outro.cancelar(j.id)
    return { preparado: true }
  }
  await f.s.processar()
  outro.fechar()
  assert.equal(f.envios(), 0)
  assert.equal(f.s.obterJob(j.id).estado, 'cancelado')
})
test('troca de conta e expiração depois de preparar impedem envio', async (t) => {
  const f = await fixture(t)
  const j = f.publicar()
  f.driver.verificar = async () => ({
    sessao: 'autenticada',
    contaVerificada: { perfilUrl: 'https://www.linkedin.com/in/outra', nome: 'Outra' },
  })
  await f.s.processar()
  assert.equal(f.envios(), 0)
  assert.equal(f.s.obterJob(j.id).estado, 'aguardando_humano')
  f.driver.verificar = async () => ({
    sessao: 'autenticada',
    contaVerificada: { perfilUrl: URL_PERFIL, nome: 'Teste' },
  })
  f.driver.preparar = async () => {
    f.avancar(600001)
    return { preparado: true }
  }
  await f.s.processar()
  assert.equal(f.envios(), 0)
  assert.equal(f.s.obterJob(j.id).estado, 'expirado')
})
test('pausa humana preserva job sem ação e a janela expira offline', async (t) => {
  const f = await fixture(t)
  const j = f.publicar()
  f.driver.disponivel = async () => 'controle_humano'
  await f.s.processar()
  assert.equal(f.s.obterJob(j.id).estado, 'aguardando_humano')
  assert.equal(f.envios(), 0)
  f.driver.disponivel = async () => 'offline'
  f.avancar(600001)
  await f.s.processar()
  assert.equal(f.s.obterJob(j.id).estado, 'expirado')
  assert.equal(f.envios(), 0)
})
test('resposta perdida ou recibo divergente fica incerto e não repete envio', async (t) => {
  const f = await fixture(t)
  const j = f.publicar()
  let chamadas = 0
  f.driver.enviar = async () => {
    chamadas++
    throw new Error('timeout')
  }
  await f.s.processar()
  await f.s.processar()
  assert.equal(chamadas, 1)
  assert.equal(f.s.obterJob(j.id).estado, 'incerto')
  assert.throws(
    () => f.s.cancelar(j.id),
    (e) => e.codigo === 'ENVIO_JA_INICIADO',
  )
})
test('dois coordenadores não operam o perfil ao mesmo tempo', async (t) => {
  const f = await fixture(t)
  const outro = criarServicoSessoes(f.opcoes)
  f.publicar()
  f.driver.preparar = async () => {
    await outro.processar()
    await assert.rejects(
      () => outro.verificar(),
      (e) => e.codigo === 'EXECUTOR_OCUPADO',
    )
    return { preparado: true }
  }
  await f.s.processar()
  outro.fechar()
  assert.equal(f.envios(), 1)
})

test('cancelamento na última checagem vence a transição de envio', async (t) => {
  const f = await fixture(t)
  const j = f.publicar()
  let chamadas = 0
  f.driver.disponivel = async () => {
    if (++chamadas === 2) f.s.cancelar(j.id)
    return 'livre'
  }
  await f.s.processar()
  assert.equal(f.envios(), 0)
  assert.equal(f.s.obterJob(j.id).estado, 'cancelado')
})

test('a agenda fixa a conta e exige revisão depois de uma troca', async (t) => {
  const f = await fixture(t)
  const registro = criarRegistroIntegracoes({ dataDir: f.dataDir, userDataDir: path.join(f.dataDir, 'user'), sessoes: f.s, now: f.opcoes.now })
  const fila = criarFilaEditorial({ dataDir: f.dataDir, registro, now: f.opcoes.now })
  const item = await fila.criar({ pautaId: 'p-agenda', conta: 'linkedin', idioma: 'pt-BR', titulo: 'Teste', texto: 'Texto aprovado' })
  await assert.rejects(() => fila.publicar(item.id, { revisao: item.revisao, perfilUrl: 'https://www.linkedin.com/in/outra' }), e => e.codigo === 'CONTA_DIVERGENTE')
  await fila.agendar(item.id, { revisao: item.revisao, agendadoPara: new Date(2000).toISOString(), perfilUrl: URL_PERFIL })
  const outra = 'https://www.linkedin.com/in/outra'
  f.driver.verificar = async () => ({ sessao: 'autenticada', contaVerificada: { perfilUrl: outra, nome: 'Outra' } })
  await f.s.vincular({ perfilUrl: outra })
  f.avancar(1001)
  await fila.processarAgendados()
  assert.equal((await fila.obter(item.id)).estado, 'erro')
  assert.equal(f.envios(), 0)
})

test('recibo de outro conteúdo não promove o job para publicado', async (t) => {
  const f = await fixture(t)
  const j = f.publicar()
  f.driver.enviar = async (p) => ({ id: 'urn:li:activity:123', url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', perfilUrl: p.perfilUrl, texto: 'Outro texto' })
  await f.s.processar()
  assert.equal(f.s.obterJob(j.id).estado, 'incerto')
  assert.equal(f.s.obterJob(j.id).recibo, null)
})
test('queda depois de possível clique recupera incerto sem repetir', async (t) => {
  const f = await fixture(t)
  const j = f.publicar()
  const db = new DatabaseSync(path.join(f.dataDir, 'editorial/.sessoes/estado.sqlite'))
  const r = JSON.parse(db.prepare("SELECT valor FROM registros WHERE tipo='job' AND id=?").get(j.id).valor)
  r.estado = 'envio_iniciado'
  db.prepare("UPDATE registros SET valor=? WHERE tipo='job' AND id=?").run(JSON.stringify(r), j.id)
  db.prepare('INSERT OR REPLACE INTO lease VALUES(1,?,?)').run(2147483647, 'morto')
  db.close()
  await f.s.processar()
  assert.equal(f.envios(), 0)
  assert.equal(f.s.obterJob(j.id).estado, 'incerto')
})
test('a Fila distingue job enfileirado de publicado e sincroniza recibo', async (t) => {
  const f = await fixture(t)
  const r = criarRegistroIntegracoes({
    dataDir: f.dataDir,
    userDataDir: path.join(f.dataDir, 'user'),
    sessoes: f.s,
    now: f.opcoes.now,
  })
  const fila = criarFilaEditorial({ dataDir: f.dataDir, registro: r, now: f.opcoes.now })
  const i = await fila.criar({
    pautaId: 'p1',
    conta: 'linkedin',
    idioma: 'pt-BR',
    formato: 'texto',
    titulo: 'Título',
    texto: 'Texto aprovado',
  })
  const pendente = await fila.publicar(i.id, { revisao: i.revisao, perfilUrl: URL_PERFIL })
  assert.equal(pendente.estado, 'aguardando_executor')
  assert.equal(pendente.recibo, undefined)
  await assert.rejects(
    () => fila.atualizar(i.id, { revisao: pendente.revisao, texto: 'Mudou' }),
    (e) => e.codigo === 'ESTADO_INVALIDO',
  )
  await f.s.processar()
  const [listado] = await fila.listar()
  assert.equal(listado.estado, 'publicado')
  const final = await fila.obter(i.id)
  assert.equal(final.estado, 'publicado')
  assert.match(final.recibo.url, /activity:123/)
})
test('modificação do arquivo da Fila após aprovação bloqueia envio', async (t) => {
  const f = await fixture(t)
  const r = criarRegistroIntegracoes({
    dataDir: f.dataDir,
    userDataDir: path.join(f.dataDir, 'user'),
    sessoes: f.s,
    now: f.opcoes.now,
  })
  const fila = criarFilaEditorial({ dataDir: f.dataDir, registro: r, now: f.opcoes.now })
  const i = await fila.criar({
    pautaId: 'p1',
    conta: 'linkedin',
    idioma: 'pt-BR',
    titulo: 'Título',
    texto: 'Texto aprovado',
  })
  const j = await fila.publicar(i.id, { revisao: i.revisao, perfilUrl: URL_PERFIL })
  const arquivo = path.join(f.dataDir, 'editorial/itens', i.id + '.json')
  fs.writeFileSync(arquivo, JSON.stringify({ ...j, texto: 'Outro texto' }))
  await f.s.processar()
  assert.equal(f.envios(), 0)
  assert.equal((await fila.obter(i.id)).estado, 'erro')
})

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('comprovante PNG do envio é gravado no recibo e na pasta editorial', async (t) => {
  const f = await fixture(t)
  f.driver.enviar = async (p) => ({
    id: 'urn:li:activity:123',
    url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/',
    perfilUrl: p.perfilUrl,
    texto: p.texto,
    comprovantePng: PNG,
  })
  const j = f.publicar()
  await f.s.processar()
  const job = f.s.obterJob(j.id)
  assert.equal(job.estado, 'publicado')
  assert.equal(job.recibo.comprovante.sha256.length, 64)
  const arquivo = path.join(f.dataDir, 'editorial', job.recibo.comprovante.arquivo)
  assert.equal(fs.readFileSync(arquivo).toString('base64'), PNG)
  const log = fs.readFileSync(path.join(f.dataDir, '_log.ndjson'), 'utf8')
  assert.match(log, /sessoes:comprovante/)
})

test('capturarComprovante respeita o lease do executor', async (t) => {
  const f = await fixture(t)
  f.driver.capturar = async () => ({ comprovantePng: PNG, url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', id: 'urn:li:activity:123', perfilUrl: URL_PERFIL })
  const j = f.publicar()
  f.driver.preparar = async () => {
    await assert.rejects(() => f.s.capturarComprovante({ url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', perfilUrl: URL_PERFIL }), (e) => e.codigo === 'EXECUTOR_OCUPADO')
    return { preparado: true }
  }
  await f.s.processar()
  assert.equal(f.s.obterJob(j.id).estado, 'publicado')
  const avulso = await f.s.capturarComprovante({ url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', perfilUrl: URL_PERFIL, itemId: 'ed-teste' })
  assert.ok(fs.existsSync(path.join(f.dataDir, 'editorial', avulso.comprovante.arquivo)))
})
