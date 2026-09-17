// Conexão X (x.com). Autorização OAuth 2.0 com PKCE no próprio DailyWork ou
// token de usuário colado manualmente. Leitura: perfil e posts do dia.
// Escrita: post (e resposta), sempre por proposta confirmada.

const { ErroConexao, contarCaracteres, dentroDaJanela, ordenarSinais, requisitar, sinal, textoLimitado, validarCampos, validarMidiaLocal, lerMidiaLocal } = require('./comum.cjs')
const { aguardarCallback, gerarEstado, gerarPkce, montarUrl } = require('./oauth.cjs')

const API = 'https://api.x.com/2'
const URL_AUTORIZACAO = 'https://x.com/i/oauth2/authorize'
const URL_TOKEN = 'https://api.x.com/2/oauth2/token'
const ESCOPOS = 'tweet.read tweet.write users.read offline.access media.write'
const PORTA_CALLBACK = 47832
const REDIRECT_PADRAO = `http://127.0.0.1:${PORTA_CALLBACK}/callback`
const LIMITE_POST = 280

const ESQUEMA_CONFIGURACAO = Object.freeze([
  { campo: 'clientId', rotulo: 'Client ID do app (OAuth 2.0)', tipo: 'text', opcional: true, ajuda: `Crie um app no developer portal com callback ${REDIRECT_PADRAO} e permissão de leitura e escrita.` },
  { campo: 'clientSecret', rotulo: 'Client secret (só para app confidencial)', tipo: 'password', opcional: true },
  { campo: 'accessToken', rotulo: 'Token de usuário (alternativa ao OAuth)', tipo: 'password', opcional: true, ajuda: 'Cole um token de usuário já gerado se preferir não autorizar pelo DailyWork.' },
])

const ESQUEMA_PUBLICACAO = Object.freeze([
  { campo: 'texto', rotulo: 'Texto do post', tipo: 'textarea', max: LIMITE_POST },
  { campo: 'respostaA', rotulo: 'Responder ao post (id)', tipo: 'text', opcional: true, max: 30, padrao_regex: '^\\d+$' },
])

function criarConexaoX({ cofre, fetchImpl = fetch, now = () => Date.now(), abrirAutorizacao = null, dataDir = null }) {
  const id = 'x'
  let autorizacao = { estado: 'ociosa', erro: null, url: null }

  async function dadosSalvos() {
    return (await cofre.ler(id)) || null
  }

  function cabecalhoCliente(dados) {
    if (dados.clientSecret) {
      return { Authorization: `Basic ${Buffer.from(`${dados.clientId}:${dados.clientSecret}`).toString('base64')}` }
    }
    return {}
  }

  async function renovarToken(dados) {
    if (!dados?.refreshToken || !dados.clientId) return dados
    const resposta = await requisitar(fetchImpl, URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...cabecalhoCliente(dados) },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: dados.refreshToken, client_id: dados.clientId }).toString(),
    })
    if (!resposta.ok) throw new ErroConexao('CREDENCIAL_INVALIDA', 'O X recusou a renovação do token. Autorize de novo.', 401)
    const atualizado = {
      ...dados,
      accessToken: resposta.corpo.access_token,
      refreshToken: resposta.corpo.refresh_token || dados.refreshToken,
      expiraEm: now() + Number(resposta.corpo.expires_in || 7200) * 1000,
    }
    await cofre.guardar(id, atualizado)
    return atualizado
  }

  async function tokenValido() {
    let dados = await dadosSalvos()
    if (!dados?.accessToken) throw new ErroConexao('NAO_CONFIGURADA', 'X não conectado: autorize o app ou cole um token de usuário.', 401)
    if (dados.expiraEm && now() > dados.expiraEm - 60_000 && dados.refreshToken) dados = await renovarToken(dados)
    return dados
  }

  async function api(caminho, init = {}) {
    const dados = await tokenValido()
    const resposta = await requisitar(fetchImpl, `${API}${caminho}`, {
      ...init,
      headers: { Authorization: `Bearer ${dados.accessToken}`, 'User-Agent': 'DailyWork', ...(init.headers || {}) },
    })
    if (!resposta.ok) {
      const detalhe = resposta.corpo?.detail || resposta.corpo?.title || resposta.corpo?.errors?.[0]?.message || `X respondeu ${resposta.status}`
      const detalheTexto = String(detalhe).toLowerCase()
      const codigo = resposta.status === 401 ? 'CREDENCIAL_INVALIDA' : resposta.status === 429 ? 'LIMITE_X' : (resposta.status === 403 && (detalheTexto.includes('media.write') || detalheTexto.includes('scope'))) ? 'MEDIA_SCOPE_AUSENTE' : resposta.status === 402 || resposta.status === 403 ? 'PLANO_X' : 'FALHA_X'
      throw new ErroConexao(codigo, detalhe, resposta.status)
    }
    return resposta
  }

  async function usuarioAtual() {
    const dados = await tokenValido()
    if (dados.usuario?.id && dados.usuario?.username) return dados.usuario
    const { corpo } = await api('/users/me?user.fields=profile_image_url,public_metrics,description')
    const usuario = {
      id: corpo.data.id,
      username: corpo.data.username,
      nome: corpo.data.name,
      avatar: corpo.data.profile_image_url || null,
      seguidores: corpo.data.public_metrics?.followers_count ?? null,
    }
    await cofre.guardar(id, { ...dados, usuario })
    return usuario
  }

  async function status() {
    const dados = await dadosSalvos()
    const configured = Boolean(dados?.accessToken)
    const base = {
      id,
      configured,
      origemCredencial: dados?.accessToken ? (dados.refreshToken ? 'oauth' : 'token') : dados?.clientId ? 'app-sem-autorizacao' : null,
      online: false,
      conta: null,
      error: null,
      autorizacao: { estado: autorizacao.estado, erro: autorizacao.erro, url: autorizacao.url },
    }
    if (!configured) return base
    try {
      const usuario = await usuarioAtual()
      return { ...base, online: true, conta: { login: usuario.username, nome: usuario.nome, url: `https://x.com/${usuario.username}`, avatar: usuario.avatar } }
    } catch (erro) {
      return { ...base, error: erro.message }
    }
  }

  async function configurar(entrada) {
    const atual = (await dadosSalvos()) || {}
    const clientId = textoLimitado(entrada?.clientId, 200)
    const clientSecret = textoLimitado(entrada?.clientSecret, 400)
    const accessToken = textoLimitado(entrada?.accessToken, 2_000)
    const dados = { ...atual }
    if (clientId) dados.clientId = clientId
    if (clientSecret) dados.clientSecret = clientSecret
    if (accessToken) {
      dados.accessToken = accessToken
      delete dados.refreshToken
      delete dados.expiraEm
      delete dados.usuario
    }
    if (!dados.clientId && !dados.accessToken) throw new ErroConexao('CAMPO_OBRIGATORIO', 'Informe o Client ID do app ou um token de usuário.')
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
    if (!dados?.clientId) throw new ErroConexao('CAMPO_OBRIGATORIO', 'Salve o Client ID do app antes de autorizar.')
    if (autorizacao.estado === 'aguardando') return { url: autorizacao.url, estado: 'aguardando' }
    const pkce = gerarPkce()
    const estado = gerarEstado()
    const redirectUri = dados.redirectUri || REDIRECT_PADRAO
    const url = montarUrl(URL_AUTORIZACAO, {
      response_type: 'code',
      client_id: dados.clientId,
      redirect_uri: redirectUri,
      scope: ESCOPOS,
      state: estado,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    })
    autorizacao = { estado: 'aguardando', erro: null, url }
    const retorno = aguardarCallback({ porta: Number(new URL(redirectUri).port), caminho: new URL(redirectUri).pathname, estado })
    const janela = abrirAutorizacao ? await abrirAutorizacao({ id, url, partition: 'persist:conexao-x' }) : null
    ;(async () => {
      try {
        const { code } = await retorno
        const resposta = await requisitar(fetchImpl, URL_TOKEN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...cabecalhoCliente(dados) },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: dados.clientId,
            redirect_uri: redirectUri,
            code_verifier: pkce.verifier,
          }).toString(),
        })
        if (!resposta.ok) throw new Error(resposta.corpo?.error_description || resposta.corpo?.error || `troca de código falhou (${resposta.status})`)
        await cofre.guardar(id, {
          ...dados,
          accessToken: resposta.corpo.access_token,
          refreshToken: resposta.corpo.refresh_token || null,
          expiraEm: now() + Number(resposta.corpo.expires_in || 7200) * 1000,
          usuario: null,
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
    const usuario = await usuarioAtual()
    const { corpo } = await api('/users/me?user.fields=profile_image_url,public_metrics,description,created_at')
    return {
      login: corpo.data.username,
      nome: corpo.data.name,
      bio: corpo.data.description || '',
      url: `https://x.com/${corpo.data.username}`,
      avatar: corpo.data.profile_image_url || usuario.avatar,
      seguidores: corpo.data.public_metrics?.followers_count ?? null,
      seguindo: corpo.data.public_metrics?.following_count ?? null,
      posts: corpo.data.public_metrics?.tweet_count ?? null,
    }
  }

  async function sinais(janela) {
    const usuario = await usuarioAtual()
    const parametros = new URLSearchParams({
      max_results: '100',
      start_time: new Date(janela.inicioMs).toISOString(),
      end_time: new Date(Math.min(janela.fimMs, now() - 15_000)).toISOString(),
      'tweet.fields': 'created_at,public_metrics,conversation_id',
    })
    const { corpo } = await api(`/users/${usuario.id}/tweets?${parametros}`)
    const itens = (Array.isArray(corpo?.data) ? corpo.data : [])
      .filter((post) => dentroDaJanela(post.created_at, janela))
      .map((post) => sinal({
        id: post.id,
        timestamp: post.created_at,
        tipo: 'post',
        titulo: String(post.text || '').split('\n')[0],
        texto: post.text || '',
        url: `https://x.com/${usuario.username}/status/${post.id}`,
        extra: { metricas: post.public_metrics || null },
      }))
    return { itens: ordenarSinais(itens), erros: [], conta: usuario.username }
  }

  async function prepararPublicacao(entrada) {
    const campos = validarCampos(ESQUEMA_PUBLICACAO, entrada)
    if (contarCaracteres(campos.texto) > LIMITE_POST) throw new ErroConexao('CAMPO_LONGO', `O post excede ${LIMITE_POST} caracteres.`)
    const midiasEntrada = Array.isArray(entrada?.midias) ? entrada.midias : []
    if (midiasEntrada.length > 1) throw new ErroConexao('MIDIA_NAO_SUPORTADA', 'X aceita uma imagem ou vídeo por post neste conector.')
    const midia = midiasEntrada.length ? await validarMidiaLocal(midiasEntrada[0], { dataDir, maxBytes: midiasEntrada[0].tipo === 'video' ? 512 * 1024 * 1024 : 15 * 1024 * 1024, tipos: ['imagem', 'video'] }) : null
    return {
      tipo: campos.respostaA ? 'resposta' : 'post',
      resumo: campos.respostaA ? `Responder ao post ${campos.respostaA} no X` : 'Publicar post no X',
      payload: { texto: campos.texto, respostaA: campos.respostaA || null, midia },
      preview: { titulo: campos.respostaA ? `Resposta ao post ${campos.respostaA}` : 'Post no X', corpo: campos.texto, destino: 'x.com' },
    }
  }

  async function publicar(payload) {
    const usuario = await usuarioAtual()
    const corpoPedido = { text: payload.texto }
    if (payload.respostaA) corpoPedido.reply = { in_reply_to_tweet_id: payload.respostaA }
    if (payload.midia) {
      const midia = await lerMidiaLocal(payload.midia, { dataDir, maxBytes: payload.midia.tipo === 'video' ? 512 * 1024 * 1024 : 15 * 1024 * 1024, tipos: ['imagem', 'video'] })
      const mediaId = await enviarMidia(midia)
      corpoPedido.media = { media_ids: [mediaId] }
    }
    const { corpo } = await api('/tweets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpoPedido),
    })
    const postId = corpo?.data?.id
    return { id: String(postId), url: `https://x.com/${usuario.username}/status/${postId}` }
  }

  async function enviarMidia(midia) {
    if (midia.tipo === 'imagem') {
      const resposta = await api('/media/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media: midia.dados.toString('base64'), media_category: 'tweet_image' }),
      })
      const id = resposta.corpo?.data?.id || resposta.corpo?.id
      if (!id) throw new ErroConexao('UPLOAD_X_INVALIDO', 'X não devolveu o id da mídia.', 502)
      return String(id)
    }
    const inicial = await api('/media/upload/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_category: 'tweet_video', media_type: midia.mime, total_bytes: midia.tamanho }),
    })
    const mediaId = inicial.corpo?.data?.id || inicial.corpo?.id
    if (!mediaId) throw new ErroConexao('UPLOAD_X_INVALIDO', 'X não devolveu o id do upload de vídeo.', 502)
    const tamanhoBloco = 5 * 1024 * 1024
    for (let inicio = 0, segmento = 0; inicio < midia.dados.length; inicio += tamanhoBloco, segmento += 1) {
      const bloco = midia.dados.subarray(inicio, Math.min(inicio + tamanhoBloco, midia.dados.length))
      await api(`/media/upload/${encodeURIComponent(mediaId)}/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media: bloco.toString('base64'), segment_index: segmento }),
      })
    }
    const finalizado = await api(`/media/upload/${encodeURIComponent(mediaId)}/finalize`, {
      method: 'POST',
    })
    let processamento = finalizado.corpo?.data?.processing_info || finalizado.corpo?.processing_info || null
    const limite = Date.now() + 60_000
    while (processamento && processamento.state !== 'succeeded') {
      if (processamento.state === 'failed') throw new ErroConexao('VIDEO_PROCESSAMENTO_FALHOU', processamento.error?.message || 'X falhou ao processar o vídeo.', 422)
      if (Date.now() >= limite) throw new ErroConexao('VIDEO_PROCESSAMENTO_TIMEOUT', 'X não concluiu o processamento do vídeo.', 504)
      const espera = Math.min(Number(processamento.check_after_secs || 1) * 1_000, Math.max(1, limite - Date.now()))
      await new Promise((resolve) => setTimeout(resolve, espera))
      const estado = await api(`/media/upload?media_id=${encodeURIComponent(mediaId)}&command=STATUS`)
      processamento = estado.corpo?.data?.processing_info || estado.corpo?.processing_info || null
    }
    return String(mediaId)
  }

  return {
    id,
    nome: 'X',
    dominio: 'x.com',
    dominiosSessao: ['x.com', 'twitter.com'],
    urlInicial: 'https://x.com/home',
    partition: 'persist:conexao-x',
    capacidades: { ler: true, publicar: true, sinais: true, oauth: true, midia: { imagem: true, video: true, escopo: 'media.write' } },
    esquemaConfiguracao: ESQUEMA_CONFIGURACAO,
    esquemaPublicacao: ESQUEMA_PUBLICACAO,
    orientacaoRedacao: `Post único de até ${LIMITE_POST} caracteres, uma ideia só: o que foi feito ou lançado e o que dá para fazer com isso, na primeira linha já concreto (nome, número ou cena, não pergunta retórica). Parágrafos de uma frase separados por linha em branco, como nas referências aprovadas do titular; um fragmento curto de opinião no fim é aceitável quando for dele. A imagem mostra a coisa citada; não escreva frase sobre o que a captura mostra ou não comprova. Sem hashtags por padrão; no máximo uma se agregar descoberta. Nunca fórmulas de engajamento ("concorda?", "segue o fio") nem tom de coach.`,
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

module.exports = { criarConexaoX, LIMITE_POST_X: LIMITE_POST }
