const test = require('node:test')
const assert = require('node:assert/strict')
const { criarConexaoLinkedIn, escaparComentario, versaoApi } = require('../electron/integracoes/linkedin.cjs')
const { json, redeFalsa, cofreEmMemoria } = require('./integracoes-suporte.cjs')

function rotasLinkedIn() {
  return [
    { trecho: '/v2/userinfo', resposta: json({ sub: 'abc123', name: 'Example User', picture: 'https://p/x.jpg', email: 'l@x' }) },
    { metodo: 'POST', trecho: '/rest/posts', resposta: (chamada) => {
      assert.equal(chamada.headers['X-Restli-Protocol-Version'], '2.0.0')
      assert.match(chamada.headers['LinkedIn-Version'], /^\d{6}$/)
      return new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:777' } })
    } },
    { metodo: 'POST', trecho: '/oauth/v2/accessToken', resposta: json({ access_token: 'li-tok', expires_in: 5184000 }) },
  ]
}

test('token colado conecta, identifica a pessoa e publica com escape do texto', async (t) => {
  const rede = redeFalsa(rotasLinkedIn())
  const conexao = criarConexaoLinkedIn({ cofre: cofreEmMemoria(t), fetchImpl: rede.fetchImpl })
  const estado = await conexao.configurar({ accessToken: 'li-manual' })
  assert.equal(estado.online, true)
  assert.equal(estado.conta.nome, 'Example User')
  assert.ok(estado.expiraEm)

  const preparada = await conexao.prepararPublicacao({ texto: 'Hoje (finalmente) publiquei #dailywork', visibilidade: 'CONNECTIONS', linkUrl: 'https://site.example', linkTitulo: 'Site' })
  assert.match(preparada.resumo, /para conexões/)
  const recibo = await conexao.publicar(preparada.payload)
  assert.equal(recibo.url, 'https://www.linkedin.com/feed/update/urn:li:share:777/')
  const envio = rede.chamadas.find((chamada) => chamada.url.includes('/rest/posts'))
  const corpo = JSON.parse(envio.body)
  assert.equal(corpo.author, 'urn:li:person:abc123')
  assert.equal(corpo.commentary, 'Hoje \\(finalmente\\) publiquei \\#dailywork')
  assert.equal(corpo.visibility, 'CONNECTIONS')
  assert.deepEqual(corpo.content, { article: { source: 'https://site.example', title: 'Site' } })
})

test('sinais são declarados indisponíveis e o post respeita o limite', async (t) => {
  const conexao = criarConexaoLinkedIn({ cofre: cofreEmMemoria(t), fetchImpl: redeFalsa(rotasLinkedIn()).fetchImpl })
  assert.equal(conexao.capacidades.sinais, false)
  assert.match((await conexao.sinais()).indisponivel, /não expõe/)
  await assert.rejects(conexao.prepararPublicacao({ texto: 'a'.repeat(3001) }), /excede 3000/)
  await assert.rejects(conexao.prepararPublicacao({ texto: 'ok', linkUrl: 'javascript:alert(1)' }), /http/)
})

test('fluxo OAuth troca o código por token com client secret e marca a origem', async (t) => {
  const cofre = cofreEmMemoria(t)
  const rede = redeFalsa(rotasLinkedIn())
  // O teste não disputa a porta OAuth da instância desktop aberta.
  const reserva = require('node:net').createServer()
  await new Promise(resolve => reserva.listen(0, '127.0.0.1', resolve))
  const redirectUri = `http://127.0.0.1:${reserva.address().port}/callback`
  await new Promise(resolve => reserva.close(resolve))
  const conexao = criarConexaoLinkedIn({ cofre, fetchImpl: rede.fetchImpl, abrirAutorizacao: async () => ({ fechar() {} }), redirectUri })
  await assert.rejects(conexao.autorizar(), /Client ID/)
  await conexao.configurar({ clientId: 'cid', clientSecret: 'sec' })
  const { url } = await conexao.autorizar()
  const parametros = new URL(url).searchParams
  assert.equal(parametros.get('scope'), 'openid profile email w_member_social')
  await fetch(`${redirectUri}?state=${parametros.get('state')}&code=xyz`)
  for (let tentativa = 0; tentativa < 50 && conexao.statusAutorizacao().estado === 'aguardando'; tentativa += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(conexao.statusAutorizacao().estado, 'concluida')
  const troca = rede.chamadas.find((chamada) => chamada.url.includes('accessToken'))
  assert.equal(new URLSearchParams(troca.body).get('client_secret'), 'sec')
  assert.equal((await conexao.status()).origemCredencial, 'oauth')
})

test('utilitários de versão e escape são estáveis', () => {
  assert.equal(versaoApi(Date.parse('2026-09-05T00:00:00Z')), '202607')
  assert.equal(escaparComentario('a|b{c}[d]<e>@f*g_h~i\\j'), 'a\\|b\\{c\\}\\[d\\]\\<e\\>\\@f\\*g\\_h\\~i\\\\j')
})
