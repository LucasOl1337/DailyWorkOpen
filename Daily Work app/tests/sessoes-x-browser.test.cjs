const nodeTest = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { existsSync } = require('node:fs')
const test = (nome, fn) => nodeTest(nome, { skip: !existsSync('/usr/bin/chromium') }, fn)
const { chromium } = require('playwright-core')
const { operarContexto, idTweet } = require('../electron/sessoes/x-browser.cjs')

async function paginaIsolada(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-x-browser-'))
  const imagens = [path.join(dir, 'uma.png'), path.join(dir, 'duas.png')]
  imagens.forEach((arquivo) => fs.writeFileSync(arquivo, 'imagem'))
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true })
  t.after(async () => { await browser.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const context = await browser.newContext()
  const envios = []
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== 'https://x.com') return route.abort()
    if (/CreateTweet/.test(url.pathname) && request.method() === 'POST') {
      envios.push(request.postData())
      return route.fulfill({ json: { data: { create_tweet: { tweet_results: { result: { rest_id: '123', core: {} } } } } } })
    }
    let html = ''
    if (url.pathname === '/home') html = '<a data-testid="AppTabBar_Profile_Link" href="/example_user">Perfil</a><div data-testid="SideNav_AccountSwitcher_Button">Example User\n@example_user</div>'
    if (url.pathname === '/compose/post') html = `<div role="dialog"><div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"></div><input data-testid="fileInput" type="file" multiple><div data-testid="attachments"></div><button data-testid="tweetButton">Post</button></div><script>
      document.querySelector('[data-testid=fileInput]').onchange = (event) => {
        const area = document.querySelector('[data-testid=attachments]');
        area.replaceChildren(...[...event.target.files].map(() => document.createElement('img')));
      };
      document.querySelector('[data-testid=tweetButton]').onclick = () => fetch('/i/api/graphql/test/CreateTweet', { method: 'POST', body: '{}' });
    </script>`
    if (url.pathname === '/example_user/status/123') html = '<article data-testid="tweet"><a href="/example_user">Lucas</a><div data-testid="tweetText">Texto aprovado</div><div data-testid="tweetPhoto"><img></div><div data-testid="tweetPhoto"><img></div></article>'
    return html ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort()
  })
  return { context, imagens, envios }
}

test('driver visual do X prepara texto e imagens e só envia depois da aprovação', async (t) => {
  const fixture = await paginaIsolada(t)
  const entrada = { texto: 'Texto aprovado', nome: 'Example User', perfilUrl: 'https://x.com/example_user', midias: fixture.imagens.map((arquivo) => ({ arquivo })), expiraEm: Date.now() + 60_000 }
  assert.deepEqual(await operarContexto(fixture.context, { ...entrada, acao: 'verificar' }), { sessao: 'autenticada', contaVerificada: { perfilUrl: entrada.perfilUrl, nome: 'Example User' } })
  assert.deepEqual(await operarContexto(fixture.context, { ...entrada, acao: 'preparar' }), { preparado: true, midias: 2 })
  assert.equal(fixture.envios.length, 0)
  const recibo = await operarContexto(fixture.context, { ...entrada, acao: 'enviar' })
  assert.equal(fixture.envios.length, 1)
  assert.equal(recibo.url, 'https://x.com/example_user/status/123')
  assert.equal(recibo.midias, 2)
  assert.match(recibo.comprovantePng || '', /^iVBOR/)
})

test('extrai o id somente de um recibo de tweet reconhecível', () => {
  assert.equal(idTweet({ data: { create_tweet: { tweet_results: { result: { rest_id: '456' } } } } }), '456')
  assert.equal(idTweet({ data: { rest_id: '456' } }), null)
})
