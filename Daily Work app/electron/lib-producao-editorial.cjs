// Orquestra lotes editoriais assíncronos. O produtor prepara versões para a
// Fila; nunca chama confirmar-publicacao e nunca opera sessões de viewers.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { criarRedatorPublicacoes, validarCamposPublicacao } = require('./lib-redator-publicacoes.cjs')
const { classificarEstoqueEditorial } = require('./lib-estoque-editorial.cjs')
const { montarOrigem } = require('./lib-proveniencia-editorial.cjs')
const { hashConteudo } = require('./lib-editor-editorial.cjs')
const { carregarPerfilEditorial } = require('./lib-perfil-editorial.cjs')
const { resumoProducao } = require('./lib-logica-editorial.cjs')
const { referenciasDescritas } = require('./lib-referencias-editoriais.cjs')
const { candidatosProjetos, candidatosAutomaticos, listarProjetosEditoriais } = require('./lib-projetos-editoriais.cjs')

const CONTAS = ['linkedin', 'x', 'github', 'reddit']
const IDIOMAS = ['pt-BR', 'en']
const PADRAO = Object.freeze({
  ativa: true,
  quantidade: 3,
  contas: ['linkedin', 'x'],
  idiomas: ['pt-BR', 'en'],
  intervaloMinutos: 30,
  estoqueAlvo: 12,
  perfilId: 'grok-4-6',
  midiaAutomatica: true,
})

function agoraIso() { return new Date().toISOString() }
function clone(valor) { return JSON.parse(JSON.stringify(valor)) }
function hash(valor) { return crypto.createHash('sha256').update(String(valor)).digest('hex').slice(0, 20) }
function lerJson(arquivo, fallback) {
  try { return fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : fallback } catch { return fallback }
}
function gravarJson(arquivo, valor) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true })
  const temporario = `${arquivo}.${process.pid}.tmp`
  fs.writeFileSync(temporario, `${JSON.stringify(valor, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporario, arquivo)
}
function recortar(valor, limite = 6_000) {
  const texto = String(valor || '')
  return texto.length > limite ? `${texto.slice(0, limite)}…` : texto
}
function diaSaoPaulo(valor) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(valor))
  const porTipo = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]))
  return `${porTipo.year}-${porTipo.month}-${porTipo.day}`
}
function textoResposta(resposta) {
  return typeof resposta === 'string' ? resposta : resposta?.mensagem || resposta?.texto || resposta?.content || ''
}
function validarLista(lista, permitidos, nome) {
  if (!Array.isArray(lista) || !lista.length) throw new Error(`${nome} deve conter ao menos um valor`)
  const resultado = [...new Set(lista.map(String))]
  const invalido = resultado.find((item) => !permitidos.includes(item))
  if (invalido) throw new Error(`${nome} contém valor inválido: ${invalido}`)
  return resultado
}

// O perfil editorial fica persistido separadamente do provedor global. Se o
// usuário troca de provedor, o ID antigo pode deixar de existir no catálogo
// ativo e bloquear todos os lotes. Nesse caso específico, repita com o perfil
// padrão efetivo do agente. Outros erros continuam visíveis.
function completarComPerfilAtual(completar) {
  return async (entrada) => {
    try {
      return await completar(entrada)
    } catch (erro) {
      if (erro?.codigo !== 'PERFIL_NAO_PERMITIDO' || !entrada?.perfilId) throw erro
      return completar({ ...entrada, perfilId: undefined })
    }
  }
}

function criarProducaoEditorial({
  fila,
  lib,
  sumario = null,
  analiseSumario = null,
  completar,
  redator = null,
  registro = null,
  jobsMidias = null,
  dataDir,
  skillsDir,
  skillName = 'aprendizado-em-post',
  logica = null,
  now = () => Date.now(),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  onUpdate = null,
  portfolioDir = null,
  knowledgeDir,
} = {}) {
  if (!fila || typeof fila.criar !== 'function' || typeof fila.listar !== 'function') throw new Error('produção editorial precisa da fila')
  if (typeof completar !== 'function' && !redator) throw new Error('produção editorial precisa de completar ou redator')

  const raizDados = dataDir || lib?.DATA_DIR || process.env.DAILYWORK_DATA_DIR || path.resolve(__dirname, '../data')
  const raizEditorial = path.join(raizDados, 'editorial')
  const arquivoConfig = path.join(raizEditorial, 'producao-config.json')
  const arquivoEstado = path.join(raizEditorial, 'producao-estado.json')
  const arquivoHistorico = path.join(raizEditorial, 'producao-historico.ndjson')
  const arquivoLock = path.join(raizEditorial, 'producao.lock')
  const arquivoCancelamento = path.join(raizEditorial, 'producao-cancelamento.json')
  const arquivoImpedimentos = path.join(raizEditorial, 'producao-impedimentos.json')
  let config = normalizarConfig(lerJson(arquivoConfig, PADRAO))
  let producao = lerJson(arquivoEstado, { status: 'ociosa', criados: [], erros: [] })
  let rotina = null
  let rotinaHabilitada = false
  let cancelRequested = false
  let runToken = 0
  let activeRun = null
  let lockOwner = null
  let rotinaIntervaloMinutos = null

  function pidVivo(pid) {
    if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false
    try { process.kill(Number(pid), 0); return true } catch (erro) { return erro.code !== 'ESRCH' }
  }
  function lerLock() { return lerJson(arquivoLock, null) }
  function sincronizarConfig() {
    const disco = lerJson(arquivoConfig, null)
    if (disco) config = normalizarConfig(disco)
  }
  function sincronizarEstado() {
    const disco = lerJson(arquivoEstado, null)
    if (disco && !activeRun) producao = disco
  }
  function cancelamentoDo(id) {
    const pedido = lerJson(arquivoCancelamento, null)
    return pedido?.id === id
  }
  let redatorAtivo = redator

  function emitir() {
    const pacote = { producao: clone(producao), config: clone(config), projetos: listarProjetosEditoriais(raizDados) }
    if (typeof onUpdate === 'function') {
      try { onUpdate(pacote) } catch { /* observabilidade não interrompe a produção */ }
    }
    return pacote
  }
  function persistirConfig() { gravarJson(arquivoConfig, config) }
  function persistirEstado() { gravarJson(arquivoEstado, producao) }
  function registrarHistorico(evento) {
    fs.mkdirSync(raizEditorial, { recursive: true })
    fs.appendFileSync(arquivoHistorico, `${JSON.stringify({ ts: agoraIso(), ...evento })}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  function adquirirLock(id) {
    fs.mkdirSync(raizEditorial, { recursive: true })
    const nonce = crypto.randomBytes(16).toString('hex')
    const candidato = { pid: process.pid, nonce, id, criadoEm: agoraIso() }
    try {
      const fd = fs.openSync(arquivoLock, 'wx', 0o600)
      fs.writeFileSync(fd, JSON.stringify(candidato))
      fs.closeSync(fd)
      lockOwner = candidato
      return true
    } catch (erro) {
      if (erro.code === 'EEXIST') {
        const atual = lerLock()
        if (atual && !pidVivo(atual.pid)) {
          try {
            const conferido = lerLock()
            if (conferido?.pid === atual.pid && conferido?.nonce === atual.nonce) fs.unlinkSync(arquivoLock)
          } catch { return false }
          return adquirirLock(id)
        }
        return false
      }
      throw erro
    }
  }
  function liberarLock() {
    if (!lockOwner) return
    try {
      const atual = lerLock()
      if (atual?.pid === lockOwner.pid && atual?.nonce === lockOwner.nonce) fs.unlinkSync(arquivoLock)
    } catch (erro) { if (erro.code !== 'ENOENT') throw erro }
    lockOwner = null
  }
  function recuperarOrfao() {
    const lock = lerLock()
    if (lock && !pidVivo(lock.pid)) {
      try {
        const conferido = lerLock()
        if (conferido?.pid === lock.pid && conferido?.nonce === lock.nonce) fs.unlinkSync(arquivoLock)
      } catch {}
    }
    if (producao.status === 'executando' && !lerLock()) {
      producao = { ...producao, status: 'erro', mensagem: 'execução anterior encontrada sem processo proprietário', erro: { codigo: 'PRODUCAO_ORFA', mensagem: 'a execução anterior não tinha lock vivo; nenhuma saída foi reenviada' }, atualizadoEm: agoraIso() }
      persistirEstado()
    }
  }
  function skillInstructions() {
    const pasta = path.resolve(skillsDir || path.resolve(__dirname, '../skills'), skillName)
    const principal = path.join(pasta, 'SKILL.md')
    if (!fs.existsSync(principal)) {
      const erro = new Error(`skill editorial não encontrada: ${principal}`)
      erro.codigo = 'SKILL_EDITORIAL_AUSENTE'
      throw erro
    }
    const partes = [fs.readFileSync(principal, 'utf8')]
    const refs = path.join(pasta, 'references')
    if (fs.existsSync(refs)) {
      for (const nome of fs.readdirSync(refs).filter((item) => item.endsWith('.md')).sort()) {
        partes.push(`\n## Referência ${nome}\n${fs.readFileSync(path.join(refs, nome), 'utf8')}`)
      }
    }
    return partes.join('\n')
  }
  const registroAtivo = registro || fila.registro || null
  function obterRedator() {
    if (redatorAtivo) return redatorAtivo
    redatorAtivo = criarRedatorPublicacoes({ completar: completarComPerfilAtual(completar), registro: registroAtivo, lib, sumario, analiseSumario, logica })
    return redatorAtivo
  }
  function contextoBruto(dia) {
    const blocos = lib && typeof lib.listarBlocos === 'function' ? lib.listarBlocos(dia) : []
    let inputs = []
    try { inputs = sumario?.obterInputs?.(dia)?.inputs || [] } catch { inputs = [] }
    let analise = null
    try { analise = analiseSumario?.obter?.(dia)?.analysis || analiseSumario?.obter?.(dia)?.analise || null } catch { analise = null }
    return { blocos, inputs, analise }
  }
  function pontosReferenciaReal(projeto) {
    const chave = String(projeto || '').toLowerCase()
    if (!chave) return 0
    const refs = path.join(raizEditorial, 'midias', 'refs')
    if (fs.existsSync(refs)) {
      const nomes = fs.readdirSync(refs).join(' ').toLowerCase()
      if (nomes.includes(chave) || nomes.includes(chave.replace(/-/g, ''))) return 3
    }
    return 0
  }
  function acervoCandidatos() {
    const blocos = lib && typeof lib.listarBlocos === 'function' ? lib.listarBlocos() : []
    const selecionados = blocos.filter((bloco) => ['projeto', 'nota', 'link'].includes(bloco.tipo)).map((bloco) => ({
      ...bloco,
      origem: { tipo: 'acervo', projeto: bloco.origem?.projeto || bloco.projeto || undefined },
    }))
    // O Principal é um índice visual e pode não conter as fichas dos projetos.
    // Leia somente as cópias explicitamente destinadas ao site público; não
    // transforme o vault inteiro ou transcripts privados em pauta.
    const pastaPublica = portfolioDir
      ? path.resolve(portfolioDir)
      : (lib?.DATA_DIR ? path.resolve(__dirname, '../../LucasOL/Portfolio/site-publico/projetos') : null)
    if (!pastaPublica || !fs.existsSync(pastaPublica)) return selecionados
    for (const nome of fs.readdirSync(pastaPublica).filter(nome => nome.endsWith('.md')).sort()) {
      const arquivo = path.join(pastaPublica, nome)
      if (!fs.existsSync(arquivo)) continue
      const corpo = fs.readFileSync(arquivo, 'utf8').slice(0, 12_000)
      const titulo = corpo.match(/^#\s+(.+)$/m)?.[1]?.trim() || nome.replace(/\.md$/, '')
      const url = corpo.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/)?.[0]
      selecionados.push({
        id: `public-project-${nome.replace(/\.md$/, '')}`,
        tipo: 'projeto', status: 'feito', titulo, corpo,
        evidencias: [`Ficha pública sanitizada lida de ${arquivo}.`],
        fontes: [{ rotulo: `Ficha pública ${nome}`, ...(url ? { url } : {}) }],
        origem: { tipo: 'acervo', projeto: nome.replace(/\.md$/, '') },
      })
    }
    return selecionados
  }
  function candidatos(dia) {
    const bruto = contextoBruto(dia)
    const saida = []
    for (const bloco of [...bruto.blocos, ...acervoCandidatos()]) {
      const corpo = String(bloco.corpo || '').trim()
      const evidencias = Array.isArray(bloco.evidencias) ? bloco.evidencias : []
      if (!bloco.titulo || (!corpo && !evidencias.length)) continue
      const titulo = String(bloco.titulo).trim()
      // Pautas vindas do acervo representam uma ficha persistente, então a
      // identidade não pode mudar apenas porque o lote escolheu outro dia.
      // Incluímos o conteúdo na chave para que uma alteração material da ficha
      // gere uma nova pauta, sem republicar a mesma ficha em dias consecutivos.
      const identidade = bloco.origem?.tipo === 'acervo'
        ? `${bloco.origem.projeto || bloco.id || titulo}:${hash(`${corpo}\n${evidencias.join('\n')}`)}`
        : `${dia}:${titulo.toLocaleLowerCase('pt-BR')}`
      saida.push({
        titulo,
        pautaId: `pauta-${hash(identidade)}`,
        score: (bloco.status === 'feito' ? 4 : 1) + Math.min(4, evidencias.length * 2) + Math.min(2, bloco.fontes?.length || 0) + pontosReferenciaReal(bloco.origem?.projeto || bloco.projeto) + (bloco.origem?.tipo === 'acervo' ? 0 : 5),
        briefing: [
          `Pauta candidata: ${titulo}`,
          `Status registrado: ${bloco.status || 'pendente'}`,
          corpo ? `Registro: ${recortar(corpo, 4_000)}` : '',
          evidencias.length ? `Evidências registradas: ${recortar(evidencias.join('; '), 3_000)}` : '',
          Array.isArray(bloco.fontes) && bloco.fontes.length ? `Fontes: ${recortar(bloco.fontes.map((f) => typeof f === 'string' ? f : JSON.stringify(f)).join('; '), 2_000)}` : '',
          'Separe claramente resultado observado, tentativa e plano; só trate resultado como feito quando o registro trouxer evidência.',
        ].filter(Boolean).join('\n'),
        fontes: Array.isArray(bloco.fontes) ? bloco.fontes.map((fonte) => typeof fonte === 'string' ? { rotulo: fonte } : fonte).filter(Boolean) : [],
        origem: montarOrigem({
          tipo: bloco.origem?.tipo === 'acervo' ? 'acervo' : 'dia',
          projeto: bloco.origem?.projeto || bloco.projeto,
          dia: bloco.origem?.tipo === 'acervo' ? undefined : dia,
          loteDia: dia,
          titulo,
          analiseUsada: false,
          partePrincipal: bloco.origem?.tipo === 'acervo' ? 'ficha-publica' : 'bloco',
        }),
      })
    }
    for (const estudo of (Array.isArray(bruto.analise?.studies) ? bruto.analise.studies : [])) {
      const titulo = String(estudo.subject || estudo.context || '').trim()
      if (!titulo) continue
      saida.push({
        titulo,
        pautaId: `pauta-${hash(`${dia}:${titulo.toLocaleLowerCase('pt-BR')}`)}`,
        score: 2,
        briefing: `Pauta derivada do estudo do dia: ${titulo}\n${recortar(estudo.markdown || '', 4_000)}\nSepare resultado observado, tentativa e plano.`,
        fontes: [],
        origem: montarOrigem({
          tipo: 'dia',
          dia,
          loteDia: dia,
          titulo,
          analiseUsada: true,
          partePrincipal: 'estudo',
        }),
      })
    }
    if (!saida.length && bruto.inputs.length) {
      const ultimo = bruto.inputs[bruto.inputs.length - 1]
      const titulo = 'Aprendizado a partir do trabalho do dia'
      saida.push({
        titulo,
        pautaId: `pauta-${hash(`${dia}:inputs`)}`,
        score: 1,
        briefing: `Use somente esta entrada como pista editorial, sem alegar que a intenção foi entregue: ${recortar(ultimo.text || ultimo.texto, 3_000)}`,
        fontes: ultimo.content?.url ? [{ rotulo: 'Proveniência da entrada', url: ultimo.content.url }] : [],
        origem: montarOrigem({
          tipo: 'dia',
          dia,
          loteDia: dia,
          titulo,
          partePrincipal: 'inputs',
        }),
      })
    }
    const vistos = new Set()
    return saida.sort((a, b) => b.score - a.score).filter((item) => !vistos.has(item.pautaId) && vistos.add(item.pautaId))
  }
  function editorialPedidoDireto(pauta) {
    const trecho = String(pauta.briefing || pauta.titulo || '').replace(/\s+/g, ' ').trim()
    const evidencia = (trecho.length >= 20 ? trecho : `${pauta.titulo}. Pedido direto do titular.`).slice(0, 1800)
    return {
      titulo: pauta.titulo,
      leitor: 'Quem acompanha o trabalho do titular',
      situacao: 'Pedido direto de publicação',
      tese: pauta.titulo,
      interesse: 'O titular pediu uma peça sobre este assunto.',
      limites: 'A peça ainda não passou pela revisão de evidências.',
      evidencias: [{ id: 'pedido-1', trecho: evidencia, sustenta: 'Pedido direto do titular; revisar antes de publicar.' }],
      midia: { tipo: 'nenhuma', objetivo: 'Texto pedido diretamente; mídia opcional na revisão.' },
    }
  }
  function montarPautaPedido(entrada) {
    const pedido = entrada.pedido
    let briefingProjeto = ''
    let fontes = Array.isArray(pedido.fontes) ? pedido.fontes.filter((fonte) => fonte && typeof fonte === 'object' && fonte.rotulo) : []
    let origem = montarOrigem({ tipo: 'pedido', projeto: pedido.projeto, dia: entrada.dia, titulo: pedido.tema, partePrincipal: 'pedido' })
    if (pedido.projeto) {
      try {
        const desde = entrada.desde || (() => {
          const data = new Date(`${entrada.dia}T12:00:00`)
          data.setDate(data.getDate() - 30)
          return data.toISOString().slice(0, 10)
        })()
        const [pauta] = candidatosProjetos({ dataDir: raizDados, projetos: [pedido.projeto], desde, ate: entrada.ate || entrada.dia, dia: entrada.dia })
        briefingProjeto = pauta.briefing
        if (!fontes.length) fontes = pauta.fontes
        origem = { ...pauta.origem, tipo: 'pedido', partes: [{ tipo: 'pedido', rotulo: pedido.tema, projeto: pedido.projeto }, ...(pauta.origem?.partes || [])] }
      } catch { /* o pedido segue com o contexto informado pelo titular */ }
    }
    const contexto = [pedido.contexto, briefingProjeto].filter(Boolean).join('\n\n')
    return {
      titulo: pedido.tema,
      pautaId: `pedido-${hash(`${pedido.tema}:${now()}`).slice(0, 16)}`,
      score: 99,
      briefing: [`Pedido direto do titular: ${pedido.tema}`, contexto ? `Contexto do pedido:\n${contexto}` : '', 'Separe resultado observado, tentativa e plano.'].filter(Boolean).join('\n\n'),
      fontes,
      origem,
    }
  }
  async function itensExistentes() {
    const itens = await fila.listar()
    return Array.isArray(itens) ? itens : []
  }
  function preferenciasRecentes() {
    const perfil = carregarPerfilEditorial({ knowledgeDir })
    const arquivo = path.join(raizEditorial, 'feedback.ndjson')
    const recentes = !fs.existsSync(arquivo) ? [] : fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean).slice(-80).map(lerLinha).filter(Boolean)
      .filter(e => e.motivo || e.tipo === 'edicao').slice(-12)
      .map(e => ({ tipo: e.tipo, conta: e.conta, idioma: e.idioma, motivo: e.motivo, antes: recortar(e.antes, 500), depois: recortar(e.depois, 500), tese: e.tese }))
    return [...(perfil ? [perfil] : []), ...recentes]
  }
  // Preserva o rascunho se a mídia falhar, mas só conclui a versão com o
  // job visual pronto. Falha de imagem não pode virar sucesso do lote.
  async function dispararMidiaAutomatica(item, { acompanharLote = false, perfilVisao, exigirMidia = false, verificarCancelamento = () => {} } = {}) {
    if (!jobsMidias || typeof jobsMidias.iniciar !== 'function') return false
    if (config.midiaAutomatica === false && !exigirMidia) return false
    if (item.editorial?.pauta?.midia?.tipo === 'nenhuma') return false
    if (!item?.id || !Number.isInteger(item.revisao)) return false
    try {
      const conexao = registroAtivo?.obterConexao ? registroAtivo.obterConexao(item.conta) : null
      // Só gasta crédito da Factory quando o conector declara suporte explícito
      // a imagem; GitHub/Reddit e capacidade desconhecida seguem só com texto.
      if (conexao?.capacidades?.midia?.imagem !== true) return false
      const ilustracao = item.editorial?.pauta?.midia?.tipo === 'ilustracao'
      if (ilustracao && jobsMidias.configuracao?.().autorizarGasto !== true) throw Object.assign(new Error('A pauta pede ilustração, mas a geração não está habilitada. Escolha uma captura disponível ou habilite a geração.'), { codigo: 'MIDIA_INCOMPLETA' })
      const iniciado = await jobsMidias.iniciar({ itemId: item.id, revisao: item.revisao, tipo: 'imagem', pautaId: item.pautaId, estrategia: ilustracao ? 'editorial' : 'referencia-real', provedores: 'codex', perfilVisao, briefing: item.editorial?.pauta?.midia?.direcao || '' })
      try { verificarCancelamento() } catch (erro) { await jobsMidias.cancelar(iniciado.job.id); throw erro }
      registrarHistorico({ tipo: 'midia-automatica-iniciada', itemId: item.id, pautaId: item.pautaId, jobId: iniciado?.job?.id || null })
      if (acompanharLote) {
        producao.midiaJobId = iniciado?.job?.id
        producao.etapa = 'Preparando e revisando a imagem'; persistirEstado(); emitir()
      }
      if (typeof jobsMidias.aguardar !== 'function') throw new Error('O serviço de mídia não permite acompanhar a conclusão.')
      const final = await jobsMidias.aguardar(iniciado.job.id)
      verificarCancelamento()
      if (final?.status !== 'ready' || !final.midias?.length) throw Object.assign(new Error(final?.erro?.mensagem || 'A imagem não ficou pronta; o rascunho foi preservado.'), { codigo: final?.erro?.codigo || 'MIDIA_INCOMPLETA' })
      await completarVideo(item.id, { perfilVisao, verificarCancelamento, acompanharLote })
      if (acompanharLote) producao.midiaJobId = undefined
      return true
    } catch (erro) {
      registrarHistorico({ tipo: 'midia-automatica-falhou', itemId: item.id, pautaId: item.pautaId, codigo: erro?.codigo || 'MIDIA_AUTOMATICA_FALHOU', mensagem: String(erro?.message || erro) })
      throw erro
    }
  }
  async function completarVideo(itemId, { perfilVisao, verificarCancelamento, acompanharLote = true }) {
    if (config.formatoMidia !== 'video') return
    verificarCancelamento()
    const atual = await fila.obter(itemId)
    verificarCancelamento()
    if (atual.midias?.some(m => m.tipo === 'video')) return
    if (registroAtivo?.obterConexao(atual.conta)?.capacidades?.midia?.video !== true) throw Object.assign(new Error('Esta rede não aceita vídeo. Escolha imagem nas preferências de conteúdo.'), { codigo: 'VIDEO_NAO_SUPORTADO' })
    const video = await jobsMidias.iniciar({ itemId: atual.id, revisao: atual.revisao, tipo: 'video', automatico: true, perfilVisao })
    try { verificarCancelamento() } catch (erro) { await jobsMidias.cancelar(video.job.id); throw erro }
    if (acompanharLote) { producao.midiaJobId = video.job.id; producao.etapa = 'Montando e revisando o vídeo'; persistirEstado(); emitir() }
    const pronto = await jobsMidias.aguardar(video.job.id)
    verificarCancelamento()
    if (pronto?.status !== 'ready' || !pronto.midias?.length) throw Object.assign(new Error(pronto?.erro?.mensagem || 'O vídeo não ficou pronto. As imagens foram preservadas.'), { codigo: pronto?.erro?.codigo || 'VIDEO_INCOMPLETO' })
  }
  async function gerarVersao(pauta, conta, idioma, entrada, skill) {
    const resultado = await obterRedator().rascunhar({
      conta,
      dia: entrada.dia,
      idioma,
      perfilId: entrada.perfilId || config.perfilId,
      perfilEditor: entrada.perfilEditor,
      onEtapa: etapa => { producao.etapa = etapa; producao.atualizadoEm = agoraIso(); persistirEstado(); emitir() },
      briefing: `${entrada.briefing || ''}\n\nIdioma desta versão: ${idioma}. Conta de destino: ${conta}.\n${resumoProducao(typeof logica === 'function' ? logica() : logica)}`,
      contextoExtra: pauta.briefing,
      instrucoesEditorial: skill,
      publicavel: true,
      strictJson: true,
      pautaEditorial: pauta.pedidoDireto ? null : pauta.editorial,
      preferencias: entrada.preferencias || [],
      linkObrigatorio: pauta.linkPublico || '',
    })
    if (!resultado?.contextoUsado) throw new Error('não há contexto editorial real para esta pauta')
    const campos = resultado.rascunho || {}
    const conexao = registroAtivo?.obterConexao ? registroAtivo.obterConexao(conta) : null
    if (conexao?.esquemaPublicacao) {
      const erros = validarCamposPublicacao(conexao.esquemaPublicacao, campos)
      if (erros.length) { const erro = new Error(`campos inválidos antes da fila: ${erros.join('; ')}`); erro.codigo = 'PUBLICACAO_INVALIDA'; throw erro }
    }
    const texto = campos.texto || campos.corpo || ''
    if (!String(texto).trim()) throw new Error(`a versão ${conta}/${idioma} não tem texto publicável`)
    const item = {
      pautaId: pauta.pautaId,
      conta,
      idioma,
      formato: 'texto',
      titulo: String(campos.titulo || pauta.titulo).trim(),
      texto: String(texto),
      campos,
      midias: [],
      fontes: pauta.fontes,
      origem: pauta.origem,
      estado: 'pendente',
    }
    if (pauta.pedidoDireto) {
      item.editorial = {
        versao: 'pedido-direto',
        pauta: pauta.editorial,
        qualidade: {
          estado: 'pedido_direto',
          aprovado: false,
          parecer: 'Pedido direto, sem revisão de evidências.',
          notas: {},
          problemas: ['Pedido direto: a decisão final é sua.'],
        },
      }
    } else if (resultado.editorial) item.editorial = resultado.editorial
    if (item.editorial) item.editorial.qualidade.conteudoHash = hashConteudo(item)
    if (item.editorial && pauta.atividade) item.editorial.atividade = pauta.atividade
    if(entrada.agenda)item.agenda=entrada.agenda
    return item
  }
  async function retomarMidias(existentes, entrada, id, token) {
    const criados = [], erros = []
    if (entrada.pedido || typeof jobsMidias?.retomarItem !== 'function') return { criados, erros }
    const limite = Number.isInteger(entrada.limiteVersoes) ? entrada.limiteVersoes : Infinity
    const historias = new Set()
    for (const item of existentes) {
      if (criados.length >= limite) break
      if (cancelRequested || cancelamentoDo(id) || token !== runToken) break
      if (!entrada.contas.includes(item.conta) || !entrada.idiomas.includes(item.idioma)) continue
      if (entrada.pautaIds?.length && !entrada.pautaIds.includes(item.pautaId)) continue
      if (entrada.projetos?.length && !entrada.projetos.includes(item.origem?.projeto)) continue
      if (historias.size >= entrada.quantidade && !historias.has(item.pautaId)) continue
      const qualidade = item.editorial?.qualidade
      const faltaVideo = config.formatoMidia === 'video' && item.midias?.some(m => m.tipo === 'imagem') && !item.midias.some(m => m.tipo === 'video')
      if (item.estado !== 'pendente' || (item.midias?.length && !faltaVideo) || qualidade?.aprovado !== true || qualidade.estado !== 'aprovada' || qualidade.conteudoHash !== hashConteudo(item)) continue
      if (entrada.agenda) require('./agenda/guarda.cjs').conferir(entrada.agenda)
      try {
        const iniciado = await jobsMidias.retomarItem(item.id, item.revisao, { formatoMidia: config.formatoMidia, reavaliar: entrada.reavaliar === true })
        if (!iniciado?.job?.id) continue
        if (cancelRequested || cancelamentoDo(id) || token !== runToken) { await jobsMidias.cancelar(iniciado.job.id); break }
        producao.midiaJobId = iniciado.job.id
        producao.etapa = 'Retomando a mídia do texto aprovado'; persistirEstado(); emitir()
        const final = await jobsMidias.aguardar(iniciado.job.id)
        if (final?.status !== 'ready' || !final.midias?.length) throw Object.assign(new Error(final?.erro?.mensagem || 'A mídia ainda não ficou pronta.'), { codigo: final?.erro?.codigo || 'MIDIA_INCOMPLETA' })
        if (cancelRequested || cancelamentoDo(id) || token !== runToken) break
        await completarVideo(item.id, { perfilVisao: entrada.perfilVisao, verificarCancelamento: () => {
          if (cancelRequested || cancelamentoDo(id) || token !== runToken) throw Object.assign(new Error('Produção cancelada.'), { codigo: 'JOB_CANCELADO' })
          if (entrada.agenda) require('./agenda/guarda.cjs').conferir(entrada.agenda)
        } })
        const atual = await fila.obter(item.id)
        if (cancelRequested || cancelamentoDo(id) || token !== runToken) break
        criados.push(atual); historias.add(item.pautaId)
        registrarHistorico({ tipo: 'sucesso', loteId: id, pautaId: item.pautaId, itemId: item.id, conta: item.conta, idioma: item.idioma, retomada: 'midia', projeto: item.origem?.projeto, fonteHash: item.editorial.atividade?.fonteHash, anguloHash: item.editorial.pauta?.anguloHash, tese: item.editorial.pauta?.tese })
        producao.criados = criados.map(item => item.id); producao.atualizadoEm = agoraIso(); persistirEstado(); emitir()
      } catch (erro) {
        const falha = { pautaId: item.pautaId, itemId: item.id, conta: item.conta, idioma: item.idioma, codigo: erro.codigo || 'MIDIA_INCOMPLETA', mensagem: erro.message }
        erros.push(falha); registrarHistorico({ tipo: 'falha', loteId: id, ...falha })
      }
    }
    return { criados, erros }
  }
  async function executar(entrada, id, token, owner) {
    const lock = Boolean(owner)
    try {
      const skill = skillInstructions()
      entrada.preferencias = preferenciasRecentes()
      const existentes = await itensExistentes()
      const retomada = await retomarMidias(existentes, entrada, id, token)
      if (cancelRequested || cancelamentoDo(id) || token !== runToken) {
        if(producao.id===id){producao.status='cancelada';producao.mensagem='Produção cancelada durante a retomada da mídia.';producao.atualizadoEm=agoraIso();persistirEstado();emitir()}
        return
      }
      const historiasRetomadas = new Set(retomada.criados.map(item => item.pautaId)).size
      if (retomada.criados.length && (historiasRetomadas >= entrada.quantidade || retomada.criados.length >= (entrada.limiteVersoes ?? Infinity))) {
        producao = { ...producao, status: 'concluida', criados: retomada.criados.map(item => item.id), historias: historiasRetomadas, erros: retomada.erros, etapa: undefined, midiaJobId: undefined, mensagem: `${retomada.criados.length} versão(ões) concluída(s) retomando a mídia.`, atualizadoEm: agoraIso() }
        persistirEstado(); emitir(); return
      }
      const historico = fs.existsSync(arquivoHistorico) ? fs.readFileSync(arquivoHistorico, 'utf8').split('\n').filter(Boolean).map((linha) => lerLinha(linha)).filter((item) => item?.tipo === 'sucesso') : []
      const pautaIds = Array.isArray(entrada.pautaIds) && entrada.pautaIds.length ? new Set(entrada.pautaIds.map(String)) : null
      const idsAtuais = new Set(existentes.map(item => item.id))
      // Uma calibração explícita pode refazer pautas selecionadas já arquivadas.
      // Itens ainda na fila e a produção automática continuam protegidos.
      const historicoBloqueante = entrada.regenerarArquivadas === true && pautaIds
        ? historico.filter(item => !pautaIds.has(item.pautaId) || idsAtuais.has(item.itemId))
        : historico
      const usados = new Set([...existentes, ...historicoBloqueante].map((item) => `${item.pautaId || ''}:${item.conta || ''}:${item.idioma || ''}`))
      const chaveFonte = (item, conta = item.conta, idioma = item.idioma) => {
        const fonteHash = item.atividade?.fonteHash || item.editorial?.atividade?.fonteHash || item.fonteHash
        const projeto = item.origem?.projeto || item.projeto
        return fonteHash && projeto ? `${projeto}:${fonteHash}:${conta}:${idioma}` : null
      }
      const fontesUsadas = new Set([...existentes, ...historicoBloqueante].map(item => chaveFonte(item)).filter(Boolean))
      const jaProduzida = (pauta, conta, idioma) => usados.has(`${pauta.pautaId}:${conta}:${idioma}`) || fontesUsadas.has(chaveFonte(pauta, conta, idioma))
      const limiteVersoes = Number.isInteger(entrada.limiteVersoes) ? entrada.limiteVersoes : Infinity
      const fontes = !entrada.pedido && !entrada.projetos ? candidatosAutomaticos({ dataDir: raizDados, dia: entrada.dia }) : { pautas: [], impedimentos: [] }
      const projetosComFonte = new Set(fontes.pautas.map(p => p.origem.projeto))
      const todasPautas = entrada.pedido
        ? [montarPautaPedido(entrada)]
        : entrada.projetos ? candidatosProjetos({ dataDir: raizDados, ...entrada }) : [...fontes.pautas, ...new Map((entrada.diasContexto || [entrada.dia]).flatMap(dia => candidatos(dia)).filter(p => p.origem?.tipo !== 'acervo' || !projetosComFonte.has(p.origem?.projeto)).map(p => [p.pautaId, p])).values()]
      const impedimentos = lerJson(arquivoImpedimentos, {})
      const chavePauta = pauta => hash(JSON.stringify([pauta.briefing, pauta.captura, pauta.referenciasVisuais || referenciasDescritas({ item: pauta, dataDir: raizDados }), entrada.briefing, entrada.preferencias, entrada.perfilEditor || entrada.perfilId || config.perfilId]))
      const chavesOriginais = new Map(todasPautas.map(pauta => [pauta.pautaId, chavePauta(pauta)]))
      const descartadas = [...fontes.impedimentos]
      const disponiveis = todasPautas.filter(pauta => {
        const anterior = impedimentos[pauta.pautaId]
        if (entrada.reavaliar || !anterior || anterior.chave !== chavesOriginais.get(pauta.pautaId) || now() - anterior.em >= 86_400_000) return true
        descartadas.push({ pautaId: pauta.pautaId, titulo: pauta.titulo, codigo: anterior.codigo, motivo: anterior.motivo, aguardandoMudanca: true })
        return false
      })
      producao.descartadas = descartadas
      const porProjeto = new Map()
      for (const item of existentes) {
        const projeto = String(item.origem?.projeto || '').toLowerCase()
        if (!projeto) continue
        const atual = porProjeto.get(projeto) || { pendentes: 0, publicados: 0, recusados: 0 }
        if (item.estado === 'recusado') atual.recusados += 1
        else if (item.estado === 'publicado') atual.publicados += 1
        else atual.pendentes += 1
        porProjeto.set(projeto, atual)
      }
      const ranqueadas = disponiveis.map((pauta) => {
        const projeto = String(pauta.origem?.projeto || '').toLowerCase()
        const saturacao = porProjeto.get(projeto) || { pendentes: 0, publicados: 0, recusados: 0 }
        const penalidade = Math.min(12, saturacao.pendentes * 2) + Math.min(6, saturacao.publicados * 3) + Math.min(8, saturacao.recusados)
        return { ...pauta, score: pauta.score - penalidade }
      }).sort((a, b) => b.score - a.score || a.pautaId.localeCompare(b.pautaId))
      const pautasSelecionadas = pautaIds ? ranqueadas.filter((pauta) => pautaIds.has(pauta.pautaId)) : ranqueadas
      const pautas = entrada.pedido
        ? pautasSelecionadas
        : pautasSelecionadas.filter((pauta) => (entrada.contas || config.contas).some((conta) => (entrada.idiomas || config.idiomas).some((idioma) => !jaProduzida(pauta, conta, idioma)))).slice(0, entrada.projetos ? 60 : 30)
      if (!pautas.length && !retomada.criados.length && !retomada.erros.length && entrada.projetos && pautasSelecionadas.length) {
        producao.status = 'concluida'
        producao.mensagem = 'Os projetos selecionados já têm versões na fila ou no histórico. Nenhuma duplicata foi criada.'
        producao.atualizadoEm = agoraIso()
        persistirEstado(); emitir()
        return
      }
      if (!pautas.length && !retomada.criados.length && !retomada.erros.length) {
        producao = { ...producao, status: 'sem_pauta', etapa: undefined, mensagem: descartadas.length ? 'As pautas disponíveis aguardam novas evidências. Recomeçar força uma nova avaliação.' : 'Nenhuma pauta nova disponível nas fontes e no contexto. O conteúdo existente foi preservado.', atualizadoEm: agoraIso() }
        persistirEstado(); emitir(); return
      }
      let criados = retomada.criados
      const erros = retomada.erros
      let historias = new Set(criados.map(item => item.pautaId)).size
      const angulos = new Map(historico.filter(e => e.anguloHash).map(e => [e.anguloHash, e.pautaId]))
      for (const pauta of pautas) {
        if(entrada.agenda)require('./agenda/guarda.cjs').conferir(entrada.agenda)
        if (cancelRequested || cancelamentoDo(id) || token !== runToken || criados.length >= limiteVersoes || historias >= entrada.quantidade) break
        producao.etapa = 'Selecionando história'; producao.pautaAtual = pauta.titulo; persistirEstado(); emitir()
        try {
          const preparar = obterRedator().prepararPauta
          if (typeof preparar !== 'function') throw Object.assign(new Error('O redator não oferece avaliação de pauta.'), { codigo: 'EDITOR_INDISPONIVEL' })
          if (pauta.captura) {
            producao.etapa = 'Capturando a capacidade do produto'; persistirEstado(); emitir()
            if (typeof jobsMidias?.capturarPauta !== 'function') throw Object.assign(new Error('A pauta precisa de captura do produto; o executor não está disponível.'), { codigo: 'CAPTURA_INDISPONIVEL' })
            const capturada = await jobsMidias.capturarPauta(pauta, { perfilVisao: entrada.perfilVisao, verificarCancelamento: () => {
              if (cancelRequested || cancelamentoDo(id) || token !== runToken) throw Object.assign(new Error('Captura cancelada.'), { codigo: 'JOB_CANCELADO' })
            } })
            pauta.referenciasVisuais = capturada.references
            pauta.briefing += `\n\nCapturas do produto inspecionadas: ${capturada.references.map(r => r.descricao).join('\n')}`
          }
          const pedidoPauta = { titulo: pauta.titulo, contexto: pauta.briefing, fontes: pauta.fontes, preferencias: entrada.preferencias, briefing: entrada.briefing || '', referenciasVisuais: pauta.referenciasVisuais || referenciasDescritas({ item: pauta, dataDir: raizDados }), exigirMidia: entrada.exigirMidia === true, perfilId: entrada.perfilEditor }
          for (let tentativa = 0; tentativa < 2; tentativa++) {
            try { pauta.editorial = await preparar(pedidoPauta); break }
            catch (erro) {
              if (tentativa || !['PAUTA_INVALIDA', 'EDITOR_JSON_INVALIDO', 'PAUTA_SEM_EVIDENCIA', 'EVIDENCIA_NAO_ENCONTRADA'].includes(erro.codigo)) throw erro
              pedidoPauta.briefing += `\nCorreção de contrato: ${erro.message}. Use somente trechos literais e nomes exatos dos arquivos fornecidos em referenciasVisuais. Não invente ou encurte o caminho da captura.`
              producao.etapa = 'Corrigindo a seleção da história'; persistirEstado(); emitir()
            }
          }
          if (pauta.captura) {
            // A receita declara uma sequência complementar, não candidatas
            // concorrentes. Preserve todas as cenas até a revisão do conjunto.
            pauta.editorial.midia = { ...pauta.editorial.midia, tipo: 'captura', referencias: pauta.referenciasVisuais, referencia: pauta.referenciasVisuais[0].arquivo, referenciaSha256: pauta.referenciasVisuais[0].sha256 }
          }
          // O redator recebe este mesmo registro. A revisão também precisa
          // poder citar os fatos que o seletor não repetiu nos seus trechos.
          if (pauta.atividade) {
            for (const [i, trecho] of pauta.briefing.split(/\n\n/).entries()) {
              if (trecho.length >= 20 && trecho.length <= 1800) pauta.editorial.evidencias.push({ id: `registro-${i + 1}`, trecho, sustenta: 'Registro público do projeto ou observação visual inspecionada, com os limites expressos no próprio trecho.' })
            }
          }
          if (angulos.has(pauta.editorial.anguloHash) && angulos.get(pauta.editorial.anguloHash) !== pauta.pautaId) throw Object.assign(new Error('Esta mesma ideia já foi produzida; falta um ângulo novo.'), { codigo: 'PAUTA_REPETIDA' })
          pauta.titulo = pauta.editorial.titulo
        } catch (erro) {
          const evidenciasFracas = ['PAUTA_SEM_EVIDENCIA', 'EVIDENCIA_NAO_ENCONTRADA', 'SEM_PAUTA_PUBLICAVEL'].includes(erro.codigo)
          if (entrada.pedido && evidenciasFracas) {
            pauta.editorial = editorialPedidoDireto(pauta)
            pauta.pedidoDireto = true
          } else {
          if (!['CAPTURA_NECESSARIA', 'CAPTURA_INDISPONIVEL', 'CAPTURA_REPROVADA', 'CAPTURA_FALHOU', 'SEM_PAUTA_PUBLICAVEL', 'PAUTA_REPETIDA', 'PAUTA_SEM_EVIDENCIA', 'EVIDENCIA_NAO_ENCONTRADA', 'PAUTA_INVALIDA', 'EDITOR_JSON_INVALIDO'].includes(erro.codigo)) throw erro
          const descarte = { pautaId: pauta.pautaId, titulo: pauta.titulo, codigo: erro.codigo, motivo: erro.message }
          descartadas.push(descarte); producao.descartadas = descartadas
          if (['CAPTURA_NECESSARIA', 'SEM_PAUTA_PUBLICAVEL', 'PAUTA_SEM_EVIDENCIA', 'EVIDENCIA_NAO_ENCONTRADA'].includes(erro.codigo)) {
            impedimentos[pauta.pautaId] = { chave: chavesOriginais.get(pauta.pautaId), codigo: erro.codigo, motivo: erro.message, em: now() }
            gravarJson(arquivoImpedimentos, impedimentos)
          }
          if (entrada.projetos || erro.codigo.startsWith('CAPTURA_')) { erros.push({ pautaId: pauta.pautaId, codigo: erro.codigo, mensagem: erro.message }); producao.erros = erros }
          registrarHistorico({ tipo: 'pauta-descartada', loteId: id, ...descarte }); persistirEstado(); emitir()
          continue
          }
        }
        const criadosAntes = criados.length
        for (const conta of entrada.contas || config.contas) {
          for (const idioma of entrada.idiomas || config.idiomas) {
            if (cancelRequested || cancelamentoDo(id) || producao.status === 'cancelada' || token !== runToken || criados.length >= limiteVersoes) break
            const chave = `${pauta.pautaId}:${conta}:${idioma}`
            if (!entrada.pedido && jaProduzida(pauta, conta, idioma)) continue
            try {
              producao.etapa = `Escrevendo e revisando ${conta} · ${idioma}`; persistirEstado(); emitir()
              const item = await gerarVersao(pauta, conta, idioma, entrada, skill)
              if (cancelRequested || cancelamentoDo(id) || producao.status === 'cancelada' || token !== runToken || criados.length >= limiteVersoes) break
              if(entrada.agenda)require('./agenda/guarda.cjs').conferir(entrada.agenda)
              const criado = await fila.criar(item)
              const persistido = criado?.data || criado || item
              usados.add(chave)
              const fonteUsada = chaveFonte(pauta, conta, idioma)
              if (fonteUsada) fontesUsadas.add(fonteUsada)
              const comMidia = await dispararMidiaAutomatica(persistido, { acompanharLote: true, perfilVisao: entrada.perfilVisao, exigirMidia: entrada.exigirMidia === true, verificarCancelamento: () => {
                if (cancelRequested || cancelamentoDo(id) || token !== runToken) throw Object.assign(new Error('Produção cancelada.'), { codigo: 'JOB_CANCELADO' })
                if (entrada.agenda) require('./agenda/guarda.cjs').conferir(entrada.agenda)
              } })
              if (entrada.exigirMidia && !comMidia) throw Object.assign(new Error('Esta rodada exige uma imagem; a mídia automática não está disponível.'), { codigo: 'MIDIA_INCOMPLETA' })
              if (cancelRequested || cancelamentoDo(id) || token !== runToken) break
              criados.push(persistido)
              registrarHistorico({ tipo: 'sucesso', loteId: id, pautaId: pauta.pautaId, projeto: pauta.origem?.projeto, fonteHash: pauta.atividade?.fonteHash, anguloHash: pauta.editorial.anguloHash, tese: pauta.editorial.tese, conta, idioma, itemId: persistido.id || null, ...(entrada.regenerarArquivadas === true && pautaIds ? { regeneracaoSolicitada: true } : {}) })
              angulos.set(pauta.editorial.anguloHash, pauta.pautaId)
              producao.criados = criados.map((valor) => valor.id || valor)
              producao.atualizadoEm = agoraIso()
              persistirEstado(); emitir()
            } catch (erro) {
              const falha = { pautaId: pauta.pautaId, conta, idioma, codigo: erro.codigo || 'GERACAO_FALHOU', mensagem: erro.message }
              erros.push(falha)
              registrarHistorico({ tipo: 'falha', loteId: id, ...falha })
              producao.erros = erros
              producao.atualizadoEm = agoraIso()
              persistirEstado(); emitir()
            }
          }
        }
        if (criados.length > criadosAntes) historias++
      }
      const foiCancelada = cancelRequested || cancelamentoDo(id) || producao.status === 'cancelada'
      const loteVazio = !criados.length && erros.length > 0
      producao.etapa = undefined; producao.pautaAtual = undefined; producao.midiaJobId = undefined
      producao.historias = historias
      producao.status = foiCancelada ? 'cancelada' : loteVazio ? 'erro' : !criados.length ? 'sem_pauta' : 'concluida'
      producao.mensagem = foiCancelada
        ? 'produção cancelada; nenhuma nova versão foi adicionada após o cancelamento'
        : loteVazio
          ? erros[0].mensagem
          : !criados.length ? 'Nenhuma história atingiu o padrão editorial. Veja o que falta nas pautas avaliadas.' : `${criados.length} versão(ões) revisada(s), a partir de ${historias} história(s).`
      producao.erro = loteVazio
        ? { codigo: erros[0].codigo || 'GERACAO_FALHOU', mensagem: erros[0].mensagem }
        : erros.length ? `${erros.length} versão(ões) falharam; veja erros e histórico` : undefined
      producao.atualizadoEm = agoraIso()
      persistirEstado(); emitir()
    } catch (erro) {
      producao.status = cancelRequested || cancelamentoDo(id) || producao.status === 'cancelada' ? 'cancelada' : 'erro'
      producao.mensagem = erro.message
      producao.erro = { codigo: erro.codigo || 'PRODUCAO_FALHOU', mensagem: erro.message }
      producao.erros = [...(producao.erros || []), producao.erro]
      producao.atualizadoEm = agoraIso()
      registrarHistorico({ tipo: 'lote-falhou', loteId: id, codigo: erro.codigo || 'PRODUCAO_FALHOU', mensagem: erro.message })
      persistirEstado(); emitir()
    } finally {
      if (lock) liberarLock()
      if (cancelamentoDo(id)) { try { fs.unlinkSync(arquivoCancelamento) } catch {} }
    }
  }
  // Espelha uma peça aprovada para revisão em outra conta e/ou idioma. A
  // versão nova é adaptada pelo redator (não uma tradução literal), preserva
  // pauta, fontes e origem, e passa pelo mesmo pipeline de mídia automática.
  async function espelhar(itemId, entrada = {}) {
    const item = await fila.obter(itemId)
    if (!item) throw Object.assign(new Error('item editorial não encontrado'), { codigo: 'NAO_ENCONTRADO' })
    if (item.estado === 'publicando') throw Object.assign(new Error('aguarde a publicação em andamento terminar antes de espelhar'), { codigo: 'ITEM_PUBLICANDO' })
    const contaAlvo = entrada.conta ? String(entrada.conta) : item.conta
    const idiomaAlvo = entrada.idioma ? String(entrada.idioma) : item.idioma === 'pt-BR' ? 'en' : 'pt-BR'
    validarLista([contaAlvo], CONTAS, 'conta')
    validarLista([idiomaAlvo], IDIOMAS, 'idioma')
    if (contaAlvo === item.conta && idiomaAlvo === item.idioma) {
      throw Object.assign(new Error('escolha outra conta ou outro idioma para espelhar'), { codigo: 'ESPELHO_IDENTICO' })
    }
    const existentes = await itensExistentes()
    const duplicada = existentes.find((existente) =>
      existente.pautaId === item.pautaId &&
      existente.conta === contaAlvo &&
      existente.idioma === idiomaAlvo &&
      existente.estado !== 'recusado'
    )
    if (duplicada) {
      throw Object.assign(new Error(`já existe uma versão ${contaAlvo}/${idiomaAlvo} desta pauta (${duplicada.id})`), { codigo: 'ESPELHO_DUPLICADO' })
    }
    // A geração leva minutos; um cliente que estoura o timeout e repete o
    // pedido criava três versões da mesma pauta. A chave fica reservada até o
    // fim, e a repetição recebe 409 em vez de outra peça.
    const chaveEspelho = `${item.pautaId}:${contaAlvo}:${idiomaAlvo}`
    if (espelhosEmAndamento.has(chaveEspelho)) {
      throw Object.assign(new Error(`a versão ${contaAlvo}/${idiomaAlvo} desta pauta já está sendo gerada; aguarde em vez de repetir o pedido`), { codigo: 'ESPELHO_EM_ANDAMENTO', status: 409 })
    }
    espelhosEmAndamento.add(chaveEspelho)
    try {
      return await espelharGerar({ item, contaAlvo, idiomaAlvo, entrada })
    } finally {
      espelhosEmAndamento.delete(chaveEspelho)
    }
  }
  const espelhosEmAndamento = new Set()
  async function espelharGerar({ item, contaAlvo, idiomaAlvo, entrada }) {
    const recorte = [
      `Peça original (${item.conta}, ${item.idioma}):`,
      `Título: ${item.titulo}`,
      `Texto: ${recortar(item.texto, 4_000)}`,
      Array.isArray(item.fontes) && item.fontes.length ? `Fontes: ${item.fontes.map((fonte) => fonte.url ? `${fonte.rotulo} (${fonte.url})` : fonte.rotulo).join('; ')}` : '',
    ].filter(Boolean).join('\n')
    const preferencias = preferenciasRecentes()
    let pautaEditorial = item.editorial?.pauta
    if (!pautaEditorial) {
      const fonteAtual = candidatos(item.origem?.dia || diaSaoPaulo(now())).find(p => p.pautaId === item.pautaId || (item.origem?.projeto && p.origem?.projeto === item.origem.projeto))
      if (!fonteAtual) throw Object.assign(new Error('Esta peça antiga não tem evidências recuperáveis. Gere uma nova história a partir do registro de origem.'), { codigo: 'ESPELHO_SEM_EVIDENCIA' })
      pautaEditorial = await obterRedator().prepararPauta({ titulo: item.titulo, contexto: fonteAtual.briefing, fontes: fonteAtual.fontes, preferencias })
    }
    const resultado = await obterRedator().rascunhar({
      conta: contaAlvo,
      dia: item.origem?.tipo === 'dia' ? item.origem.dia : undefined,
      idioma: idiomaAlvo,
      perfilId: entrada.perfilId || config.perfilId,
      // O espelho usa o mesmo contrato de revisão do lote. Sem propagar este
      // perfil, a redação podia rodar num provedor e a revisão cair no modelo
      // global (ou em um fallback limitado), ignorando a escolha da chamada.
      perfilEditor: entrada.perfilEditor || entrada.perfilId || config.perfilId,
      briefing: [
        `Adapte a peça abaixo para ${contaAlvo} em ${idiomaAlvo}. Não traduza literalmente: reescreva na voz da conta e do idioma, preservando somente os fatos, evidências e fontes já presentes no original.`,
        `Idioma de destino: ${idiomaAlvo}. Conta de destino: ${contaAlvo}.`,
        'Produza apenas campos publicáveis; não transforme plano ou pedido em entrega.',
      ].join('\n'),
      contextoExtra: recorte,
      instrucoesEditorial: skillInstructions(),
      publicavel: true,
      strictJson: true,
      pautaEditorial,
      preferencias,
    })
    if (!resultado?.contextoUsado) throw Object.assign(new Error('o espelho não teve contexto editorial'), { codigo: 'SEM_CONTEXTO_EDITORIAL' })
    const campos = resultado.rascunho || {}
    const conexao = registroAtivo?.obterConexao ? registroAtivo.obterConexao(contaAlvo) : null
    if (conexao?.esquemaPublicacao) {
      const erros = validarCamposPublicacao(conexao.esquemaPublicacao, campos)
      if (erros.length) { const erro = new Error(`campos inválidos antes da fila: ${erros.join('; ')}`); erro.codigo = 'PUBLICACAO_INVALIDA'; throw erro }
    }
    const texto = campos.texto || campos.corpo || ''
    if (!String(texto).trim()) throw Object.assign(new Error(`a versão ${contaAlvo}/${idiomaAlvo} não tem texto publicável`), { codigo: 'PUBLICACAO_INVALIDA' })
    const versao = {
      pautaId: item.pautaId,
      conta: contaAlvo,
      idioma: idiomaAlvo,
      formato: 'texto',
      titulo: String(campos.titulo || item.titulo).trim(),
      texto: String(texto),
      campos,
      midias: [],
      fontes: item.fontes,
      origem: item.origem,
      estado: 'pendente',
      ...(resultado.editorial ? { editorial: resultado.editorial } : {}),
    }
    if (versao.editorial) versao.editorial.qualidade.conteudoHash = hashConteudo(versao)
    const criado = await fila.criar(versao)
    const persistido = criado?.data || criado
    registrarHistorico({ tipo: 'espelho', origemId: item.id, itemId: persistido.id || null, pautaId: item.pautaId, conta: contaAlvo, idioma: idiomaAlvo })
    await dispararMidiaAutomatica(persistido)
    return typeof fila.obter === 'function' ? await fila.obter(persistido.id) : persistido
  }
  function normalizarEntrada(entrada = {}) {
    const dia = String(entrada.dia || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error('dia deve estar em AAAA-MM-DD')
    let pedido = entrada.pedido
    if (pedido != null) {
      if (typeof pedido !== 'object' || Array.isArray(pedido)) throw new Error('pedido deve ser um objeto')
      const tema = String(pedido.tema || '').trim()
      if (!tema || tema.length > 240) throw new Error('pedido.tema é obrigatório e deve ter até 240 caracteres')
      const contexto = String(pedido.contexto || '').trim()
      if (contexto.length > 8000) throw new Error('pedido.contexto excede 8000 caracteres')
      const projeto = String(pedido.projeto || '').trim()
      if (projeto && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(projeto)) throw new Error('pedido.projeto inválido')
      const fontes = Array.isArray(pedido.fontes) ? pedido.fontes : []
      if (fontes.length > 20) throw new Error('pedido.fontes deve ter até 20 itens')
      pedido = { tema, ...(contexto ? { contexto } : {}), ...(projeto ? { projeto } : {}), fontes }
    }
    const quantidade = Number(entrada.quantidade ?? (pedido ? 1 : (entrada.projetos ? new Set(entrada.projetos).size : config.quantidade)))
    const limite = entrada.projetos ? 60 : 20
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > limite) throw new Error(`quantidade deve ser um inteiro entre 1 e ${limite}`)
    return { ...entrada, perfilEditor: entrada.perfilEditor || entrada.perfilId || config.perfilId, dia, quantidade, pedido, contas: validarLista(entrada.contas || config.contas, CONTAS, 'contas'), idiomas: validarLista(entrada.idiomas || config.idiomas, IDIOMAS, 'idiomas') }
  }
  function pacoteConcorrente() {
    sincronizarConfig()
    const disco = lerJson(arquivoEstado, null)
    if (disco?.status === 'executando') producao = disco
    else {
      const lock = lerLock()
      if (lock?.id) producao = { status: 'executando', id: lock.id, mensagem: 'produção em andamento em outro processo' }
    }
    return emitir()
  }
  function iniciar(entrada = {}) {
    recuperarOrfao(); sincronizarConfig(); sincronizarEstado()
    if (activeRun || producao.status === 'executando') return emitir()
    let normalizada
    try { normalizada = normalizarEntrada(entrada) } catch (erro) {
      producao = { status: 'erro', mensagem: erro.message, erro: { codigo: 'ENTRADA_INVALIDA', mensagem: erro.message }, criados: [], erros: [] }
      persistirEstado(); return emitir()
    }
    cancelRequested = false
    const id = `lote-${now()}-${hash(JSON.stringify(normalizada))}`
    if (!adquirirLock(id)) return pacoteConcorrente()
    producao = { status: 'executando', agenda: normalizada.agenda, id, dia: normalizada.dia, criados: [], erros: [], iniciadoEm: agoraIso(), atualizadoEm: agoraIso() }
    persistirEstado(); emitir()
    const token = ++runToken
    const tarefa = executar(normalizada, id, token, lockOwner)
    activeRun = tarefa
    void tarefa.then(() => { if (activeRun === tarefa) activeRun = null }, () => { if (activeRun === tarefa) activeRun = null })
    return emitir()
  }
  function estado() { recuperarOrfao(); sincronizarConfig(); sincronizarEstado(); return emitir() }
  function configurar(entrada = {}) {
    sincronizarConfig()
    const proximo = { ...config, ...entrada }
    validarConfig(proximo)
    const tinhaRotina = Boolean(rotina)
    if (tinhaRotina) { clearIntervalImpl(rotina); rotina = null; rotinaIntervaloMinutos = null }
    config = normalizarConfig(proximo)
    persistirConfig(); emitir()
    if (tinhaRotina || rotinaHabilitada) iniciarRotina()
    return clone(config)
  }
  function cancelar() {
    sincronizarEstado()
    if (producao.status === 'executando') {
      cancelRequested = true
      if (producao.id) gravarJson(arquivoCancelamento, { id: producao.id, ts: agoraIso() })
      if (producao.midiaJobId) jobsMidias?.cancelar?.(producao.midiaJobId)
      producao.status = 'cancelada'
      producao.mensagem = 'cancelamento solicitado; a chamada atual será descartada antes de enfileirar'
      producao.atualizadoEm = agoraIso()
      persistirEstado(); emitir()
    } else if (producao.status === 'cancelada' || producao.status === 'erro') {
      producao.status = 'ociosa'
      producao.mensagem = null
      producao.etapa = null
      producao.erros = []
      producao.atualizadoEm = agoraIso()
      persistirEstado(); emitir()
    }
    return emitir()
  }
  function iniciarRotina() {
    rotinaHabilitada = true
    sincronizarConfig()
    if (rotina) return emitir()
    if (!config.ativa) return emitir()
    const ciclo = async () => {
      sincronizarConfig(); sincronizarEstado()
      if (!config.ativa) {
        if (rotina) clearIntervalImpl(rotina)
        rotina = null
        rotinaIntervaloMinutos = null
        return
      }
      if (!rotina || producao.status === 'executando') return
      if (rotinaIntervaloMinutos !== config.intervaloMinutos) {
        clearIntervalImpl(rotina)
        rotina = null
        rotinaIntervaloMinutos = null
        iniciarRotina()
        return
      }
      try {
        const itens = await itensExistentes()
        const estoque = classificarEstoqueEditorial(itens).ocupado
        if (estoque >= config.estoqueAlvo) return
        const dia = diaSaoPaulo(now())
        const espaco = Math.max(0, config.estoqueAlvo - estoque)
        if (espaco <= 0) return
        iniciar({ dia, quantidade: config.quantidade, limiteVersoes: espaco, contas: config.contas, idiomas: config.idiomas, perfilId: config.perfilId })
      } catch (erro) {
        producao = { ...producao, status: 'erro', mensagem: erro.message, erro: { codigo: 'ROTINA_FALHOU', mensagem: erro.message } }
        persistirEstado(); emitir()
      }
    }
    rotinaIntervaloMinutos = config.intervaloMinutos
    rotina = setIntervalImpl(ciclo, config.intervaloMinutos * 60_000)
    if (typeof rotina.unref === 'function') rotina.unref()
    void ciclo()
    return emitir()
  }
  function parar() {
    if (rotina) clearIntervalImpl(rotina)
    rotina = null
    rotinaIntervaloMinutos = null
    rotinaHabilitada = false
    runToken += 1
    if (producao.status === 'executando') cancelar()
    return emitir()
  }
  recuperarOrfao()
  if (!fs.existsSync(arquivoConfig)) persistirConfig()
  if (!fs.existsSync(arquivoEstado)) persistirEstado()
  return { iniciar, estado, configurar, cancelar, iniciarRotina, parar, espelhar, carregarSkill: skillInstructions }
}

function lerLinha(linha) { try { return JSON.parse(linha) } catch { return null } }
function validarConfig(proximo) {
    if (proximo.quantidade != null && (!Number.isInteger(Number(proximo.quantidade)) || Number(proximo.quantidade) < 1 || Number(proximo.quantidade) > 20)) throw new Error('quantidade deve ser um inteiro entre 1 e 20')
    if (proximo.intervaloMinutos != null && (!Number.isFinite(Number(proximo.intervaloMinutos)) || Number(proximo.intervaloMinutos) < 1)) throw new Error('intervaloMinutos deve ser positivo')
    if (proximo.estoqueAlvo != null && (!Number.isInteger(Number(proximo.estoqueAlvo)) || Number(proximo.estoqueAlvo) < 0)) throw new Error('estoqueAlvo deve ser inteiro não negativo')
  return normalizarConfig(proximo)
}

function normalizarConfig(valor) {
  const entrada = { ...PADRAO, ...(valor || {}) }
  return {
    ativa: entrada.ativa !== false,
    quantidade: Math.max(1, Math.min(20, Number(entrada.quantidade) || PADRAO.quantidade)),
    contas: validarLista(entrada.contas || PADRAO.contas, CONTAS, 'contas'),
    idiomas: validarLista(entrada.idiomas || PADRAO.idiomas, IDIOMAS, 'idiomas'),
    intervaloMinutos: Math.max(1, Number(entrada.intervaloMinutos) || PADRAO.intervaloMinutos),
    estoqueAlvo: Math.max(0, Number.isInteger(Number(entrada.estoqueAlvo)) ? Number(entrada.estoqueAlvo) : PADRAO.estoqueAlvo),
    midiaAutomatica: entrada.midiaAutomatica !== false,
    formatoMidia: entrada.formatoMidia === 'video' ? 'video' : 'imagem',
    ...(entrada.perfilId ? { perfilId: String(entrada.perfilId) } : {}),
  }
}

module.exports = { criarProducaoEditorial, completarComPerfilAtual, normalizarConfig, validarConfig, PADRAO }
