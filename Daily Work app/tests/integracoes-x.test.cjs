const test = require('node:test')
const assert = require('node:assert/strict')
const { criarConexaoX } = require('../electron/integracoes/x.cjs')
const { gerarPkce, aguardarCallback } = require('../electron/integracoes/oauth.cjs')
const { janelaDoDia } = require('../electron/sumario/shared.cjs')
const { json, redeFalsa, cofreEmMemoria } = require('./integracoes-suporte.cjs')

const DIA = '2026-09-05'

function rotasX() {
  return [
    { trecho: '/users/me', resposta: json({ data: { id: '42', username: 'lucasol', name: 'Lucas', profile_image_url: 'p', public_metrics: { followers_count: 7, following_count: 3, tweet_count: 99 } } }) },
    { trecho: '/users/42/tweets', resposta: (chamada) => {
      const url = new URL(chamada.url)
      assert.ok(url.searchParams.get('start_time'))
      return json({ data: [{ id: '900', text: 'post do dia', created_at: new Date(janelaDoDia(DIA).inicioMs + 60_000).toISOString(), public_metrics: { like_count: 1 } }] })
    } },
    { metodo: 'POST', trecho: '/tweets', resposta: (chamada) => json({ data: { id: '901', text: JSON.parse(chamada.body).text } }, 201) },
    { metodo: 'POST', trecho: '/oauth2/token', resposta: (chamada) => {
      const form = new URLSearchParams(chamada.body)
      if (form.get('grant_type') === 'refresh_token') return json({ access_token: 'novo', refresh_token: 'r2', expires_in: 7200 })
      return json({ access_token: 'tok', refresh_token: 'r1', expires_in: 7200 })
    } },
  ]
}

test('token colado manualmente conecta e publica dentro do limite', async (t) => {
  const rede = redeFalsa(rotasX())
  const conexao = criarConexaoX({ cofre: cofreEmMemoria(t), fetchImpl: rede.fetchImpl })
  await assert.rejects(conexao.configurar({}), /Client ID|token/)
  const estado = await conexao.configurar({ accessToken: 'token-manual' })
  assert.equal(estado.online, true)
  assert.equal(estado.conta.login, 'lucasol')
  assert.equal(estado.origemCredencial, 'token')

  await assert.rejects(conexao.prepararPublicacao({ texto: 'x'.repeat(281) }), /excede 280/)
  const preparada = await conexao.prepararPublicacao({ texto: 'Olá mundo', respostaA: '123' })
  assert.equal(preparada.tipo, 'resposta')
  const recibo = await conexao.publicar(preparada.payload)
  assert.equal(recibo.url, 'https://x.com/lucasol/status/901')
  const envio = rede.chamadas.find((chamada) => chamada.url.endsWith('/tweets'))
  assert.deepEqual(JSON.parse(envio.body), { text: 'Olá mundo', reply: { in_reply_to_tweet_id: '123' } })
  assert.equal(envio.headers.Authorization, 'Bearer token-manual')
})

test('sinais do dia consultam os posts do usuário e o token expirado é renovado', async (t) => {
  const cofre = cofreEmMemoria(t)
  let agora = Date.parse('2026-09-05T15:00:00Z')
  const rede = redeFalsa(rotasX())
  const conexao = criarConexaoX({ cofre, fetchImpl: rede.fetchImpl, now: () => agora })
  await cofre.guardar('x', { clientId: 'cid', accessToken: 'velho', refreshToken: 'r0', expiraEm: agora - 1 })
  const resultado = await conexao.sinais(janelaDoDia(DIA))
  assert.equal(resultado.itens.length, 1)
  assert.equal(resultado.itens[0].url, 'https://x.com/lucasol/status/900')
  const renovacao = rede.chamadas.find((chamada) => chamada.url.includes('/oauth2/token'))
  assert.equal(new URLSearchParams(renovacao.body).get('grant_type'), 'refresh_token')
  assert.equal((await cofre.ler('x')).accessToken, 'novo')
})

test('autorização OAuth abre URL com PKCE e conclui pelo retorno em loopback', async (t) => {
  const cofre = cofreEmMemoria(t)
  const rede = redeFalsa(rotasX())
  let janelaAberta = null
  const conexao = criarConexaoX({
    cofre,
    fetchImpl: rede.fetchImpl,
    abrirAutorizacao: async ({ url, partition }) => {
      janelaAberta = { url, partition, fechada: false }
      return { fechar: () => { janelaAberta.fechada = true } }
    },
  })
  await conexao.configurar({ clientId: 'cid' })
  const { url, estado } = await conexao.autorizar()
  assert.equal(estado, 'aguardando')
  const parametros = new URL(url).searchParams
  assert.equal(parametros.get('code_challenge_method'), 'S256')
  assert.equal(parametros.get('redirect_uri'), 'http://127.0.0.1:47832/callback')
  assert.equal(janelaAberta.partition, 'persist:conexao-x')

  const retorno = await fetch(`http://127.0.0.1:47832/callback?state=${parametros.get('state')}&code=abc`)
  assert.equal(retorno.status, 200)
  for (let tentativa = 0; tentativa < 50 && conexao.statusAutorizacao().estado === 'aguardando'; tentativa += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(conexao.statusAutorizacao().estado, 'concluida')
  assert.equal(janelaAberta.fechada, true)
  const troca = rede.chamadas.find((chamada) => chamada.url.includes('/oauth2/token'))
  const form = new URLSearchParams(troca.body)
  assert.equal(form.get('code'), 'abc')
  assert.ok(form.get('code_verifier'))
  assert.equal((await cofre.ler('x')).refreshToken, 'r1')
  assert.equal((await conexao.status()).origemCredencial, 'oauth')
})

test('retorno com estado errado é recusado e o servidor de callback continua esperando', async () => {
  const pkce = gerarPkce()
  assert.notEqual(pkce.verifier, pkce.challenge)
  const promessa = aguardarCallback({ porta: 47899, estado: 'certo', timeoutMs: 2_000 })
  const errado = await fetch('http://127.0.0.1:47899/callback?state=errado&code=1')
  assert.equal(errado.status, 400)
  const certo = await fetch('http://127.0.0.1:47899/callback?state=certo&code=ok')
  assert.equal(certo.status, 200)
  assert.deepEqual(await promessa, { code: 'ok' })
})
