const test = require('node:test')
const assert = require('node:assert/strict')
const { criarConexaoReddit } = require('../electron/integracoes/reddit.cjs')
const { janelaDoDia } = require('../electron/sumario/shared.cjs')
const { json, redeFalsa, cofreEmMemoria } = require('./integracoes-suporte.cjs')

const DIA = '2026-09-05'
const criadoNoDia = Math.floor((janelaDoDia(DIA).inicioMs + 7200_000) / 1000)

function rotasReddit() {
  return [
    { metodo: 'POST', trecho: 'reddit.com/api/v1/access_token', resposta: (chamada) => {
      assert.match(chamada.headers.Authorization, /^Basic /)
      assert.match(chamada.headers['User-Agent'], /dailywork/)
      return json({ access_token: 'rtok', expires_in: 3600 })
    } },
    { trecho: '/api/v1/me', resposta: json({ name: 'lucasol', icon_img: 'https://i/x.png?x=1', total_karma: 120, link_karma: 100, comment_karma: 20, subreddit: { title: 'Lucas', public_description: 'oi' } }) },
    { trecho: '/user/lucasol/submitted', resposta: json({ data: { children: [
      { data: { name: 't3_a', title: 'Post do dia', selftext: 'texto', created_utc: criadoNoDia, permalink: '/r/x/comments/a', subreddit: 'x', score: 4 } },
      { data: { name: 't3_b', title: 'Antigo', created_utc: criadoNoDia - 86400 * 3, permalink: '/r/x/comments/b', subreddit: 'x' } },
    ] } }) },
    { trecho: '/user/lucasol/comments', resposta: json({ data: { children: [{ data: { name: 't1_c', body: 'comentário', created_utc: criadoNoDia + 10, permalink: '/r/x/comments/a/c', subreddit: 'x', link_title: 'Post do dia' } }] } }) },
    { metodo: 'POST', trecho: '/api/submit', resposta: (chamada) => {
      const form = new URLSearchParams(chamada.body)
      if (form.get('sr') === 'proibido') return json({ json: { errors: [['SUBREDDIT_NOTALLOWED', 'sem permissão', 'sr']] } })
      return json({ json: { errors: [], data: { name: 't3_novo', url: 'https://www.reddit.com/r/x/comments/novo' } } })
    } },
    { metodo: 'POST', trecho: '/api/comment', resposta: json({ json: { errors: [], data: { things: [{ data: { name: 't1_novo', permalink: '/r/x/comments/a/novo' } }] } } }) },
  ]
}

test('credenciais do app script obtêm token por password grant e leem o perfil', async (t) => {
  const rede = redeFalsa(rotasReddit())
  const conexao = criarConexaoReddit({ cofre: cofreEmMemoria(t), fetchImpl: rede.fetchImpl })
  await assert.rejects(conexao.configurar({ clientId: 'a' }), /obrigatório/)
  const estado = await conexao.configurar({ clientId: 'a', clientSecret: 'b', username: 'lucasol', password: 'c' })
  assert.equal(estado.online, true)
  assert.equal(estado.conta.avatar, 'https://i/x.png')
  const perfil = await conexao.perfil()
  assert.equal(perfil.karma, 120)
  assert.equal(rede.chamadas.filter((chamada) => chamada.url.includes('access_token')).length, 1, 'token em cache')
})

test('sinais do dia unem posts e comentários dentro da janela', async (t) => {
  const conexao = criarConexaoReddit({ cofre: cofreEmMemoria(t), fetchImpl: redeFalsa(rotasReddit()).fetchImpl })
  await conexao.configurar({ clientId: 'a', clientSecret: 'b', username: 'lucasol', password: 'c' })
  const resultado = await conexao.sinais(janelaDoDia(DIA))
  assert.deepEqual(resultado.itens.map((item) => item.id), ['t3_a', 't1_c'])
  assert.equal(resultado.itens[0].url, 'https://www.reddit.com/r/x/comments/a')
})

test('post e comentário passam pela validação e erros da API viram mensagens', async (t) => {
  const rede = redeFalsa(rotasReddit())
  const conexao = criarConexaoReddit({ cofre: cofreEmMemoria(t), fetchImpl: rede.fetchImpl })
  await conexao.configurar({ clientId: 'a', clientSecret: 'b', username: 'lucasol', password: 'c' })
  await assert.rejects(conexao.prepararPublicacao({ tipo: 'post', subreddit: 'x' }), /obrigatórios/)
  await assert.rejects(conexao.prepararPublicacao({ tipo: 'link', subreddit: 'x', titulo: 't', url: 'ftp://x' }), /URL http/)
  const post = await conexao.prepararPublicacao({ tipo: 'post', subreddit: 'x', titulo: 'Título', texto: 'corpo' })
  const recibo = await conexao.publicar(post.payload)
  assert.equal(recibo.id, 't3_novo')
  const envio = rede.chamadas.find((chamada) => chamada.url.endsWith('/api/submit'))
  assert.equal(new URLSearchParams(envio.body).get('kind'), 'self')

  const negado = await conexao.prepararPublicacao({ tipo: 'post', subreddit: 'proibido', titulo: 'Título', texto: 'corpo' })
  await assert.rejects(conexao.publicar(negado.payload), /sem permissão/)

  const comentario = await conexao.prepararPublicacao({ tipo: 'comentario', alvo: 't3_a', texto: 'oi' })
  assert.equal((await conexao.publicar(comentario.payload)).url, 'https://www.reddit.com/r/x/comments/a/novo')
})
