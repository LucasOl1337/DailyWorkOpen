const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { criarServicoAutomacoes, classificarUrl } = require('../electron/lib-automacoes.cjs')
const { criarArquivos, lerJson, hash } = require('../electron/automacoes/arquivos.cjs')
const { criarBiblioteca } = require('../electron/automacoes/biblioteca.cjs')
const { criarCampanha } = require('../electron/automacoes/campanha.cjs')
const { criarMiddlewareAutomacoes } = require('../electron/automacoes/http.cjs')
const { registrarOperacoes } = require('../electron/lib-operacoes.cjs')
const { criarApiLocal } = require('../electron/lib-api-local.cjs')

function fixture(t, opcoes = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-automacoes-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const base = path.join(dir, 'Portfolio/empresas/cognition')
  fs.mkdirSync(path.join(base, 'scripts'), { recursive: true })
  for (const [nome, texto] of Object.entries({ 'findings.md': '# Experiência\nProjeto comprovado em Node.js.', 'argumentos.md': '# Argumentos\nUma abordagem específica por destinatário.', 'playbook.md': '# Critérios\nRespeitar limites de atribuição.', 'ciclo.prompt.md': 'Ciclo sintético para testes sem envio.' })) fs.writeFileSync(path.join(base, nome), texto)
  const estadoPath = path.join(base, 'estado.json.local')
  fs.writeFileSync(estadoPath, JSON.stringify({ campanha: 'cognition', toques: { '2026-09-10': { email: { status: 'ENVIADA' } } }, fila_argumentos: ['A01'], candidaturas: {} }))
  const dataDir = path.join(dir, 'data')
  const arquivos = criarArquivos({ lucasOlDir: dir, dataDir })
  const biblioteca = criarBiblioteca(arquivos, { extrairPdf: opcoes.extrairPdf })
  const campanha = criarCampanha(arquivos, biblioteca)
  const servico = criarServicoAutomacoes({ lucasOlDir: dir, dataDir, navegador: { estado: async () => ({ nome: 'teste', conectado: true, controle: 'agente', workspace: 9, porta: 12345 }), preparar: async () => ({ conectado: true, controle: 'agente', nome: 'teste', workspace: 9 }) }, executarComando: async () => ({ stdout: 'ActiveState=active\nNextElapseUSecRealtime=Fri 2026-09-11 09:30:00 -03\nLastTriggerUSec=Thu 2026-09-10 09:30:00 -03\n' }), fetchImpl: async () => ({ ok: true, json: async () => ({ Browser: 'Chromium', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/teste' }) }), fetchIdentidade: async () => ({ ok: false, text: async () => '' }), ...opcoes })
  return { dir, base, estadoPath, dataDir, arquivos, biblioteca, campanha, servico }
}
async function servidor(t, handler) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  return `http://127.0.0.1:${server.address().port}`
}

test('fila manual deduplica URLs e preserva os bytes do histórico da campanha', async t => {
  const f = fixture(t)
  const antes = fs.readFileSync(f.estadoPath, 'utf8')
  const primeiro = await f.servico.adicionarAlvo({ url: 'https://twitter.com/exemplo?tracking=1' })
  const segundo = await f.servico.adicionarAlvo({ url: 'https://x.com/exemplo' })
  assert.equal(primeiro.adicionado, true); assert.equal(segundo.adicionado, false)
  assert.equal(primeiro.item.id, segundo.item.id)
  assert.equal(fs.readFileSync(f.estadoPath, 'utf8'), antes)
  assert.equal((await f.servico.estado()).filaManual.length, 1)
  assert.match(fs.readFileSync(path.join(f.dataDir, '_log.ndjson'), 'utf8'), /alvo-adicionar/)
})

test('fila manual reconcilia duplicata pendente com envio já comprovado sem disparar de novo', async t => {
  let disparos = 0
  const f = fixture(t, { executarComando: async () => { disparos++; return { stdout: '' } } })
  const primeiro = await f.servico.adicionarAlvo({ url: 'https://linkedin.com/in/exemplo' })
  const c = await f.biblioteca.preparar({ tipo: 'ciclo' })
  const i = await f.campanha.registrar({ contextoId: c.id, tipo: 'linkedin', alvo: primeiro.item.url, texto: 'Mensagem específica.', fontesUsadas: [c.fontes[0].id], filaId: primeiro.item.id })
  await f.campanha.concluir({ id: i.id, status: 'confirmado', evidencia: 'recibo verificável' })

  const duplicata = { ...primeiro.item, id: '11111111-1111-4111-8111-111111111111', status: 'na_fila' }
  fs.writeFileSync(path.join(f.base, 'runs/fila', `${duplicata.id}.json.local`), JSON.stringify(duplicata))
  const resultado = await f.servico.adicionarAlvo({ url: primeiro.item.url, agora: true })

  assert.equal(resultado.reconciliado, true)
  assert.equal(resultado.item.status, 'feito')
  assert.equal(resultado.item.evidencia, 'recibo verificável')
  assert.equal(resultado.disparo, undefined)
  assert.equal(disparos, 0)
  assert.match(fs.readFileSync(path.join(f.dataDir, '_log.ndjson'), 'utf8'), /alvo-reconciliar/)
})

test('JSON inválido ou domínio falso falha sem regravar os arquivos', async t => {
  const f = fixture(t)
  const corrompido = '{"toques":'
  fs.writeFileSync(f.estadoPath, corrompido)
  await assert.rejects(f.servico.adicionarAlvo({ url: 'https://x.com/exemplo' }), { codigo: 'ESTADO_INVALIDO' })
  assert.equal(fs.readFileSync(f.estadoPath, 'utf8'), corrompido)
  for (const url of ['https://linkedin.com.example.org/in/exemplo', 'file:///tmp/teste', 'https://x.com/home', 'https://x.com/a/status/xyz', 'https://jobs.ashbyhq.com/cognition']) assert.throws(() => classificarUrl(url), { codigo: 'URL_INVALIDA' })
})

test('seleção tem revisão e contexto preserva conteúdo anterior e envelope íntegro', async t => {
  const f = fixture(t)
  const b = f.servico.biblioteca()
  const id = b.fontes[0].id
  const salvo = await f.servico.salvarSelecao({ fontes: [id], revisao: b.config.revisao })
  await assert.rejects(f.servico.salvarSelecao({ fontes: [id], revisao: b.config.revisao }), { codigo: 'CONFLITO' })
  const contexto = await f.servico.prepararContexto({ tipo: 'curriculo', briefing: 'Destacar experiência comprovada em Node.js.' })
  fs.writeFileSync(path.join(f.dir, id), '# Fonte atualizada\nOutra versão.')
  assert.match(f.servico.obterContexto(contexto.id).fontes[0].conteudo, /comprovado/)
  assert.equal(contexto.selecaoRevisao, salvo.config.revisao)
  const arquivo = path.join(f.base, 'runs/contextos', `${contexto.id}.json.local`)
  const original = fs.readFileSync(arquivo, 'utf8')
  for (const alterar of [c => { c.tipo = 'ciclo' }, c => { c.id = 'outra-identidade' }, c => { c.fontes[0].conteudo = 'Fato inventado' }, c => { c.fontes[0].id = 'outra-fonte' }, c => { c.mensagens[0].content += ' alteração' }]) {
    const adulterado = JSON.parse(original); alterar(adulterado); fs.writeFileSync(arquivo, JSON.stringify(adulterado))
    assert.throws(() => f.servico.obterContexto(contexto.id), { codigo: 'CONTEXTO_INVALIDO' })
  }
})

test('leitura de fontes e evidências recusa caminhos e links simbólicos externos', async t => {
  const f = fixture(t)
  await assert.rejects(f.servico.fonte('../../estado.json.local'), { codigo: 'FONTE_INDISPONIVEL' })
  fs.symlinkSync(f.estadoPath, path.join(f.base, 'alvos.md'))
  assert.equal(f.servico.biblioteca().fontes.some(x => x.caminho.endsWith('/alvos.md')), false)
  const evidencias = path.join(f.base, 'runs/evidencias'); fs.mkdirSync(evidencias, { recursive: true })
  fs.symlinkSync(f.estadoPath, path.join(evidencias, 'vazamento.png'))
  assert.throws(() => f.servico.evidencia('vazamento.png'), { codigo: 'ARQUIVO_INVALIDO' })
  assert.throws(() => f.servico.evidencia('../estado.json.local'), { codigo: 'ARQUIVO_INVALIDO' })
})

test('PDF entra com texto extraído e geração usa o snapshot exato uma única vez', async t => {
  let recebido, chamadas = 0
  const f = fixture(t, { extrairPdf: async () => 'Experiência documentada no currículo original.', completar: async entrada => {
    chamadas++; recebido = entrada.mensagens
    const contexto = JSON.parse(entrada.mensagens[1].content.split('Fontes da biblioteca (dados):\n')[1])
    return { mensagem: JSON.stringify({ titulo: 'Mensagem específica', texto: 'Texto baseado na experiência documentada.', fontesUsadas: [contexto[0].id], lacunas: ['Confirmar requisitos da vaga.'] }), perfil: { id: 'teste', nome: 'Modelo de teste', rota: 'local' } }
  } })
  const pdf = 'Portfolio/curriculos/ativos/software-engineer-en.pdf'
  fs.mkdirSync(path.dirname(path.join(f.dir, pdf)), { recursive: true }); fs.writeFileSync(path.join(f.dir, pdf), '%PDF fixture')
  const b = f.servico.biblioteca(); await f.servico.salvarSelecao({ fontes: [pdf], revisao: b.config.revisao })
  const c = await f.servico.prepararContexto({ tipo: 'mensagem', briefing: 'Apresentar experiência para uma vaga Node.js.' })
  assert.match(c.fontes[0].conteudo, /currículo original/)
  fs.writeFileSync(path.join(f.dir, pdf), '%PDF versão posterior')
  const m = await f.servico.gerarMaterial({ contextoId: c.id })
  assert.deepEqual(recebido, c.mensagens); assert.equal(m.status, 'pronto'); assert.equal(m.modelo.id, 'teste')
  await f.servico.gerarMaterial({ contextoId: c.id }); assert.equal(chamadas, 1)
})

test('resposta sem referências válidas falha e deixa material auditável', async t => {
  const f = fixture(t, { completar: async () => ({ mensagem: JSON.stringify({ titulo: 'Texto', texto: 'Não fundamentado', fontesUsadas: ['fonte-inexistente'], lacunas: [] }) }) })
  const c = await f.servico.prepararContexto({ briefing: 'Mensagem para apresentação.' })
  await assert.rejects(f.servico.gerarMaterial({ contextoId: c.id }), { codigo: 'RESPOSTA_INVALIDA' })
  assert.equal(f.servico.obterMaterial(c.id).status, 'falhou')
})

test('PDF com extensão maiúscula também usa o extrator e título legível', async t => {
  const leituras = []
  const f = fixture(t, { extrairPdf: async arquivo => { leituras.push(arquivo); return 'Texto extraído do PDF.' } })
  for (const extensao of ['pdf', 'PDF']) {
    const id = `Portfolio/curriculos/perfil-profissional.${extensao}`
    fs.mkdirSync(path.dirname(path.join(f.dir, id)), { recursive: true }); fs.writeFileSync(path.join(f.dir, id), '%PDF binário')
    const fonte = await f.servico.fonte(id)
    assert.equal(fonte.formato, 'pdf'); assert.equal(fonte.titulo, 'perfil profissional')
    assert.equal(fonte.conteudo, 'Texto extraído do PDF.')
  }
  assert.equal(leituras.length, 2)
})

test('fonte externa com credenciais é rejeitada antes de persistir interação', async t => {
  const f = fixture(t)
  const c = await f.biblioteca.preparar({ tipo: 'ciclo' })
  for (const url of ['https://usuario:senha@example.invalid/post', 'https://usuario@example.invalid/post']) {
    await assert.rejects(f.campanha.registrar({ contextoId: c.id, tipo: 'email', alvo: 'pessoa@example.invalid', texto: 'Texto documentado.', fontesUsadas: [c.fontes[0].id], fontesExternas: [{ url, trecho: 'Vaga informada.' }] }), { codigo: 'FONTES_INVALIDAS' })
  }
  assert.equal(f.campanha.listarInteracoes().length, 0)
})

test('limite considera estado operacional sem cortar fontes silenciosamente', async t => {
  const f = fixture(t)
  await assert.rejects(f.biblioteca.preparar({ tipo: 'ciclo' }, { estado: 'a'.repeat(170_000) }), { codigo: 'CONTEXTO_MUITO_GRANDE' })
  assert.equal(fs.existsSync(path.join(f.base, 'runs/contextos')), false)
})

test('contexto do executor omite imagens data URL da identidade da campanha', async t => {
  const f = fixture(t)
  const contexto = await f.biblioteca.preparar({ tipo: 'pesquisa' }, {
    cadastro: { id: 'cognition', identidade: { produto: 'Devin', resumo: 'Agentes de software.', logo: `data:image/png;base64,${'a'.repeat(20_000)}`, banner: `data:image/jpeg;base64,${'b'.repeat(150_000)}` } },
    estado: { fila: [] },
  })
  const operacional = contexto.mensagens.at(-1).content
  assert.match(operacional, /Agentes de software/)
  assert.doesNotMatch(operacional, /data:image/)
  assert.ok(contexto.caracteres < 160_000)
})

test('tentativas têm IDs independentes e conclusões tardias não confirmam outro texto', async t => {
  const f = fixture(t)
  const c = await f.biblioteca.preparar({ tipo: 'ciclo' })
  const entrada = { contextoId: c.id, tipo: 'email', alvo: 'pessoa@example.invalid', texto: 'Primeiro texto', fontesUsadas: [c.fontes[0].id] }
  const a = await f.campanha.registrar(entrada)
  await assert.rejects(f.campanha.registrar(entrada), { codigo: 'ENVIO_JA_REGISTRADO' })
  await f.campanha.concluir({ id: a.id, status: 'nao_enviado' })
  const b = await f.campanha.registrar({ ...entrada, texto: 'Segundo texto' })
  assert.notEqual(a.id, b.id)
  await assert.rejects(f.campanha.concluir({ id: a.id, status: 'confirmado', evidencia: 'recibo' }), { codigo: 'CONFLITO' })
  assert.equal(f.campanha.listarInteracoes().find(i => i.id === b.id).status, 'enviando')
})

test('conclusão só atende a fila vinculada no registro e exige evidência', async t => {
  const f = fixture(t)
  const fila = await f.servico.adicionarAlvo({ url: 'https://x.com/exemplo' })
  const c = await f.biblioteca.preparar({ tipo: 'ciclo' })
  await assert.rejects(f.campanha.registrar({ contextoId: c.id, tipo: 'email', alvo: 'pessoa@example.invalid', texto: 'Texto', fontesUsadas: [c.fontes[0].id], filaId: fila.item.id }), { codigo: 'FILA_INCOMPATIVEL' })
  const i = await f.campanha.registrar({ contextoId: c.id, tipo: 'x', alvo: fila.item.url, texto: 'Resposta contextual.', fontesUsadas: [c.fontes[0].id], filaId: fila.item.id })
  await assert.rejects(f.campanha.concluir({ id: i.id, status: 'confirmado' }), { codigo: 'EVIDENCIA_OBRIGATORIA' })
  await f.campanha.concluir({ id: i.id, status: 'confirmado', evidencia: 'https://x.com/exemplo/status/123' })
  assert.equal((await f.servico.estado()).filaManual[0].status, 'feito')
})

test('patch inválido ou revisão antiga não modifica o histórico', async t => {
  const f = fixture(t)
  const original = fs.readFileSync(f.estadoPath, 'utf8')
  const revisao = f.campanha.estado().revisao
  for (const patch of [{ toques: 'invalido' }, { candidaturas: [] }, { bloqueios: null }, { fila_argumentos: [null] }]) await assert.rejects(f.campanha.atualizarEstado({ revisao, patch }), { codigo: 'ESTADO_INVALIDO' })
  await assert.rejects(f.campanha.atualizarEstado({ revisao: 'antiga', patch: { fila_argumentos: [] } }), { codigo: 'CONFLITO' })
  assert.equal(fs.readFileSync(f.estadoPath, 'utf8'), original)
})

test('conferência manual resolve pendência e o estado informa o bloqueio real', async t => {
  const f = fixture(t)
  const c = await f.biblioteca.preparar({ tipo: 'ciclo' })
  const i = await f.campanha.registrar({ contextoId: c.id, tipo: 'email', alvo: 'pessoa@example.invalid', texto: 'Texto específico.', fontesUsadas: [c.fontes[0].id] })
  await f.campanha.concluir({ id: i.id, status: 'incerto', nota: 'Conexão caiu durante a ação.' })
  assert.equal((await f.servico.estado()).pendenciasInteracoes, 1)
  await f.servico.conferirInteracao({ id: i.id, status: 'nao_enviado', nota: 'Destino conferido; não houve envio.' })
  assert.equal((await f.servico.estado()).pendenciasInteracoes, 0)
  assert.equal(f.campanha.listarInteracoes()[0].status, 'nao_enviado')
})

test('HTTP legado protege origem e HTTP v1 executa os novos contratos', async t => {
  const f = fixture(t)
  const url = await servidor(t, criarMiddlewareAutomacoes(f.servico))
  const r = await fetch(url + '/executar', { method: 'POST', headers: { Origin: 'https://externo.example', 'Content-Type': 'text/plain', 'Sec-Fetch-Site': 'cross-site' } })
  assert.equal(r.status, 403)
  const urlRuim = await fetch(url + '/alvo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"url":"invalid"}' })
  assert.equal(urlRuim.status, 400)
  const ops = new Map(); registrarOperacoes({ registrar: (n, fn) => ops.set(n, fn), automacoes: f.servico })
  const v1 = await servidor(t, criarApiLocal({ operacoes: ops, token: 'teste' }).middleware)
  for (const [operacao, args] of [['estado', []], ['biblioteca', []], ['fonte', [f.servico.biblioteca().fontes[0].id]], ['contexto-preparar', [{ briefing: 'Preparar uma mensagem específica.' }]]]) {
    const res = await fetch(v1 + '/api/v1/operacoes/automacoes/' + operacao, { method: 'POST', headers: { Authorization: 'Bearer teste', 'Content-Type': 'application/json' }, body: JSON.stringify({ args }) })
    assert.equal(res.status, 200, `${operacao}: ${await res.text()}`)
  }
})

test('saúde informa bancada e preserva o erro de preparação', async t => {
  const f = fixture(t)
  const est = await f.servico.estado()
  assert.equal(est.timer.proxima, 'Fri 2026-09-11 09:30:00 -03')
  assert.equal(est.chromeCDP, true)
  assert.equal(est.navegador.workspace, 9)
  const s = criarServicoAutomacoes({ lucasOlDir: f.dir, dataDir: f.dataDir, navegador: { preparar: async () => { throw Object.assign(new Error('Controle com o humano'), { codigo: 'CONTROLE_HUMANO' }) } } })
  await assert.rejects(s.abrirPerfil(), { codigo: 'CONTROLE_HUMANO' })
})

async function esperar(fn, timeout = 5000) {
  const fim = Date.now() + timeout
  while (!fn()) { if (Date.now() > fim) throw new Error('Tempo de espera excedido'); await new Promise(r => setTimeout(r, 30)) }
}
function runner(t, f, codigo) {
  const script = path.join(f.base, 'scripts/rodar-campanha.sh')
  const wrapper = path.join(f.dir, 'runner-test.cjs')
  fs.writeFileSync(wrapper, `require(${JSON.stringify(path.resolve(__dirname, '../electron/automacoes/navegador.cjs'))}).criarNavegador=()=>({trava:${JSON.stringify(path.join(f.dir, 'browser.lock'))},estado:async()=>({nome:'teste',conectado:true,controle:'agente',workspace:9})})`)
  fs.mkdirSync(f.arquivos.runs, {recursive:true})
  fs.writeFileSync(script, 'exec flock --no-fork -n -E 75 "' + path.join(f.arquivos.runs, 'ciclo.lock') + '" "' + process.execPath + '" --require "' + wrapper + '" "' + path.resolve(__dirname, '../electron/automacoes/rodar.cjs') + '"\n')
  const fake = path.join(f.dir, 'fake-codex.cjs')
  fs.writeFileSync(fake, '#!/usr/bin/env node\n' + codigo); fs.chmodSync(fake, 0o700)
  const env = { ...process.env, LUCASOL_DIR: f.dir, DAILYWORK_DATA_DIR: f.dataDir, DAILYWORK_APP_DIR: path.resolve(__dirname, '..'), DAILYWORK_CODEX_BIN: fake }
  function iniciar() {
    const p = spawn('bash', [script], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const fim = once(p, 'exit')
    t.after(() => { if (p.exitCode === null) p.kill('SIGTERM') })
    return { p, fim }
  }
  return { iniciar, env }
}

test('timer e botão compartilham trava e registram contexto antes do executor', async t => {
  const f = fixture(t)
  const r = runner(t, f, 'process.stdin.resume(); setTimeout(() => process.exit(0), 600);')
  const primeiro = r.iniciar()
  const [sinal] = await once(primeiro.p.stdout, 'data')
  assert.match(sinal.toString(), /AUTOMACOES_INICIO=/)
  const segundo = r.iniciar(); assert.equal((await segundo.fim)[0], 75)
  assert.equal((await primeiro.fim)[0], 0)
  const registros = fs.readdirSync(path.join(f.base, 'runs/execucoes')).filter(n => n.endsWith('.json.local'))
  assert.equal(registros.length, 1)
  const job = lerJson(path.join(f.base, 'runs/execucoes', registros[0]))
  assert.equal(job.status, 'concluida')
  const c = f.biblioteca.obterContexto(job.contextoId)
  assert.equal(c.promptHash, hash(JSON.stringify(c.mensagens)))
})

test('cancelamento encerra o grupo de processos antes de liberar a execução', async t => {
  const f = fixture(t)
  const pidPath = path.join(f.dir, 'neto.pid')
  const r = runner(t, f, `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const neto=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidPath)},String(neto.pid));process.stdin.resume();setInterval(()=>{},1000);`)
  const a = r.iniciar(); await esperar(() => fs.existsSync(pidPath)); const neto = Number(fs.readFileSync(pidPath, 'utf8'))
  t.after(() => { try { process.kill(neto, 'SIGKILL') } catch {} })
  const job = (await f.servico.estado()).execucoes[0]
  assert.equal((await f.servico.cancelar({ id: job.id })).encerrado, true)
  assert.equal((await a.fim)[0], 1)
  const vivo = () => { try { return !fs.readFileSync(`/proc/${neto}/stat`, 'utf8').split(' ')[2].includes('Z') } catch { return false } }
  await esperar(() => !vivo())
})

test('campanhas isolam biblioteca, pesquisa, fila, materiais e histórico', async t => {
  const f = fixture(t)
  const original = fs.readFileSync(f.estadoPath, 'utf8')
  const c = await f.servico.criarCampanha({ nome: 'Empresa Exemplo', site: 'https://example.com', objetivo: 'Pesquisar vagas em agentes.' })
  const outra = f.servico.paraCampanha(c.id)
  assert.equal((await outra.estado()).timer.ativo, false)
  assert.equal((await outra.estado()).execucoes.length, 0)
  assert.equal(outra.biblioteca().fontes.some(x => x.id.includes('/cognition/')), false)
  const a = await f.servico.prepararContexto({ tipo: 'ciclo' })
  assert.throws(() => outra.obterContexto(a.id), { codigo: 'NAO_ENCONTRADO' })
  assert.throws(() => outra.obterMaterial(a.id), { codigo: 'NAO_ENCONTRADO' })
  await outra.adicionarAlvo({ url: 'https://x.com/exemplo' })
  assert.equal((await f.servico.estado()).filaManual.length, 0)
  assert.equal((await outra.estado()).filaManual.length, 1)
  const p = outra.pesquisa()
  await outra.salvarPesquisa({ ...p, notas: 'Contexto exclusivo da nova empresa.' })
  assert.equal(f.servico.pesquisa().notas, '')
  assert.equal(fs.readFileSync(f.estadoPath, 'utf8'), original)
  await assert.rejects(f.servico.criarCampanha({ nome: 'Empresa Exemplo', site: 'https://example.com' }), { codigo: 'CAMPANHA_EXISTENTE' })
  const pasta = path.join(f.dir, 'Portfolio/empresas', c.id)
  for (const nome of ['playbook.md', 'argumentos.md', 'alvos.md', 'ciclo.prompt.md', 'diario.md', 'findings.md']) assert.ok(fs.existsSync(path.join(pasta, nome)))
  assert.match(fs.readFileSync(path.join(pasta, 'ciclo.prompt.md'), 'utf8'), /autorizou envio/)
  assert.doesNotMatch(fs.readFileSync(path.join(pasta, 'ciclo.prompt.md'), 'utf8'), /sem autorização de envio/)
  assert.deepEqual((await outra.estado()).filaArgumentos, ['A01'])
  assert.ok(outra.biblioteca().fontes.some(x => x.id === `Portfolio/empresas/${c.id}/playbook.md`))
  assert.match((await outra.prepararContexto({ tipo: 'ciclo' })).mensagens[0].content, /autorizou envio/)
  const { dominiosDasCampanhas } = require('../electron/automacoes/campanhas.cjs')
  assert.ok(dominiosDasCampanhas(f.dir).includes('example.com'))
  const semSite = await f.servico.criarCampanha({ nome: 'Sem Site' })
  assert.equal(semSite.site, '')
  assert.equal(semSite.nome, 'Sem Site')
  await assert.rejects(f.servico.configurarCampanha(c.id, { revisao: c.revisao, executor: 'shell-inventado' }), { codigo: 'EXECUTOR_INVALIDO' })
  const salvo = await f.servico.configurarCampanha(c.id, { revisao: c.revisao, executor: 'grok' })
  assert.equal(salvo.executor, 'grok')
  assert.equal((await f.servico.estado()).cadastro.executor, 'codex')
  await assert.rejects(f.servico.configurarCampanha(c.id, { revisao: c.revisao, executor: 'devin' }), { codigo: 'CONFLITO' })
})

test('pesquisa exige evidência e preserva alterações concorrentes', async t => {
  const f = fixture(t)
  const p = f.servico.pesquisa()
  const pessoa = { nome: 'Pessoa Exemplo', cargo: 'Engenharia', url: 'https://x.com/exemplo', prioridade: 'alta', status: 'verificado', fonteUrl: 'https://example.com/team' }
  await assert.rejects(f.servico.salvarPesquisa({ ...p, pessoas: [pessoa] }), { codigo: 'EVIDENCIA_OBRIGATORIA' })
  const entrada = { ...p, notas: 'Pesquisa com prova.', pessoas: [pessoa], fontes: [{ titulo: 'Equipe oficial', url: pessoa.fonteUrl, trecho: 'O site apresenta a pessoa na equipe.', verificadoEm: '2026-09-11' }] }
  const salvo = await f.servico.salvarPesquisa(entrada)
  assert.equal(salvo.pessoas[0].status, 'verificado')
  await assert.rejects(f.servico.salvarPesquisa({ ...entrada, notas: 'Versão antiga' }), { codigo: 'CONFLITO' })
  assert.equal(f.servico.pesquisa().notas, 'Pesquisa com prova.')
  await assert.rejects(f.servico.salvarPesquisa({ ...salvo, fontes: [null] }), { codigo: 'ENTRADA_INVALIDA' })
  const c = await f.servico.prepararContexto({ tipo: 'pesquisa' })
  await assert.rejects(f.campanha.registrar({ contextoId: c.id, tipo: 'email', alvo: 'pessoa@example.invalid', texto: 'Não enviar', fontesUsadas: [c.fontes[0].id] }), { codigo: 'CONTEXTO_INVALIDO' })
})

test('escopo HTTP e v1 chega à empresa escolhida e recusa travessia', async t => {
  const f = fixture(t)
  const nova = await f.servico.criarCampanha({ nome: 'Teste HTTP', site: 'https://http.example' })
  const url = await servidor(t, criarMiddlewareAutomacoes(f.servico))
  const est = await (await fetch(url + '/?campanha=' + nova.id)).json()
  assert.equal(est.data.campanha, nova.id)
  assert.equal((await fetch(url + '/?campanha=../fora')).status, 400)
  const ops = new Map(); registrarOperacoes({ registrar: (n, fn) => ops.set(n, fn), automacoes: f.servico })
  const v1 = await servidor(t, criarApiLocal({ operacoes: ops, token: 'teste' }).middleware)
  for (const [operacao, args] of [['estado', [nova.id]], ['pesquisa', [nova.id]], ['catalogo', []], ['campanha-configurar', [{ revisao: nova.revisao, executor: 'devin' }, nova.id]]]) {
    const res = await fetch(v1 + '/api/v1/operacoes/automacoes/' + operacao, { method: 'POST', headers: { Authorization: 'Bearer teste', 'Content-Type': 'application/json' }, body: JSON.stringify({ args }) })
    assert.equal(res.status, 200, `${operacao}: ${await res.text()}`)
  }
  fs.symlinkSync(os.tmpdir(), path.join(f.dir, 'Portfolio/empresas/externa'))
  assert.throws(() => f.servico.paraCampanha('externa'), { codigo: 'CAMPANHA_INVALIDA' })
})

test('adaptadores mantêm argumento como dado e não desativam permissões', t => {
  const { EXECUTORES, comandoExecutor } = require('../electron/automacoes/executores.cjs')
  const f = fixture(t)
  const pedido = path.join(f.dir, 'pedido com espaços.txt'); fs.writeFileSync(pedido, 'Pedido sintético sem execução.')
  for (const e of EXECUTORES) {
    const nome = `DAILYWORK_${e.bin.toUpperCase().replaceAll('-', '_')}_BIN`
    const antes = process.env[nome]; process.env[nome] = process.execPath
    try {
      const c = comandoExecutor(e.id, { cwd: f.dir, promptPath: pedido, resultadoPath: path.join(f.dir, 'resultado.txt') })
      assert.equal(c.bin, process.execPath)
      if (e.id === 'crush') assert.equal(c.env.CRUSH_CLIENT_SERVER, '0')
      assert.equal(c.args.some(a => /dangerously|bypass|yolo|skip-permission/.test(a)), false)
      if (['codex', 'grok', 'devin'].includes(e.id)) assert.ok(e.id === 'codex' ? c.stdin.includes('sintético') : c.args.includes(pedido))
    } finally { if (antes === undefined) delete process.env[nome]; else process.env[nome] = antes }
  }
})

test('helper de controle que cai não finge humano no comando quando o agente segue na bancada', async t => {
  const { criarNavegador } = require('../electron/automacoes/navegador.cjs')
  const { EventEmitter } = require('node:events')
  const f = fixture(t)
  const perfil = path.join(f.dir, '.agents/desktop/sessions/dailywork-campanhas/chromium')
  fs.mkdirSync(perfil, { recursive: true })
  fs.writeFileSync(path.join(perfil, 'DevToolsActivePort'), '40457\n/devtools/browser/bancada-teste\n')
  function filhoQueSai(code) {
    const filho = new EventEmitter()
    filho.stdin = { on() {}, end() {} }
    filho.stdout = new EventEmitter()
    filho.kill = () => {}
    queueMicrotask(() => filho.emit('exit', code))
    return filho
  }
  const comum = {
    conferirAlvos: async () => ({ verificadas: 0 }),
    home: f.dir,
    fetchImpl: async () => ({ ok: true, json: async () => ({ Browser: 'Chromium', webSocketDebuggerUrl: 'ws://127.0.0.1:40457/devtools/browser/bancada-teste' }) }),
  }
  const agente = criarNavegador({ ...comum, spawnImpl: () => filhoQueSai(1), executarComando: async () => ({ stdout: JSON.stringify({ control_mode: 'agente', workspace: 7 }) }) })
  let ok = false
  await agente.comControle(async () => { ok = true })
  assert.equal(ok, true)
  const humano = criarNavegador({ ...comum, spawnImpl: () => filhoQueSai(2), executarComando: async () => ({ stdout: JSON.stringify({ control_mode: 'humano', workspace: 7 }) }) })
  await assert.rejects(humano.comControle(async () => {}), { codigo: 'CONTROLE_HUMANO' })
})

test('saúde do navegador exige identidade da sessão CDP e respeita controle humano', async t => {
  const { criarNavegador } = require('../electron/automacoes/navegador.cjs')
  const f = fixture(t)
  const perfil = path.join(f.dir, '.agents/desktop/sessions/dailywork-campanhas/chromium')
  fs.mkdirSync(perfil, { recursive: true })
  fs.writeFileSync(path.join(perfil, 'DevToolsActivePort'), '40457\n/devtools/browser/bancada-teste\n')
  let comandos = [], controle = 'humano', identidade = 'outro-browser'
  const nav = criarNavegador({conferirAlvos:async()=>({verificadas:0}), home: f.dir, executarComando: async (bin, args) => { comandos.push(args[0]); return { stdout: JSON.stringify({ control_mode: controle, workspace: 9 }) } }, fetchImpl: async () => ({ ok: true, json: async () => ({ Browser: 'Chromium', webSocketDebuggerUrl: 'ws://127.0.0.1:40457/devtools/browser/' + identidade }) }) })
  assert.equal((await nav.estado()).conectado, false)
  identidade = 'bancada-teste'
  assert.equal((await nav.estado()).conectado, true)
  await assert.rejects(nav.preparar(), { codigo: 'CONTROLE_HUMANO' })
  assert.deepEqual([...new Set(comandos)], ['status'])
})

test('conexão Playwright usa o websocket validado sem redescoberta HTTP', async t => {
  const { criarNavegador } = require('../electron/automacoes/navegador.cjs')
  const f = fixture(t)
  const perfil = path.join(f.dir, '.agents/desktop/sessions/dailywork-campanhas/chromium')
  fs.mkdirSync(perfil, { recursive: true })
  fs.writeFileSync(path.join(perfil, 'DevToolsActivePort'), '40457\n/devtools/browser/bancada-teste\n')
  const nav = criarNavegador({conferirAlvos:async()=>({verificadas:0}),
    home: f.dir,
    executarComando: async () => ({ stdout: JSON.stringify({ control_mode: 'agente', workspace: 9 }) }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ Browser: 'Chromium', webSocketDebuggerUrl: 'ws://127.0.0.1:40457/devtools/browser/bancada-teste' }) }),
  })
  let endpoint = ''
  const browser = { contexts: () => [{}], close: async () => {} }
  const conectado = await nav.conectarPlaywright({ connectOverCDP: async recebido => { endpoint = recebido; return browser } })
  assert.equal(conectado, browser)
  assert.equal(endpoint, 'ws://127.0.0.1:40457/devtools/browser/bancada-teste')
})

test('preparo reimporta quando a sessão persistida não cobre um domínio novo', () => {
  const { sessaoCobreDominios } = require('../electron/automacoes/navegador.cjs')
  const antiga = { dominios: ['linkedin.com', 'ashbyhq.com'] }
  assert.equal(sessaoCobreDominios(antiga, ['linkedin.com']), true)
  assert.equal(sessaoCobreDominios(antiga, ['linkedin.com', 'gupy.io']), false)
  assert.equal(sessaoCobreDominios(null, ['linkedin.com']), false)
})

test('comando de navegador sem processo de origem vivo não alcança a bancada', async t => {
  const { origemViva } = require('../electron/automacoes/navegador.cjs')
  const inicio = fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]
  assert.equal(origemViva({ pid: process.pid, inicio }), true)
  assert.equal(origemViva({ pid: process.pid, inicio: 'outro-processo' }), false)
  const p = spawn(process.execPath, [path.resolve(__dirname, '../electron/automacoes/navegador.cjs'), '--interno', JSON.stringify({ acao: 'abrir', url: 'https://example.com', origem: { pid: process.pid, inicio: 'inválido' } })], { stdio: ['ignore', 'pipe', 'pipe'] })
  let erro = ''; p.stderr.on('data', d => { erro += d })
  assert.equal((await once(p, 'exit'))[0], 1)
  assert.match(erro, /EXECUCAO_ENCERRADA/)
})

test('cancelamento alcança comando isolado da bancada e preserva outra execução', async t => {
  const { encerrarOperacoes } = require('../electron/automacoes/navegador.cjs')
  const script = path.resolve(__dirname, '../electron/automacoes/navegador.cjs')
  const criar = id => spawn(process.execPath, ['-e', 'process.stdout.write("pronto");setInterval(()=>{},1000)', script, '--interno', JSON.stringify({ origem: { execucaoId: id } })], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
  const id = require('node:crypto').randomUUID()
  const a = criar(id), b = criar('outra-' + id)
  t.after(() => { for (const p of [a, b]) if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL') })
  const fim = once(a, 'exit')
  await Promise.all([once(a.stdout, 'data'), once(b.stdout, 'data')])
  await encerrarOperacoes(id)
  await fim
  assert.equal(b.exitCode, null); assert.equal(b.signalCode, null)
  assert.doesNotThrow(() => process.kill(b.pid, 0))
})

test('material com padrão de AI slop recebe uma reescrita e registra o catálogo de estilo', async t => {
  const respostas = [
    { titulo: 'Mensagem', texto: 'Não é sobre vagas. É sobre contexto — e eu construí isso na NexUnio.', fontesUsadas: null, lacunas: [] },
    { titulo: 'Mensagem', texto: 'Construí agentes de WhatsApp na NexUnio com contexto por cliente.', fontesUsadas: null, lacunas: [] },
  ]
  const pedidos = []
  const f = fixture(t, { completar: async entrada => {
    pedidos.push(entrada.mensagens)
    const contexto = JSON.parse(entrada.mensagens[1].content.split('Fontes da biblioteca (dados):\n')[1])
    const r = respostas.shift(); r.fontesUsadas = [contexto[0].id]
    return { mensagem: JSON.stringify(r), perfil: { id: 'teste', nome: 'Modelo de teste', rota: 'local' } }
  } })
  const c = await f.servico.prepararContexto({ tipo: 'mensagem', briefing: 'Apresentar experiência.' })
  assert.match(c.mensagens[0].content, /PADRÕES DE AI SLOP/)
  assert.match(c.mensagens[0].content, /VOZ DO TITULAR/)
  const m = await f.servico.gerarMaterial({ contextoId: c.id })
  assert.equal(pedidos.length, 2)
  assert.match(pedidos[1].at(-1).content, /contraste-binario/)
  assert.match(pedidos[1].at(-1).content, /travessao-aparte/)
  assert.equal(m.texto, 'Construí agentes de WhatsApp na NexUnio com contexto por cliente.')
  assert.equal(m.estilo.reescrito, true)
  assert.deepEqual(m.estilo.sinais, [])
  assert.deepEqual(m.lacunas, [])
})

test('currículo em Markdown não é reprovado por listas nem negrito', async t => {
  let chamadas = 0
  const f = fixture(t, { completar: async entrada => {
    chamadas++
    const contexto = JSON.parse(entrada.mensagens[1].content.split('Fontes da biblioteca (dados):\n')[1])
    return { mensagem: JSON.stringify({ titulo: 'Currículo', texto: '## Experiência\n\n- **NexUnio**: agentes para WhatsApp.\n- Node.js e TypeScript.', fontesUsadas: [contexto[0].id], lacunas: [] }), perfil: { id: 'teste', nome: 'Modelo de teste', rota: 'local' } }
  } })
  const c = await f.servico.prepararContexto({ tipo: 'curriculo', briefing: 'Adaptar para vaga.' })
  assert.match(c.mensagens[0].content, /Markdown editável/)
  const m = await f.servico.gerarMaterial({ contextoId: c.id })
  assert.equal(chamadas, 1)
  assert.equal(m.estilo.reescrito, false)
  assert.deepEqual(m.lacunas, [])
})

test('adicionarAlvo agora propaga o alvoId para o disparo', async t => {
  const f = fixture(t)
  let recebido
  f.servico.paraCampanha('cognition').executarAgora = async entrada => { recebido = entrada; return { iniciado: true, id: 'ciclo-1' } }
  const r = await f.servico.adicionarAlvo({ url: 'https://x.com/exemplo', agora: true })
  assert.equal(r.adicionado, true)
  assert.equal(recebido.alvoId, r.item.id)
  assert.equal(r.disparo.id, 'ciclo-1')
})

test('autorização avulsa fica vinculada ao alvo existente e chega ao briefing focado', async t => {
  const f = fixture(t)
  const primeiro=await f.servico.adicionarAlvo({url:'https://x.com/exemplo'})
  const autorizado=await f.servico.adicionarAlvo({url:'https://x.com/exemplo',forcarContato:true,identidadeX:'@example_user'})
  assert.equal(autorizado.autorizado,true)
  assert.equal(autorizado.item.id,primeiro.item.id)
  assert.equal(autorizado.item.autorizacaoExplicita,true)
  assert.equal(autorizado.item.identidadeX,'@example_user')
})

test('iniciar prepara a bancada e recusa alvo fora da fila', async t => {
  const chamadas = []
  const f = fixture(t, { navegador: {
    estado: async () => { chamadas.push('estado'); return { conectado: false, controle: 'agente' } },
    preparar: async () => { chamadas.push('preparar'); throw Object.assign(new Error('preparou'), { codigo: 'PREPAROU' }) },
  } })
  const antes = process.env.DAILYWORK_CODEX_BIN
  process.env.DAILYWORK_CODEX_BIN = process.execPath
  t.after(() => { if (antes === undefined) delete process.env.DAILYWORK_CODEX_BIN; else process.env.DAILYWORK_CODEX_BIN = antes })
  await assert.rejects(f.servico.executarAgora({ alvoId: 'nao-existe' }), { codigo: 'ALVO_INVALIDO' })
  assert.deepEqual(chamadas, [])
  const alvo = await f.servico.adicionarAlvo({ url: 'https://x.com/exemplo', forcarContato:true, identidadeX:'@example_user' })
  await assert.rejects(f.servico.executarAgora({ alvoId: alvo.item.id }), { codigo: 'PREPAROU' })
  assert.deepEqual(chamadas, ['preparar'])
})

test('ciclo focado descreve o alvo no pedido e falha cedo se ele não está na fila', async t => {
  const f = fixture(t)
  const r = runner(t, f, 'process.exit(0)')
  r.env.AUTOMACOES_ALVO_ID = 'alvo-inexistente'
  r.env.AUTOMACOES_BANCADA_RETRY_MS = '1'
  assert.equal((await r.iniciar().fim)[0], 1)
  const pasta = path.join(f.base, 'runs/execucoes')
  const job = lerJson(path.join(pasta, fs.readdirSync(pasta)[0]))
  assert.equal(job.codigo, 'ALVO_INVALIDO')
  const alvo = await f.servico.adicionarAlvo({ url: 'https://x.com/exemplo', forcarContato:true, identidadeX:'@example_user' })
  r.env.AUTOMACOES_ALVO_ID = alvo.item.id
  const ok = r.iniciar()
  const [sinal] = await once(ok.p.stdout, 'data')
  assert.match(sinal.toString(), /AUTOMACOES_INICIO=/)
  assert.equal((await ok.fim)[0], 0)
  const pedido = fs.readdirSync(path.join(f.base, 'runs')).find(n => n.endsWith('.pedido.local.txt'))
  assert.match(fs.readFileSync(path.join(f.base, 'runs', pedido), 'utf8'), /https:\/\/x.com\/exemplo/)
  assert.match(fs.readFileSync(path.join(f.base, 'runs', pedido), 'utf8'), /Limite desta rodada: 1 interação/)
  assert.match(fs.readFileSync(path.join(f.base, 'runs', pedido), 'utf8'), /autorizou explicitamente este contato avulso/)
  assert.match(fs.readFileSync(path.join(f.base, 'runs', pedido), 'utf8'), /@example_user/)
})

test('disparo imediato injeta AUTOMACOES_ALVO_ID e limite 1 mesmo fora da agenda', t => {
  const { montarEnvCiclo } = require('../electron/automacoes/execucoes.cjs')
  const env = montarEnvCiclo({ lucasOlDir: '/tmp', dataDir: '/tmp/data', campanhaId: 'cognition', tipo: 'ciclo', cadastro: { executor: 'codex' }, alvoId: 'alvo-1' })
  assert.equal(env.AUTOMACOES_ALVO_ID, 'alvo-1')
  assert.equal(env.AUTOMACOES_LIMITE, '1')
  const comAgenda = montarEnvCiclo({ lucasOlDir: '/tmp', dataDir: '/tmp/data', campanhaId: 'cognition', tipo: 'ciclo', cadastro: { executor: 'codex' }, agenda: { id: 'ag', arquivo: '/tmp/a' }, briefing: 'hoje', limite: 4, alvoId: 'alvo-1' })
  assert.equal(comAgenda.AUTOMACOES_LIMITE, '1')
  assert.equal(comAgenda.AUTOMACOES_EXECUTOR, 'codex')
})

test('bancada tenta de novo em falha transitória e não insiste no controle humano', async t => {
  const { garantirBancada } = require('../electron/automacoes/rodar.cjs')
  const prev = process.env.AUTOMACOES_BANCADA_RETRY_MS
  process.env.AUTOMACOES_BANCADA_RETRY_MS = '1'
  t.after(() => { if (prev === undefined) delete process.env.AUTOMACOES_BANCADA_RETRY_MS; else process.env.AUTOMACOES_BANCADA_RETRY_MS = prev })
  let n = 0
  const browser = await garantirBancada({
    preparar: async () => {
      n++
      if (n === 1) throw Object.assign(new Error('fria'), { codigo: 'BANCADA_INDISPONIVEL' })
      return { conectado: true, controle: 'agente', nome: 'teste', workspace: 9 }
    },
  })
  assert.equal(n, 2)
  assert.equal(browser.conectado, true)
  await assert.rejects(garantirBancada({ preparar: async () => { throw Object.assign(new Error('com você'), { codigo: 'CONTROLE_HUMANO' }) } }), { codigo: 'CONTROLE_HUMANO' })
})

test('conectar reabre o Chromium durante o cold start', async t => {
  const { criarNavegador } = require('../electron/automacoes/navegador.cjs')
  const f = fixture(t)
  const perfil = path.join(f.dir, '.agents/desktop/sessions/dailywork-campanhas/chromium')
  fs.mkdirSync(perfil, { recursive: true })
  fs.writeFileSync(path.join(perfil, 'DevToolsActivePort'), '40457\n/devtools/browser/bancada-teste\n')
  let comandos = [], fetches = 0
  const nav = criarNavegador({conferirAlvos:async()=>({verificadas:0}),
    home: f.dir,
    esperaConexao: { tentativas: 6, intervalo: 1, reemitirACada: 2 },
    executarComando: async (_bin, args) => { comandos.push(args[0]); return { stdout: JSON.stringify({ control_mode: 'agente', workspace: 9 }) } },
    fetchImpl: async () => {
      fetches++
      if (fetches < 3) throw new Error('ainda não')
      return { ok: true, json: async () => ({ Browser: 'Chromium', webSocketDebuggerUrl: 'ws://127.0.0.1:40457/devtools/browser/bancada-teste' }) }
    },
  })
  const r = await nav.conectar()
  assert.equal(r.conectado, true)
  assert.ok(comandos.includes('cdp'))
  assert.ok(comandos.includes('browser'))
  assert.ok(comandos.includes('keep'))
  assert.ok(fetches >= 3)
})

test('Cognition chega com marca e fatos da campanha mesmo sem cadastro extra', async t => {
  const f = fixture(t)
  const id = (await f.servico.estado()).cadastro.identidade
  assert.equal(id.produto, 'Devin')
  assert.match(id.banner, /cognition\.com\/opengraph-image/)
  assert.match(id.logo, /cognition\.com\/apple-icon/)
  assert.ok(id.fatos.some(x => /Deployed Engineer/i.test(x.texto)))
  assert.equal(id.fundo, '#efebe3')
  assert.equal(id.clara, true)
})

test('marca remota vira data URL local para o renderer não depender do CSP', async t => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(40, 1)])
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)])
  const f = fixture(t, {
    fetchIdentidade: async url => {
      if (String(url).includes('opengraph-image')) return { ok: true, arrayBuffer: async () => jpeg }
      if (String(url).includes('apple-icon')) return { ok: true, arrayBuffer: async () => png }
      return { ok: false, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
    },
  })
  const id = (await f.servico.estado()).cadastro.identidade
  assert.match(id.banner, /^data:image\/jpeg;base64,/)
  assert.match(id.logo, /^data:image\/png;base64,/)
  assert.ok(fs.existsSync(path.join(f.base, 'marca-banner.local')))
  assert.ok(fs.existsSync(path.join(f.base, 'marca-logo.local')))
  const cadastroDisco = fs.existsSync(path.join(f.base, 'campanha.json.local')) ? fs.readFileSync(path.join(f.base, 'campanha.json.local'), 'utf8') : ''
  assert.doesNotMatch(cadastroDisco, /data:image/)
})

test('campanha nasce só com o nome e aceita domínio colado sem https', async t => {
  const { normalizarSite } = require('../electron/automacoes/campanhas.cjs')
  assert.equal(normalizarSite('acme.test'), 'https://acme.test')
  assert.equal(normalizarSite('http://acme.test/time'), 'https://acme.test/time')
  assert.equal(normalizarSite('  https://acme.test  '), 'https://acme.test')
  const f = fixture(t)
  const soNome = await f.servico.criarCampanha({ nome: 'Redibot' })
  assert.equal(soNome.site, '')
  assert.match(soNome.objetivo, /oportunidades compatíveis/)
  assert.match(fs.readFileSync(path.join(f.dir, 'Portfolio/empresas/redibot/findings.md'), 'utf8'), /não informado/)
  const comDominio = await f.servico.criarCampanha({ nome: 'Acme Labs', site: 'acme.test', objetivo: 'Conversar com o time.' })
  assert.equal(new URL(comDominio.site).hostname, 'acme.test')
  await assert.rejects(f.servico.criarCampanha({ nome: 'Ruim', site: 'ftp://x.example' }), { codigo: 'URL_INVALIDA' })
})

test('nova empresa guarda og:image do site e sobrevive se a coleta falhar', async t => {
  const { coletarIdentidade, fundirIdentidade } = require('../electron/automacoes/identidade.cjs')
  const html = '<meta property="og:image" content="/opengraph-image.jpg"><meta name="theme-color" content="#0a1628"><meta property="og:description" content="Foguete e naves."><link rel="icon" type="image/svg+xml" href="/icon.svg">'
  const coletada = await coletarIdentidade('https://spacex.com', async () => ({ ok: true, text: async () => html }))
  assert.equal(coletada.banner, 'https://spacex.com/opengraph-image.jpg')
  assert.equal(coletada.logo, 'https://spacex.com/icon.svg')
  assert.equal(coletada.fundo, '#0a1628')
  assert.match(coletada.resumo, /Foguete/)
  const f = fixture(t, { fetchIdentidade: async () => ({ ok: true, text: async () => html }) })
  const c = await f.servico.criarCampanha({ nome: 'SpaceX', site: 'https://spacex.com', objetivo: 'Abrir conversa com o time de software.' })
  assert.equal(c.identidade.banner, 'https://spacex.com/opengraph-image.jpg')
  assert.equal(c.identidade.produto, '')
  assert.match(c.identidade.resumo, /Foguete/)
  const semRede = fundirIdentidade({ id: 'acme', nome: 'Acme', site: 'https://acme.test', objetivo: 'Mapear o time.' })
  assert.equal(semRede.logo, 'https://acme.test/favicon.ico')
  assert.equal(semRede.banner, '')
  assert.equal(semRede.resumo, 'Mapear o time.')
})

test('protocolo da bancada DailyWork é estável por frente e entra na ponte de campanhas', () => {
  const { protocolo, NOMES } = require('../electron/bancada-protocolo.cjs')
  const { instrucaoDaPonte } = require('../electron/automacoes/rodar.cjs')
  const nativo = protocolo({ frente: 'candidaturas', via: 'nativo' })
  const codex = protocolo({ frente: 'candidaturas', via: 'codex' })
  assert.equal(NOMES.candidaturas, 'dailywork-candidaturas')
  assert.match(nativo, /dailywork-candidaturas/)
  assert.match(nativo, /não execute stop/i)
  assert.doesNotMatch(nativo, /agent-bench-mcp/)
  assert.match(codex, /dailywork-bancada/)
  assert.match(codex, /bench_cdp/)
  const ponte = instrucaoDaPonte({ nome: 'dailywork-campanhas', workspace: 9 }, '/tmp/navegador.cjs')
  assert.match(ponte, /dailywork-campanhas/)
  assert.match(ponte, /dailywork-bancada/)
  assert.match(require('../electron/automacoes/modelo-campanha.cjs').textosCampanha({ nome: 'Acme' }).ciclo, /dailywork-campanhas/)
})

test('script preparar da skill DailyWork descreve ensure keep e cdp sem stop', (t) => {
  const { spawnSync } = require('node:child_process')
  const script = path.join(os.homedir(), '.agents/skills/dailywork-bancada/scripts/preparar')
  if (!fs.existsSync(script)) {
    t.skip('skill dailywork-bancada ausente neste ambiente')
    return
  }
  const r = spawnSync(script, ['--dry-run', 'candidaturas'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const plano = JSON.parse(r.stdout)
  assert.equal(plano.bench, 'dailywork-candidaturas')
  assert.deepEqual(plano.commands, ['ensure', 'keep', 'cdp'])
  assert.ok(plano.never.includes('stop padrao'))
})
