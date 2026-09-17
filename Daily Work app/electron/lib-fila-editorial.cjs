// Fila editorial persistente. Cada item é um arquivo independente para que um
// registro corrompido não impeça os demais de aparecerem na fila.
const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')
const crypto = require('node:crypto')
const { hashConteudo } = require('./lib-editor-editorial.cjs')
const estilo = require('./lib-estilo-slop.cjs')

// Portão de publicação. Agentes (canal api) só publicam ou agendam quando a
// política está em modo automático E a peça passa em todos os portões: revisão
// editorial aprovada para o texto atual, catálogo de estilo sem sinal duro e
// imagem presente quando a história pede captura. A interface do app (canal
// desktop) continua sendo a decisão humana e não é bloqueada.
const MODOS_PUBLICACAO = ['supervisionado', 'automatico']

const CONTAS = new Set(['linkedin', 'x', 'github', 'reddit'])
const IDIOMAS = new Set(['pt-BR', 'en'])
const FORMATOS = new Set(['texto', 'imagem', 'video'])
const ESTADOS = new Set(['pendente', 'agendado', 'aguardando_executor', 'publicando', 'publicado', 'recusado', 'erro', 'incerto'])
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const MAX_ITEM_BYTES = 1 * 1024 * 1024
const MAX_TEXTO = 500_000
const LOCK_TIMEOUT_MS = 15_000
const LOCK_STALE_MS = 30 * 60_000

class ErroFila extends Error {
  constructor(codigo, mensagem, status = 400, detalhes = undefined) {
    super(mensagem)
    this.name = 'ErroFila'
    this.codigo = codigo
    this.status = status
    if (detalhes !== undefined) this.detalhes = detalhes
  }
}

function agoraIso(now) { return new Date(now()).toISOString() }
function idSeguro(id, campo = 'id') {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new ErroFila('ID_INVALIDO', `${campo} inválido.`, 400)
  return id
}
function dentro(arquivo, diretorio) {
  const rel = path.relative(path.resolve(diretorio), path.resolve(arquivo))
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}
function erroStatus(erro, padrao = 400) {
  return Number.isInteger(erro?.status) ? erro.status : padrao
}
function isNetworkError(erro) {
  const codigo = String(erro?.codigo || '').toUpperCase()
  const mensagem = String(erro?.message || erro || '').toLowerCase()
  return erro?.rede === true || erro?.network === true || erro?.status >= 500 ||
    /(?:ECONN|ENET|EAI_AGAIN|ETIMEDOUT|ENOTFOUND|ECONNRESET|NETWORK|TIMEOUT|FETCH|SOCKET|ABORT)/.test(codigo) ||
    /(?:network|offline|unreachable|temporarily unavailable|timed? ?out|fetch failed|socket|connection reset|connection refused|dns)/.test(mensagem)
}
function clone(valor) {
  return valor == null ? valor : JSON.parse(JSON.stringify(valor))
}

function criarFilaEditorial({ dataDir, registro, onUpdate, now = () => Date.now(), intervaloMs = 15_000 } = {}) {
  if (!dataDir) throw new Error('fila editorial sem dataDir')
  if (!registro || typeof registro.prepararPublicacao !== 'function' || typeof registro.confirmarPublicacao !== 'function') {
    throw new Error('fila editorial sem registro de publicação')
  }
  const base = path.join(path.resolve(dataDir), 'editorial')
  const itensDir = path.join(base, 'itens')
  const itensArquivoDir = path.join(base, '_arquivo', 'itens')
  const midiaDir = path.join(base, 'midias')
  const comprovantesDir = path.join(base, 'comprovantes')
  const locksDir = path.join(base, '.locks')
  const auditoria = path.join(base, '_auditoria.ndjson')
  const politicaArquivo = path.join(base, 'publicacao-politica.json')
  const processos = new Set()
  let timer = null
  let parado = false

  fs.mkdirSync(itensDir, { recursive: true })
  fs.mkdirSync(comprovantesDir, { recursive: true, mode: 0o700 })
  fs.mkdirSync(locksDir, { recursive: true })

  function politicaPublicacao() {
    try {
      const salvo = JSON.parse(fs.readFileSync(politicaArquivo, 'utf8'))
      if (MODOS_PUBLICACAO.includes(salvo?.modo)) return { modo: salvo.modo, atualizadoEm: salvo.atualizadoEm || null }
    } catch { /* sem política salva: supervisionado */ }
    return { modo: 'supervisionado', atualizadoEm: null }
  }
  function configurarPublicacao(entrada = {}) {
    const modo = String(entrada?.modo || '')
    if (!MODOS_PUBLICACAO.includes(modo)) throw new ErroFila('CAMPO_INVALIDO', `modo deve ser ${MODOS_PUBLICACAO.join(' ou ')}.`, 400)
    const politica = { modo, atualizadoEm: agoraIso(now) }
    fs.writeFileSync(politicaArquivo, JSON.stringify(politica, null, 2))
    auditar('politica-publicacao', { modo })
    return politica
  }
  function bloqueiosDePublicacao(item) {
    const bloqueios = []
    const qualidade = item.editorial?.qualidade
    if (!qualidade || qualidade.estado !== 'aprovada' || qualidade.aprovado !== true || qualidade.conteudoHash !== hashConteudo(item)) {
      bloqueios.push({ codigo: 'SEM_REVISAO_VALIDA', mensagem: 'A peça não tem revisão editorial aprovada para o texto atual.' })
    }
    const sinais = estilo.detectar(item.texto, { idioma: item.idioma, conta: item.conta })
    const avaliacao = estilo.resumo(sinais)
    if (avaliacao.gravidade !== 'ok') {
      bloqueios.push({ codigo: 'ESTILO_REPROVADO', mensagem: `Padrões de AI slop no texto: ${sinais.map((s) => `${s.padrao} (“${s.trecho}”)`).join('; ')}.`, sinais: sinais.map((s) => ({ padrao: s.padrao, nivel: s.nivel, trecho: s.trecho, correcao: s.correcao })) })
    }
    const tipoMidia = item.editorial?.pauta?.midia?.tipo
    if (tipoMidia && tipoMidia !== 'nenhuma' && !(item.midias || []).length) {
      bloqueios.push({ codigo: 'SEM_MIDIA', mensagem: 'A história pede uma captura e a peça está sem imagem.' })
    }
    return bloqueios
  }
  function prontidao(item) {
    const { modo } = politicaPublicacao()
    const bloqueios = item.estado === 'pendente' ? bloqueiosDePublicacao(item) : []
    return { pronta: item.estado === 'pendente' && !bloqueios.length, modo, bloqueios }
  }
  function comProntidao(item) {
    return item ? { ...clone(item), prontidao: prontidao(item) } : item
  }
  // Canal api = agente. Sem modo automático, nada publica ou agenda por agente;
  // com ele, só peças sem bloqueio. A recusa fica na auditoria para o treino.
  function exigirPortao(item, canal, acao) {
    if (canal !== 'api') return
    const { modo } = politicaPublicacao()
    if (modo !== 'automatico') {
      auditar('publicacao-bloqueada', { id: item.id, operacao: acao, canal, codigo: 'APROVACAO_HUMANA_PENDENTE' })
      throw new ErroFila('APROVACAO_HUMANA_PENDENTE', 'Publicação automática desligada: um humano precisa publicar ou agendar pela interface do DailyWork.', 403)
    }
    const bloqueios = bloqueiosDePublicacao(item)
    if (bloqueios.length) {
      auditar('publicacao-bloqueada', { id: item.id, operacao: acao, canal, codigo: 'PUBLICACAO_BLOQUEADA', bloqueios: bloqueios.map((b) => b.codigo) })
      const erro = new ErroFila('PUBLICACAO_BLOQUEADA', `A peça não passou no portão de publicação: ${bloqueios.map((b) => b.mensagem).join(' ')}`, 409)
      erro.bloqueios = bloqueios
      throw erro
    }
  }

  function arquivoItem(id) {
    idSeguro(id)
    const arquivo = path.join(itensDir, `${id}.json`)
    if (!dentro(arquivo, itensDir)) throw new ErroFila('ID_INVALIDO', 'identificador fora da fila.', 400)
    return arquivo
  }
  function arquivoLock(id) {
    const arquivo = path.join(locksDir, `${id}.lock`)
    if (!dentro(arquivo, locksDir)) throw new ErroFila('ID_INVALIDO', 'identificador fora da fila.', 400)
    return arquivo
  }
  function auditar(acao, dados = {}) {
    try {
      fs.mkdirSync(base, { recursive: true })
      fs.appendFileSync(auditoria, JSON.stringify({ ts: agoraIso(now), acao, ...dados }) + '\n', 'utf8')
    } catch { /* auditoria não derruba a fila */ }
  }
  function notificar(item) {
    try { onUpdate?.(clone(item)) } catch { /* listeners são acessórios */ }
  }
  function registrarFeedback(tipo, item, dados = {}) {
    fs.appendFileSync(path.join(base, 'feedback.ndjson'), JSON.stringify({ ts: agoraIso(now), tipo, itemId: item.id, pautaId: item.pautaId, conta: item.conta, idioma: item.idioma, tese: item.editorial?.pauta?.tese || item.titulo, ...dados }) + '\n', { mode: 0o600 })
  }

  function lerArquivo(id) {
    const arquivo = arquivoItem(id)
    try {
      const stat = fs.statSync(arquivo)
      if (stat.size > MAX_ITEM_BYTES) throw new ErroFila('ITEM_MUITO_GRANDE', `item excede ${MAX_ITEM_BYTES} bytes.`, 413)
      const item = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
      if (!item || item.id !== id || !ID_RE.test(item.id)) throw new Error('id do item não confere')
      return item
    } catch (erro) {
      if (erro?.codigo === 'ITEM_MUITO_GRANDE') throw erro
      if (erro?.code === 'ENOENT') return null
      auditar('item-corrompido', { id, erro: String(erro?.message || erro) })
      return null
    }
  }
  function listarArquivos() {
    let nomes = []
    try { nomes = fs.readdirSync(itensDir) } catch { return [] }
    return nomes.filter((nome) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/.test(nome)).map((nome) => nome.slice(0, -5))
  }
  function lerTodos() {
    return listarArquivos().map(lerArquivo).filter(Boolean)
  }
  async function persistir(item) {
    const destino = arquivoItem(item.id)
    const texto = JSON.stringify(item, null, 2) + '\n'
    if (Buffer.byteLength(texto) > MAX_ITEM_BYTES) throw new ErroFila('ITEM_MUITO_GRANDE', `item excede ${MAX_ITEM_BYTES} bytes.`, 413)
    await fsp.mkdir(itensDir, { recursive: true })
    const temporario = path.join(itensDir, `.${item.id}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`)
    try {
      await fsp.writeFile(temporario, texto, { encoding: 'utf8', mode: 0o600 })
      await fsp.rename(temporario, destino)
    } finally {
      await fsp.rm(temporario, { force: true }).catch(() => {})
    }
  }
  function persistirSincrono(item) {
    const destino = arquivoItem(item.id)
    const texto = JSON.stringify(item, null, 2) + '\n'
    if (Buffer.byteLength(texto) > MAX_ITEM_BYTES) throw new ErroFila('ITEM_MUITO_GRANDE', `item excede ${MAX_ITEM_BYTES} bytes.`, 413)
    const temporario = path.join(itensDir, `.${item.id}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`)
    try { fs.writeFileSync(temporario, texto, { encoding: 'utf8', mode: 0o600 }); fs.renameSync(temporario, destino) } finally {
      try { fs.rmSync(temporario, { force: true }) } catch { /* já renomeado */ }
    }
  }
  function lockDonoAtivo(arquivo) {
    let registro
    try { registro = JSON.parse(fs.readFileSync(arquivo, 'utf8')) } catch { return false }
    const pid = Number(registro?.pid)
    if (!Number.isInteger(pid) || pid <= 0) return false
    try { process.kill(pid, 0); return true } catch (erro) {
      return erro?.code === 'EPERM'
    }
  }
  async function comLock(id, fn) {
    const arquivo = arquivoLock(id)
    const inicio = Date.now()
    let handle
    while (!handle) {
      try {
        handle = await fsp.open(arquivo, 'wx', 0o600)
        await handle.writeFile(JSON.stringify({ pid: process.pid, criadoEm: agoraIso(now) }))
      } catch (erro) {
        if (erro?.code !== 'EEXIST') throw erro
        try {
          const stat = await fsp.stat(arquivo)
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) await fsp.rm(arquivo, { force: true })
        } catch { /* corrida de lock */ }
        if (Date.now() - inicio > LOCK_TIMEOUT_MS) throw new ErroFila('ITEM_EM_USO', 'item está sendo alterado por outro processo.', 409)
        await new Promise((resolve) => setTimeout(resolve, 35))
      }
    }
    try { return await fn() } finally {
      await handle.close().catch(() => {})
      await fsp.rm(arquivo, { force: true }).catch(() => {})
    }
  }
  function exigirRevisao(item, revisao) {
    if (!Number.isInteger(revisao) || revisao !== item.revisao) {
      throw new ErroFila('REVISAO_OBSOLETA', 'o item mudou; recarregue a fila antes de tentar de novo.', 409, { revisaoAtual: item.revisao })
    }
  }
  function normalizarEntrada(entrada, existente = null) {
    const fonte = entrada && typeof entrada === 'object' ? entrada : {}
    const item = existente ? { ...existente } : {}
    const conta = fonte.conta ?? item.conta
    const idioma = fonte.idioma ?? item.idioma
    const formato = fonte.formato ?? item.formato ?? 'texto'
    if (!CONTAS.has(conta)) throw new ErroFila('CAMPO_INVALIDO', 'conta inválida.', 400)
    if (!IDIOMAS.has(idioma)) throw new ErroFila('CAMPO_INVALIDO', 'idioma inválido.', 400)
    if (!FORMATOS.has(formato)) throw new ErroFila('CAMPO_INVALIDO', 'formato inválido.', 400)
    const texto = String(fonte.texto ?? item.texto ?? '')
    const titulo = String(fonte.titulo ?? item.titulo ?? '').trim()
    if (!titulo) throw new ErroFila('CAMPO_OBRIGATORIO', 'título é obrigatório.', 400)
    if (!texto.trim()) throw new ErroFila('CAMPO_OBRIGATORIO', 'texto é obrigatório.', 400)
    if ([...titulo].length > 500) throw new ErroFila('CAMPO_LONGO', 'título excede 500 caracteres.', 400)
    if ([...texto].length > MAX_TEXTO) throw new ErroFila('CAMPO_LONGO', `texto excede ${MAX_TEXTO} caracteres.`, 413)
    const campos = fonte.campos ?? item.campos ?? {}
    const fontes = fonte.fontes ?? item.fontes ?? []
    const midias = fonte.midias ?? item.midias ?? []
    if (!campos || typeof campos !== 'object' || Array.isArray(campos)) throw new ErroFila('CAMPO_INVALIDO', 'campos deve ser um objeto.', 400)
    if (!Array.isArray(fontes) || fontes.length > 100) throw new ErroFila('CAMPO_INVALIDO', 'fontes deve ser uma lista.', 400)
    if (!Array.isArray(midias) || midias.length > 20) throw new ErroFila('CAMPO_INVALIDO', 'midias deve ser uma lista.', 400)
    for (const fonteRef of fontes) {
      if (!fonteRef || typeof fonteRef !== 'object' || typeof fonteRef.rotulo !== 'string') throw new ErroFila('CAMPO_INVALIDO', 'fonte inválida.', 400)
      if (fonteRef.url != null && !/^https?:\/\//i.test(String(fonteRef.url))) throw new ErroFila('CAMPO_INVALIDO', 'URL de fonte inválida.', 400)
    }
    for (const midia of midias) {
      if (!midia || typeof midia !== 'object' || !ID_RE.test(String(midia.id || '')) || typeof midia.arquivo !== 'string') {
        throw new ErroFila('CAMPO_INVALIDO', 'mídia inválida.', 400)
      }
      const caminho = path.resolve(base, midia.arquivo)
      if (!dentro(caminho, midiaDir)) throw new ErroFila('MIDIA_FORA_DA_AREA', 'mídia fora da área de previews.', 400)
      if (midia.tipo != null && !['imagem', 'video'].includes(midia.tipo)) throw new ErroFila('CAMPO_INVALIDO', 'tipo de mídia inválido.', 400)
    }
    const pautaId = String(fonte.pautaId ?? item.pautaId ?? '').trim()
    if (!pautaId || pautaId.length > 200 || /[\r\n]/.test(pautaId)) throw new ErroFila('CAMPO_OBRIGATORIO', 'pautaId é obrigatório.', 400)
    const origem = fonte.origem ?? item.origem ?? { tipo: 'dia' }
    if (!origem || typeof origem !== 'object' || !['dia', 'acervo', 'pedido', 'manual'].includes(origem.tipo)) throw new ErroFila('CAMPO_INVALIDO', 'origem inválida.', 400)
    const novo = { ...item, pautaId, conta, idioma, formato, titulo, texto, campos: clone(campos), midias: clone(midias), fontes: clone(fontes), origem: clone(origem) }
    if(fonte.agenda)novo.agenda={id:String(fonte.agenda.id),arquivo:String(fonte.agenda.arquivo)}
    const editorial = fonte.editorial ?? item.editorial
    if (editorial != null) {
      if (typeof editorial !== 'object' || Array.isArray(editorial) || Buffer.byteLength(JSON.stringify(editorial)) > 100_000) throw new ErroFila('CAMPO_INVALIDO', 'avaliação editorial inválida.', 400)
      novo.editorial = clone(editorial)
      if (novo.editorial.qualidade?.estado === 'aprovada' && novo.editorial.qualidade.conteudoHash !== hashConteudo(novo)) {
        novo.editorial.qualidade.estado = 'alterada'
        novo.editorial.qualidade.aprovado = false
      }
    }
    return novo
  }
  function prepararEntrada(item) {
    return {
      ...(item.campos || {}),
      // O texto editorial é a fonte de verdade também para esquemas que
      // chamam o campo de `corpo` (GitHub) ou `texto` (X/LinkedIn/Reddit).
      titulo: item.titulo,
      texto: item.texto,
      corpo: item.texto,
      formato: item.formato,
      midias: clone(item.midias || []),
      fontes: clone(item.fontes || []),
    }
  }
  function atualizarEstado(item, patch) {
    return { ...item, ...patch, atualizadoEm: agoraIso(now) }
  }
  function erroPublicacao(item, erro, tipo) {
    return atualizarEstado(item, {
      estado: tipo === 'rede' ? 'incerto' : 'erro',
      erro: { tipo, codigo: String(erro?.codigo || 'ERRO_PUBLICACAO'), mensagem: String(erro?.message || erro) },
      revisao: item.revisao + 1,
    })
  }
  async function publicarBloqueado(id, revisao, origem = 'manual', perfilAprovado = null, canal = 'desktop') {
    let item = lerArquivo(id)
    if (!item) throw new ErroFila('NAO_ENCONTRADO', `item não encontrado: ${id}`, 404)
    exigirRevisao(item, revisao)
    if (!['pendente', 'agendado'].includes(item.estado)) throw new ErroFila('ESTADO_INVALIDO', `item não pode ser publicado no estado ${item.estado}.`, 409)
    if (origem === 'manual') exigirPortao(item, canal, 'publicar')
    if (origem === 'agenda' && item.aprovacao?.canal === 'api') {
      // Agenda feita por agente: o portão vale de novo na hora do disparo. Se
      // a política ou a peça mudaram, a agenda cai e a peça volta a pendente.
      try { exigirPortao(item, 'api', 'agenda') } catch (erro) {
        item = atualizarEstado(item, { estado: 'pendente', erro: { codigo: erro.codigo, mensagem: erro.message }, revisao: item.revisao + 1 })
        delete item.agendadoPara; delete item.aprovacao
        await persistir(item); notificar(item)
        throw erro
      }
    }
    const transporte = transporteAtual(item.conta)
    if (origem === 'agenda') {
      if (JSON.stringify(item.aprovacao?.transporte || { tipo: 'api' }) !== JSON.stringify(transporte)) {
        item = atualizarEstado(item, { estado: 'erro', erro: { codigo: 'CONTA_DIVERGENTE', mensagem: 'O destino mudou depois do agendamento; revise a peça novamente.' }, revisao: item.revisao + 1 })
        await persistir(item); notificar(item)
        throw new ErroFila('CONTA_DIVERGENTE', item.erro.mensagem, 409)
      }
    } else if (transporte.tipo === 'sessao_visual' && perfilAprovado !== transporte.perfilUrl) {
      throw new ErroFila('CONTA_DIVERGENTE', 'A conta de envio mudou; reabra a revisão antes de confirmar.', 409)
    }
    // O formato e as mídias são validados pelo conector durante a preparação
    // (e a mídia novamente na confirmação, pelo hash aprovado). A fila não
    // pode transformar uma capacidade específica de LinkedIn/X em uma
    // proibição global.
    const expiraEnvioEm = origem === 'agenda' ? Date.parse(item.agendadoPara) + 15 * 60_000 : now() + 10 * 60_000
    item = atualizarEstado(item, { estado: 'publicando', agendadoPara: undefined, erro: undefined, publicacao: { pid: process.pid, iniciadoEm: agoraIso(now), chave: crypto.randomUUID() }, revisao: item.revisao + 1 })
    delete item.agendadoPara
    delete item.erro
    await persistir(item)
    notificar(item)
    auditar('publicar-inicio', { id, revisao: item.revisao, origem })
    try {
      const entrada = prepararEntrada(item)
      entrada.origemAgenda = require('./agenda/consumo.cjs').vinculo() || null
      entrada.origemEditorial = { itemId: item.id, revisao: item.revisao, chave: item.publicacao.chave }
      entrada.expiraEnvioEm = expiraEnvioEm
      // A agenda fixa o hash visto na aprovação; repetir a checagem aqui
      // impede que um arquivo trocado entre aprovação e envio seja publicado.
      entrada.midias = await fixarMidiasParaAprovacao(item.midias || [])
      require('./agenda/consumo.cjs').antes()
      const proposta = await registro.prepararPublicacao(item.conta, entrada)
      require('./agenda/consumo.cjs').antes()
      const recibo = await registro.confirmarPublicacao({ proposalId: proposta.proposalId })
      if (recibo.transporte === 'sessao_visual') {
        item = atualizarEstado(item, { estado: 'aguardando_executor', publicacao: { ...item.publicacao, jobId: recibo.jobId, transporte: 'sessao_visual' } })
        await persistir(item); notificar(item)
        auditar('publicar-enfileirado', { id, jobId: recibo.jobId, revisao: item.revisao })
        return clone(item)
      }
      item = atualizarEstado(item, { estado: 'publicado', recibo: clone(recibo), erro: undefined, revisao: item.revisao + 1 })
      delete item.erro
      delete item.publicacao
      await persistir(item)
      notificar(item)
      auditar('publicar-sucesso', { id, recibo: clone(recibo) })
      return clone(item)
    } catch (erro) {
      const tipo = isNetworkError(erro) ? 'rede' : 'validacao'
      item = erroPublicacao(item, erro, tipo)
      delete item.publicacao
      await persistir(item)
      notificar(item)
      auditar('publicar-falha', { id, tipo, codigo: erro?.codigo || null })
      throw Object.assign(erro instanceof Error ? erro : new Error(String(erro)), { codigo: erro?.codigo || 'PUBLICACAO_FALHOU', status: erroStatus(erro, tipo === 'rede' ? 502 : 400) })
    }
  }

  function recuperarPublicando() {
    for (const item of lerTodos()) {
      if (item.estado !== 'publicando') continue
      const job = item.publicacao?.chave && registro.sessoes?.porOrigem(item.publicacao.chave)
      if (job) {
        // Confirmação persistiu o job, mas o processo caiu antes de anexá-lo.
        persistirSincrono(atualizarEstado(item, { estado: 'aguardando_executor', publicacao: { ...item.publicacao, jobId: job.id, transporte: 'sessao_visual' } }))
        continue
      }
      // A fila pode estar sendo servida por outro processo (Electron + Vite).
      // Um lock vivo prova que a publicação ainda está em andamento; aguarde
      // o dono liberar o item para não transformar uma ação legítima em incerta.
      const lock = arquivoLock(item.id)
      let handle = null
      try {
        if (fs.existsSync(lock)) {
          if (lockDonoAtivo(lock)) continue
          fs.rmSync(lock, { force: true })
        }
        try {
          handle = fs.openSync(lock, 'wx', 0o600)
          fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, token: crypto.randomUUID(), criadoEm: agoraIso(now) }))
        } catch (erro) {
          if (erro?.code === 'EEXIST') continue
          throw erro
        }
        // Releia depois de tomar o lock: outro processo pode ter concluído
        // entre a listagem inicial e esta recuperação.
        const atual = lerArquivo(item.id)
        if (!atual || atual.estado !== 'publicando') continue
        const recuperado = atualizarEstado(atual, {
          estado: 'incerto',
          erro: { tipo: 'reinicio', codigo: 'REINICIO_DURANTE_PUBLICACAO', mensagem: 'O processo terminou durante a publicação; confirme no destino antes de qualquer ação.' },
          revisao: Number(atual.revisao || 0) + 1,
        })
        persistirSincrono(recuperado); auditar('reinicio-incerto', { id: item.id })
      } catch { /* será detectado na próxima leitura */
      } finally {
        if (handle != null) { try { fs.closeSync(handle) } catch {} }
        if (handle != null) { try { fs.rmSync(lock, { force: true }) } catch {} }
      }
    }
  }
  recuperarPublicando()

  async function listar(filtros = {}) {
    await reconciliarVisuais()
    const itens = lerTodos().filter((item) => {
      if (filtros.estado && item.estado !== filtros.estado) return false
      if (filtros.conta && item.conta !== filtros.conta) return false
      if (filtros.idioma && item.idioma !== filtros.idioma) return false
      if (filtros.pautaId && item.pautaId !== filtros.pautaId) return false
      return true
    })
    return itens.sort((a, b) => {
      const criado = String(b.criadoEm || b.atualizadoEm || '').localeCompare(String(a.criadoEm || a.atualizadoEm || ''))
      if (criado) return criado
      return String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || ''))
    }).map(comProntidao)
  }
  async function obter(id) { await reconciliarVisuais(); const item = lerArquivo(id); return comProntidao(item) }
  async function verificar(id) { idSeguro(id); const item = lerArquivo(id); if (!item) throw new ErroFila('NAO_ENCONTRADO', `item não encontrado: ${id}`, 404); return { id, ...prontidao(item) } }
  async function reconciliarVisuais() {
    if (!registro.sessoes) return
    for (const item of lerTodos().filter(i => i.publicacao?.jobId && ['aguardando_executor','publicando'].includes(i.estado))) {
      await comLock(item.id, async () => {
        const atual = lerArquivo(item.id)
        if (!atual?.publicacao?.jobId) return
        const job = registro.sessoes.obterJob(atual.publicacao.jobId)
        if (!job) return
        const terminal = ['publicado','incerto','falhou','cancelado','expirado'].includes(job.estado)
        const estado = job.estado === 'publicado' ? 'publicado' : job.estado === 'incerto' ? 'incerto' : terminal ? 'erro' : 'aguardando_executor'
        if (atual.estado === estado && atual.publicacao.estado === job.estado) return
        const novo = atualizarEstado(atual, { estado, publicacao: { ...atual.publicacao, estado: job.estado }, ...(job.erro ? { erro: { mensagem: job.erro } } : {}) })
        if (terminal) { novo.revisao++; delete novo.publicacao; if (job.recibo) novo.recibo = job.recibo }
        await persistir(novo); notificar(novo)
      })
    }
  }
  async function criar(entrada) {
    const candidato = normalizarEntrada(entrada)
    const id = entrada?.id == null ? `ed-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}` : idSeguro(entrada.id)
    return comLock(id, async () => {
      if (lerArquivo(id)) throw new ErroFila('JA_EXISTE', `item já existe: ${id}`, 409)
      const momento = agoraIso(now)
      const item = { ...candidato, id, estado: 'pendente', revisao: 1, criadoEm: momento, atualizadoEm: momento }
      await persistir(item); auditar('criar', { id }); notificar(item); return clone(item)
    })
  }
  async function atualizar(id, entrada = {}) {
    idSeguro(id)
    return comLock(id, async () => {
      const atual = lerArquivo(id)
      if (!atual) throw new ErroFila('NAO_ENCONTRADO', `item não encontrado: ${id}`, 404)
      exigirRevisao(atual, entrada.revisao)
      if (['aguardando_executor','publicando','publicado'].includes(atual.estado)) throw new ErroFila('ESTADO_INVALIDO', 'Cancele o envio pendente antes de editar; itens publicados são imutáveis.', 409)
      const novo = normalizarEntrada(entrada, atual)
      const mudouConteudo = ['pautaId', 'conta', 'idioma', 'formato', 'titulo', 'texto', 'campos', 'midias', 'fontes', 'origem'].some((chave) => JSON.stringify(novo[chave]) !== JSON.stringify(atual[chave]))
      const item = atualizarEstado({ ...atual, ...novo }, { revisao: atual.revisao + 1 })
      if (mudouConteudo && atual.estado === 'agendado') { item.estado = 'pendente'; delete item.agendadoPara; delete item.aprovacao }
      await persistir(item)
      if (atual.texto !== item.texto) registrarFeedback('edicao', item, { antes: atual.texto.slice(0, 4000), depois: item.texto.slice(0, 4000), motivo: String(entrada.motivo || '').trim().slice(0, 1000) })
      auditar('atualizar', { id, revisao: item.revisao, revogouAgenda: mudouConteudo && atual.estado === 'agendado' }); notificar(item); return clone(item)
    })
  }
  async function excluirMuitos(entrada = {}) {
    const pedidos = Array.isArray(entrada?.itens) ? entrada.itens : []
    if (pedidos.length === 0) throw new ErroFila('CAMPO_OBRIGATORIO', 'informe ao menos um item para excluir.', 400)
    if (pedidos.length > 500) throw new ErroFila('LIMITE_EXCEDIDO', 'a exclusão em massa aceita até 500 itens por vez.', 400)
    const vistos = new Set()
    const normalizados = pedidos.map((pedido) => {
      const id = idSeguro(pedido?.id)
      if (vistos.has(id)) throw new ErroFila('ITEM_DUPLICADO', `item repetido na exclusão: ${id}`, 400)
      vistos.add(id)
      if (!Number.isInteger(pedido?.revisao)) throw new ErroFila('CAMPO_INVALIDO', `revisão inválida para ${id}.`, 400)
      return { id, revisao: pedido.revisao }
    })
    const excluidos = []
    const falhas = []
    await fsp.mkdir(itensArquivoDir, { recursive: true })
    for (const pedido of normalizados) {
      try {
        await comLock(pedido.id, async () => {
          const atual = lerArquivo(pedido.id)
          if (!atual) throw new ErroFila('NAO_ENCONTRADO', `item não encontrado: ${pedido.id}`, 404)
          exigirRevisao(atual, pedido.revisao)
          if (['aguardando_executor', 'publicando'].includes(atual.estado)) {
            throw new ErroFila('ESTADO_INVALIDO', `cancele o envio de ${pedido.id} antes de excluir.`, 409)
          }
          const sufixo = `${now()}-${crypto.randomBytes(4).toString('hex')}`
          const destino = path.join(itensArquivoDir, `${sufixo}-${pedido.id}.json`)
          if (!dentro(destino, itensArquivoDir)) throw new ErroFila('ID_INVALIDO', 'destino de arquivo inválido.', 400)
          await fsp.rename(arquivoItem(pedido.id), destino)
          excluidos.push(pedido.id)
        })
      } catch (erro) {
        falhas.push({ id: pedido.id, codigo: erro?.codigo || 'ERRO_INTERNO', mensagem: String(erro?.message || erro) })
      }
    }
    auditar('excluir-em-massa', { quantidade: excluidos.length, ids: excluidos, falhas })
    return { excluidos, falhas }
  }
  async function agendar(id, entrada = {}) {
    idSeguro(id)
    const quando = Date.parse(String(entrada.agendadoPara || ''))
    if (!Number.isFinite(quando)) throw new ErroFila('DATA_INVALIDA', 'agendadoPara deve ser uma data ISO válida.', 400)
    if (quando <= now()) throw new ErroFila('DATA_INVALIDA', 'agendadoPara precisa estar no futuro.', 400)
    return comLock(id, async () => {
      const atual = lerArquivo(id); if (!atual) throw new ErroFila('NAO_ENCONTRADO', `item não encontrado: ${id}`, 404)
      exigirRevisao(atual, entrada.revisao)
      if (atual.estado !== 'pendente') throw new ErroFila('ESTADO_INVALIDO', `item não pode ser agendado no estado ${atual.estado}.`, 409)
      const canal = entrada.canal === 'api' ? 'api' : 'desktop'
      exigirPortao(atual, canal, 'agendar')
      const transporte = transporteAtual(atual.conta)
      if (transporte.tipo === 'sessao_visual' && transporte.perfilUrl !== entrada.perfilUrl) throw new ErroFila('CONTA_DIVERGENTE', 'A conta mudou; reabra a revisão antes de agendar.', 409)
      if (transporte.tipo === 'sessao_visual' && (atual.midias?.length || atual.formato !== 'texto')) throw new ErroFila('MIDIA_NAO_SUPORTADA', 'O executor visual aceita apenas texto nesta versão.', 409)
      const midiasAprovadas = await fixarMidiasParaAprovacao(atual.midias || [])
      const item = atualizarEstado(atual, { estado: 'agendado', midias: midiasAprovadas, agendadoPara: new Date(quando).toISOString(), aprovacao: { revisao: atual.revisao + 1, aprovadoEm: agoraIso(now), midias: midiasAprovadas.map((midia) => ({ id: midia.id, sha256: midia.sha256, tamanho: midia.tamanho })) }, revisao: atual.revisao + 1 })
      item.aprovacao.transporte = transporte
      item.aprovacao.canal = canal
      await persistir(item); auditar('agendar', { id, agendadoPara: item.agendadoPara, revisao: item.revisao, canal }); notificar(item); return clone(item)
    })
  }
  async function recusar(id, entrada = {}) { return mudarEstado(id, entrada, 'recusado', ['pendente', 'agendado'], { agendadoPara: undefined, aprovacao: undefined }) }
  async function reabrir(id, entrada = {}) { return mudarEstado(id, entrada, 'pendente', ['recusado', 'erro', 'incerto'], { erro: undefined, recibo: undefined, agendadoPara: undefined, aprovacao: undefined }) }
  async function mudarEstado(id, entrada, estado, permitidos, extras = {}) {
    idSeguro(id)
    return comLock(id, async () => {
      const atual = lerArquivo(id); if (!atual) throw new ErroFila('NAO_ENCONTRADO', `item não encontrado: ${id}`, 404)
      exigirRevisao(atual, entrada.revisao)
      if (!permitidos.includes(atual.estado)) throw new ErroFila('ESTADO_INVALIDO', `item não pode mudar do estado ${atual.estado}.`, 409)
      const item = atualizarEstado(atual, { ...extras, estado, revisao: atual.revisao + 1 })
      if (estado === 'recusado') item.feedback = { motivo: String(entrada.motivo || '').trim().slice(0, 1000), registradoEm: agoraIso(now) }
      for (const chave of Object.keys(extras)) if (extras[chave] === undefined) delete item[chave]
      await persistir(item)
      if (estado === 'recusado') registrarFeedback('recusa', item, { motivo: item.feedback.motivo, antes: item.texto.slice(0, 4000) })
      auditar(estado === 'recusado' ? 'recusar' : 'reabrir', { id, revisao: item.revisao }); notificar(item); return clone(item)
    })
  }
  async function publicar(id, entrada = {}) {
    if(entrada.agenda)require('./agenda/guarda.cjs').conferir(entrada.agenda)
    idSeguro(id)
    const item = await comLock(id, () => publicarBloqueado(id, entrada.revisao, 'manual', entrada.perfilUrl, entrada.canal === 'api' ? 'api' : 'desktop'))
    agendarCaptura(item)
    return item
  }
  function sessaoDaConta(conta) {
    return registro.sessoes?.para ? registro.sessoes.para(conta) : conta === 'linkedin' ? registro.sessoes : null
  }
  function agendarCaptura(item) {
    if (item?.estado === 'publicado' && item.recibo?.url && !item.recibo.comprovante) {
      void capturarComprovante(item.id).catch((erro) => auditar('comprovante-falha', { id: item.id, codigo: erro?.codigo || null }))
    }
  }
  function transporteAtual(conta) {
    const sessao = sessaoDaConta(conta)
    const visual = sessao?.estado()
    return visual?.transporte === 'sessao_visual' ? { tipo: 'sessao_visual', perfilUrl: visual.contaEsperada?.perfilUrl } : { tipo: 'api' }
  }
  async function fixarMidiasParaAprovacao(midias) {
    const resultado = []
    for (const midia of midias || []) {
      const arquivo = path.resolve(base, midia.arquivo)
      if (!dentro(arquivo, midiaDir)) throw new ErroFila('MIDIA_FORA_DA_AREA', 'mídia fora da área de previews.', 400)
      let real
      try { real = await fsp.realpath(arquivo) } catch { throw new ErroFila('MIDIA_NAO_ENCONTRADA', 'arquivo de mídia não encontrado.', 404) }
      const realDir = await fsp.realpath(midiaDir).catch(() => path.resolve(midiaDir))
      if (!dentro(real, realDir)) throw new ErroFila('MIDIA_FORA_DA_AREA', 'mídia fora da área de previews.', 400)
      const stat = await fsp.stat(real)
      if (!stat.isFile() || stat.size <= 0) throw new ErroFila('MIDIA_INVALIDA', 'arquivo de mídia vazio ou inválido.', 400)
      if (stat.size > 512 * 1024 * 1024) throw new ErroFila('MIDIA_MUITO_GRANDE', 'arquivo de mídia excede o limite.', 413)
      const dados = await fsp.readFile(real)
      const sha256 = crypto.createHash('sha256').update(dados).digest('hex')
      if (midia.sha256 && String(midia.sha256).toLowerCase() !== sha256) throw new ErroFila('MIDIA_HASH_INVALIDO', 'a mídia mudou antes da aprovação.', 409)
      resultado.push({ ...midia, sha256, tamanho: stat.size })
    }
    return resultado
  }
  async function processarAgendados() {
    if (processos.has('agenda')) return { processados: 0, ignorados: 0, concorrente: true }
    processos.add('agenda')
    let processados = 0; let ignorados = 0
    try {
      for (const item of lerTodos()) {
        if (item.estado !== 'agendado' || !item.agendadoPara || Date.parse(item.agendadoPara) > now()) continue
        try {
          const resultado = await comLock(item.id, async () => {
            const atual = lerArquivo(item.id)
            if (!atual || atual.estado !== 'agendado' || !atual.aprovacao || atual.aprovacao.revisao !== atual.revisao || Date.parse(atual.agendadoPara || '') > now()) return null
            return publicarBloqueado(item.id, atual.revisao, 'agenda')
          })
          if (resultado) {
            processados += 1
            agendarCaptura(resultado)
          }
        } catch (erro) {
          if (erro?.codigo === 'ITEM_EM_USO') ignorados += 1
          else auditar('agenda-falha', { id: item.id, erro: String(erro?.message || erro) })
        }
      }
    } finally { processos.delete('agenda') }
    return { processados, ignorados }
  }
  function iniciar() {
    if (timer) return
    parado = false
    registro.sessoes?.iniciar()
    timer = setInterval(() => { void processarAgendados() }, intervaloMs)
    timer.unref?.()
    void processarAgendados()
  }
  function parar() { parado = true; if (timer) clearInterval(timer); timer = null; registro.sessoes?.parar() }
  async function lerMidia(itemId, midiaId) {
    idSeguro(itemId, 'itemId'); idSeguro(midiaId, 'midiaId')
    const item = lerArquivo(itemId)
    if (!item) throw new ErroFila('NAO_ENCONTRADO', 'item não encontrado.', 404)
    const midia = (item.midias || []).find((valor) => valor.id === midiaId)
    if (!midia) throw new ErroFila('NAO_ENCONTRADO', 'mídia não encontrada.', 404)
    const arquivo = path.resolve(base, midia.arquivo)
    if (!dentro(arquivo, midiaDir)) throw new ErroFila('MIDIA_FORA_DA_AREA', 'mídia fora da área de previews.', 400)
    let stat
    let real
    try {
      real = await fsp.realpath(arquivo)
      const realDir = await fsp.realpath(midiaDir).catch(() => path.resolve(midiaDir))
      if (!dentro(real, realDir)) throw new ErroFila('MIDIA_FORA_DA_AREA', 'mídia fora da área de previews.', 400)
      stat = await fsp.stat(real)
    } catch (erro) {
      if (erro?.codigo === 'MIDIA_FORA_DA_AREA') throw erro
      throw new ErroFila('NAO_ENCONTRADO', 'arquivo de mídia não encontrado.', 404)
    }
    if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new ErroFila('MIDIA_INVALIDA', 'arquivo de mídia inválido.', 400)
    const dados = await fsp.readFile(real)
    return { dados, mime: midia.mime || 'application/octet-stream', nome: path.basename(real) }
  }
  function lerArquivado(id) {
    idSeguro(id)
    let nomes = []
    try { nomes = fs.readdirSync(itensArquivoDir) } catch { return { item: null, arquivo: null } }
    const nome = nomes.find((entrada) => entrada.endsWith(`-${id}.json`))
    if (!nome) return { item: null, arquivo: null }
    const arquivo = path.join(itensArquivoDir, nome)
    if (!dentro(arquivo, itensArquivoDir)) return { item: null, arquivo: null }
    try {
      const item = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
      return item?.id === id ? { item, arquivo } : { item: null, arquivo: null }
    } catch { return { item: null, arquivo: null } }
  }
  function listarArquivados() {
    let nomes = []
    try { nomes = fs.readdirSync(itensArquivoDir) } catch { return [] }
    return nomes.filter((nome) => nome.endsWith('.json')).map((nome) => {
      try { return JSON.parse(fs.readFileSync(path.join(itensArquivoDir, nome), 'utf8')) } catch { return null }
    }).filter(Boolean)
  }
  function resumoHistorico(item, arquivado) {
    return {
      id: item.id,
      conta: item.conta,
      idioma: item.idioma,
      titulo: item.titulo,
      texto: item.texto,
      publishedAt: item.recibo?.publishedAt || item.atualizadoEm,
      url: item.recibo?.url || null,
      midias: clone(item.midias || []),
      comprovante: item.recibo?.comprovante || null,
      origem: clone(item.origem || null),
      arquivado: arquivado === true,
    }
  }
  async function historico(filtros = {}) {
    const desde = String(filtros.desde || '').trim()
    const ate = String(filtros.ate || '').trim()
    if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw new ErroFila('DATA_INVALIDA', 'desde deve estar em AAAA-MM-DD.', 400)
    if (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate)) throw new ErroFila('DATA_INVALIDA', 'ate deve estar em AAAA-MM-DD.', 400)
    if (filtros.conta && !CONTAS.has(filtros.conta)) throw new ErroFila('CAMPO_INVALIDO', 'conta inválida.', 400)
    const ativos = lerTodos().filter((item) => item.estado === 'publicado').map((item) => resumoHistorico(item, false))
    const arquivados = listarArquivados().filter((item) => item.estado === 'publicado').map((item) => resumoHistorico(item, true))
    return [...ativos, ...arquivados]
      .filter((item) => !filtros.conta || item.conta === filtros.conta)
      .filter((item) => {
        const dia = String(item.publishedAt || '').slice(0, 10)
        if (desde && dia < desde) return false
        if (ate && dia > ate) return false
        return true
      })
      .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
  }
  async function persistirDestino(arquivo, diretorio, item) {
    const texto = JSON.stringify(item, null, 2) + '\n'
    if (Buffer.byteLength(texto) > MAX_ITEM_BYTES) throw new ErroFila('ITEM_MUITO_GRANDE', `item excede ${MAX_ITEM_BYTES} bytes.`, 413)
    await fsp.mkdir(diretorio, { recursive: true })
    const temporario = path.join(diretorio, `.${item.id}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`)
    try {
      await fsp.writeFile(temporario, texto, { encoding: 'utf8', mode: 0o600 })
      await fsp.rename(temporario, arquivo)
    } finally {
      await fsp.rm(temporario, { force: true }).catch(() => {})
    }
  }
  async function capturarComprovante(id) {
    idSeguro(id)
    const preview = lerArquivo(id) || lerArquivado(id).item
    if (!preview) throw new ErroFila('NAO_ENCONTRADO', `item não encontrado: ${id}`, 404)
    if (preview.estado !== 'publicado' || !preview.recibo?.url) throw new ErroFila('ESTADO_INVALIDO', 'só peças publicadas com recibo recebem comprovante.', 409)
    const sessao = sessaoDaConta(preview.conta)
    if (typeof sessao?.capturarComprovante !== 'function') throw new ErroFila('SESSAO_INDISPONIVEL', 'A sessão visual desta conta não está disponível para capturar o comprovante.', 503)
    return comLock(id, async () => {
      const ativo = lerArquivo(id)
      const arquivo = ativo ? { item: ativo, arquivo: arquivoItem(id), diretorio: itensDir } : (() => {
        const encontrado = lerArquivado(id)
        return encontrado.item ? { item: encontrado.item, arquivo: encontrado.arquivo, diretorio: itensArquivoDir } : null
      })()
      if (!arquivo) throw new ErroFila('NAO_ENCONTRADO', `item não encontrado: ${id}`, 404)
      const atual = arquivo.item
      if (atual.estado !== 'publicado' || !atual.recibo?.url) throw new ErroFila('ESTADO_INVALIDO', 'só peças publicadas com recibo recebem comprovante.', 409)
      const perfilUrl = sessao.estado()?.contaEsperada?.perfilUrl || null
      const resultado = await sessao.capturarComprovante({ url: atual.recibo.url, perfilUrl, itemId: atual.id })
      const item = atualizarEstado(atual, { recibo: { ...atual.recibo, comprovante: clone(resultado.comprovante) } })
      await persistirDestino(arquivo.arquivo, arquivo.diretorio, item)
      auditar('comprovante-capturado', { id, sha256: resultado.comprovante?.sha256 || null })
      notificar(item)
      return clone(item)
    })
  }
  async function lerComprovante(id) {
    idSeguro(id)
    const atual = lerArquivo(id) || lerArquivado(id).item
    if (!atual) throw new ErroFila('NAO_ENCONTRADO', 'item não encontrado.', 404)
    const relativo = atual.recibo?.comprovante?.arquivo
    if (!relativo) throw new ErroFila('NAO_ENCONTRADO', 'comprovante não encontrado.', 404)
    const arquivo = path.resolve(base, relativo)
    if (!dentro(arquivo, comprovantesDir)) throw new ErroFila('MIDIA_FORA_DA_AREA', 'comprovante fora da área editorial.', 400)
    let real
    try {
      real = await fsp.realpath(arquivo)
      const realDir = await fsp.realpath(comprovantesDir).catch(() => path.resolve(comprovantesDir))
      if (!dentro(real, realDir)) throw new ErroFila('MIDIA_FORA_DA_AREA', 'comprovante fora da área editorial.', 400)
    } catch (erro) {
      if (erro?.codigo === 'MIDIA_FORA_DA_AREA') throw erro
      throw new ErroFila('NAO_ENCONTRADO', 'arquivo de comprovante não encontrado.', 404)
    }
    const stat = await fsp.stat(real)
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new ErroFila('MIDIA_INVALIDA', 'arquivo de comprovante inválido.', 400)
    const dados = await fsp.readFile(real)
    return { dados, mime: 'image/png', nome: path.basename(real) }
  }
  return { listar, obter, verificar, criar, atualizar, excluirMuitos, publicar, agendar, recusar, reabrir, processarAgendados, iniciar, parar, lerMidia, historico, capturarComprovante, lerComprovante, politicaPublicacao, configurarPublicacao, ErroFila }
}

module.exports = { criarFilaEditorial, ErroFila, CONTAS, IDIOMAS, FORMATOS }
