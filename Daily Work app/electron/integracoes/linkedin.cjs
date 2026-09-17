// Conexão LinkedIn. Autorização OAuth 2.0 (OpenID Connect + Share on
// LinkedIn) ou token de acesso colado. Leitura: identidade via userinfo.
// A API pessoal não expõe feed nem histórico, então não há sinais do dia.
// Escrita: post no perfil, sempre por proposta confirmada.

const { ErroConexao, contarCaracteres, requisitar, textoLimitado, validarCampos, validarMidiaLocal, lerMidiaLocal } = require('./comum.cjs')
const { aguardarCallback, gerarEstado, montarUrl } = require('./oauth.cjs')

const URL_AUTORIZACAO = 'https://www.linkedin.com/oauth/v2/authorization'
const URL_TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken'
const URL_USERINFO = 'https://api.linkedin.com/v2/userinfo'
const URL_POSTS = 'https://api.linkedin.com/rest/posts'
const URL_IMAGES = 'https://api.linkedin.com/rest/images?action=initializeUpload'
const URL_VIDEOS = 'https://api.linkedin.com/rest/videos?action=initializeUpload'
const URL_VIDEOS_FINALIZE = 'https://api.linkedin.com/rest/videos?action=finalizeUpload'
const ESCOPOS = 'openid profile email w_member_social'
const PORTA_CALLBACK = 47831
const REDIRECT_PADRAO = `http://localhost:${PORTA_CALLBACK}/callback`
const LIMITE_POST = 3000

const ESQUEMA_CONFIGURACAO = Object.freeze([
  { campo: 'clientId', rotulo: 'Client ID do app', tipo: 'text', opcional: true, ajuda: `App no LinkedIn Developers com os produtos "Sign In with LinkedIn using OpenID Connect" e "Share on LinkedIn", redirect ${REDIRECT_PADRAO}.` },
  { campo: 'clientSecret', rotulo: 'Client secret', tipo: 'password', opcional: true },
  { campo: 'accessToken', rotulo: 'Token de acesso (alternativa ao OAuth)', tipo: 'password', opcional: true, ajuda: 'Gere no OAuth token tool do portal de desenvolvedores se preferir não autorizar pelo DailyWork.' },
])

const ESQUEMA_PUBLICACAO = Object.freeze([
  { campo: 'texto', rotulo: 'Texto do post', tipo: 'textarea', max: LIMITE_POST },
  {
    campo: 'visibilidade',
    rotulo: 'Visibilidade',
    tipo: 'select',
    opcional: true,
    padrao: 'PUBLIC',
    opcoes: [
      { valor: 'PUBLIC', rotulo: 'Pública' },
      { valor: 'CONNECTIONS', rotulo: 'Somente conexões' },
    ],
  },
  { campo: 'linkUrl', rotulo: 'Link em destaque (opcional)', tipo: 'text', opcional: true, max: 2_000 },
  { campo: 'linkTitulo', rotulo: 'Título do link', tipo: 'text', opcional: true, max: 200 },
])

function versaoApi(agoraMs) {
  const data = new Date(agoraMs)
  data.setUTCMonth(data.getUTCMonth() - 2)
  return `${data.getUTCFullYear()}${String(data.getUTCMonth() + 1).padStart(2, '0')}`
}

// O campo commentary usa o "little text format": estes caracteres precisam
// de escape para não serem interpretados como formatação.
function escaparComentario(texto) {
  return String(texto).replace(/([\\|{}@\[\]()<>#*_~])/g, '\\$1')
}

function criarConexaoLinkedIn({ cofre, fetchImpl = fetch, now = () => Date.now(), abrirAutorizacao = null, dataDir = null, redirectUri = REDIRECT_PADRAO }) {
  const id = 'linkedin'
  let autorizacao = { estado: 'ociosa', erro: null, url: null }

  async function dadosSalvos() {
    return (await cofre.ler(id)) || null
  }

  async function tokenValido() {
    const dados = await dadosSalvos()
    if (!dados?.accessToken) throw new ErroConexao('NAO_CONFIGURADA', 'LinkedIn não conectado: autorize o app ou cole um token de acesso.', 401)
    if (dados.expiraEm && now() > dados.expiraEm) throw new ErroConexao('CREDENCIAL_EXPIRADA', 'O token do LinkedIn expirou. Autorize de novo.', 401)
    return dados
  }

  async function api(url, init = {}) {
    const dados = await tokenValido()
    const resposta = await requisitar(fetchImpl, url, {
      ...init,
      headers: {
        Authorization: `Bearer ${dados.accessToken}`,
        'User-Agent': 'DailyWork',
        'LinkedIn-Version': versaoApi(now()),
        'X-Restli-Protocol-Version': '2.0.0',
        ...(init.headers || {}),
      },
    })
    if (!resposta.ok) {
      const mensagem = resposta.corpo?.message || resposta.corpo?.error_description || `LinkedIn respondeu ${resposta.status}`
      throw new ErroConexao(resposta.status === 401 ? 'CREDENCIAL_INVALIDA' : 'FALHA_LINKEDIN', mensagem, resposta.status)
    }
    return resposta
  }

  async function identidade() {
    const dados = await tokenValido()
    if (dados.pessoa?.sub) return dados.pessoa
    const { corpo } = await api(URL_USERINFO)
    const pessoa = { sub: corpo.sub, nome: corpo.name || `${corpo.given_name || ''} ${corpo.family_name || ''}`.trim(), avatar: corpo.picture || null, email: corpo.email || null }
    await cofre.guardar(id, { ...dados, pessoa })
    return pessoa
  }

  async function status() {
    const dados = await dadosSalvos()
    const configured = Boolean(dados?.accessToken)
    const base = {
      id,
      configured,
      origemCredencial: dados?.accessToken ? (dados.viaOauth ? 'oauth' : 'token') : dados?.clientId ? 'app-sem-autorizacao' : null,
      online: false,
      conta: null,
      error: null,
      expiraEm: dados?.expiraEm ? new Date(dados.expiraEm).toISOString() : null,
      autorizacao: { estado: autorizacao.estado, erro: autorizacao.erro, url: autorizacao.url },
    }
    if (!configured) return base
    try {
      const pessoa = await identidade()
      return { ...base, online: true, conta: { login: pessoa.sub, nome: pessoa.nome, url: 'https://www.linkedin.com/in/me/', avatar: pessoa.avatar } }
    } catch (erro) {
      return { ...base, error: erro.message }
    }
  }

  async function configurar(entrada) {
    const atual = (await dadosSalvos()) || {}
    const dados = { ...atual }
    const clientId = textoLimitado(entrada?.clientId, 200)
    const clientSecret = textoLimitado(entrada?.clientSecret, 400)
    const accessToken = textoLimitado(entrada?.accessToken, 4_000)
    if (clientId) dados.clientId = clientId
    if (clientSecret) dados.clientSecret = clientSecret
    if (accessToken) {
      dados.accessToken = accessToken
      dados.viaOauth = false
      dados.expiraEm = now() + 60 * 24 * 60 * 60 * 1000
      delete dados.pessoa
    }
    if (!dados.clientId && !dados.accessToken) throw new ErroConexao('CAMPO_OBRIGATORIO', 'Informe o Client ID do app ou um token de acesso.')
    await cofre.guardar(id, dados)
    return status()
  }

  async function desconectar() {
    await cofre.remover(id)
    autorizacao = { estado: 'ociosa', erro: null, url: null }
    return status()
  }

  async function autorizar() {
    const dados = await dadosSalvos()
    if (!dados?.clientId || !dados.clientSecret) throw new ErroConexao('CAMPO_OBRIGATORIO', 'Salve Client ID e Client secret antes de autorizar.')
    if (autorizacao.estado === 'aguardando') return { url: autorizacao.url, estado: 'aguardando' }
    const estado = gerarEstado()
    const redirectUriEfetivo = dados.redirectUri || redirectUri
    const url = montarUrl(URL_AUTORIZACAO, {
      response_type: 'code',
      client_id: dados.clientId,
      redirect_uri: redirectUriEfetivo,
      state: estado,
      scope: ESCOPOS,
    })
    autorizacao = { estado: 'aguardando', erro: null, url }
    const retorno = aguardarCallback({ porta: Number(new URL(redirectUriEfetivo).port), caminho: new URL(redirectUriEfetivo).pathname, estado })
    const janela = abrirAutorizacao ? await abrirAutorizacao({ id, url, partition: 'persist:conexao-linkedin' }) : null
    ;(async () => {
      try {
        const { code } = await retorno
        const resposta = await requisitar(fetchImpl, URL_TOKEN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: dados.clientId,
            client_secret: dados.clientSecret,
            redirect_uri: redirectUriEfetivo,
          }).toString(),
        })
        if (!resposta.ok) throw new Error(resposta.corpo?.error_description || resposta.corpo?.error || `troca de código falhou (${resposta.status})`)
        await cofre.guardar(id, {
          ...dados,
          accessToken: resposta.corpo.access_token,
          refreshToken: resposta.corpo.refresh_token || null,
          expiraEm: now() + Number(resposta.corpo.expires_in || 5184000) * 1000,
          viaOauth: true,
          pessoa: null,
        })
        autorizacao = { estado: 'concluida', erro: null, url: null }
      } catch (erro) {
        autorizacao = { estado: 'falhou', erro: erro.message, url: null }
      } finally {
        janela?.fechar?.()
      }
    })()
    return { url, estado: 'aguardando' }
  }

  async function perfil() {
    const pessoa = await identidade()
    const dados = await dadosSalvos()
    return {
      login: pessoa.sub,
      nome: pessoa.nome,
      bio: '',
      url: 'https://www.linkedin.com/in/me/',
      avatar: pessoa.avatar,
      email: pessoa.email,
      tokenExpiraEm: dados?.expiraEm ? new Date(dados.expiraEm).toISOString() : null,
    }
  }

  async function sinais() {
    return { itens: [], erros: [], conta: null, indisponivel: 'A API pessoal do LinkedIn não expõe o feed nem o histórico de posts.' }
  }

  async function prepararPublicacao(entrada) {
    const campos = validarCampos(ESQUEMA_PUBLICACAO, entrada)
    if (contarCaracteres(campos.texto) > LIMITE_POST) throw new ErroConexao('CAMPO_LONGO', `O post excede ${LIMITE_POST} caracteres.`)
    if (campos.linkUrl && !/^https?:\/\//.test(campos.linkUrl)) throw new ErroConexao('CAMPO_INVALIDO', 'O link em destaque precisa ser http(s).')
    const visibilidade = campos.visibilidade || 'PUBLIC'
    const midias = Array.isArray(entrada?.midias) ? entrada.midias : []
    if (midias.length > 1) throw new ErroConexao('MIDIA_NAO_SUPORTADA', 'LinkedIn aceita uma imagem ou vídeo por post neste conector.')
    if (midias.length && campos.linkUrl) throw new ErroConexao('COMBINACAO_NAO_SUPORTADA', 'LinkedIn não combina mídia e artigo no mesmo post neste conector.')
    const midia = midias.length ? await validarMidiaLocal(midias[0], { dataDir, maxBytes: midias[0].tipo === 'video' ? 512 * 1024 * 1024 : 20 * 1024 * 1024, tipos: ['imagem', 'video'], mimes: midias[0].tipo === 'video' ? ['video/mp4'] : ['image/jpeg', 'image/png'] }) : null
    return {
      tipo: 'post',
      resumo: `Publicar post ${visibilidade === 'PUBLIC' ? 'público' : 'para conexões'} no LinkedIn`,
      payload: { texto: campos.texto, visibilidade, linkUrl: campos.linkUrl || null, linkTitulo: campos.linkTitulo || null, midia },
      preview: { titulo: `Post no LinkedIn (${visibilidade === 'PUBLIC' ? 'público' : 'conexões'})`, corpo: campos.linkUrl ? `${campos.texto}\n\n${campos.linkUrl}` : campos.texto, destino: 'linkedin.com/in/me' },
    }
  }

  async function publicar(payload) {
    const pessoa = await identidade()
    const corpoPedido = {
      author: `urn:li:person:${pessoa.sub}`,
      commentary: escaparComentario(payload.texto),
      visibility: payload.visibilidade,
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }
    if (payload.midia) {
      const midia = await lerMidiaLocal(payload.midia, { dataDir, maxBytes: payload.midia.tipo === 'video' ? 512 * 1024 * 1024 : 20 * 1024 * 1024, tipos: ['imagem', 'video'], mimes: payload.midia.tipo === 'video' ? ['video/mp4'] : ['image/jpeg', 'image/png'] })
      let urn
      if (midia.tipo === 'imagem') urn = await enviarImagem(midia, `urn:li:person:${pessoa.sub}`)
      else urn = await enviarVideo(midia, `urn:li:person:${pessoa.sub}`)
      corpoPedido.content = { media: { id: urn, ...(payload.midia.altText ? { altText: String(payload.midia.altText).slice(0, 4096) } : {}) } }
    } else if (payload.linkUrl) corpoPedido.content = { article: { source: payload.linkUrl, title: payload.linkTitulo || payload.linkUrl } }
    const resposta = await api(URL_POSTS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'LinkedIn-Version': versaoApi(now()),
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(corpoPedido),
    })
    const urn = resposta.headers?.get?.('x-restli-id') || resposta.corpo?.id || ''
    return { id: String(urn), url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : 'https://www.linkedin.com/in/me/recent-activity/all/' }
  }

  async function enviarImagem(midia, owner) {
    const inicial = await api(URL_IMAGES, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initializeUploadRequest: { owner } }) })
    const valor = inicial.corpo?.value
    if (!valor?.uploadUrl || !valor.image) throw new ErroConexao('UPLOAD_LINKEDIN_INVALIDO', 'LinkedIn não devolveu o upload de imagem.', 502)
    const resposta = await fetchImpl(valor.uploadUrl, { method: 'PUT', headers: { 'Content-Type': midia.mime }, body: midia.dados })
    if (!resposta?.ok) throw new ErroConexao('UPLOAD_LINKEDIN_FALHOU', `Upload de imagem recusado (${resposta?.status || 0}).`, resposta?.status || 502)
    return valor.image
  }

  async function enviarVideo(midia, owner) {
    const inicial = await api(URL_VIDEOS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: midia.tamanho, uploadCaptions: false, uploadThumbnail: false } }) })
    const valor = inicial.corpo?.value
    if (!valor?.video || !Array.isArray(valor.uploadInstructions) || !valor.uploadInstructions.length) throw new ErroConexao('UPLOAD_LINKEDIN_INVALIDO', 'LinkedIn não devolveu instruções de upload de vídeo.', 502)
    const partes = []
    for (const instrucao of valor.uploadInstructions) {
      const inicio = Number(instrucao.firstByte || 0); const fim = Number(instrucao.lastByte ?? midia.dados.length - 1)
      const resposta = await fetchImpl(instrucao.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${inicio}-${fim}/${midia.dados.length}` }, body: midia.dados.subarray(inicio, fim + 1) })
      if (!resposta?.ok) throw new ErroConexao('UPLOAD_LINKEDIN_FALHOU', `Upload de vídeo recusado (${resposta?.status || 0}).`, resposta?.status || 502)
      const etag = resposta.headers?.get?.('etag') || resposta.headers?.get?.('ETag')
      if (!etag) throw new ErroConexao('UPLOAD_LINKEDIN_INVALIDO', 'LinkedIn não devolveu ETag de uma parte do vídeo.', 502)
      partes.push(String(etag).replace(/^"|"$/g, ''))
    }
    await api(URL_VIDEOS_FINALIZE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ finalizeUploadRequest: { video: valor.video, uploadToken: valor.uploadToken || '', uploadedPartIds: partes } }),
    })
    const limite = Date.now() + 60_000
    while (Date.now() < limite) {
      const estado = await api(`https://api.linkedin.com/rest/videos/${encodeURIComponent(valor.video)}`)
      const status = estado.corpo?.status
      if (status === 'AVAILABLE') return valor.video
      if (status === 'PROCESSING_FAILED') throw new ErroConexao('VIDEO_PROCESSAMENTO_FALHOU', estado.corpo?.processingFailureReason || 'LinkedIn falhou ao processar o vídeo.', 422)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new ErroConexao('VIDEO_PROCESSAMENTO_TIMEOUT', 'LinkedIn não concluiu o processamento do vídeo.', 504)
  }

  return {
    id,
    nome: 'LinkedIn',
    dominio: 'linkedin.com',
    dominiosSessao: ['linkedin.com'],
    urlInicial: 'https://www.linkedin.com/in/me/',
    partition: 'persist:conexao-linkedin',
    capacidades: { ler: true, publicar: true, sinais: false, oauth: true, midia: { imagem: true, video: true } },
    esquemaConfiguracao: ESQUEMA_CONFIGURACAO,
    esquemaPublicacao: ESQUEMA_PUBLICACAO,
    orientacaoRedacao: `Post de até ${LIMITE_POST} caracteres, mas o padrão aprovado pelo titular é curto: três a seis parágrafos de uma ou duas frases, separados por linha em branco. Estrutura das referências aprovadas: o que foi feito ou lançado (primeira linha, concreta: nome, número, cena), o que dá para fazer com isso e, se houver, o que o produto ainda não faz. O limite é do produto, nunca da imagem: não escreva frase sobre o que a captura mostra, prova ou deixa de provar; a imagem fala por si. A imagem ou o vídeo mostra exatamente essa coisa. Sem "aprendizado", "o que levo daqui", lição, moral ou pergunta de fechamento; termine na última informação. Hashtags só quando agregarem descoberta (zero a três). Nada de tom de coach, lista de emoji ou relatório de RH.`,
    status,
    configurar,
    desconectar,
    autorizar,
    statusAutorizacao: () => ({ ...autorizacao }),
    perfil,
    sinais,
    prepararPublicacao,
    publicar,
  }
}

module.exports = { criarConexaoLinkedIn, escaparComentario, versaoApi, LIMITE_POST_LINKEDIN: LIMITE_POST }
