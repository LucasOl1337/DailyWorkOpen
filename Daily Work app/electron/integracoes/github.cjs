// Conexão GitHub. Credencial: token pessoal salvo no cofre ou, na ausência
// dele, o token da sessão do `gh` já autenticado nesta máquina.
// Leitura: perfil, repositórios recentes e eventos do dia. Escrita: issue,
// comentário e gist, sempre por proposta confirmada.

const childProcess = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { ErroConexao, dentroDaJanela, ordenarSinais, requisitar, sinal, textoLimitado, validarCampos } = require('./comum.cjs')

const API = 'https://api.github.com'
const CACHE_GH_MS = 5 * 60 * 1000

const ESQUEMA_CONFIGURACAO = Object.freeze([
  {
    campo: 'token',
    rotulo: 'Token pessoal (opcional)',
    tipo: 'password',
    opcional: true,
    ajuda: 'Deixe vazio para reutilizar a sessão do gh CLI. Um token fine-grained com repo, gist e read:user cobre tudo.',
  },
])

const ESQUEMA_PUBLICACAO = Object.freeze([
  {
    campo: 'tipo',
    rotulo: 'Tipo',
    tipo: 'select',
    opcoes: [
      { valor: 'issue', rotulo: 'Issue' },
      { valor: 'comentario', rotulo: 'Comentário em issue ou PR' },
      { valor: 'gist', rotulo: 'Gist' },
    ],
  },
  { campo: 'repo', rotulo: 'Repositório (dono/nome)', tipo: 'text', opcional: true, max: 140, padrao_regex: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' },
  { campo: 'numero', rotulo: 'Número da issue ou PR', tipo: 'text', opcional: true, max: 12, padrao_regex: '^\\d+$' },
  { campo: 'titulo', rotulo: 'Título', tipo: 'text', opcional: true, max: 256 },
  { campo: 'corpo', rotulo: 'Conteúdo (markdown)', tipo: 'textarea', max: 60_000 },
  { campo: 'arquivo', rotulo: 'Nome do arquivo do gist', tipo: 'text', opcional: true, max: 120 },
  { campo: 'publico', rotulo: 'Gist público', tipo: 'boolean', opcional: true },
])

// O `gh` pode não estar no PATH do processo (mise, launcher gráfico). Procura
// o binário em locais conhecidos antes de cair no nome simples.
function candidatosGh() {
  const home = os.homedir()
  const lista = [
    path.join(home, '.local', 'bin', 'gh'),
    '/usr/bin/gh',
    '/usr/local/bin/gh',
    '/opt/homebrew/bin/gh',
    path.join(home, '.local', 'share', 'mise', 'shims', 'gh'),
  ]
  const instalacoes = path.join(home, '.local', 'share', 'mise', 'installs', 'gh')
  try {
    for (const versao of fs.readdirSync(instalacoes)) {
      const raiz = path.join(instalacoes, versao)
      lista.push(path.join(raiz, 'bin', 'gh'))
      try {
        for (const entrada of fs.readdirSync(raiz)) lista.push(path.join(raiz, entrada, 'bin', 'gh'))
      } catch {
        // pasta sem subdiretórios
      }
    }
  } catch {
    // mise ausente
  }
  return lista
}

function resolverBinarioGh() {
  if (process.env.DAILYWORK_GH_BIN) return process.env.DAILYWORK_GH_BIN
  for (const candidato of candidatosGh()) {
    try {
      if (fs.statSync(candidato).isFile()) return candidato
    } catch {
      // tenta o próximo
    }
  }
  return 'gh'
}

// Último recurso: o próprio arquivo de hosts do gh, quando ele guarda o token
// em texto (sem keyring). Só lê a entrada de github.com.
function tokenDoHostsYml(ghConfigDir = null) {
  try {
    const arquivo = path.join(ghConfigDir || process.env.GH_CONFIG_DIR || path.join(os.homedir(), '.config', 'gh'), 'hosts.yml')
    const linhas = fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)
    let dentroDoHost = false
    for (const linha of linhas) {
      if (/^\S/.test(linha)) dentroDoHost = /^github\.com:/.test(linha)
      else if (dentroDoHost) {
        const match = linha.match(/^\s+oauth_token:\s*(\S+)/)
        if (match) return match[1]
      }
    }
  } catch {
    // sem arquivo
  }
  return null
}

// `ghConfigDir` isola a leitura do hosts.yml (testes e perfis alternativos).
function criarConexaoGitHub({ cofre, fetchImpl = fetch, execFileImpl = promisify(childProcess.execFile), now = () => Date.now(), binarioGh = null, ghConfigDir = null }) {
  const id = 'github'
  let cacheGh = { token: null, em: 0 }

  async function tokenDoGh() {
    if (cacheGh.token && now() - cacheGh.em < CACHE_GH_MS) return cacheGh.token
    let token = null
    try {
      const { stdout } = await execFileImpl(binarioGh || resolverBinarioGh(), ['auth', 'token'], { timeout: 8_000, windowsHide: true })
      token = String(stdout || '').trim() || null
    } catch {
      token = null
    }
    if (!token) token = tokenDoHostsYml(ghConfigDir)
    if (!token) return null
    cacheGh = { token, em: now() }
    return token
  }

  async function credencial() {
    const salva = await cofre.ler(id)
    if (salva?.token) return { token: salva.token, origem: 'cofre' }
    const gh = await tokenDoGh()
    if (gh) return { token: gh, origem: 'gh-cli' }
    return null
  }

  function cabecalhos(token) {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'DailyWork',
    }
  }

  async function api(caminho, init = {}) {
    const cred = await credencial()
    if (!cred) throw new ErroConexao('NAO_CONFIGURADA', 'GitHub não conectado: salve um token ou autentique o gh CLI.', 401)
    const resposta = await requisitar(fetchImpl, caminho.startsWith('http') ? caminho : `${API}${caminho}`, {
      ...init,
      headers: { ...cabecalhos(cred.token), ...(init.headers || {}) },
    })
    if (!resposta.ok) {
      const mensagem = resposta.corpo?.message || `GitHub respondeu ${resposta.status}`
      throw new ErroConexao(resposta.status === 401 ? 'CREDENCIAL_INVALIDA' : 'FALHA_GITHUB', mensagem, resposta.status)
    }
    return resposta
  }

  async function status() {
    const cred = await credencial()
    const base = { id, configured: Boolean(cred), origemCredencial: cred?.origem || null, online: false, conta: null, error: null }
    if (!cred) return base
    try {
      const { corpo } = await api('/user')
      return {
        ...base,
        online: true,
        conta: { login: corpo.login, nome: corpo.name || corpo.login, url: corpo.html_url, avatar: corpo.avatar_url },
      }
    } catch (erro) {
      return { ...base, error: erro.message }
    }
  }

  async function configurar(entrada) {
    const token = textoLimitado(entrada?.token, 400)
    if (token) {
      if (token.length < 20) throw new ErroConexao('CAMPO_INVALIDO', 'Token do GitHub muito curto.')
      await cofre.guardar(id, { token })
    } else {
      await cofre.remover(id)
    }
    return status()
  }

  async function desconectar() {
    await cofre.remover(id)
    cacheGh = { token: null, em: 0 }
    return status()
  }

  async function perfil() {
    const usuario = (await api('/user')).corpo
    const repos = (await api('/user/repos?sort=pushed&per_page=8&affiliation=owner')).corpo
    let notificacoes = 0
    try { notificacoes = ((await api('/notifications?per_page=50')).corpo || []).length } catch { notificacoes = 0 }
    return {
      login: usuario.login,
      nome: usuario.name || usuario.login,
      bio: usuario.bio || '',
      url: usuario.html_url,
      avatar: usuario.avatar_url,
      seguidores: usuario.followers,
      seguindo: usuario.following,
      repositoriosPublicos: usuario.public_repos,
      notificacoesNaoLidas: notificacoes,
      repositorios: (Array.isArray(repos) ? repos : []).map((repo) => ({
        nome: repo.full_name,
        descricao: repo.description || '',
        url: repo.html_url,
        estrelas: repo.stargazers_count,
        atualizadoEm: repo.pushed_at,
        privado: Boolean(repo.private),
      })),
    }
  }

  function mapearEvento(evento) {
    const repo = evento.repo?.name || ''
    const base = `https://github.com/${repo}`
    const p = evento.payload || {}
    switch (evento.type) {
      case 'PushEvent': {
        const commits = Array.isArray(p.commits) ? p.commits : []
        return commits.map((commit, indice) => sinal({
          id: `${evento.id}:${commit.sha || indice}`,
          timestamp: evento.created_at,
          tipo: 'commit',
          titulo: `${repo}: ${String(commit.message || '').split('\n')[0]}`,
          texto: commit.message || '',
          url: commit.sha ? `${base}/commit/${commit.sha}` : base,
        }))
      }
      case 'IssuesEvent':
        return [sinal({ id: evento.id, timestamp: evento.created_at, tipo: `issue-${p.action || 'evento'}`, titulo: `${repo}#${p.issue?.number}: ${p.issue?.title || ''}`, texto: p.issue?.body || '', url: p.issue?.html_url || base })]
      case 'PullRequestEvent':
        return [sinal({ id: evento.id, timestamp: evento.created_at, tipo: `pr-${p.action || 'evento'}`, titulo: `${repo}#${p.number}: ${p.pull_request?.title || ''}`, texto: p.pull_request?.body || '', url: p.pull_request?.html_url || base })]
      case 'IssueCommentEvent':
      case 'PullRequestReviewCommentEvent':
        return [sinal({ id: evento.id, timestamp: evento.created_at, tipo: 'comentario', titulo: `${repo}#${p.issue?.number || p.pull_request?.number || ''}`, texto: p.comment?.body || '', url: p.comment?.html_url || base })]
      case 'CreateEvent':
        return [sinal({ id: evento.id, timestamp: evento.created_at, tipo: 'criacao', titulo: `${repo}: ${p.ref_type} ${p.ref || ''}`.trim(), url: base })]
      case 'ReleaseEvent':
        return [sinal({ id: evento.id, timestamp: evento.created_at, tipo: 'release', titulo: `${repo}: ${p.release?.name || p.release?.tag_name || ''}`, texto: p.release?.body || '', url: p.release?.html_url || base })]
      case 'WatchEvent':
      case 'ForkEvent':
        return [sinal({ id: evento.id, timestamp: evento.created_at, tipo: evento.type === 'WatchEvent' ? 'estrela' : 'fork', titulo: repo, url: base })]
      default:
        return []
    }
  }

  async function sinais(janela) {
    const usuario = (await api('/user')).corpo
    const itens = []
    const erros = []
    const vistos = new Set()
    for (let pagina = 1; pagina <= 3; pagina += 1) {
      let eventos
      try {
        eventos = (await api(`/users/${encodeURIComponent(usuario.login)}/events?per_page=100&page=${pagina}`)).corpo
      } catch (erro) {
        erros.push(erro.message)
        break
      }
      if (!Array.isArray(eventos) || eventos.length === 0) break
      for (const evento of eventos) {
        if (!evento?.id || vistos.has(String(evento.id))) continue
        vistos.add(String(evento.id))
        if (dentroDaJanela(evento.created_at, janela)) itens.push(...mapearEvento(evento))
      }
      const maisAntigo = eventos[eventos.length - 1]?.created_at
      if (eventos.length < 100 || (maisAntigo && Date.parse(maisAntigo) < janela.inicioMs)) break
    }
    return { itens: ordenarSinais(itens), erros, conta: usuario.login }
  }

  async function prepararPublicacao(entrada) {
    const campos = validarCampos(ESQUEMA_PUBLICACAO, entrada)
    if (campos.tipo === 'issue') {
      if (!campos.repo) throw new ErroConexao('CAMPO_OBRIGATORIO', 'Repositório é obrigatório para uma issue.')
      if (!campos.titulo) throw new ErroConexao('CAMPO_OBRIGATORIO', 'Título é obrigatório para uma issue.')
      return {
        tipo: 'issue',
        resumo: `Abrir issue em ${campos.repo}: ${campos.titulo}`,
        payload: { tipo: 'issue', repo: campos.repo, titulo: campos.titulo, corpo: campos.corpo },
        preview: { titulo: campos.titulo, corpo: campos.corpo, destino: `github.com/${campos.repo}/issues` },
      }
    }
    if (campos.tipo === 'comentario') {
      if (!campos.repo || !campos.numero) throw new ErroConexao('CAMPO_OBRIGATORIO', 'Repositório e número são obrigatórios para comentar.')
      return {
        tipo: 'comentario',
        resumo: `Comentar em ${campos.repo}#${campos.numero}`,
        payload: { tipo: 'comentario', repo: campos.repo, numero: Number(campos.numero), corpo: campos.corpo },
        preview: { titulo: `Comentário em ${campos.repo}#${campos.numero}`, corpo: campos.corpo, destino: `github.com/${campos.repo}/issues/${campos.numero}` },
      }
    }
    const arquivo = campos.arquivo || 'dailywork.md'
    return {
      tipo: 'gist',
      resumo: `Criar gist ${campos.publico ? 'público' : 'secreto'} ${arquivo}`,
      payload: { tipo: 'gist', arquivo, descricao: campos.titulo || '', conteudo: campos.corpo, publico: Boolean(campos.publico) },
      preview: { titulo: campos.titulo || arquivo, corpo: campos.corpo, destino: `gist.github.com (${campos.publico ? 'público' : 'secreto'})` },
    }
  }

  async function publicar(payload) {
    if (payload.tipo === 'issue') {
      const { corpo } = await api(`/repos/${payload.repo}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: payload.titulo, body: payload.corpo }),
      })
      return { id: String(corpo.number), url: corpo.html_url }
    }
    if (payload.tipo === 'comentario') {
      const { corpo } = await api(`/repos/${payload.repo}/issues/${payload.numero}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: payload.corpo }),
      })
      return { id: String(corpo.id), url: corpo.html_url }
    }
    if (payload.tipo === 'gist') {
      const { corpo } = await api('/gists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: payload.descricao,
          public: payload.publico,
          files: { [payload.arquivo]: { content: payload.conteudo } },
        }),
      })
      return { id: String(corpo.id), url: corpo.html_url }
    }
    throw new ErroConexao('TIPO_INVALIDO', 'Tipo de publicação desconhecido para o GitHub.')
  }

  return {
    id,
    nome: 'GitHub',
    dominio: 'github.com',
    dominiosSessao: ['github.com'],
    urlInicial: 'https://github.com/',
    partition: 'persist:conexao-github',
    capacidades: { ler: true, publicar: true, sinais: true, oauth: false },
    esquemaConfiguracao: ESQUEMA_CONFIGURACAO,
    esquemaPublicacao: ESQUEMA_PUBLICACAO,
    orientacaoRedacao: 'Issues e comentários usam markdown do GitHub: contexto, passos, critério de pronto. Gists servem para trechos e notas técnicas.',
    status,
    configurar,
    desconectar,
    perfil,
    sinais,
    prepararPublicacao,
    publicar,
  }
}

module.exports = { criarConexaoGitHub, ESQUEMA_PUBLICACAO_GITHUB: ESQUEMA_PUBLICACAO }
