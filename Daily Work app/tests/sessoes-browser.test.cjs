const nodeTest = require('node:test')
const fs = require('node:fs')
const { existsSync } = fs
const os = require('node:os')
const path = require('node:path')
const test = (nome, fn) => nodeTest(nome, { skip: !existsSync('/usr/bin/chromium') }, fn)
const assert = require('node:assert/strict')
const { chromium } = require('playwright-core')
const { operarContexto, conferirPublicacao } = require('../electron/sessoes/linkedin-browser.cjs')

// Chromium descartável, sem cookies, com TODAS as requisições interceptadas.
// A marcação do compositor reproduz os atributos observados no site em 09/09.
async function paginaIsolada(t, { publico = 'Publicar para qualquer pessoa', rascunho = '', paragrafos = false, textoPublicado = 'Texto aprovado', midiasPublicadas = 0 } = {}) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext()
  const envios = []
  await context.exposeFunction('registrarEnvio', (texto) => envios.push(texto))
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'https://www.linkedin.com') return route.abort()
    if (url.pathname === '/in/me/') return route.fulfill({ status: 302, headers: { location: '/in/teste/' } })
    let html = ''
    if (url.pathname === '/in/teste/') html = '<title>Teste | LinkedIn</title><main><h1>Teste</h1></main>'
    if (url.pathname === '/feed/') html = '<p onclick="location.href=\'/sharing/compose\'">Começar publicação</p>'
    if (url.pathname === '/sharing/compose') html = `<dialog data-testid="dialog" open><button id="fechar" aria-label="Fechar"></button>
      <div role="button">Teste</div><div role="button">${publico}</div>
      <div componentkey="ShareBox_textEditor" role="textbox" contenteditable="true">${rascunho}</div>
      <input id="arquivos" type="file" multiple hidden><button id="midia" aria-label="Mídia"></button>
      <div id="previews"></div><footer role="contentinfo" hidden><button id="avancar">Avançar</button></footer>
      <button id="publicar">Publicar</button></dialog><script>
        document.querySelector('#midia').onclick=()=>document.querySelector('#arquivos').click();
        document.querySelector('#arquivos').onchange=()=>document.querySelector('footer').hidden=false;
        document.querySelector('#avancar').onclick=()=>{
          const total=document.querySelector('#arquivos').files.length;
          document.querySelector('#previews').innerHTML='<div componentkey="ShareBoxpreviewCard">'+Array.from({length:total},(_,i)=>'<img src="blob:https://www.linkedin.com/test-'+i+'"><button aria-label="Close"></button>').join('')+'</div>';
          document.querySelector('footer').hidden=true;
        };
        document.querySelector('#fechar').onclick=()=>{
          const aviso=document.createElement('dialog'); aviso.open=true;
          aviso.innerHTML='<button id="descartar">Descartar</button>';
          document.body.append(aviso);
          aviso.querySelector('#descartar').onclick=()=>document.querySelector('dialog[data-testid="dialog"]').remove();
        };
        if (${paragrafos}) document.querySelector('[contenteditable]').oninput = (event) => {
          const editor = event.currentTarget;
          if (editor.innerText.trim().replace(/\\s+/g, ' ') !== ${JSON.stringify(textoPublicado.replace(/\s+/g, ' '))}) return;
          editor.oninput = null;
          const linhas = ${JSON.stringify(textoPublicado)}.split('\\n');
          editor.replaceChildren(...linhas.map(linha => {
            const p = document.createElement('p');
            if (linha) p.textContent = linha;
            else { const br = document.createElement('br'); br.className = 'ProseMirror-trailingBreak'; p.append(br); }
            return p;
          }));
        };
        document.querySelector('#publicar').onclick=()=>{
          window.registrarEnvio(document.querySelector('[contenteditable]').innerText);
          document.body.innerHTML='<div role="alert"><a href="/feed/update/urn:li:activity:123/">Ver publicação</a></div>';
        }
      </script>`
    if (url.pathname === '/feed/update/urn:li:activity:123/') html = '<main><article data-urn="urn:li:activity:123"><a class="update-components-actor__meta-link" href="/in/teste/?miniProfileUrn=teste">Teste</a><div class="update-components-text"><span dir="ltr">' + textoPublicado.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<span><br></span>') + '</span></div>' + Array.from({ length: midiasPublicadas }, (_, i) => `<img src="https://media.licdn.com/dms/image/feedshare-${i}">`).join('') + '</article></main>'
    if (!html) return route.abort()
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  })
  const page = await context.newPage()
  await page.goto('https://www.linkedin.com/feed/')
  return { context, envios, page }
}
const entrada = { texto: 'Texto aprovado', nome: 'Teste', perfilUrl: 'https://www.linkedin.com/in/teste', expiraEm: Date.now() + 600_000 }

test('driver prepara sem enviar e só aceita recibo da publicação após clique autorizado', async (t) => {
  const f = await paginaIsolada(t)
  assert.equal((await operarContexto(f.context, { ...entrada, acao: 'preparar' })).preparado, true)
  assert.deepEqual(f.envios, [])
  const recibo = await operarContexto(f.context, { ...entrada, acao: 'enviar' })
  assert.deepEqual(f.envios, ['Texto aprovado'])
  assert.equal(recibo.id, 'urn:li:activity:123')
})

test('driver preserva rascunho que já existe na sessão', async (t) => {
  const f = await paginaIsolada(t, { rascunho: 'Rascunho humano' })
  await assert.rejects(() => operarContexto(f.context, { ...entrada, acao: 'preparar' }), e => e.codigo === 'RASCUNHO_EXISTENTE')
  assert.equal(await f.page.getByRole('textbox').innerText(), 'Rascunho humano')
  assert.deepEqual(f.envios, [])
})

test('driver anexa todas as imagens aprovadas e confere a mídia no recibo', async (t) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-linkedin-browser-'))
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }))
  const arquivos = ['uma.png', 'duas.png'].map((nome) => {
    const arquivo = path.join(pasta, nome)
    fs.writeFileSync(arquivo, nome)
    return { arquivo, tipo: 'imagem', mime: 'image/png' }
  })
  const f = await paginaIsolada(t, { midiasPublicadas: 2 })
  const pedido = { ...entrada, midias: arquivos }
  const preparado = await operarContexto(f.context, { ...pedido, acao: 'preparar' })
  assert.deepEqual(preparado, { preparado: true, midias: 2 })
  assert.deepEqual(f.envios, [])
  const recibo = await operarContexto(f.context, { ...pedido, acao: 'enviar' })
  assert.equal(recibo.midias, 2)
  assert.equal(f.envios.length, 1)
})

test('driver descarta texto e imagens sem publicar', async (t) => {
  const f = await paginaIsolada(t)
  await operarContexto(f.context, { ...entrada, acao: 'preparar' })
  assert.deepEqual(await operarContexto(f.context, { acao: 'descartar' }), { descartado: true })
  assert.equal(await f.page.locator('[componentkey="ShareBox_textEditor"]').count(), 0)
  assert.deepEqual(f.envios, [])
})

test('driver compara parágrafos do ProseMirror sem contar espaçamento visual como conteúdo', async (t) => {
  const texto = 'Primeiro parágrafo.\n\nSegundo parágrafo.'
  const f = await paginaIsolada(t, { paragrafos: true, textoPublicado: texto })
  const pedido = { ...entrada, texto }
  const preparado = await operarContexto(f.context, { ...pedido, acao: 'preparar' })
  assert.equal(preparado.preparado, true, await f.page.getByRole('textbox').innerHTML())
  assert.notEqual(await f.page.getByRole('textbox').innerText(), texto)
  assert.deepEqual(f.envios, [])
  const recibo = await operarContexto(f.context, { ...pedido, acao: 'enviar' })
  assert.equal(recibo.texto, texto)
  assert.equal(f.envios.length, 1)
})

test('driver recusa público diferente e alterações no compositor', async (t) => {
  const f = await paginaIsolada(t, { publico: 'Publicar para conexões' })
  await operarContexto(f.context, { ...entrada, acao: 'preparar' })
  await assert.rejects(() => operarContexto(f.context, { ...entrada, acao: 'enviar' }), e => e.codigo === 'PUBLICO_NAO_VERIFICADO')
  await f.page.getByRole('textbox').fill('Texto alterado')
  await assert.rejects(() => operarContexto(f.context, { ...entrada, acao: 'enviar' }), e => e.codigo === 'CONTEUDO_DIVERGENTE')
  assert.deepEqual(f.envios, [])
})

test('driver exige o autor aprovado no compositor e validade da aprovação', async (t) => {
  const f = await paginaIsolada(t)
  await operarContexto(f.context, { ...entrada, acao: 'preparar' })
  await assert.rejects(() => operarContexto(f.context, { ...entrada, acao: 'enviar', nome: 'Outro autor' }), e => e.codigo === 'CONTA_DIVERGENTE')
  await assert.rejects(() => operarContexto(f.context, { ...entrada, acao: 'enviar', expiraEm: 0 }), e => e.codigo === 'APROVACAO_EXPIRADA')
  assert.deepEqual(f.envios, [])
})

test('conferência do permalink exige texto e autor do próprio card sem realizar envios', async (t) => {
  const f = await paginaIsolada(t)
  const url = 'https://www.linkedin.com/feed/update/urn:li:activity:123/'
  await assert.rejects(() => conferirPublicacao(f.page, { ...entrada, texto: 'Outro texto' }, url), e => e.codigo === 'RESULTADO_INCERTO')
  await assert.rejects(() => conferirPublicacao(f.page, { ...entrada, perfilUrl: 'https://www.linkedin.com/in/outra' }, url), e => e.codigo === 'RESULTADO_INCERTO')
  const recibo = await conferirPublicacao(f.page, entrada, url)
  assert.equal(recibo.id, 'urn:li:activity:123')
  assert.match(recibo.comprovantePng || '', /^iVBOR/)
  assert.deepEqual(f.envios, [])
})
