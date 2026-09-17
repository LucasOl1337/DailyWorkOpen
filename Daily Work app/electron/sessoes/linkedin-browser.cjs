// Executado SOMENTE pelo hub agent-bench, em seu display e sob a trava humana.
// A página não fornece código, comandos ou URLs arbitrárias ao host.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { chromium } = require('playwright-core')
const ROOT = 'https://www.linkedin.com'
const erro = (codigo, mensagem) => Object.assign(new Error(mensagem), { codigo })
const normalizar = (s) =>
  String(s || '')
    .replace(/\r\n/g, '\n')
    .trim()
function perfilUrl(url) {
  try {
    const u = new URL(url, ROOT)
    return u.origin === ROOT && /^\/in\/[^/]+\/?$/.test(u.pathname)
      ? ROOT + u.pathname.replace(/\/$/, '')
      : null
  } catch {
    return null
  }
}
async function textoEditor(editor) {
  return editor.evaluate((elemento) => {
    const blocos = [...elemento.childNodes]
    // ProseMirror representa cada linha por um parágrafo, inclusive as vazias.
    // innerText inclui espaçamento visual entre blocos e não preserva o texto.
    if (!blocos.length || !blocos.every((no) => no.nodeName === 'P')) return elemento.innerText
    function texto(no) {
      if (no.nodeType === Node.TEXT_NODE) return no.textContent
      if (no.nodeName === 'BR') return no.classList.contains('ProseMirror-trailingBreak') ? '' : '\n'
      return [...no.childNodes].map(texto).join('')
    }
    return blocos.map(texto).join('\n')
  })
}
async function pngDoCartao(locator) {
  try {
    const buffer = await locator.screenshot({ type: 'png' })
    return buffer?.length ? buffer.toString('base64') : null
  } catch {
    return null
  }
}

async function conferirPublicacao(page, entrada, url, { exigirTexto = true } = {}) {
  const match = String(url).match(/^https:\/\/www\.linkedin\.com\/feed\/update\/(urn:li:activity:\d+)\/?$/)
  if (!match) throw erro('RECIBO_INVALIDO', 'Link de publicação inválido.')
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
  const card = page.locator(`main [data-urn="${match[1]}"]`)
  await card.first().waitFor({ state: 'visible', timeout: 7000 }).catch(() => {})
  if ((await card.count()) === 1) {
    const conteudo = card.locator('.update-components-text')
    const midiasEsperadas = (entrada.midias || []).length
    const midiasPublicadas = await card.locator('img[src*="/feedshare-"]').count()
    const autores = await card.locator('a.update-components-actor__meta-link[href*="/in/"]').evaluateAll((es) =>
      es.filter((e) => e.getBoundingClientRect().height).map((e) => e.getAttribute('href')),
    )
    const textoPublicado = await conteudo.innerText().catch(() => '')
    const textoOk = !exigirTexto || ((await conteudo.count()) === 1 && normalizar(textoPublicado) === normalizar(entrada.texto))
    const midiasOk = !exigirTexto || midiasPublicadas === midiasEsperadas
    if (page.url().replace(/\/$/, '') === url.replace(/\/$/, '') &&
      autores.some((a) => perfilUrl(a) === entrada.perfilUrl) &&
      textoOk &&
      midiasOk) {
      const comprovantePng = await pngDoCartao(card.first())
      if (!exigirTexto && !comprovantePng) throw erro('COMPROVANTE_FALHOU', 'Não foi possível capturar o comprovante do post no LinkedIn.')
      return {
        id: match[1],
        url,
        perfilUrl: entrada.perfilUrl,
        texto: exigirTexto ? entrada.texto : textoPublicado,
        midias: midiasPublicadas,
        ...(comprovantePng ? { comprovantePng } : {}),
      }
    }
  }
  throw erro('RESULTADO_INCERTO', 'O envio pode ter ocorrido; confira o perfil antes de tentar novamente.')
}
async function operar(entrada) {
  const base = path.join(os.homedir(), '.agents/desktop/sessions/dailywork-redes')
  const info = JSON.parse(
    fs.readFileSync(
      path.join('/run/user', String(process.getuid()), 'agent-bench/dailywork-redes/session.json'),
      'utf8',
    ),
  )
  if (
    !process.env.DISPLAY ||
    process.env.DISPLAY !== info.display ||
    info.state !== base ||
    info.display === ':0'
  )
    throw erro('ISOLAMENTO_INVALIDO', 'O driver exige o display próprio da bancada.')
  const [porta, ws] = fs
    .readFileSync(path.join(base, 'chromium/DevToolsActivePort'), 'utf8')
    .trim()
    .split('\n')
  if (!/^\d+$/.test(porta) || !/^\/devtools\/browser\/[\w-]+$/.test(ws))
    throw erro('DRIVER_OFFLINE', 'Endpoint local inválido.')
  const browser = await chromium.connectOverCDP(`ws://127.0.0.1:${porta}${ws}`, { timeout: 5000 })
  try {
    const context = browser.contexts()[0]
    return await operarContexto(context, entrada)
  } finally {
    // Em conexão CDP, close desconecta o cliente; preserva navegador e abas.
    await browser.close()
  }
}
async function operarContexto(context, entrada) {
  if (entrada.acao === 'importar') {
    let importados = 0
    for (const cookie of entrada.cookies || []) {
      const host = cookie.domain || new URL(cookie.url).hostname
      if (!/(^|\.)linkedin\.com$/.test(host)) continue
      try {
        await context.addCookies([
          {
            name: cookie.name,
            value: cookie.value,
            domain: host,
            path: cookie.path || '/',
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: { lax: 'Lax', strict: 'Strict', no_restriction: 'None' }[cookie.sameSite] || 'Lax',
            expires: cookie.expirationDate || -1,
          },
        ])
        importados++
      } catch {
        /* não incluir conteúdo nem diagnóstico de cookies */
      }
    }
    return { importados }
  }
  let page = context.pages().find((p) => p.url().startsWith(ROOT + '/'))
  if (!page) page = await context.newPage()
  page.setDefaultTimeout(7000)
  page.setDefaultNavigationTimeout(15000)
  const editor = () => page.locator(
    '[componentkey="ShareBox_textEditor"][contenteditable="true"][role="textbox"]',
  )
  const compositor = () => page.locator('dialog[data-testid="dialog"]').filter({ has: editor() })
  async function contarMidias() {
    const dialogo = compositor()
    if ((await dialogo.count()) !== 1) return 0
    return dialogo
      .locator('[componentkey="ShareBoxpreviewCard"] img[src^="blob:"]')
      .count()
  }
  async function anexarMidias(midias = []) {
    if (!midias.length) return 0
    const abrirMidia = page.getByRole('button', { name: /^(Mídia|Media)$/i })
    if ((await abrirMidia.count()) !== 1)
      throw erro('PAGINA_ALTERADA', 'O seletor de imagens do LinkedIn não foi identificado.')
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 8000 }),
      abrirMidia.click(),
    ])
    await chooser.setFiles(midias.map((midia) => midia.arquivo))
    const avancar = page
      .getByRole('contentinfo')
      .getByRole('button', { name: /^(Avançar|Next)$/i })
    await avancar.first().waitFor({ state: 'visible', timeout: 10000 })
    if ((await avancar.count()) !== 1)
      throw erro('PAGINA_ALTERADA', 'O editor de imagens do LinkedIn ficou ambíguo.')
    await avancar.click()
    await compositor()
      .locator('[componentkey="ShareBoxpreviewCard"] img[src^="blob:"]')
      .nth(midias.length - 1)
      .waitFor({ state: 'visible', timeout: 10000 })
    const quantidade = await contarMidias()
    if (quantidade !== midias.length)
      throw erro('MIDIA_DIVERGENTE', 'O LinkedIn não confirmou todas as imagens aprovadas.')
    return quantidade
  }
  async function identidade(navegar = true) {
    if (navegar) await page.goto(ROOT + '/in/me/', { waitUntil: 'domcontentloaded' })
    await page.waitForURL((u) => !u.pathname.startsWith('/in/me'), { timeout: 8000 }).catch(() => {})
    if (/\/login|\/uas\/|\/signup|\/checkpoint|\/authwall/.test(page.url()))
      return { sessao: /checkpoint/.test(page.url()) ? 'desafio' : 'login_necessario', contaVerificada: null }
    const url = perfilUrl(page.url())
    if (!url) return { sessao: 'desconhecida', contaVerificada: null }
    const nome =
      normalizar(
        await page
          .locator('h1')
          .first()
          .innerText()
          .catch(() => ''),
      ) || normalizar((await page.title()).replace(/\s*\|\s*LinkedIn.*$/, ''))
    if (!nome) return { sessao: 'desconhecida', contaVerificada: null }
    return { sessao: 'autenticada', contaVerificada: { perfilUrl: url, nome } }
  }
  if (entrada.acao === 'verificar') return await identidade()
  if (entrada.acao === 'capturar') {
    const estado = await identidade()
    if (estado.sessao !== 'autenticada') throw erro('LOGIN_NECESSARIO', 'Confirme o login na bancada.')
    if (estado.contaVerificada?.perfilUrl !== entrada.perfilUrl)
      throw erro('CONTA_DIVERGENTE', 'A conta aberta não é a conta vinculada.')
    return conferirPublicacao(page, entrada, entrada.url, { exigirTexto: false })
  }
  if (entrada.acao === 'consultar') {
    const estado = await identidade()
    if (estado.sessao !== 'autenticada') return estado
    if (entrada.perfilUrl && estado.contaVerificada.perfilUrl !== entrada.perfilUrl)
      throw erro('CONTA_DIVERGENTE', 'A conta aberta não é a conta vinculada.')
    return {
      ...estado,
      url: page.url(),
      texto: (await page.locator('main').innerText()).slice(0, 12000),
      cobertura: 'Página de perfil visível; não representa histórico completo.',
    }
  }
  if (entrada.acao === 'descartar') {
    const dialogo = compositor()
    if ((await dialogo.count()) !== 1) return { descartado: false }
    const fechar = dialogo.locator(
      ':scope > button[aria-label="Fechar"], :scope > button[aria-label="Close"]',
    )
    if ((await fechar.count()) !== 1)
      throw erro('PAGINA_ALTERADA', 'O fechamento do compositor ficou ambíguo.')
    await fechar.click()
    const descartar = page.getByRole('button', { name: /^(Descartar|Discard)$/i })
    await descartar.first().waitFor({ state: 'visible' })
    if ((await descartar.count()) !== 1)
      throw erro('PAGINA_ALTERADA', 'A confirmação de descarte ficou ambígua.')
    await descartar.click()
    await editor().waitFor({ state: 'hidden' })
    return { descartado: true }
  }
  if (!['preparar', 'enviar'].includes(entrada.acao)) throw erro('ACAO_INVALIDA', 'Ação não permitida.')
  if (!perfilUrl(entrada.perfilUrl) || !normalizar(entrada.texto) || [...entrada.texto].length > 3000)
    throw erro('CONTEUDO_INVALIDO', 'Conta ou texto inválido.')
  if (entrada.acao === 'preparar') {
    const estado = await identidade()
    if (estado.contaVerificada?.perfilUrl !== entrada.perfilUrl)
      throw erro('CONTA_DIVERGENTE', 'Verifique o login e a conta da bancada.')
    await page.goto(ROOT + '/feed/', { waitUntil: 'domcontentloaded' })
    const abrir = page.getByText(/^(Começar publicação|Comece uma publicação|Start a post)$/i)
    await abrir.first().waitFor({ state: 'visible' })
    if ((await abrir.count()) !== 1)
      throw erro('PAGINA_ALTERADA', 'O compositor do LinkedIn não foi identificado com segurança.')
    await abrir.click()
    const campo = editor()
    await campo.first().waitFor({ state: 'visible' })
    if ((await campo.count()) !== 1)
      throw erro('PAGINA_ALTERADA', 'Editor ambíguo; revise a página na bancada.')
    if (normalizar(await textoEditor(campo)))
      throw erro(
        'RASCUNHO_EXISTENTE',
        'O compositor já contém um rascunho; revise-o na bancada antes de continuar.',
      )
    await campo.fill(entrada.texto)
    const midias = await anexarMidias(entrada.midias)
    return {
      preparado: normalizar(await textoEditor(campo)) === normalizar(entrada.texto),
      midias,
    }
  }
  // Apenas esta ação contém um clique final. O coordenador persiste a intenção
  // antes de chamá-la. Mudança de tela, autor, público ou texto bloqueia envio.
  if (Date.now() > entrada.expiraEm) throw erro('APROVACAO_EXPIRADA', 'A janela de envio expirou.')
  if (page.url() !== ROOT + '/sharing/compose')
    throw erro('PAGINA_ALTERADA', 'A página mudou antes do envio.')
  const campo = editor()
  if ((await campo.count()) !== 1 || normalizar(await textoEditor(campo)) !== normalizar(entrada.texto))
    throw erro('CONTEUDO_DIVERGENTE', 'O texto do compositor mudou.')
  if (await contarMidias() !== (entrada.midias || []).length)
    throw erro('MIDIA_DIVERGENTE', 'As imagens do compositor mudaram.')
  // Confere identidade por navegação numa página auxiliar da MESMA sessão.
  const original = page
  const auxiliar = await context.newPage()
  auxiliar.setDefaultTimeout(7000)
  auxiliar.setDefaultNavigationTimeout(15000)
  try {
    page = auxiliar
    const atual = await identidade()
    if (atual.contaVerificada?.perfilUrl !== entrada.perfilUrl)
      throw erro('CONTA_DIVERGENTE', 'A conta mudou antes do envio.')
  } finally {
    await auxiliar.close()
    page = original
  }
  const publico = page.getByRole('button', { name: /^(Publicar para qualquer pessoa|Post to anyone)$/i })
  if ((await publico.count()) !== 1)
    throw erro('PUBLICO_NAO_VERIFICADO', 'Confira a visibilidade pública do post na bancada.')
  const autorCompositor = page.getByRole('button', { name: entrada.nome, exact: true })
  if (!entrada.nome || (await autorCompositor.count()) !== 1)
    throw erro('CONTA_DIVERGENTE', 'O autor selecionado no compositor não é o perfil aprovado.')
  if (Date.now() > entrada.expiraEm) throw erro('APROVACAO_EXPIRADA', 'A janela de envio expirou.')
  // Revalidar conteúdo depois de observar a identidade na página auxiliar.
  if (normalizar(await textoEditor(campo)) !== normalizar(entrada.texto))
    throw erro('CONTEUDO_DIVERGENTE', 'O texto mudou antes do clique final.')
  const publicar = page.getByRole('button', { name: /^(Post|Publicar)$/ })
  if ((await publicar.count()) !== 1) throw erro('PAGINA_ALTERADA', 'Botão de publicação ambíguo.')
  const verPost = page.getByRole('alert').getByRole('link', { name: /^(Ver publicação|View post)$/i })
  if (await verPost.count())
    throw erro('ESTADO_ANTERIOR', 'Existe um recibo anterior na tela; revise a bancada.')
  await publicar.click()
  await campo.waitFor({ state: 'hidden', timeout: 12000 })
  await verPost
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => {})
  if ((await verPost.count()) === 1) {
    const url = new URL(await verPost.getAttribute('href'), ROOT).href
    return conferirPublicacao(page, entrada, url)
  }
  throw erro('RESULTADO_INCERTO', 'O envio pode ter ocorrido; confira o perfil antes de tentar novamente.')
}
if (require.main === module) {
  let input = ''
  process.stdin.on('data', (chunk) => {
    input += chunk
    if (input.length > 2 * 1024 * 1024) process.exit(1)
  })
  process.stdin.on('end', async () => {
    try {
      process.stdout.write(JSON.stringify({ ok: true, data: await operar(JSON.parse(input)) }))
    } catch (e) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          erro: {
            codigo: e.codigo || 'DRIVER_ERRO',
            mensagem: e.codigo ? e.message : 'A página não pôde ser operada com segurança.',
          },
        }),
      )
    }
  })
}
module.exports = { operar, operarContexto, perfilUrl, conferirPublicacao }
