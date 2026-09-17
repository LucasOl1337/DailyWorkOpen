const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { erro, hash, comTrava, criarArquivos, lerJson, gravarJson, listarJson } = require('./automacoes/arquivos.cjs')
const { criarBiblioteca } = require('./automacoes/biblioteca.cjs')
const { criarMateriais } = require('./automacoes/materiais.cjs')
const { criarExecucoes } = require('./automacoes/execucoes.cjs')
const { criarCampanha } = require('./automacoes/campanha.cjs')
const { diaLocal } = require('./sumario/shared.cjs')
const { criarCatalogoCampanhas, criarPesquisa, dominiosDasCampanhas } = require('./automacoes/campanhas.cjs')
const { criarNavegador, DOMINIOS } = require('./automacoes/navegador.cjs')
const { listarExecutores } = require('./automacoes/executores.cjs')

function classificarUrl(valor) {
  let u
  try { u = new URL(valor) } catch {}
  if (!u || u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw erro('URL_INVALIDA', 'Use um link HTTPS de perfil LinkedIn, perfil/post X ou vaga Ashby.')
  const partes = u.pathname.split('/').filter(Boolean)
  let dados
  if (['linkedin.com', 'www.linkedin.com'].includes(u.hostname) && partes[0] === 'in' && partes.length === 2) dados = { canal: 'linkedin', tipo: 'perfil', alvo: partes[1] }
  if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(u.hostname) && /^[A-Za-z0-9_]{1,15}$/.test(partes[0] || '') && !['home', 'search', 'explore', 'i', 'settings', 'messages', 'notifications'].includes(partes[0])) {
    if (partes.length === 1) dados = { canal: 'x', tipo: 'perfil', alvo: partes[0] }
    if (partes.length === 3 && partes[1] === 'status' && /^\d+$/.test(partes[2])) dados = { canal: 'x', tipo: 'post', alvo: partes[0] }
  }
  if (u.hostname === 'jobs.ashbyhq.com' && partes.length === 2) dados = { canal: 'ashby', tipo: 'vaga', alvo: partes.join('/') }
  if (!dados) throw erro('URL_INVALIDA', 'Esse link não é um perfil, post ou vaga suportado.')
  u.search = ''; u.hash = ''; u.pathname = '/' + partes.join('/')
  if (dados.canal === 'x') u.hostname = 'x.com'
  return { ...dados, url: u.href, post: dados.tipo === 'post' ? u.href : '' }
}

function criarServicoDaCampanha({ lucasOlDir, dataDir, campanhaId, completar, extrairPdf, executarComando, fetchImpl, navegador, catalogo }) {
  const arquivos = criarArquivos({ lucasOlDir, dataDir, campanhaId })
  const { base, runs, lerEstado, auditar } = arquivos
  const biblioteca = criarBiblioteca(arquivos, { extrairPdf })
  const materiais = criarMateriais(arquivos, biblioteca, completar)
  const campanha = criarCampanha(arquivos, biblioteca)
  const execucoes = criarExecucoes(arquivos, { executarComando, fetchImpl, navegador, obterCadastro: () => catalogo.obter(campanhaId) })
  const pesquisa = criarPesquisa(arquivos)
  const evidDir = path.join(runs, 'evidencias')
  const filaDir = path.join(runs, 'fila')
  let servico
  function filaManual(est = lerEstado()) {
    return [...(est.fila_manual || []).map((item, i) => ({ ...item, id: item.id || `legado-${i}` })), ...listarJson(filaDir)]
  }
  function evidencias() {
    if (!fs.existsSync(evidDir)) return []
    return fs.readdirSync(evidDir).filter(n => /\.(png|jpe?g|webp)$/i.test(n)).flatMap(arquivo => {
      try {
        const st = fs.lstatSync(path.join(evidDir, arquivo))
        return st.isFile() && !st.isSymbolicLink() ? [{ arquivo, mtime: st.mtime.toISOString(), bytes: st.size }] : []
      } catch (e) { if (e.code === 'ENOENT') return []; throw e }
    }).sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, 12)
  }
  // Última ação do navegador registrada pelo executor; só vale enquanto for recente.
  function atividadeRecente() {
    try {
      const a = JSON.parse(fs.readFileSync(path.join(arquivos.runs, 'atividade.local.json'), 'utf8'))
      return Date.now() - Date.parse(a.em) < 15 * 60000 ? a : null
    } catch { return null }
  }
  async function estado() {
    const est = lerEstado()
    const hoje = diaLocal()
    const toque = est.toques?.[hoje]
    const eventos = ['email', 'social', 'ashby', 'ashby2'].flatMap(tipo => {
      const d = toque?.[tipo]
      return d ? [{ tipo, status: d.status || 'PENDENTE', alvo: d.alvo || '', texto: d.texto || d.rascunho?.body || '', url: d.reply_url || d.post || d.profile_url || '', evidencia: d.evidencia || '', motivo: d.motivo || '' }] : []
    })
    const [timer, browser] = await Promise.all([execucoes.timer(), navegador.estado()])
    let diario = ''
    try { diario = fs.readFileSync(path.join(base, 'diario.md'), 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
    return {
      campanha: campanhaId, cadastro: await catalogo.materializar(campanhaId), navegador: browser, objetivo: est.objetivo || '', inicio: est.inicio || '', hoje,
      toqueHoje: toque ? { slot: toque.slot, eventos } : null,
      filaArgumentos: est.fila_argumentos || [], filaManual: filaManual(est),
      candidaturas: Object.entries(est.candidaturas || {}).map(([id, c]) => ({ id, ...c })),
      bloqueios: est.bloqueios || [], timer, chromeCDP: browser.conectado, cdpPort: browser.porta,
      diario: diario.split('\n').filter(l => l.startsWith('- ')).slice(-10).reverse(),
      atividade: atividadeRecente(),
      evidencias: evidencias(), execucoes: execucoes.listar(), materiais: materiais.listar(), interacoes: campanha.listarInteracoes(), pendenciasInteracoes: campanha.pendentes().length,
    }
  }
  function evidencia(nome) {
    if (typeof nome !== 'string' || nome !== path.basename(nome) || !/\.(png|jpe?g|webp)$/i.test(nome)) throw erro('ARQUIVO_INVALIDO', 'Selecione uma imagem de evidência da campanha.')
    const arquivo = path.join(evidDir, nome)
    if (!fs.existsSync(arquivo)) throw erro('NAO_ENCONTRADO', 'Evidência não encontrada.', 404)
    const st = fs.lstatSync(arquivo)
    if (!st.isFile() || st.isSymbolicLink() || st.size > 12 * 1024 * 1024) throw erro('ARQUIVO_INVALIDO', 'Evidência inválida ou maior que 12 MB.')
    const ext = path.extname(nome).slice(1).toLowerCase().replace('jpg', 'jpeg')
    return `data:image/${ext};base64,${fs.readFileSync(arquivo).toString('base64')}`
  }
  async function adicionarAlvo({ url, agora = false, forcarContato = false, identidadeX = '' } = {}) {
    if (typeof url !== 'string' || url.length > 2000 || typeof agora !== 'boolean' || typeof forcarContato !== 'boolean' || typeof identidadeX !== 'string' || identidadeX.length > 40) throw erro('ENTRADA_INVALIDA', 'Informe um link válido.')
    if (identidadeX && !/^@[A-Za-z0-9_]{1,15}$/.test(identidadeX)) throw erro('ENTRADA_INVALIDA', 'Informe a identidade X no formato @usuario.')
    const info = classificarUrl(url.trim())
    lerEstado()
    const resultado = await comTrava(path.join(runs, 'fila.lock'), () => {
      const fila = filaManual()
      const existente = fila.find(m => m.url === info.url && m.status === 'na_fila')
      if (existente) {
        const concluido = fila.find(m => m.id !== existente.id && m.url === info.url && m.status === 'feito' && m.evidencia)
        const interacao = campanha.listarInteracoes().find(i => i.alvo === info.url && i.status === 'confirmado' && i.evidencia)
        const comprovante = concluido || interacao
        if (comprovante && !/^legado-\d+$/.test(existente.id)) {
          const destino = path.join(filaDir, `${existente.id}.json.local`)
          const atual = lerJson(destino)
          if (atual) {
            const item = {
              ...atual,
              status: 'feito',
              evidencia: comprovante.evidencia,
              contextoId: comprovante.contextoId || null,
              reconciliadoEm: new Date().toISOString(),
              reconciliadoCom: comprovante.id,
            }
            gravarJson(destino, item, { backup: true })
            auditar('alvo-reconciliar', { alvoId: item.id, comprovanteId: comprovante.id, canal: item.canal, urlHash: hash(item.url) })
            return { adicionado: false, reconciliado: true, item }
          }
        }
        if (forcarContato && !/^legado-\d+$/.test(existente.id)) {
          const destino = path.join(filaDir, `${existente.id}.json.local`)
          const atual = lerJson(destino)
          if (atual) {
            const item = { ...atual, autorizacaoExplicita: true, ...(identidadeX ? { identidadeX } : {}), autorizadoEm: new Date().toISOString() }
            gravarJson(destino, item, { backup: true })
            auditar('alvo-autorizar', { alvoId: item.id, canal: item.canal, urlHash: hash(item.url) })
            return { adicionado: false, autorizado: true, item }
          }
        }
        return { adicionado: false, item: existente }
      }
      const item = { id: randomUUID(), ...info, adicionado_em: new Date().toISOString(), status: 'na_fila', ...(forcarContato ? { autorizacaoExplicita: true, autorizadoEm: new Date().toISOString() } : {}), ...(identidadeX ? { identidadeX } : {}) }
      gravarJson(path.join(filaDir, `${item.id}.json.local`), item)
      auditar('alvo-adicionar', { alvoId: item.id, canal: item.canal, urlHash: hash(item.url) })
      return { adicionado: true, item }
    })
    if (agora && !resultado.reconciliado) {
      try { return { ...resultado, disparo: await servico.executarAgora({ alvoId: resultado.item.id }) } }
      catch (e) { return { ...resultado, disparo: { iniciado: false, erro: e.message } } }
    }
    return resultado
  }
  async function conferirInteracao(entrada) {
    if (execucoes.listar().some(e => ['preparando', 'executando'].includes(e.status))) throw erro('EM_EXECUCAO', 'Aguarde o ciclo terminar antes de conferir manualmente o resultado.', 409)
    return campanha.concluir(entrada)
  }
  servico = { estado, evidencia, adicionarAlvo, conferirInteracao, executarAgora: execucoes.iniciar, cancelar: execucoes.cancelar, pesquisar: () => execucoes.iniciar({ tipo: 'pesquisa' }), abrirPerfil: navegador.preparar, pesquisa: pesquisa.obter, salvarPesquisa: pesquisa.salvar, biblioteca: biblioteca.listar, fonte: biblioteca.fonte, salvarSelecao: biblioteca.salvarSelecao, prepararContexto: biblioteca.preparar, obterContexto: biblioteca.obterContexto, gerarMaterial: materiais.gerar, obterMaterial: materiais.obter }
  return servico
}

function criarServicoAutomacoes(opcoes = {}) {
  const lucasOlDir = opcoes.lucasOlDir || process.env.LUCASOL_DIR || path.resolve(__dirname, '../../LucasOL')
  const dataDir = opcoes.dataDir || process.env.DAILYWORK_DATA_DIR || path.resolve(__dirname, '../data')
  const catalogo = criarCatalogoCampanhas({ lucasOlDir, dataDir, fetchIdentidade: opcoes.fetchIdentidade || (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined) })
  const navegador = opcoes.navegador || criarNavegador({ dominios: () => dominiosDasCampanhas(lucasOlDir, DOMINIOS) })
  const cache = new Map()
  function paraCampanha(id = 'cognition') {
    catalogo.obter(id)
    if (!cache.has(id)) cache.set(id, criarServicoDaCampanha({ ...opcoes, lucasOlDir, dataDir, campanhaId: id, navegador, catalogo }))
    return cache.get(id)
  }
  return { ...paraCampanha(), paraCampanha, catalogo: async () => {
    await Promise.all(catalogo.listar().map(c => catalogo.materializar(c.id)))
    return { campanhas: catalogo.listar(), executores: listarExecutores(), navegador: await navegador.estado() }
  }, criarCampanha: catalogo.criar, configurarCampanha: catalogo.configurar, importarSessao: navegador.importarSessao, mostrarNavegador: navegador.mostrar, abrirPagina: navegador.abrirPagina }
}
module.exports = { criarServicoAutomacoes, classificarUrl }
