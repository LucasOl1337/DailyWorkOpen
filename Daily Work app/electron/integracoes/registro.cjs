// Registro das conexões externas do DailyWork. Cada conexão declara viewer
// (partição persistente do webview), credencial (cofre cifrado), sinais
// (alimentam o Sumário Diário) e publicação (proposta + confirmação + log).
// O processo principal é o único cliente das APIs; o renderer só vê estados.

const fs = require('node:fs')
const path = require('node:path')
const { criarCofreCredenciais } = require('./credenciais.cjs')
const { criarPropostas } = require('./propostas.cjs')
const { criarConexaoGitHub } = require('./github.cjs')
const { criarConexaoLinkedIn } = require('./linkedin.cjs')
const { criarConexaoReddit } = require('./reddit.cjs')
const { criarConexaoX } = require('./x.cjs')
const { ErroConexao } = require('./comum.cjs')
const { cobertura, criarMensagem, janelaDoDia, mesclarConversas } = require('../sumario/shared.cjs')

const CACHE_SINAIS_MS = 15 * 60 * 1000

function criarRegistroIntegracoes({
  userDataDir,
  dataDir,
  safeStorage = null,
  fetchImpl = globalThis.fetch,
  execFileImpl,
  now = () => Date.now(),
  abrirAutorizacao = null,
  conexoes: conexoesInjetadas,
  versaoApp = '0.5.0',
  habilitarSessoes = false,
  sessoes: sessoesInjetadas = null,
} = {}) {
  if (!userDataDir) throw new Error('registro de integrações sem diretório de dados do usuário')
  const cofre = criarCofreCredenciais({ userDataDir, safeStorage })
  const propostas = criarPropostas({ now })
  const sessoes = sessoesInjetadas || (habilitarSessoes && process.platform === 'linux'
    ? require('../sessoes/hub.cjs').criarHubSessoes({ dataDir, now }) : null)
  const sessaoPara = (id) => sessoes?.para ? sessoes.para(id) : id === 'linkedin' ? sessoes : null
  const dependencias = { cofre, fetchImpl, now, abrirAutorizacao, execFileImpl, versaoApp, dataDir }
  const lista = conexoesInjetadas || [
    criarConexaoGitHub(dependencias),
    criarConexaoLinkedIn(dependencias),
    criarConexaoX(dependencias),
    criarConexaoReddit(dependencias),
  ]
  const conexoes = new Map(lista.map((conexao) => [conexao.id, conexao]))
  const cacheSinais = new Map()

  function auditar(registro) {
    if (!dataDir) return
    try {
      fs.mkdirSync(dataDir, { recursive: true })
      fs.appendFileSync(path.join(dataDir, '_log.ndjson'), `${JSON.stringify({ ts: new Date(now()).toISOString(), ...registro })}\n`, 'utf8')
    } catch {
      // auditoria nunca derruba a publicação
    }
  }

  function obterConexao(id) {
    const conexao = conexoes.get(String(id || ''))
    if (!conexao) throw new ErroConexao('CONEXAO_DESCONHECIDA', `Conexão desconhecida: ${id}`, 404)
    return conexao
  }

  function descrever(conexao) {
    return {
      id: conexao.id,
      nome: conexao.nome,
      dominio: conexao.dominio,
      dominiosSessao: conexao.dominiosSessao || [conexao.dominio],
      urlInicial: conexao.urlInicial,
      partition: conexao.partition,
      capacidades: sessaoPara(conexao.id)?.estado().transporte === 'sessao_visual'
        ? { ...conexao.capacidades, midia: {
            imagem: sessaoPara(conexao.id).estado().capacidades.publicarImagem,
            video: sessaoPara(conexao.id).estado().capacidades.publicarVideo,
          } } : conexao.capacidades,
      esquemaConfiguracao: conexao.esquemaConfiguracao,
      esquemaPublicacao: conexao.esquemaPublicacao,
      orientacaoRedacao: conexao.orientacaoRedacao || '',
    }
  }

  async function listar({ comStatus = true } = {}) {
    return Promise.all([...conexoes.values()].map(async (conexao) => ({
      ...descrever(conexao),
      status: comStatus ? await conexao.status() : null,
      visual: sessaoPara(conexao.id) ? await sessaoPara(conexao.id).obterEstado() : null,
    })))
  }

  async function status(id) {
    const conexao = obterConexao(id)
    return { ...descrever(conexao), status: await conexao.status(), visual: sessaoPara(id) ? await sessaoPara(id).obterEstado() : null }
  }

  async function configurar(id, entrada) {
    const conexao = obterConexao(id)
    const resultado = await conexao.configurar(entrada || {})
    cacheSinais.clear()
    auditar({ acao: 'integracoes:configurar', conta: id })
    return { ...descrever(conexao), status: resultado }
  }

  async function desconectar(id) {
    const conexao = obterConexao(id)
    const resultado = await conexao.desconectar()
    cacheSinais.clear()
    auditar({ acao: 'integracoes:desconectar', conta: id })
    return { ...descrever(conexao), status: resultado }
  }

  async function autorizar(id) {
    const conexao = obterConexao(id)
    if (typeof conexao.autorizar !== 'function') throw new ErroConexao('SEM_OAUTH', `${conexao.nome} não usa autorização no navegador.`)
    return conexao.autorizar()
  }

  async function perfil(id) {
    const sessao = sessaoPara(id)
    if (sessao?.estado().transporte === 'sessao_visual') {
      const r = await sessao.consultar()
      if (!r.contaVerificada) throw new ErroConexao('LOGIN_NECESSARIO', 'Verifique a sessão da bancada.')
      return { login: r.contaVerificada.nome, nome: r.contaVerificada.nome, url: r.contaVerificada.perfilUrl, bio: r.texto, avatar: null, cobertura: r.cobertura }
    }
    return obterConexao(id).perfil()
  }

  async function sinais(id, dia, { forcar = false } = {}) {
    const conexao = obterConexao(id)
    const janela = janelaDoDia(dia)
    const chave = `${id}:${dia}`
    const cache = cacheSinais.get(chave)
    if (!forcar && cache && now() - cache.em < CACHE_SINAIS_MS) return cache.valor
    const resultado = await conexao.sinais(janela)
    const valor = { conta: conexao.id, nome: conexao.nome, dia, ...resultado, coletadoEm: new Date(now()).toISOString() }
    cacheSinais.set(chave, { em: now(), valor })
    return valor
  }

  async function prepararPublicacao(id, entrada) {
    const sessao = sessaoPara(id)
    if (sessao?.estado().transporte === 'sessao_visual') return sessao.preparar(entrada)
    const conexao = obterConexao(id)
    if (!conexao.capacidades?.publicar) throw new ErroConexao('SEM_PUBLICACAO', `${conexao.nome} não permite publicar pelo DailyWork.`)
    const preparada = await conexao.prepararPublicacao(entrada || {})
    return propostas.criar({ conta: conexao.id, tipo: preparada.tipo, resumo: preparada.resumo, payload: preparada.payload, preview: preparada.preview })
  }

  async function confirmarPublicacao({ proposalId } = {}) {
    if (String(proposalId).startsWith('sv-') && sessoes) return sessoes.confirmar({ proposalId })
    const proposta = propostas.consumir(proposalId)
    const conexao = obterConexao(proposta.conta)
    try {
      const resultado = await conexao.publicar(proposta.payload)
      const recibo = {
        conta: conexao.id,
        nome: conexao.nome,
        tipo: proposta.tipo,
        resumo: proposta.resumo,
        id: resultado.id || null,
        url: resultado.url || null,
        hash: proposta.hash,
        publishedAt: new Date(now()).toISOString(),
      }
      auditar({ acao: 'integracoes:publicar', conta: conexao.id, tipo: proposta.tipo, hash: proposta.hash, id: recibo.id, url: recibo.url })
      cacheSinais.clear()
      return recibo
    } catch (erro) {
      auditar({ acao: 'integracoes:publicar-falhou', conta: conexao.id, tipo: proposta.tipo, hash: proposta.hash, erro: String(erro.message || erro) })
      throw erro
    }
  }

  function cancelarPublicacao({ proposalId } = {}) {
    if (String(proposalId).startsWith('sv-') && sessoes) return sessoes.cancelarProposta(proposalId)
    return { cancelada: propostas.cancelar(proposalId) }
  }

  function propostasPendentes() {
    return propostas.listar()
  }

  // Fontes do Sumário Diário: uma por conexão que expõe sinais. Cada item vira
  // uma mensagem de autoria humana, com proveniência verificável na URL.
  function fontesSumario() {
    return [...conexoes.values()]
      .filter((conexao) => conexao.capacidades?.sinais)
      .map((conexao) => {
        const coletar = async (ctx) => {
          const estado = await conexao.status()
          if (!estado.configured) {
            return { conversations: [], coverage: cobertura({ id: conexao.id, label: conexao.nome, discovered: false, conversations: [] }) }
          }
          const erros = []
          let itens = []
          try {
            const resultado = await sinais(conexao.id, ctx.janela.dia)
            itens = resultado.itens
            erros.push(...(resultado.erros || []))
          } catch (erro) {
            erros.push(String(erro.message || erro))
          }
          const conversas = itens.length
            ? mesclarConversas([{
                id: `${conexao.id}:${ctx.janela.dia}`,
                source: conexao.id,
                app: conexao.nome,
                title: `${conexao.nome} · ${estado.conta?.login || conexao.dominio}`,
                cwd: null,
                sourcePath: conexao.dominio,
                messages: itens.map((item) => criarMensagem({
                  source: conexao.id,
                  conversationId: `${conexao.id}:${ctx.janela.dia}`,
                  recordId: item.id,
                  timestamp: item.timestamp,
                  role: 'user',
                  kind: 'message',
                  text: item.texto || item.titulo,
                  content: { tipo: item.tipo, titulo: item.titulo, url: item.url },
                  provenance: { url: item.url, tipo: item.tipo, conta: estado.conta?.login || null },
                })),
              }])
            : []
          return {
            conversations: conversas,
            coverage: cobertura({
              id: conexao.id,
              label: conexao.nome,
              discovered: true,
              conversations: conversas,
              records: itens.length,
              errors: erros,
              notes: [`Atividade pública e privada da conta ${estado.conta?.login || ''} lida pela API oficial; credenciais ficam no cofre cifrado.`],
            }),
          }
        }
        Object.defineProperty(coletar, 'name', { value: `coletar${conexao.nome.replace(/\W/g, '')}` })
        return coletar
      })
  }

  return {
    sessoes,
    async sessaoVisual(acao, entrada = {}) {
      if (!sessoes) throw new ErroConexao('SESSAO_INDISPONIVEL', 'Sessões visuais indisponíveis neste ambiente.')
      const conta = entrada.conta === 'x' ? 'x' : 'linkedin'
      const sessao = sessaoPara(conta)
      if (!sessao) throw new ErroConexao('SESSAO_INDISPONIVEL', `Sessão visual de ${conta} indisponível.`)
      const metodos = { estado: () => sessao.obterEstado(), verificar: () => sessao.verificar(), vincular: () => sessao.vincular(entrada), importar: () => sessao.importar(), perfil: () => sessao.consultar(), jobs: () => sessao.listarJobs(), job: () => sessoes.obterJob(entrada.jobId), cancelar: () => sessoes.cancelar(entrada.jobId) }
      if (!Object.hasOwn(metodos, acao)) throw new ErroConexao('ACAO_INVALIDA', 'Operação de sessão desconhecida.')
      return metodos[acao]()
    },
    listar,
    status,
    configurar,
    desconectar,
    autorizar,
    perfil,
    sinais,
    prepararPublicacao,
    confirmarPublicacao,
    cancelarPublicacao,
    propostasPendentes,
    fontesSumario,
    obterConexao,
    ids: () => [...conexoes.keys()],
    partitions: () => [...conexoes.values()].map((conexao) => conexao.partition),
    cofre,
  }
}

module.exports = { criarRegistroIntegracoes, ErroConexao }
