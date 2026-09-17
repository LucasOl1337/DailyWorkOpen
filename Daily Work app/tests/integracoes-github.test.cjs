const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { criarConexaoGitHub } = require('../electron/integracoes/github.cjs')
const { criarRegistroIntegracoes } = require('../electron/integracoes/registro.cjs')
const { janelaDoDia } = require('../electron/sumario/shared.cjs')
const { temporario, json, redeFalsa, cofreEmMemoria } = require('./integracoes-suporte.cjs')

const DIA = '2026-09-05'
const dentro = new Date(janelaDoDia(DIA).inicioMs + 3 * 3600_000).toISOString()
const fora = new Date(janelaDoDia(DIA).inicioMs - 3600_000).toISOString()

function rotasGitHub() {
  return [
    { trecho: '/user/repos', resposta: json([{ full_name: 'lucas/dw', html_url: 'https://github.com/lucas/dw', stargazers_count: 3, pushed_at: dentro, private: false }]) },
    { trecho: '/users/lucas/events', resposta: json([
      { id: '1', type: 'PushEvent', created_at: dentro, repo: { name: 'lucas/dw' }, payload: { commits: [{ sha: 'abc', message: 'feat: conexões\n\ncorpo' }] } },
      { id: '1', type: 'PushEvent', created_at: dentro, repo: { name: 'lucas/dw' }, payload: { commits: [{ sha: 'abc', message: 'feat: conexões' }] } },
      { id: '2', type: 'IssuesEvent', created_at: fora, repo: { name: 'lucas/dw' }, payload: { action: 'opened', issue: { number: 4, title: 'antiga', html_url: 'u' } } },
      { id: '3', type: 'PullRequestEvent', created_at: dentro, repo: { name: 'lucas/dw' }, payload: { action: 'opened', number: 9, pull_request: { title: 'PR do dia', html_url: 'https://github.com/lucas/dw/pull/9' } } },
    ]) },
    { trecho: '/notifications', resposta: json([{ id: 'n1' }, { id: 'n2' }]) },
    { trecho: '/user', resposta: json({ login: 'lucas', name: 'Lucas', html_url: 'https://github.com/lucas', avatar_url: 'https://a/x.png', followers: 10, following: 2, public_repos: 5, bio: 'dev' }) },
    { metodo: 'POST', trecho: '/repos/lucas/dw/issues', resposta: (chamada) => json({ number: 12, html_url: 'https://github.com/lucas/dw/issues/12', recebido: JSON.parse(chamada.body) }, 201) },
    { metodo: 'POST', trecho: '/gists', resposta: (chamada) => json({ id: 'g1', html_url: 'https://gist.github.com/g1', recebido: JSON.parse(chamada.body) }, 201) },
  ]
}

test('token do gh CLI é usado quando o cofre está vazio e o cofre tem prioridade', async (t) => {
  const cofre = cofreEmMemoria(t)
  const rede = redeFalsa(rotasGitHub())
  let chamadasGh = 0
  const conexao = criarConexaoGitHub({ cofre, fetchImpl: rede.fetchImpl, execFileImpl: async () => { chamadasGh += 1; return { stdout: 'gho_cli\n' } } })

  const inicial = await conexao.status()
  assert.equal(inicial.configured, true)
  assert.equal(inicial.origemCredencial, 'gh-cli')
  assert.equal(inicial.conta.login, 'lucas')
  assert.equal(rede.chamadas[0].headers.Authorization, 'Bearer gho_cli')

  await conexao.configurar({ token: 'ghp_token_do_cofre_1234567890' })
  const depois = await conexao.status()
  assert.equal(depois.origemCredencial, 'cofre')
  assert.equal(rede.chamadas.at(-1).headers.Authorization, 'Bearer ghp_token_do_cofre_1234567890')
  assert.equal(chamadasGh, 1, 'o token do gh fica em cache')

  await conexao.desconectar()
  assert.equal((await conexao.status()).origemCredencial, 'gh-cli')
})

test('sem gh e sem token o estado é não configurado, sem chamadas de rede', async (t) => {
  const rede = redeFalsa([])
  // ghConfigDir vazio: o hosts.yml real desta máquina não pode vazar para o teste.
  const conexao = criarConexaoGitHub({ cofre: cofreEmMemoria(t), fetchImpl: rede.fetchImpl, execFileImpl: async () => { throw new Error('gh ausente') }, ghConfigDir: temporario(t) })
  const estado = await conexao.status()
  assert.equal(estado.configured, false)
  assert.equal(rede.chamadas.length, 0)
  await assert.rejects(conexao.perfil(), /não conectado/)
})

test('sinais do dia filtram pela janela local e deduplicam eventos repetidos', async (t) => {
  const conexao = criarConexaoGitHub({ cofre: cofreEmMemoria(t), fetchImpl: redeFalsa(rotasGitHub()).fetchImpl, execFileImpl: async () => ({ stdout: 'gho' }) })
  const resultado = await conexao.sinais(janelaDoDia(DIA))
  assert.deepEqual(resultado.itens.map((item) => item.tipo), ['commit', 'pr-opened'])
  assert.equal(resultado.itens[0].titulo, 'lucas/dw: feat: conexões')
  assert.equal(resultado.itens[0].url, 'https://github.com/lucas/dw/commit/abc')
  assert.equal(resultado.conta, 'lucas')
})

test('perfil reúne usuário, repositórios recentes e notificações', async (t) => {
  const conexao = criarConexaoGitHub({ cofre: cofreEmMemoria(t), fetchImpl: redeFalsa(rotasGitHub()).fetchImpl, execFileImpl: async () => ({ stdout: 'gho' }) })
  const perfil = await conexao.perfil()
  assert.equal(perfil.login, 'lucas')
  assert.equal(perfil.notificacoesNaoLidas, 2)
  assert.equal(perfil.repositorios[0].nome, 'lucas/dw')
})

test('publicação nasce como proposta validada e só sai após confirmação, com auditoria', async (t) => {
  const raiz = temporario(t)
  const rede = redeFalsa(rotasGitHub())
  const registro = criarRegistroIntegracoes({ userDataDir: raiz, dataDir: path.join(raiz, 'data'), fetchImpl: rede.fetchImpl, execFileImpl: async () => ({ stdout: 'gho' }) })

  await assert.rejects(registro.prepararPublicacao('github', { tipo: 'issue', corpo: 'x' }), /Repositório é obrigatório/)
  await assert.rejects(registro.prepararPublicacao('github', { tipo: 'issue', repo: 'invalido', titulo: 't', corpo: 'x' }), /formato inválido/)

  const proposta = await registro.prepararPublicacao('github', { tipo: 'issue', repo: 'lucas/dw', titulo: 'Conectar contas', corpo: 'Descrição' })
  assert.equal(proposta.conta, 'github')
  assert.equal(proposta.preview.destino, 'github.com/lucas/dw/issues')
  assert.equal(rede.chamadas.filter((chamada) => chamada.metodo === 'POST').length, 0, 'nada é enviado ao preparar')

  const recibo = await registro.confirmarPublicacao({ proposalId: proposta.proposalId })
  assert.equal(recibo.url, 'https://github.com/lucas/dw/issues/12')
  const envio = rede.chamadas.find((chamada) => chamada.metodo === 'POST')
  assert.deepEqual(JSON.parse(envio.body), { title: 'Conectar contas', body: 'Descrição' })
  await assert.rejects(registro.confirmarPublicacao({ proposalId: proposta.proposalId }), /inexistente|expirada/)

  const log = fs.readFileSync(path.join(raiz, 'data', '_log.ndjson'), 'utf8').trim().split('\n').map((linha) => JSON.parse(linha))
  const publicacao = log.find((linha) => linha.acao === 'integracoes:publicar')
  assert.equal(publicacao.conta, 'github')
  assert.equal(publicacao.hash, proposta.hash)
})

test('proposta expira e gist preserva a escolha de visibilidade', async (t) => {
  const raiz = temporario(t)
  let agora = Date.parse('2026-09-05T12:00:00Z')
  const rede = redeFalsa(rotasGitHub())
  const registro = criarRegistroIntegracoes({ userDataDir: raiz, fetchImpl: rede.fetchImpl, execFileImpl: async () => ({ stdout: 'gho' }), now: () => agora })
  const expirada = await registro.prepararPublicacao('github', { tipo: 'gist', corpo: 'conteúdo', arquivo: 'nota.md', publico: 'true' })
  agora += 11 * 60_000
  await assert.rejects(registro.confirmarPublicacao({ proposalId: expirada.proposalId }), /expirada/)

  const valida = await registro.prepararPublicacao('github', { tipo: 'gist', corpo: 'conteúdo', arquivo: 'nota.md', publico: true })
  assert.match(valida.resumo, /público/)
  const recibo = await registro.confirmarPublicacao({ proposalId: valida.proposalId })
  assert.equal(recibo.url, 'https://gist.github.com/g1')
  const envio = rede.chamadas.find((chamada) => chamada.url.endsWith('/gists'))
  assert.deepEqual(JSON.parse(envio.body).files, { 'nota.md': { content: 'conteúdo' } })
  assert.equal(JSON.parse(envio.body).public, true)
})
