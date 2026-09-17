// Executado somente na bancada dailywork-redes. O clique final acontece após
// a aprovação persistida pelo coordenador de sessões visuais.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { chromium } = require('playwright-core')

const ROOT = 'https://x.com'
const RESERVADOS = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'search', 'settings', 'compose', 'login', 'signup'])
const erro = (codigo, mensagem) => Object.assign(new Error(mensagem), { codigo })
const normalizar = (valor) => String(valor || '').replace(/\r\n/g, '\n').trim()
const textoCompositor = (editor) => editor.evaluate((elemento) => elemento.innerText || '')

function perfilUrl(url) {
  try {
    const u = new URL(url, ROOT)
    const partes = u.pathname.split('/').filter(Boolean)
    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(u.hostname) || partes.length !== 1) return null
    const handle = partes[0]
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle) || RESERVADOS.has(handle.toLowerCase())) return null
    return `${ROOT}/${handle}`
  } catch {
    return null
  }
}

function idTweet(corpo) {
  const direto = corpo?.data?.create_tweet?.tweet_results?.result?.rest_id
  if (/^\d+$/.test(String(direto || ''))) return String(direto)
  const fila = [corpo]
  const vistos = new Set()
  while (fila.length) {
    const atual = fila.shift()
    if (!atual || typeof atual !== 'object' || vistos.has(atual)) continue
    vistos.add(atual)
    if (/^\d+$/.test(String(atual.rest_id || '')) && (atual.legacy?.full_text || atual.core)) return String(atual.rest_id)
    fila.push(...Object.values(atual))
  }
  return null
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
  const perfil = perfilUrl(entrada.perfilUrl)
  const handle = perfil?.split('/').pop()
  const match = String(url).match(/^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/)
  if (!perfil || !match || match[1].toLowerCase() !== handle.toLowerCase()) throw erro('RECIBO_INVALIDO', 'Link de publicação do X inválido.')
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
  const tweet = page.locator('article[data-testid="tweet"]').first()
  await tweet.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {})
  const texto = normalizar(await tweet.locator('[data-testid="tweetText"]').innerText().catch(() => ''))
  const autor = await tweet.locator(`a[href="/${handle}"]`).count()
  const fotos = await tweet.locator('[data-testid="tweetPhoto"] img').count()
  const textoOk = !exigirTexto || texto === normalizar(entrada.texto)
  const midiasOk = !exigirTexto || fotos >= (entrada.midias?.length || 0)
  if (page.url().replace(/\/$/, '') !== url || !autor || !textoOk || !midiasOk)
    throw erro('RESULTADO_INCERTO', 'O envio pode ter ocorrido; confira o perfil do X antes de tentar novamente.')
  const comprovantePng = await pngDoCartao(tweet)
  if (!exigirTexto && !comprovantePng) throw erro('COMPROVANTE_FALHOU', 'Não foi possível capturar o comprovante do post no X.')
  return {
    id: match[2],
    url,
    perfilUrl: perfil,
    texto: exigirTexto ? entrada.texto : texto,
    midias: exigirTexto ? (entrada.midias?.length || 0) : fotos,
    ...(comprovantePng ? { comprovantePng } : {}),
  }
}

async function operar(entrada) {
  const base = path.join(os.homedir(), '.agents/desktop/sessions/dailywork-redes')
  const info = JSON.parse(fs.readFileSync(path.join('/run/user', String(process.getuid()), 'agent-bench/dailywork-redes/session.json'), 'utf8'))
  if (!process.env.DISPLAY || process.env.DISPLAY !== info.display || info.state !== base || info.display === ':0')
    throw erro('ISOLAMENTO_INVALIDO', 'O driver exige o display próprio da bancada.')
  const [porta, socket] = fs.readFileSync(path.join(base, 'chromium/DevToolsActivePort'), 'utf8').trim().split('\n')
  if (!/^\d+$/.test(porta) || !/^\/devtools\/browser\/[\w-]+$/.test(socket)) throw erro('DRIVER_OFFLINE', 'Endpoint local inválido.')
  const browser = await chromium.connectOverCDP(`ws://127.0.0.1:${porta}${socket}`, { timeout: 5000 })
  try {
    return await operarContexto(browser.contexts()[0], entrada)
  } finally {
    await browser.close()
  }
}

async function operarContexto(context, entrada) {
  if (entrada.acao === 'importar') {
    let importados = 0
    for (const cookie of entrada.cookies || []) {
      const host = cookie.domain || (cookie.url ? new URL(cookie.url).hostname : '')
      if (!/(^|\.)(x|twitter)\.com$/.test(host)) continue
      try {
        await context.addCookies([{
          name: cookie.name,
          value: cookie.value,
          ...(cookie.domain ? { domain: cookie.domain } : { url: cookie.url }),
          path: cookie.path || '/',
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: { lax: 'Lax', strict: 'Strict', no_restriction: 'None' }[cookie.sameSite] || 'Lax',
          expires: cookie.expirationDate || -1,
        }])
        importados++
      } catch {
        // Nunca retornar valores nem diagnóstico de cookies.
      }
    }
    return { importados }
  }

  let page = context.pages().find((candidate) => candidate.url().startsWith(`${ROOT}/compose/post`))
    || context.pages().find((candidate) => /^https:\/\/(x\.com|twitter\.com)\//.test(candidate.url()))
  if (!page) page = await context.newPage()
  page.setDefaultTimeout(9000)
  page.setDefaultNavigationTimeout(20000)

  async function identidade(alvo = page) {
    await alvo.goto(`${ROOT}/home`, { waitUntil: 'domcontentloaded' })
    await alvo.waitForTimeout(1200)
    if (/\/i\/flow\/login|\/login/.test(alvo.url()) || await alvo.locator('input[autocomplete="username"]').count())
      return { sessao: 'login_necessario', contaVerificada: null }
    const link = alvo.locator('a[data-testid="AppTabBar_Profile_Link"]')
    const href = await link.first().getAttribute('href').catch(() => null)
    const perfil = perfilUrl(href)
    if (!perfil) return { sessao: 'desconhecida', contaVerificada: null }
    const conta = alvo.locator('[data-testid="SideNav_AccountSwitcher_Button"]')
    const handle = `@${perfil.split('/').pop()}`
    const textoConta = normalizar(await conta.first().innerText().catch(() => ''))
    const nome = textoConta.replace(handle, '').trim().split('\n').find(Boolean) || handle
    return { sessao: 'autenticada', contaVerificada: { perfilUrl: perfil, nome } }
  }

  if (entrada.acao === 'verificar') return identidade()
  if (entrada.acao === 'capturar') {
    const estado = await identidade()
    if (estado.sessao !== 'autenticada') throw erro('LOGIN_NECESSARIO', 'Confirme o login do X na bancada.')
    if (estado.contaVerificada?.perfilUrl.toLowerCase() !== String(entrada.perfilUrl || '').toLowerCase())
      throw erro('CONTA_DIVERGENTE', 'A conta do X aberta não é a conta vinculada.')
    return conferirPublicacao(page, entrada, entrada.url, { exigirTexto: false })
  }
  if (entrada.acao === 'consultar') {
    const estado = await identidade()
    if (estado.sessao !== 'autenticada') return estado
    if (entrada.perfilUrl && estado.contaVerificada.perfilUrl.toLowerCase() !== entrada.perfilUrl.toLowerCase())
      throw erro('CONTA_DIVERGENTE', 'A conta do X aberta não é a conta vinculada.')
    return { ...estado, url: estado.contaVerificada.perfilUrl, cobertura: 'Identidade autenticada visível no X.' }
  }
  if (entrada.acao === 'descartar') {
    if (page.url().startsWith(`${ROOT}/compose/post`)) {
      await page.evaluate(() => {
        const editor = document.querySelector('[data-testid="tweetTextarea_0"]')
        if (editor) {
          editor.textContent = ''
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
        }
        for (const botao of document.querySelectorAll('[data-testid="removeMedia"], button[aria-label="Remove media"], button[aria-label="Remover mídia"]')) botao.click()
      })
      await page.waitForTimeout(250)
      await page.goto(`${ROOT}/home`, { waitUntil: 'domcontentloaded' })
    }
    return { descartado: true }
  }
  if (!['preparar', 'enviar'].includes(entrada.acao)) throw erro('ACAO_INVALIDA', 'Ação não permitida.')
  if (!perfilUrl(entrada.perfilUrl) || !normalizar(entrada.texto) || [...entrada.texto].length > 280)
    throw erro('CONTEUDO_INVALIDO', 'Conta ou texto inválido para o X.')

  if (entrada.acao === 'preparar') {
    const estado = await identidade()
    if (estado.contaVerificada?.perfilUrl.toLowerCase() !== entrada.perfilUrl.toLowerCase())
      throw erro('CONTA_DIVERGENTE', 'Verifique o login e a conta do X na bancada.')
    await page.goto(`${ROOT}/compose/post`, { waitUntil: 'domcontentloaded' })
    const editor = page.locator('[role="dialog"] [data-testid="tweetTextarea_0"]')
    await editor.first().waitFor({ state: 'visible' })
    if ((await editor.count()) !== 1) throw erro('PAGINA_ALTERADA', 'O compositor do X não foi identificado com segurança.')
    if (normalizar(await editor.innerText())) throw erro('RASCUNHO_EXISTENTE', 'O compositor do X já contém um rascunho.')
    await editor.fill(entrada.texto)
    const arquivos = (entrada.midias || []).map((midia) => midia.arquivo)
    if (arquivos.length) {
      const input = page.locator('[role="dialog"] input[data-testid="fileInput"]')
      if ((await input.count()) !== 1) throw erro('PAGINA_ALTERADA', 'O controle de imagem do X não foi identificado.')
      await input.setInputFiles(arquivos)
      await page.waitForFunction((quantidade) => document.querySelectorAll('[role="dialog"] [data-testid="attachments"] img').length >= quantidade, arquivos.length, { timeout: 60000 })
    }
    return { preparado: normalizar(await textoCompositor(editor)) === normalizar(entrada.texto), midias: arquivos.length }
  }

  if (Date.now() > entrada.expiraEm) throw erro('APROVACAO_EXPIRADA', 'A janela de envio expirou.')
  if (!page.url().startsWith(`${ROOT}/compose/post`)) throw erro('PAGINA_ALTERADA', 'A página mudou antes do envio.')
  const editor = page.locator('[role="dialog"] [data-testid="tweetTextarea_0"]')
  if ((await editor.count()) !== 1 || normalizar(await textoCompositor(editor)) !== normalizar(entrada.texto))
    throw erro('CONTEUDO_DIVERGENTE', 'O texto do compositor do X mudou.')
  const quantidadeMidias = entrada.midias?.length || 0
  const previews = await page.locator('[role="dialog"] [data-testid="attachments"] img, [role="dialog"] [data-testid="tweetPhoto"] img').count()
  if (previews < quantidadeMidias) throw erro('MIDIA_DIVERGENTE', 'A mídia aprovada não está completa no compositor do X.')

  const auxiliar = await context.newPage()
  try {
    auxiliar.setDefaultTimeout(9000)
    auxiliar.setDefaultNavigationTimeout(20000)
    const atual = await identidade(auxiliar)
    if (atual.contaVerificada?.perfilUrl.toLowerCase() !== entrada.perfilUrl.toLowerCase())
      throw erro('CONTA_DIVERGENTE', 'A conta do X mudou antes do envio.')
  } finally {
    await auxiliar.close()
  }
  if (Date.now() > entrada.expiraEm) throw erro('APROVACAO_EXPIRADA', 'A janela de envio expirou.')
  if (normalizar(await textoCompositor(editor)) !== normalizar(entrada.texto)) throw erro('CONTEUDO_DIVERGENTE', 'O texto mudou antes do clique final.')
  const publicar = page.locator('[role="dialog"] [data-testid="tweetButton"]')
  if ((await publicar.count()) !== 1 || await publicar.isDisabled()) throw erro('PAGINA_ALTERADA', 'O botão de publicar do X não está disponível.')
  const respostaPromise = page.waitForResponse((resposta) => resposta.request().method() === 'POST' && /CreateTweet/.test(resposta.url()), { timeout: 20000 }).catch(() => null)
  await publicar.click()
  const resposta = await respostaPromise
  const corpo = resposta ? await resposta.json().catch(() => null) : null
  const id = idTweet(corpo)
  if (!id) throw erro('RESULTADO_INCERTO', 'O X recebeu o clique, mas não devolveu um recibo verificável.')
  const handle = perfilUrl(entrada.perfilUrl).split('/').pop()
  return conferirPublicacao(page, entrada, `${ROOT}/${handle}/status/${id}`)
}

if (require.main === module) {
  let input = ''
  process.stdin.on('data', (chunk) => {
    input += chunk
    if (input.length > 4 * 1024 * 1024) process.exit(1)
  })
  process.stdin.on('end', async () => {
    try {
      process.stdout.write(JSON.stringify({ ok: true, data: await operar(JSON.parse(input)) }))
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, erro: { codigo: e.codigo || 'DRIVER_ERRO', mensagem: e.codigo ? e.message : 'A página do X não pôde ser operada com segurança.' } }))
    }
  })
}

module.exports = { operar, operarContexto, perfilUrl, conferirPublicacao, idTweet }
