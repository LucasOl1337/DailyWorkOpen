const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { anosExperiencia, salarioDoPreset } = require('./respostas-numericas.cjs')
const { ENVIO_REVISADO, validarAcaoFormulario } = require('./envio.cjs')

const NOME_BANCADA = 'dailywork-candidaturas'
const DOMINIOS_CANDIDATURAS = ['linkedin.com','google.com','gupy.io','ashbyhq.com','lever.co','greenhouse.io','inhire.app']
function vagaLinkedInDoTitulo(url,titulo) {
  try {
    const u=new URL(url),jobId=(u.hostname.endsWith('.linkedin.com')||u.hostname==='linkedin.com')&&u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1]
    const partes=String(titulo||'').split('|').map(v=>v.trim()).filter(Boolean)
    if(!jobId||partes.length<3||!/^linkedin$/i.test(partes.at(-1)))return null
    return {url:`https://www.linkedin.com/jobs/view/${jobId}`,cargo:partes.slice(0,-2).join(' | '),empresa:partes.at(-2)}
  } catch { return null }
}
function idVagaLinkedInDaBusca(url) {
  try {
    const u = new URL(url)
    if (!(u.hostname.endsWith('.linkedin.com') || u.hostname === 'linkedin.com') || !/^\/jobs\/search\/?$/.test(u.pathname)) return null
    const id = u.searchParams.get('currentJobId')
    return /^\d+$/.test(id || '') ? id : null
  } catch { return null }
}
function normalizarTexto(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim() }
function indiceConsentimentoUnico(label, valor, opcoes) {
  if (String(valor || '').trim()) return null
  const pergunta = normalizarTexto(label)
  if (!/(consent|concordo|aceito os termos|tratamento dos meus dados|data processing)/.test(pergunta)) return null
  const validas = (opcoes || []).filter(o => !o.disabled && String(o.value || '').trim() && !/selecionar|select (an )?option|choose/i.test(o.text || ''))
  return validas.length === 1 ? validas[0].index : null
}
function valorPresetParaCampo(campo, preset) {
  const label = normalizarTexto([campo?.label, campo?.placeholder, campo?.campo].filter(Boolean).join(' '))
  const tipo = normalizarTexto(campo?.tipo)
  if (!label || ['password','radio','checkbox','file','hidden','submit','button'].includes(tipo)) return null
  if (/(work authori|authorized to work|sponsor|visa|citizenship|cidadania|nationality|passaport|passport|\bcpf\b|identity|identidade|street|address|endereco|postal|\bcep\b|disabil|deficien|health|saude|race|raca|gender|genero|veteran|orientacao sexual)/.test(label)) return null
  if (/(why (are|do|would)|por que|cover letter|carta|motivation|motivacao|tell us|conte-nos|describe|explique|additional information)/.test(label)) return null
  const i = preset?.identidade || {}, p = preset?.perfil || {}, r = preset?.respostasRapidas || {}
  const nome = i.nomeCivil || i.nomeProfissional
  if (/\b(first|given) name\b|primeiro nome/.test(label)) return nome?.split(/\s+/)[0] || null
  if (/\b(last|family|surname)\b|sobrenome/.test(label)) return nome?.split(/\s+/).slice(1).join(' ') || null
  if (/\b(full name|your name|nome completo|nome civil|nome profissional)\b/.test(label) || /(^|_)name($|_)/.test(label)) return nome || null
  if (/e-?mail/.test(label)) return i.email || null
  if (/linkedin/.test(label)) return i.linkedin || null
  if (/github/.test(label)) return i.github || null
  if (/phone|telefone|celular|mobile/.test(label)) return i.telefone || null
  if (/(where.*work.*from|city and country|cidade e pais|current location|localizacao|location)/.test(label)) return i.localizacao || null
  if (/(current company|company where you work|empresa (em que|onde).*(trabalha|trabalho)|empresa atual)/.test(label)) return r.empresaAtual || null
  if (/notice period/.test(label)&&/(day|dia)/.test(label)) return '0'
  if (/(earliest.*start|available.*start|availability|disponibilidade|notice period|how soon.*start)/.test(label)) return /^imediat/i.test(String(p.disponibilidade || '')) ? 'Immediately' : p.disponibilidade || null
  if (/salary|salario|pretensao|compensation/.test(label) && !/current|atual/.test(label)) return salarioDoPreset(label, preset)
  if (/(years?|anos?).*(technical|software|saas|stack|typescript|javascript|node|react|python|aws|llm|postgres|postgresql|api|frontend|backend|cloud|mobile|web)/.test(label) || /(technical|software|saas|stack|typescript|javascript|node|react|python|aws|llm|postgres|postgresql|api|frontend|backend|cloud|mobile|web).*(years?|anos?)/.test(label)) {
    const anos = anosExperiencia(label, p, r.anosStackSemValorExato)
    return anos ? String(anos.valor) : null
  }
  return null
}
function criarBancada(home) {
  return require('../automacoes/navegador.cjs').criarNavegador({home,nomeBancada:NOME_BANCADA,dominios:DOMINIOS_CANDIDATURAS})
}
// Job tabs belong to this persistent agent bench, never the human browser.
function endpointChromium(home = os.homedir()) {
  const arquivo = path.join(home, '.agents/desktop/sessions', NOME_BANCADA, 'chromium/DevToolsActivePort')
  let linhas
  try { linhas = fs.readFileSync(arquivo, 'utf8').trim().split('\n') } catch {
    throw Object.assign(new Error('Aguardando o Chromium da bancada dailywork-candidaturas (workspaces 6–11). O preparo recupera a bancada automaticamente; a espera não usa tokens.'), { codigo: 'CHROMIUM_CONEXAO_AUSENTE' })
  }
  const porta = Number(linhas[0])
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535 || !/^\/devtools\/browser\/[\w-]+$/.test(linhas[1])) throw new Error('Conexão do Chromium inválida; não foi usado outro perfil.')
  return `ws://127.0.0.1:${porta}${linhas[1]}`
}

async function fecharAvisosNaoOperacionais(pagina) {
  let fechados = 0
  for (const frame of (pagina.frames?.() || []).slice(1)) {
    const url = frame.url?.() || ''
    const corpoLocator = frame.locator?.('body')
    const corpo = typeof corpoLocator?.innerText === 'function'
      ? await corpoLocator.innerText({ timeout: 300 }).catch(() => '') || ''
      : ''
    if (!/^https:\/\/app\.getbeamer\.com\/(popup|news)/.test(url) && !/Novidades na Gupy|Candidatura enviada/.test(corpo)) continue
    const fechar = frame.locator?.('[aria-label="Close"]')
    if (!fechar || await fechar.count().catch(() => 0) !== 1) continue
    await fechar.click({ timeout: 1500 }).then(() => { fechados++ }).catch(() => {})
  }
  return fechados
}

async function validarControleFormulario(a, elemento) {
  const teclado = a.acao === 'tecla' && /enter|space/i.test(a.tecla || '')
  if ((!teclado && a.acao !== 'clicar') || a[ENVIO_REVISADO] || !elemento.evaluate) return
  const nomes = await elemento.evaluate((el, teclado) => {
    const atual = el.tagName === 'BODY' ? el.ownerDocument.activeElement : el
    const nome = e => e?.getAttribute('aria-label') || e?.innerText || e?.value || e?.textContent || ''
    const escopo = teclado && (atual?.form || atual?.closest('form,[role="dialog"]'))
    return [nome(atual), ...(escopo ? [...escopo.querySelectorAll('button,input[type="submit"]')].map(nome) : [])]
  }, teclado)
  for (const nome of Array.isArray(nomes) ? nomes : [nomes]) validarAcaoFormulario({ ...a, nome })
}

function criarNavegador({ home, chromium, autorizar, registroAbas, conferirAlvos=require('../automacoes/cdp-saude.cjs').conferirAlvosResponsivos, abrirAutomaticamente=true, bancada=criarBancada(home), abrir=()=>bancada.preparar() }) {
  let browser
  let desconectando=false
  let ultimaAbertura=0
  const paginas = new Map()
  let seq = 0
  const identidades=new Map()
  const candidaturas=new Map()
  let identidadeBrowser
  async function idDoAlvo(p) {
    const sessao=await browser.contexts()[0].newCDPSession(p)
    try{return (await sessao.send('Target.getTargetInfo')).targetInfo.targetId}finally{await sessao.detach()}
  }
  function salvarAbas() {
    if(!registroAbas)return
    const temp=registroAbas+'.tmp'
    fs.mkdirSync(path.dirname(registroAbas),{recursive:true,mode:0o700})
    fs.writeFileSync(temp,JSON.stringify({browser:identidadeBrowser,seq,abas:Object.fromEntries(identidades),candidaturas:Object.fromEntries(candidaturas)}),{mode:0o600});fs.renameSync(temp,registroAbas)
  }
  function removerPagina(id) { paginas.delete(id);identidades.delete(id);candidaturas.delete(id);salvarAbas() }
  async function registrarPagina(p,id) {
    const existente=[...paginas].find(([,pagina])=>pagina===p)
    if(existente)return existente[0]
    id ||= String(++seq);paginas.set(id,p)
    // Adopt only popups of owned pages, never arbitrary pages of this profile.
    p.on?.('popup',filha=>{void registrarPagina(filha).then(filhaId=>{if(candidaturas.has(id)){candidaturas.set(filhaId,candidaturas.get(id));salvarAbas()}}).catch(()=>{})})
    // Playwright also emits page.close when disconnecting CDP, while Chrome
    // keeps the actual tabs. Only remove a target when its connection is live.
    p.on?.('close',()=>queueMicrotask(()=>{if(!desconectando&&browser&&browser.isConnected?.()!==false)removerPagina(id)}))
    if(registroAbas){identidades.set(id,await idDoAlvo(p));salvarAbas()}
    return id
  }
  async function restaurarAbas() {
    if(!registroAbas)return
    let anterior
    try{anterior=JSON.parse(fs.readFileSync(registroAbas,'utf8'))}catch{return}
    if(anterior.browser!==identidadeBrowser)return
    seq=Number(anterior.seq)||0
    const permitidos=new Map(Object.entries(anterior.abas||{}).map(([id,target])=>[target,id]))
    for(const p of browser.contexts()[0].pages()){
      const id=permitidos.get(await idDoAlvo(p))
      if(id){await registrarPagina(p,id);if(anterior.candidaturas?.[id])candidaturas.set(id,anterior.candidaturas[id])}
    }
    salvarAbas()
  }
  async function conectar() {
    desconectando=false
    if(abrirAutomaticamente&&Date.now()-ultimaAbertura>60000){autorizar();await abrir();ultimaAbertura=Date.now()}
    const endpoint=endpointChromium(home)
    autorizar()
    await conferirAlvos(Number(new URL(endpoint).port))
    try {
      browser = await (chromium || require('playwright-core').chromium).connectOverCDP(endpoint, { timeout: 15000 })
    } catch (cause) {
      const negada=/permission denied|access denied|connection rejected|user denied/i.test(cause.message||'')
      throw Object.assign(new Error(negada?'O Chromium recusou explicitamente a conexão. Confira o acesso local configurado.':'O endpoint local do Chromium não respondeu. A agenda tentará novamente sem chamar a IA.', {cause}), {codigo:negada?'CHROMIUM_ACESSO_NEGADO':'CHROMIUM_CONEXAO_AUSENTE'})
    }
    identidadeBrowser=endpoint
    await restaurarAbas()
    return browser
  }
  async function pagina(id) {
    const p = paginas.get(String(id))
    if (!p || p.isClosed()) throw new Error('Aba indisponível. Liste as abas atuais.')
    return p
  }
  async function abas() {
    if (!browser) await conectar()
    return Promise.all([...paginas].filter(([,p])=>!p.isClosed()).map(async ([id,p])=>({id,titulo:await p.title(),url:p.url()})))
  }
  function urlPublica(url) {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.username || u.password || /^(localhost|127\.|\[|10\.|192\.168\.)/.test(u.hostname)) throw new Error('Navegação restrita a páginas HTTPS públicas de vagas e pesquisa.')
    return u.href
  }
  async function ler(id, compacto=false) {
    const p = await pagina(id)
    const url = p.url()
    const titulo = await p.title()
    const frames = []
    for (const [indice, frame] of p.frames().entries()) {
      try {
        const campos=await frame.locator('input,textarea,select').evaluateAll?.(es=>{const indices={};return es.filter(e=>(e.name||e.getAttribute('aria-label')||(e.labels||[]).length)&&e.type!=='hidden'&&e.getAttribute('aria-hidden')!=='true').map(e=>{const chave=e.name||`aria:${e.getAttribute('aria-label')||[...(e.labels||[])].map(l=>l.textContent.trim()).join(' ')}`;const indice=indices[chave]||0;indices[chave]=indice+1;const valor=e.type==='password'?'':e.type==='file'?(e.files?.length?'arquivo carregado':''):String(e.value||'').slice(0,300);return {campo:e.name||'',indice,tipo:e.type,label:[...(e.labels||[])].map(l=>l.textContent.trim()).join(' ')||e.getAttribute('aria-label')||e.getAttribute('label')||'',placeholder:e.getAttribute('placeholder')||'',valor,desabilitado:Boolean(e.disabled)}})})
        const visiveis=await frame.locator('button,label,p,h1,h2,h3,span,[role]').evaluateAll?.((es,limite)=>[...new Set(es.filter(e=>{
          const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2
          if(!r.width||!r.height||x<0||y<0||x>=innerWidth||y>=innerHeight)return false
          const hit=document.elementFromPoint(x,y)
          return hit&&(e.contains(hit)||hit.contains(e))
        }).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim()).filter(t=>t&&t.length<=600))].slice(0,limite),compacto?40:80)
        const controles=await frame.locator('[role],input,option,[aria-checked],[aria-selected],[data-state]').evaluateAll?.((es,limite)=>es.filter(e=>{
          const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2
          const hit=x>=0&&y>=0&&x<innerWidth&&y<innerHeight?document.elementFromPoint(x,y):null
          return r.width&&r.height&&hit&&(e.contains(hit)||hit.contains(e))
        }).map(e=>({texto:(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim(),role:e.getAttribute('role'),marcado:['radio','checkbox'].includes(e.type)?e.checked:e.getAttribute('aria-checked'),selecionado:e.getAttribute('aria-selected'),estado:e.getAttribute('data-state'),classes:typeof e.className==='string'?e.className:''})).filter(e=>e.texto&&e.texto.length<=600).slice(0,limite),compacto?50:80)
        frames.push({ frame: indice, url: frame.url(), campos, visiveis, controles, conteudo: (await frame.locator('body').ariaSnapshot({ timeout: 5000 })).slice(0, compacto?4000:24000) })
      } catch(e) { frames.push({frame:indice,url:frame.url(),conteudo:'',erroLeitura:e.message}) }
    }
    const vagaAtual=vagaLinkedInDoTitulo(url,titulo)
    return { url, titulo, ...(vagaAtual ? { vagaAtual } : {}), frames }
  }
  async function vincular(id,candidaturaId) {
    await pagina(id)
    const anterior=candidaturas.get(String(id))
    if(anterior&&anterior!==candidaturaId)throw new Error('Esta aba pertence a outra candidatura. Abra ou reutilize a aba correta.')
    candidaturas.set(String(id),candidaturaId);salvarAbas()
  }
  async function temFormularioPendente(p) {
    for(const f of p.frames()) {
      // Do not discard edited forms or uploads; a failed inspection preserves the tab.
      try { if(await f.locator('input,textarea,select,[contenteditable="true"]').evaluateAll(es=>es.some(e=>{
        if(e.isContentEditable)return Boolean(e.textContent?.trim())
        if(e.type==='file')return Boolean(e.files?.length)
        if(['hidden','submit','button','reset','search'].includes(e.type))return false
        if(e.type==='checkbox'||e.type==='radio')return e.checked!==e.defaultChecked
        if(e.tagName==='SELECT')return [...e.options].some(o=>o.selected!==o.defaultSelected)&&e.selectedIndex>0
        return Boolean(e.value)&&e.value!==e.defaultValue
      })))return true } catch{return true}
    }
    return false
  }
  async function fecharAba(id,concluida=false) {
    const p=await pagina(id)
    const u=(()=>{try{return new URL(p.url())}catch{return null}})()
    const detalheLinkedInSemReserva=!candidaturas.has(String(id))&&u&&(u.hostname.endsWith('.linkedin.com')||u.hostname==='linkedin.com')&&/^\/jobs\/(view|search)\//.test(u.pathname)
    if(!concluida&&!detalheLinkedInSemReserva&&await temFormularioPendente(p))throw new Error('Aba preservada: há formulário editado ou anexo. Conclua e registre o resultado antes de fechar.')
    await p.close({runBeforeUnload:false});removerPagina(String(id))
    return {ok:true,acao:'fechar',aba:String(id)}
  }
  async function recusarControleHumano() {
    if (typeof bancada.estado !== 'function') return
    const atual = await bancada.estado()
    if (atual?.controle === 'humano') {
      throw Object.assign(new Error('Você está com o controle da bancada. Devolva ao agente pelo painel da bancada para continuar.'), { codigo: 'CONTROLE_HUMANO', status: 409 })
    }
  }
  async function concluir(candidaturaId) {
    await recusarControleHumano()
    const fechadas=[]
    for(const [id,c] of [...candidaturas])if(c===candidaturaId){autorizar();await fecharAba(id,true);fechadas.push(id)}
    return fechadas
  }
  async function executarInterno(a, cv) {
    autorizar()
    validarAcaoFormulario(a)
    if (a.acao === 'abas') return abas()
    if (!browser) await conectar()
    if (a.acao === 'abrir') {
      const url = urlPublica(a.url)
      const existente=[...paginas].find(([,p])=>!p.isClosed()&&p.url()===url)
      if(existente)return {aba:existente[0],reutilizada:true,...await ler(existente[0])}
      const p = await browser.contexts()[0].newPage()
      const id = await registrarPagina(p)
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      return { aba: id, ...await ler(id) }
    }
    const p = await pagina(a.aba)
    if (a.acao === 'fechar') return fecharAba(a.aba)
    if (a.acao === 'navegar') { await p.goto(urlPublica(a.url), { waitUntil: 'domcontentloaded', timeout: 30000 }); return ler(a.aba) }
    await fecharAvisosNaoOperacionais(p)
    if (a.acao === 'ler') return ler(a.aba)
    // LinkedIn repeats a job title in the results list and selected-job pane.
    // The search URL already identifies the selected job, so use its canonical
    // detail URL instead of spending model turns resolving duplicate links.
    if (a.acao === 'clicar' && a.nome) {
      const jobIdAtual = idVagaLinkedInDaBusca(p.url())
      if (jobIdAtual) {
        const links = p.getByRole('link', { name: a.nome, exact: true })
        const ids = [...new Set(await links.evaluateAll(es => es.map(e => e.href?.match(/\/jobs\/view\/(\d+)/)?.[1]).filter(Boolean)))]
        const outros = ids.filter(id => id !== jobIdAtual)
        const jobId = outros.length === 1 ? outros[0] : (!outros.length ? jobIdAtual : null)
        if (!jobId) throw new Error('Mais de uma vaga diferente corresponde ao título. Releia a busca e use o nome acessível completo.')
        await p.goto(`https://www.linkedin.com/jobs/view/${jobId}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
        return { redirecionadaDaBusca: true, ...await ler(a.aba, true) }
      }
    }
    if (a.acao === 'lote') {
      if (!Array.isArray(a.passos) || !a.passos.length || a.passos.length > 40) throw new Error('Lote exige de 1 a 40 passos.')
      const permitidas = new Set(['clicar','escolher','preencher','digitar','tecla','selecionar','anexar'])
      const resultados = []
      for (const [indice, passo] of a.passos.entries()) {
        if (!passo || !permitidas.has(passo.acao)) throw new Error(`Passo ${indice + 1} inválido no lote.`)
        const resultado = await executarInterno({ ...passo, aba: a.aba, _lote: true }, cv)
        resultados.push({ passo: indice + 1, acao: passo.acao, ok: resultado?.ok !== false, valorAtual: resultado?.valorAtual })
        if (passo.acao === 'clicar') await p.waitForTimeout?.(100)
      }
      return { ok:true, acao:'lote', executados:resultados.length, resultados, ...await ler(a.aba,true) }
    }
    if (a.acao === 'capturar') {
      await p.bringToFront?.()
      let bytes
      try { bytes=await p.screenshot({animations:'disabled',timeout:10000}) }
      catch(e) {
        if(!/timeout/i.test(e.message))throw e
        const sessao=await browser.contexts()[0].newCDPSession(p)
        let timer
        try {
          const captura=await Promise.race([sessao.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Captura da aba não respondeu. Nenhum envio foi iniciado.')),10000)})])
          bytes=Buffer.from(captura.data,'base64')
        } finally {clearTimeout(timer);await sessao.detach()}
      }
      return {bytes,url:p.url()}
    }
    if (a.acao === 'aplicar_preset') {
      const destino=new URL(p.url())
      const rapido=a._preset?.respostasRapidas
      if(!rapido)throw new Error('Preset profissional indisponível para esta candidatura.')
      const dialogoLinkedIn=destino.hostname.endsWith('linkedin.com')?p.getByRole('dialog'):null
      const linkedinRapido=Boolean(dialogoLinkedIn&&await dialogoLinkedIn.count()===1)
      const atsRapido = destino.hostname==='jobs.ashbyhq.com' || destino.hostname.endsWith('.inhire.app') || destino.hostname.endsWith('.lever.co') || destino.hostname.endsWith('.greenhouse.io') || linkedinRapido
      if(atsRapido){
        const resultados=[],pendentes=[]
        for(const [frameIndice,frame] of p.frames().entries()){
          const raiz=linkedinRapido&&frame===p.mainFrame()?dialogoLinkedIn:frame
          const campos=raiz.locator('input,textarea')
          const total=await campos.count()
          for(let indice=0;indice<total;indice++){
            const alvo=campos.nth(indice)
            const meta=await alvo.evaluate(el=>({campo:el.name||'',tipo:el.type||el.tagName.toLowerCase(),label:[...(el.labels||[])].map(l=>l.textContent.trim()).join(' ')||el.getAttribute('aria-label')||'',placeholder:el.getAttribute('placeholder')||'',obrigatorio:Boolean(el.required||el.getAttribute('aria-required')==='true'),desabilitado:Boolean(el.disabled)}))
            if(meta.desabilitado||['hidden','submit','button','radio','checkbox'].includes(meta.tipo))continue
            if(meta.tipo==='file'){
              if(cv?.caminho&&await alvo.inputValue().catch(()=>'')===''){await alvo.setInputFiles(cv.caminho,{timeout:10000});resultados.push({campo:meta.label||'Currículo',estado:'preenchido',valor:'CV oficial'})}
              continue
            }
            const atual=String(await alvo.inputValue().catch(()=>'')).trim()
            const valor=valorPresetParaCampo(meta,a._preset)
            if(atual){resultados.push({campo:meta.label||meta.campo,estado:'preservado'});continue}
            if(valor!==null&&valor!==undefined&&String(valor)!==''){
              await alvo.fill(String(valor),{timeout:10000});await alvo.press('Tab').catch(()=>{})
              resultados.push({campo:meta.label||meta.campo,estado:'preenchido'})
            } else if(meta.obrigatorio) pendentes.push({campo:meta.label||meta.campo,frame:frameIndice})
          }
          if (linkedinRapido && frame === p.mainFrame()) {
            const seletores = raiz.locator('select')
            for (let indice = 0; indice < await seletores.count(); indice++) {
              const alvo = seletores.nth(indice)
              const meta = await alvo.evaluate(el => ({
                label: [...(el.labels || [])].map(l => l.textContent.trim()).join(' ') || el.getAttribute('aria-label') || '',
                valor: el.value,
                opcoes: [...el.options].map((o, index) => ({ index, value: o.value, text: o.textContent?.trim() || '', disabled: o.disabled }))
              }))
              const opcao = indiceConsentimentoUnico(meta.label, meta.valor, meta.opcoes)
              if (opcao !== null) {
                await alvo.selectOption({ index: opcao }, { timeout: 10000 })
                resultados.push({ campo: meta.label, estado: 'preenchido', valor: 'Consentimento necessário para a candidatura' })
              }
            }
          }
        }
        if(!resultados.length&&!pendentes.length)return {ok:true,acao:'aplicar_preset',aplicavel:false,avancou:false,resultados,pendentes,bloqueios:[],...await ler(a.aba,true)}
        return {ok:true,acao:'aplicar_preset',aplicavel:true,avancou:false,resultados,pendentes,bloqueios:[],...await ler(a.aba,true)}
      }
      if(!destino.hostname.endsWith('.gupy.io')||!/\/curriculum(?:$|[/?#])/.test(destino.pathname))throw new Error('O preenchimento rápido está disponível em Ashby, InHire, Lever, Greenhouse e na etapa Meu currículo da Gupy.')
      // A previous interrupted model turn may have left a month/year popup
      // open. Close it so the first preset field owns the option list.
      try { await p.keyboard?.press?.('Escape') } catch {}
      const abertos=p.locator('input[aria-expanded="true"]')
      for(let i=0;i<await abertos.count();i++)try{await abertos.nth(i).press('Escape')}catch{}
      const normalizar=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
      const escolher=async(alvo,texto,descricao)=>{
        if(await alvo.isDisabled?.())return {campo:descricao,estado:'desabilitado'}
        if(normalizar(await alvo.inputValue())===normalizar(texto))return {campo:descricao,estado:'preservado',valor:texto}
        await alvo.click({timeout:10000});await p.waitForTimeout?.(100)
        let aberto=true
        try { aberto=await alvo.getAttribute('aria-expanded')==='true' } catch {}
        if(!aberto){
          await alvo.focus?.();await alvo.press?.('ArrowDown');await p.waitForTimeout?.(100)
        }
        const opcoes=p.getByRole('option',{name:texto,exact:true})
        const quantidade=await opcoes.count()
        let opcao=quantidade===1?opcoes.first():null
        if(!opcao){const expostas=await opcoes.evaluateAll(es=>es.flatMap((e,i)=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=x>=0&&y>=0&&x<innerWidth&&y<innerHeight?document.elementFromPoint(x,y):null;return r.width&&r.height&&hit&&(e.contains(hit)||hit.contains(e))?[i]:[]}));if(expostas.length===1)opcao=opcoes.nth(expostas[0])}
        if(!opcao)throw new Error(`O preset não encontrou a opção ${texto} em ${descricao}.`)
        await opcao.click({timeout:10000});await p.waitForTimeout?.(100)
        return {campo:descricao,estado:'preenchido',valor:texto}
      }
      const resultados=[]
      const meses=p.locator('input[name="monthValue"]'),anos=p.locator('input[name="yearValue"]')
      if(await meses.count()>=2&&await anos.count()>=2){
        resultados.push(await escolher(meses.nth(0),rapido.inicioCursoMes,'FIAP início/mês'))
        resultados.push(await escolher(anos.nth(0),rapido.inicioCursoAno,'FIAP início/ano'))
        resultados.push(await escolher(meses.nth(1),rapido.fimCursoMes,'FIAP fim/mês'))
        resultados.push(await escolher(anos.nth(1),rapido.fimCursoAno,'FIAP fim/ano'))
      }
      const empresas=p.locator('input[name="companyName"]'),atuais=p.locator('input[name="isCurrentJob"]')
      for(let i=0;i<await empresas.count();i++){
        const empresa=normalizar(await empresas.nth(i).inputValue()),inicio=empresa.includes('nexunio')?rapido.inicioNexUnio:empresa.includes('lojasync')?rapido.inicioLojaSync:null
        if(!inicio)continue
        const [mes,ano]=String(inicio).split(/\s+de\s+/i)
        const atual=atuais.nth(i)
        if(await atual.count()===1&&!await atual.isChecked()){await atual.check({timeout:10000});resultados.push({campo:`${empresa}/atual`,estado:'preenchido',valor:'Sim'})}
        const indice=2+i*2
        if(await meses.count()>indice&&await anos.count()>indice){resultados.push(await escolher(meses.nth(indice),mes,`${empresa} início/mês`));resultados.push(await escolher(anos.nth(indice),ano,`${empresa} início/ano`))}
      }
      const genero=p.locator('input[name="gender"]'),generoNeutro=p.locator('input[name="gender"][value="N"]')
      if(await genero.count()&&await p.locator('input[name="gender"]:checked').count()===0&&await generoNeutro.count()===1){try{await generoNeutro.check({timeout:10000,force:true})}catch{await generoNeutro.evaluate(el=>el.click())}resultados.push({campo:'Gênero',estado:'preenchido',valor:'Prefiro não responder'})}
      let salvar=p.getByRole('button',{name:'Salvar e continuar',exact:true})
      if(await salvar.count()!==1){
        const candidatos=p.locator('button').filter({hasText:'Salvar e continuar'}),expostos=await candidatos.evaluateAll(es=>es.flatMap((e,i)=>{const r=e.getBoundingClientRect();return r.width&&r.height?[i]:[]}))
        if(expostos.length===1)salvar=candidatos.nth(expostos[0]);else throw new Error('O botão Salvar e continuar da etapa Meu currículo não está disponível de forma inequívoca.')
      }
      const anterior=p.url();await salvar.click({timeout:10000})
      await p.waitForURL(url=>url.href!==anterior,{timeout:5000}).catch(()=>{})
      const bloqueios=[]
      if(p.url()===anterior){
        if(await p.locator('input[name="hasDisabilities"]').count()&&await p.locator('input[name="hasDisabilities"]:checked').count()===0)bloqueios.push({campo:'Pessoa com deficiência',motivo:'Autodeclaração de saúde obrigatória sem opção neutra; exige valor exato do titular.'})
        const cep=p.locator('input[placeholder="00000-000"]')
        if(await cep.count()===1&&!String(await cep.inputValue()).trim())bloqueios.push({campo:'CEP',motivo:'Endereço obrigatório ausente das fontes canônicas; não pode ser estimado.'})
      }
      return {ok:true,acao:'aplicar_preset',aplicavel:true,avancou:p.url()!==anterior,resultados,bloqueios,...await ler(a.aba,true)}
    }
    if (a.acao === 'preparar_rapido') {
      const destino=new URL(p.url())
      if(!destino.hostname.endsWith('linkedin.com'))throw new Error('O fluxo rápido multi-etapa está disponível para a Candidatura simplificada do LinkedIn.')
      const resultados=[],assinaturas=new Set()
      for(let etapa=0;etapa<8;etapa++){
        const dialogo=p.getByRole('dialog')
        if(await dialogo.count()!==1)throw new Error('Modal de Candidatura simplificada indisponível nesta aba.')
        const rapido=await executarInterno({...a,acao:'aplicar_preset'})
        resultados.push(...(rapido.resultados||[]))
        const pendentes=(rapido.pendentes||[]).filter(item=>item.campo)
        if(pendentes.length)return {ok:true,acao:'preparar_rapido',etapas:etapa+1,prontoParaRevisao:false,resultados,pendentes,...await ler(a.aba,true)}
        const enviar=dialogo.getByRole('button',{name:/^(Submit application|Enviar candidatura|Enviar inscrição)$/i})
        if(await enviar.count())return {ok:true,acao:'preparar_rapido',etapas:etapa+1,prontoParaRevisao:true,botaoEnviar:await enviar.first().innerText().catch(()=> 'Submit application'),resultados,...await ler(a.aba,true)}
        const avancar=dialogo.getByRole('button',{name:/^(Next|Continue to next step|Review|Avançar|Continuar|Revisar)$/i})
        if(await avancar.count()!==1)return {ok:true,acao:'preparar_rapido',etapas:etapa+1,prontoParaRevisao:false,resultados,motivo:'A etapa exige uma decisão específica.',...await ler(a.aba,true)}
        const assinatura=await dialogo.locator('input,textarea,select,button').evaluateAll(es=>es.map(e=>`${e.tagName}:${e.name||''}:${e.getAttribute('aria-label')||''}:${e.textContent||''}`).join('|'))
        if(assinaturas.has(assinatura))return {ok:true,acao:'preparar_rapido',etapas:etapa+1,prontoParaRevisao:false,resultados,motivo:'A etapa não avançou; confira a validação visível.',...await ler(a.aba,true)}
        assinaturas.add(assinatura)
        await avancar.click({timeout:10000})
        await p.waitForTimeout?.(350)
      }
      return {ok:true,acao:'preparar_rapido',etapas:8,prontoParaRevisao:false,resultados,motivo:'O formulário excedeu oito etapas; continuar pela etapa atual.',...await ler(a.aba,true)}
    }
    let frame = p.frames()[Number(a.frame || 0)]
    if(a.campo&&(String(a.campo).length>200||/[\0-\x1f]/.test(a.campo)))throw new Error('Use o nome de campo observado em ler.')
    const escaparAtributo=v=>String(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"')
    const localizar=async f=>{
      if(!f)return null
      if(a.campo){
        const nome=f.locator(`input[name="${escaparAtributo(a.campo)}"],textarea[name="${escaparAtributo(a.campo)}"],select[name="${escaparAtributo(a.campo)}"]`)
        if(await nome.count())return nome
        const label=f.getByLabel(a.campo,{exact:true})
        return await label.count()?label:nome
      }
      if(a.role){
        const role=f.getByRole(a.role,{name:a.nome,exact:true})
        if(!['radio','checkbox'].includes(a.role)||!/^(yes|no|sim|não)$/i.test(a.nome||'')||typeof role.count!=='function'||await role.count())return role
        return f.getByText(a.nome,{exact:true})
      }
      if(a.nome){
        const botao=f.getByRole('button',{name:a.nome,exact:true})
        if(await botao.count())return botao
        const link=f.getByRole('link',{name:a.nome,exact:true})
        if(await link.count())return link
        return f.getByText(a.nome,{exact:true})
      }
      return a.label?f.getByLabel(a.label,{exact:true}):a.textoAlvo?f.getByText(a.textoAlvo,{exact:true}):null
    }
    let alvo=await localizar(frame)
    // Third-party frames can arrive or disappear between reads. Recover only
    // an unambiguous observed control, never guess among multiple matches.
    if((a.campo||a.role||a.label||a.textoAlvo)&&(!alvo||await alvo.count?.()===0)) {
      const encontrados=[]
      for(const f of p.frames()){
        const l=await localizar(f),total=await l.count()
        if(total===1||(a.indice!==undefined&&total>a.indice))encontrados.push({frame:f,alvo:l})
      }
      if(encontrados.length!==1)throw new Error('Controle ausente ou ambíguo nos frames atuais. Releia a página e use o texto, campo ou nome acessível observado.')
      ;({frame,alvo}=encontrados[0])
    }
    if (!frame) throw new Error('Frame ausente. Releia a página.')
    if(a.acao==='tecla'&&!alvo){await validarControleFormulario(a,frame.locator('body'));await frame.locator('body').press(a.tecla,{timeout:10000});return a._lote?{ok:true,acao:a.acao,url:p.url()}:ler(a.aba)}
    let indiceResolvido=false
    if(['clicar','validarClique','escolher'].includes(a.acao)&&await alvo?.count?.()>1) {
      const expostos=await alvo.evaluateAll(es=>es.flatMap((e,i)=>{
        const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2
        if(!r.width||!r.height||x<0||y<0||x>=innerWidth||y>=innerHeight)return []
        const hit=document.elementFromPoint(x,y)
        return hit&&(e.contains(hit)||hit.contains(e))?[i]:[]
      }))
      if(expostos.length===1){alvo=alvo.nth(expostos[0]);indiceResolvido=true}
      // An explicit index comes from the latest form read. When none of the
      // repeated controls is currently visible, let Playwright select that
      // exact control and scroll it into view instead of rejecting the step.
      else if(!expostos.length&&a.indice===undefined)throw new Error('Os controles correspondentes estão fora do painel atual. Releia visiveis e avance a etapa aberta.')
    }
    if(a.acao==='anexar') {
      if(!cv)throw new Error('Reserve a candidatura antes de anexar o currículo oficial.')
      if(!alvo) {
        const arquivos=frame.locator('input[type="file"]')
        if(await arquivos.count()!==1)throw new Error('Há mais de um campo de arquivo, ou nenhum. Informe o label ou botão observado do currículo.')
        await arquivos.setInputFiles(cv.caminho,{timeout:10000})
        return {ok:true,acao:a.acao,url:p.url()}
      }
      if(a.indice!==undefined)alvo=alvo.nth(a.indice)
      if(await alvo.evaluate(el=>el.tagName==='INPUT'&&el.type==='file')) {
        await alvo.setInputFiles(cv.caminho,{timeout:10000})
        return {ok:true,acao:a.acao,url:p.url()}
      }
    }
    if (!alvo) throw new Error('Informe role/nome ou label observado no formulário.')
    if (a.indice !== undefined && a.acao!=='anexar'&&!indiceResolvido) alvo = alvo.nth(a.indice)
    await validarControleFormulario(a, alvo)
    if (a.acao==='escolher') {
      if(!a.texto)throw new Error('Escolher exige o texto exato da opção.')
      if(await alvo.evaluate(el=>el.tagName==='SELECT').catch(()=>false)){
        await alvo.selectOption({label:a.texto},{timeout:10000})
        return a._lote?{ok:true,acao:a.acao,url:p.url(),valorAtual:await alvo.inputValue().catch(()=>undefined)}:ler(a.aba,true)
      }
      await alvo.click({timeout:10000});await p.waitForTimeout?.(100)
      const opcoesExpostas=async flexivel=>{
        const expostas=[]
        for(const f of p.frames()){
          const l=flexivel?f.getByRole('option'):f.getByText(a.texto,{exact:true})
          const indices=await l.evaluateAll((es,entrada)=>es.flatMap((e,i)=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=x>=0&&y>=0&&x<innerWidth&&y<innerHeight?document.elementFromPoint(x,y):null;if(!r.width||!r.height||!hit||(!e.contains(hit)&&!hit.contains(e)))return [];if(!entrada)return [i];const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();const tokens=[...new Set(norm(entrada).split(/[^a-z0-9]+/).filter(Boolean))];return tokens.every(t=>norm(e.innerText||e.textContent).includes(t))?[i]:[]}),flexivel?a.texto:null)
          for(const i of indices)expostas.push(l.nth(i))
        }
        return expostas
      }
      let expostas=await opcoesExpostas(false)
      if(expostas.length!==1){
        const editavel=await alvo.evaluate(el=>el.matches('input,textarea,[contenteditable="true"]')).catch(()=>false)
        if(editavel){await alvo.fill(a.texto,{timeout:10000});await p.waitForTimeout?.(350);expostas=await opcoesExpostas(true)}
      }
      if(expostas.length!==1)throw new Error('Opção ausente ou ambígua no seletor aberto. Releia a etapa e use o texto exato observado.')
      await expostas[0].click({timeout:10000})
      return a._lote?{ok:true,acao:a.acao,url:p.url()}:ler(a.aba,true)
    }
    if (['clicar','validarClique'].includes(a.acao)) {
      const popup=a.acao==='clicar'&&!a._lote?p.waitForEvent?.('popup',{timeout:1000}).catch(()=>null):null
      // Styled inputs are often covered by their visual span. Their associated
      // label is the normal browser click target and keeps native events intact.
      const labelHandle=await alvo.evaluateHandle?.(el=>el.tagName==='INPUT'&&['radio','checkbox'].includes(el.type)?el.labels?.[0]||null:null,undefined,{timeout:10000})
      const scrolls=await alvo.evaluateHandle?.(el=>{const r=[];for(let p=el.parentElement;p;p=p.parentElement)if(['hidden','clip'].includes(getComputedStyle(p).overflow))r.push({element:p,top:p.scrollTop,left:p.scrollLeft});return r},undefined,{timeout:10000})
      try { await (labelHandle?.asElement()||alvo).click({ timeout: 10000,trial:a.acao==='validarClique' }) }
      catch(e) {
        await scrolls?.evaluate?.(rs=>rs.forEach(r=>{r.element.scrollTop=r.top;r.element.scrollLeft=r.left}))
        if(/intercepts pointer events/.test(e.message))throw new Error('Outro painel cobre este controle. Releia visiveis: conclua a etapa atual pelo OK/Continuar antes de clicar opções da próxima etapa. '+e.message)
        throw e
      }
      finally { await labelHandle?.dispose();await scrolls?.dispose() }
      if(a.acao==='validarClique')return {ok:true,acao:a.acao,url:p.url()}
      if(a._lote)return {ok:true,acao:a.acao,url:p.url()}
      const nova=await popup
      if(nova){
        const id=await registrarPagina(nova)
        await nova.waitForLoadState?.('domcontentloaded',{timeout:30000})
        return {aba:id,origem:a.aba,...await ler(id)}
      }
    }
    else if (a.acao === 'preencher') { await alvo.fill(a.texto, { timeout: 10000 }); await alvo.press('Tab') }
    else if (a.acao === 'digitar') { await alvo.click(); await alvo.press('ControlOrMeta+A'); await alvo.pressSequentially(a.texto, { delay: 20 }); await alvo.press('Tab') }
    else if (a.acao === 'tecla') await alvo.press(a.tecla, { timeout: 10000 })
    else if (a.acao === 'selecionar') await alvo.selectOption({ label: a.texto }, { timeout: 10000 })
    else if (a.acao === 'anexar') {
      if (!cv) throw new Error('Reserve a candidatura antes de anexar o currículo oficial.')
      const chooser = p.waitForEvent('filechooser', { timeout: 10000 }); chooser.catch(() => {})
      await alvo.click({ timeout: 10000 }); await (await chooser).setFiles(cv.caminho)
    } else throw new Error('Ação de navegador desconhecida.')
    if (['preencher', 'digitar', 'tecla', 'selecionar', 'anexar'].includes(a.acao)) {
      let valorAtual
      if(['preencher','digitar','selecionar'].includes(a.acao))try{valorAtual=await alvo.inputValue({timeout:1000})}catch{}
      return { ok: true, acao: a.acao, url: p.url(), ...(valorAtual!==undefined?{valorAtual}:{}) }
    }
    return ler(a.aba,true)
  }
  async function executar(a,cv) {
    // CDP does not need the CUA lock or viewer dock. Assumir is the pause
    // signal; Observar/Super+7 must not stop an already-connected Chromium.
    await recusarControleHumano()
    return executarInterno(a,cv)
  }
  async function fechar() { desconectando=true;if (browser) await browser.close(); browser = null }
  return { executar, conectar, fechar, vincular, concluir, candidaturaDaAba:id=>candidaturas.get(String(id)) }
}
module.exports = { NOME_BANCADA, DOMINIOS_CANDIDATURAS, endpointChromium, fecharAvisosNaoOperacionais, criarNavegador, valorPresetParaCampo, vagaLinkedInDoTitulo, idVagaLinkedInDaBusca, indiceConsentimentoUnico }
