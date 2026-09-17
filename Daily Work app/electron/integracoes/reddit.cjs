// Conexão Reddit. App do tipo "script" com credenciais no cofre; o token de
// acesso é obtido pelo processo principal e nunca sai dele. Leitura: perfil,
// posts e comentários do dia. Escrita: post e comentário por proposta.

const { ErroConexao, dentroDaJanela, ordenarSinais, requisitar, sinal, textoLimitado, validarCampos } = require('./comum.cjs')

const URL_TOKEN = 'https://www.reddit.com/api/v1/access_token'
const API = 'https://oauth.reddit.com'

const ESQUEMA_CONFIGURACAO = Object.freeze([
  { campo: 'clientId', rotulo: 'Client ID do app (tipo script)', tipo: 'text', ajuda: 'Crie em reddit.com/prefs/apps um app "script" para uso pessoal.' },
  { campo: 'clientSecret', rotulo: 'Client secret', tipo: 'password' },
  { campo: 'username', rotulo: 'Usuário', tipo: 'text' },
  { campo: 'password', rotulo: 'Senha', tipo: 'password', ajuda: 'Com verificação em duas etapas, use senha:código.' },
])

const ESQUEMA_PUBLICACAO = Object.freeze([
  {
    campo: 'tipo',
    rotulo: 'Tipo',
    tipo: 'select',
    opcoes: [
      { valor: 'post', rotulo: 'Post de texto' },
      { valor: 'link', rotulo: 'Post de link' },
      { valor: 'comentario', rotulo: 'Comentário' },
    ],
  },
  { campo: 'subreddit', rotulo: 'Subreddit', tipo: 'text', opcional: true, max: 40, padrao_regex: '^[A-Za-z0-9_]+$' },
  { campo: 'titulo', rotulo: 'Título', tipo: 'text', opcional: true, max: 300 },
  { campo: 'texto', rotulo: 'Texto (markdown)', tipo: 'textarea', opcional: true, max: 40_000 },
  { campo: 'url', rotulo: 'URL do link', tipo: 'text', opcional: true, max: 2_000 },
  { campo: 'alvo', rotulo: 'Alvo do comentário (t3_... ou t1_...)', tipo: 'text', opcional: true, max: 30, padrao_regex: '^t[13]_[a-z0-9]+$' },
])

function criarConexaoReddit({ cofre, fetchImpl = fetch, now = () => Date.now(), versaoApp = '0.5.0' }) {
  const id = 'reddit'
  let tokenCache = { token: null, expiraEm: 0, username: null }

  function userAgent(username) {
    return `${process.platform}:dailywork:v${versaoApp} (by /u/${username || 'dailywork'})`
  }

  async function dados() {
    return (await cofre.ler(id)) || null
  }

  async function token() {
    const salvo = await dados()
    if (!salvo?.clientId || !salvo.clientSecret || !salvo.username || !salvo.password) {
      throw new ErroConexao('NAO_CONFIGURADA', 'Reddit não conectado: salve as credenciais do app script.', 401)
    }
    if (tokenCache.token && tokenCache.username === salvo.username && now() < tokenCache.expiraEm - 60_000) return tokenCache
    const resposta = await requisitar(fetchImpl, URL_TOKEN, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${salvo.clientId}:${salvo.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent(salvo.username),
      },
      body: new URLSearchParams({ grant_type: 'password', username: salvo.username, password: salvo.password }).toString(),
    })
    if (!resposta.ok || !resposta.corpo?.access_token) {
      throw new ErroConexao('CREDENCIAL_INVALIDA', resposta.corpo?.error_description || resposta.corpo?.error || `Reddit recusou as credenciais (${resposta.status})`, 401)
    }
    tokenCache = {
      token: resposta.corpo.access_token,
      expiraEm: now() + Number(resposta.corpo.expires_in || 3600) * 1000,
      username: salvo.username,
    }
    return tokenCache
  }

  async function api(caminho, init = {}) {
    const atual = await token()
    const resposta = await requisitar(fetchImpl, `${API}${caminho}`, {
      ...init,
      headers: { Authorization: `bearer ${atual.token}`, 'User-Agent': userAgent(atual.username), ...(init.headers || {}) },
    })
    if (!resposta.ok) {
      throw new ErroConexao(resposta.status === 401 ? 'CREDENCIAL_INVALIDA' : 'FALHA_REDDIT', resposta.corpo?.message || `Reddit respondeu ${resposta.status}`, resposta.status)
    }
    return resposta
  }

  async function status() {
    const salvo = await dados()
    const configured = Boolean(salvo?.clientId && salvo.clientSecret && salvo.username && salvo.password)
    const base = { id, configured, origemCredencial: configured ? 'script-app' : null, online: false, conta: null, error: null }
    if (!configured) return base
    try {
      const { corpo } = await api('/api/v1/me')
      return {
        ...base,
        online: true,
        conta: { login: corpo.name, nome: corpo.subreddit?.title || corpo.name, url: `https://www.reddit.com/user/${corpo.name}`, avatar: String(corpo.icon_img || '').split('?')[0] || null },
      }
    } catch (erro) {
      return { ...base, error: erro.message }
    }
  }

  async function configurar(entrada) {
    const atual = (await dados()) || {}
    const novo = { ...atual }
    for (const campo of ESQUEMA_CONFIGURACAO) {
      const valor = textoLimitado(entrada?.[campo.campo], 400)
      if (valor) novo[campo.campo] = valor
    }
    for (const campo of ESQUEMA_CONFIGURACAO) {
      if (!novo[campo.campo]) throw new ErroConexao('CAMPO_OBRIGATORIO', `${campo.rotulo} é obrigatório.`)
    }
    await cofre.guardar(id, novo)
    tokenCache = { token: null, expiraEm: 0, username: null }
    return status()
  }

  async function desconectar() {
    await cofre.remover(id)
    tokenCache = { token: null, expiraEm: 0, username: null }
    return status()
  }

  async function perfil() {
    const { corpo } = await api('/api/v1/me')
    return {
      login: corpo.name,
      nome: corpo.subreddit?.title || corpo.name,
      bio: corpo.subreddit?.public_description || '',
      url: `https://www.reddit.com/user/${corpo.name}`,
      avatar: String(corpo.icon_img || '').split('?')[0] || null,
      karma: corpo.total_karma ?? null,
      karmaLinks: corpo.link_karma ?? null,
      karmaComentarios: corpo.comment_karma ?? null,
    }
  }

  async function sinais(janela) {
    const atual = await token()
    const itens = []
    const erros = []
    const nome = encodeURIComponent(atual.username)
    for (const [rota, tipo] of [[`/user/${nome}/submitted?limit=100&sort=new`, 'post'], [`/user/${nome}/comments?limit=100&sort=new`, 'comentario']]) {
      try {
        const { corpo } = await api(rota)
        for (const filho of corpo?.data?.children || []) {
          const item = filho?.data || {}
          if (!dentroDaJanela(Number(item.created_utc) * 1000, janela)) continue
          itens.push(sinal({
            id: item.name || item.id,
            timestamp: Number(item.created_utc) * 1000,
            tipo,
            titulo: tipo === 'post' ? `r/${item.subreddit}: ${item.title || ''}` : `r/${item.subreddit}: ${item.link_title || 'comentário'}`,
            texto: tipo === 'post' ? item.selftext || item.url || '' : item.body || '',
            url: item.permalink ? `https://www.reddit.com${item.permalink}` : null,
            extra: { pontuacao: item.score ?? null },
          }))
        }
      } catch (erro) {
        erros.push(erro.message)
      }
    }
    return { itens: ordenarSinais(itens), erros, conta: atual.username }
  }

  async function prepararPublicacao(entrada) {
    const campos = validarCampos(ESQUEMA_PUBLICACAO, entrada)
    if (campos.tipo === 'comentario') {
      if (!campos.alvo || !campos.texto) throw new ErroConexao('CAMPO_OBRIGATORIO', 'Comentário precisa de alvo e texto.')
      return {
        tipo: 'comentario',
        resumo: `Comentar em ${campos.alvo} no Reddit`,
        payload: { tipo: 'comentario', alvo: campos.alvo, texto: campos.texto },
        preview: { titulo: `Comentário em ${campos.alvo}`, corpo: campos.texto, destino: 'reddit.com' },
      }
    }
    if (!campos.subreddit || !campos.titulo) throw new ErroConexao('CAMPO_OBRIGATORIO', 'Subreddit e título são obrigatórios.')
    if (campos.tipo === 'link' && !/^https?:\/\//.test(campos.url || '')) throw new ErroConexao('CAMPO_INVALIDO', 'Post de link precisa de uma URL http(s).')
    if (campos.tipo === 'post' && !campos.texto) throw new ErroConexao('CAMPO_OBRIGATORIO', 'Post de texto precisa de texto.')
    return {
      tipo: campos.tipo,
      resumo: `Publicar em r/${campos.subreddit}: ${campos.titulo}`,
      payload: { tipo: campos.tipo, subreddit: campos.subreddit, titulo: campos.titulo, texto: campos.texto || '', url: campos.url || '' },
      preview: { titulo: campos.titulo, corpo: campos.tipo === 'link' ? campos.url : campos.texto, destino: `reddit.com/r/${campos.subreddit}` },
    }
  }

  function errosDaResposta(corpo) {
    const erros = corpo?.json?.errors
    if (Array.isArray(erros) && erros.length) return erros.map((erro) => (Array.isArray(erro) ? erro.slice(0, 2).join(': ') : String(erro))).join('; ')
    return null
  }

  async function publicar(payload) {
    if (payload.tipo === 'comentario') {
      const { corpo } = await api('/api/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ api_type: 'json', thing_id: payload.alvo, text: payload.texto }).toString(),
      })
      const erro = errosDaResposta(corpo)
      if (erro) throw new ErroConexao('FALHA_REDDIT', erro, 400)
      const coisa = corpo?.json?.data?.things?.[0]?.data || {}
      return { id: String(coisa.name || ''), url: coisa.permalink ? `https://www.reddit.com${coisa.permalink}` : null }
    }
    const formulario = { api_type: 'json', sr: payload.subreddit, kind: payload.tipo === 'link' ? 'link' : 'self', title: payload.titulo, resubmit: 'true' }
    if (payload.tipo === 'link') formulario.url = payload.url
    else formulario.text = payload.texto
    const { corpo } = await api('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(formulario).toString(),
    })
    const erro = errosDaResposta(corpo)
    if (erro) throw new ErroConexao('FALHA_REDDIT', erro, 400)
    return { id: String(corpo?.json?.data?.name || ''), url: corpo?.json?.data?.url || null }
  }

  return {
    id,
    nome: 'Reddit',
    dominio: 'reddit.com',
    dominiosSessao: ['reddit.com'],
    urlInicial: 'https://www.reddit.com/',
    partition: 'persist:conexao-reddit',
    capacidades: { ler: true, publicar: true, sinais: true, oauth: false },
    esquemaConfiguracao: ESQUEMA_CONFIGURACAO,
    esquemaPublicacao: ESQUEMA_PUBLICACAO,
    orientacaoRedacao: 'Título específico e honesto, corpo em markdown com contexto, o que foi feito e uma pergunta ou pedido claro; respeite o tom do subreddit.',
    status,
    configurar,
    desconectar,
    perfil,
    sinais,
    prepararPublicacao,
    publicar,
  }
}

module.exports = { criarConexaoReddit }
