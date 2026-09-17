const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { criarServicoCandidaturas } = require('../electron/lib-candidaturas.cjs')
const { executarMissao, criarFerramentas, compactarHistorico, separarFontes, mensagensDasFontes, invalidarFontes, resolverEstimativa, criarPreset, valorPresetParaCampo, LIMITES_EXECUCAO_RAPIDA, FERRAMENTAS } = require('../electron/candidaturas/nativo.cjs')
const { endpointChromium, criarNavegador, DOMINIOS_CANDIDATURAS, fecharAvisosNaoOperacionais, vagaLinkedInDoTitulo, idVagaLinkedInDaBusca, indiceConsentimentoUnico } = require('../electron/candidaturas/navegador.cjs')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNwAAAABJRU5ErkJggg==', 'base64')
test('preparo da bancada inclui Gupy, identidade Google e ATS usados nas candidaturas', () => {
  for (const dominio of ['gupy.io','google.com','linkedin.com','inhire.app']) assert.ok(DOMINIOS_CANDIDATURAS.includes(dominio))
})
test('vaga do LinkedIn preserva pipes no cargo e identifica a empresa pelo fim do título',()=>{
 assert.deepEqual(vagaLinkedInDoTitulo('https://www.linkedin.com/jobs/view/4467796597/','Desenvolvedor(a) FullStack Python| React| Sybase | Foursys | LinkedIn'),{url:'https://www.linkedin.com/jobs/view/4467796597',cargo:'Desenvolvedor(a) FullStack Python | React | Sybase',empresa:'Foursys'})
})
test('currentJobId só é extraído da busca de vagas do LinkedIn',()=>{
 assert.equal(idVagaLinkedInDaBusca('https://www.linkedin.com/jobs/search/?keywords=full%20stack&currentJobId=4467772462'),'4467772462')
 assert.equal(idVagaLinkedInDaBusca('https://www.linkedin.com/jobs/view/4467772462'),null)
 assert.equal(idVagaLinkedInDaBusca('https://example.com/jobs/search/?currentJobId=4467772462'),null)
})
test('consentimento obrigatório com uma única resposta útil é selecionável pelo preset',()=>{
 const opcoes=[{index:0,value:'',text:'Selecionar opção',disabled:true},{index:1,value:'accepted',text:'Li e aceito os termos',disabled:false}]
 assert.equal(indiceConsentimentoUnico('Concordo com o tratamento dos meus dados pessoais','',opcoes),1)
 assert.equal(indiceConsentimentoUnico('Qual sua linguagem preferida?','',opcoes),null)
 assert.equal(indiceConsentimentoUnico('Concordo com o tratamento dos meus dados pessoais','accepted',opcoes),null)
})
test('avisos promocionais conhecidos são fechados antes de operar o formulário', async () => {
  let cliques = 0
  const controle = { count: async () => 1, click: async () => { cliques++ } }
  const pagina = { frames: () => [
    { url: () => 'https://qualitydigital.gupy.io/form' },
    { url: () => '', locator: seletor => seletor === 'body' ? { innerText: async () => 'Novidades na Gupy com você' } : (assert.equal(seletor, '[aria-label="Close"]'), controle) },
  ] }
  assert.equal(await fecharAvisosNaoOperacionais(pagina), 1)
  assert.equal(cliques, 1)
})
test('estimativas autorizadas resolvem burocracia e preservam fatos exatos', () => {
  const dados = [
    '- Software: 3 anos', '- LLM/agentes: cerca de 2 anos', '- AWS: 0 anos',
    '- Faixa: BRL 8.000-14.000/mes ou USD 2.500-4.000/mes',
    '- Nome profissional: Example User',
    '- Estimativa autorizada para empresa atual: NexUnio, baseada no projeto profissional ativo',
  ].join('\n')
  assert.equal(resolverEstimativa(dados, 'Mês de início da formação').valor, 'Janeiro')
  assert.equal(resolverEstimativa(dados, 'Mês de fim da formação').valor, 'Dezembro')
  assert.equal(resolverEstimativa(dados, 'Quantos anos de experiência com TypeScript?').valor, '3')
  assert.equal(resolverEstimativa(dados, 'How many years of AWS experience?').valor, '0')
  assert.equal(resolverEstimativa(dados, 'Mês de início NexUnio').valor, 'Julho')
  assert.equal(resolverEstimativa(dados, 'Start year LojaSync').valor, '2026')
  assert.equal(resolverEstimativa(dados, 'Você usou algum produto Kraken nos últimos 6 meses?').valor, 'Não')
  assert.equal(resolverEstimativa(dados, 'What is the earliest date that you will be able to start?').valor, 'Immediately')
  assert.equal(resolverEstimativa(dados, 'What is your notice period in days?').valor, '0')
  assert.equal(resolverEstimativa(dados, 'Are you okay with using an activity monitoring application to track your daily work hours?').valor, 'Yes')
  assert.equal(resolverEstimativa(dados, 'Are you willing to work exclusively for our company?').valor, 'Yes')
  assert.equal(resolverEstimativa(dados, 'Do you have experience working for an American, Canadian, Australian, or European company?').valor, 'No')
  assert.equal(resolverEstimativa(dados, 'What is your level of proficiency in English?').valor, 'Conversational')
  assert.equal(resolverEstimativa(dados, 'Pretensão salarial', {moeda:'BRL',periodo:'mes',salarioMin:9000}).valor, '11000 BRL/mes')
  assert.equal(resolverEstimativa(dados, 'What are your salary expectations? Annual in USD dollars', {moeda:'BRL',periodo:'mes',salarioMin:9000}).valor, '39000 USD/ano')
  assert.equal(resolverEstimativa(dados, 'CPF'), null)
  const preset = criarPreset(dados, {moeda:'BRL',periodo:'mes'})
  assert.equal(preset.respostasRapidas.anosStackSemValorExato, 3)
  assert.equal(preset.respostasRapidas.inicioCursoMes, 'Janeiro')
  assert.equal(preset.respostasRapidas.inicioNexUnio, 'Julho de 2026')
  assert.equal(preset.respostasRapidas.empresaAtual, 'NexUnio')
})
test('preset Ashby resolve campos repetitivos sem consultar o modelo por campo', () => {
  const preset = {
    identidade: { nomeCivil:'Example User', email:'you@example.com', telefone:'+55 11 99999-0000', localizacao:'São Paulo, SP, Brasil', linkedin:'https://linkedin.com/in/your-linkedin', github:'https://github.com/example' },
    perfil: { disponibilidade:'Imediata' },
    respostasRapidas: { anosStackSemValorExato:3, pretensaoUsdAnual:'39000 USD/ano', pretensaoUsdMensal:'3250 USD/mes', pretensao:'11000 BRL/mes', empresaAtual:'NexUnio' },
  }
  assert.equal(valorPresetParaCampo({label:'Your Full Name',tipo:'text'},preset),'Example User')
  assert.equal(valorPresetParaCampo({label:'Where will you be working from? CITY and COUNTRY',tipo:'text'},preset),'São Paulo, SP, Brasil')
  assert.equal(valorPresetParaCampo({label:'Years of technical experience at a SaaS company',tipo:'text'},preset),'3')
  assert.equal(valorPresetParaCampo({label:'What are your salary expectations? Annual in USD dollars',tipo:'text'},preset),'39000')
  assert.equal(valorPresetParaCampo({label:'What is the earliest date that you will be able to start?',tipo:'text'},preset),'Immediately')
  assert.equal(valorPresetParaCampo({label:'Confirm the name of the company where you work',tipo:'text'},preset),'NexUnio')
  assert.equal(valorPresetParaCampo({label:'Why are you interested in working here?',tipo:'textarea'},preset),null)
  assert.equal(valorPresetParaCampo({label:'Are you authorized to work in the US?',tipo:'text'},preset),null)
})
test('executor nativo impõe ciclos curtos e expõe o fluxo rápido do LinkedIn',()=>{
 assert.deepEqual(LIMITES_EXECUCAO_RAPIDA,{maxRodadas:6,maxTokens:1200,timeoutMs:180000})
 const navegador=FERRAMENTAS.find(f=>f.function.name==='navegador')
 assert.ok(navegador.function.parameters.properties.acao.enum.includes('preparar_rapido'))
 const registrar=FERRAMENTAS.find(f=>f.function.name==='registrar')
 assert.equal(registrar.function.parameters.properties.entrada.properties.qualificacao.properties.requisitosAtendidos.type,'boolean')
})
test('compactação preserva último lote grande com todos os resultados e elimina grupos antigos inteiros', () => {
  const chamada = id => ({ role: 'assistant', tool_calls: [{ id, function: {name:'navegador',arguments:'{}'} }] })
  const antigo = [chamada('old'),{role:'tool',tool_call_id:'old',content:'página antiga'}]
  const recente = [chamada('new'),{role:'tool',tool_call_id:'new',content:'formulário observado'.repeat(8000)}]
  assert.deepEqual(compactarHistorico([...antigo,...recente]),recente)
  assert.deepEqual(compactarHistorico(recente),recente)
  assert.deepEqual(compactarHistorico([]),[])
})
test('compactação conserva vaga observada junto da consulta de legado seguinte', () => {
  const leitura = { role:'assistant', tool_calls:[{id:'read',function:{name:'navegador',arguments:'{"acao":"ler"}'}}] }
  const pagina = { role:'tool', tool_call_id:'read', content:JSON.stringify({url:'https://www.linkedin.com/jobs/view/123',vagaAtual:{url:'https://www.linkedin.com/jobs/view/123',cargo:'Forward Deployed Engineer',empresa:'Acme'},frames:[{conteudo:'descrição '.repeat(5000),campos:[]}]}) }
  const legado = { role:'assistant', tool_calls:[{id:'legacy',function:{name:'consultar',arguments:'{"fonte":"legado"}'}}] }
  const retorno = { role:'tool', tool_call_id:'legacy', content:'{"trechos":""}' }
  const compacto = compactarHistorico([leitura,pagina,legado,retorno])
  assert.equal(compacto.length,4)
  const preservada=JSON.parse(compacto[1].content)
  assert.equal(preservada.vagaAtual.cargo,'Forward Deployed Engineer')
  assert.equal(preservada.historicoCompactado,true)
  assert.ok(compacto[1].content.length<12000)
})
test('fontes profissionais sobrevivem à rotação das páginas sem chamadas ou resultados órfãos', () => {
  const fonte={id:'cv',function:{name:'consultar',arguments:'{"fonte":"cv"}'}}
  const pagina={id:'page',function:{name:'navegador',arguments:'{"acao":"ler"}'}}
  const retorno={role:'tool',tool_call_id:'cv',content:'{"conteudo":"CV oficial fixture"}'}
  const fontes={}
  const recente=separarFontes([{role:'assistant',tool_calls:[fonte,pagina]},retorno,{role:'tool',tool_call_id:'page',content:'página'.repeat(20000)}],fontes,()=> 'versao1')
  assert.deepEqual(recente[0].tool_calls,[pagina])
  assert.equal(compactarHistorico(recente).length,2)
  assert.deepEqual(mensagensDasFontes(fontes)[0].tool_calls,[fonte])
  assert.deepEqual(mensagensDasFontes(fontes)[1],retorno)
  separarFontes(mensagensDasFontes(fontes),fontes)
  assert.equal(Object.keys(fontes).length,1)
  invalidarFontes(fontes,()=> 'versao1')
  assert.equal(Object.keys(fontes).length,1)
  invalidarFontes(fontes,()=> 'versao2')
  assert.equal(Object.keys(fontes).length,0)
})
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-native-'))
  const cvs = path.join(root, 'LucasOL/Portfolio/curriculos/ativos')
  fs.mkdirSync(cvs, { recursive: true })
  fs.writeFileSync(path.join(cvs, 'software-engineer-pt.pdf'), '%PDF-1.4 fixture')
  const s = criarServicoCandidaturas({ repoRoot: root, launch: () => ({ tipo: 'nativo', pid: null }), stop: () => {} })
  t.after(() => { s.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const m = s.iniciar({ criterios: { meta: 1 } })
  const c = s.reservar({ missaoId: m.id, url: 'https://jobs.example.com/1', empresa: 'Fixture', cargo: 'Software', foco: 'software', idioma: 'pt', qualificacao: { ativa: true, elegivel: true, requisitosAtendidos: true, modalidade: 'remoto', motivo: 'Vaga fictícia exclusiva do teste isolado' } })
  return { s, m, c, root }
}
test('consulta repetida do mesmo estado obriga uma ação concreta antes de reler', async t => {
  const { s, m, root } = fixture(t)
  const progresso = { acoes: 0, avancos: 0 }
  const navegador = { executar: async ({ acao }) => acao === 'abas' ? [{ id: '1', url: 'https://jobs.example.com/1' }] : { ok: true } }
  const executar = criarFerramentas({ s, missaoId: m.id, repoRoot: root, progresso, salvar() {}, autorizar() {}, navegador })
  await executar('consultar', { fonte: 'estado' })
  await assert.rejects(executar('consultar', { fonte: 'estado' }), /ação concreta/)
  progresso.avancos += 1
  await executar('consultar', { fonte: 'estado' })
})
test('checkpoint atualizado substitui o antigo no contexto ainda dentro do ciclo', async t => {
  const { s, m, c, root } = fixture(t)
  await executarMissao({ s, missaoId:m.id, repoRoot:root, maxCiclos:1,
    navegador:{async conectar(){},async fechar(){}},
    agente:{async configuracao(){return {perfilPadrao:'grok-4-6',provider:'grok-cli'}},async executarComFerramentas(o){
      await o.executarFerramenta('checkpoint',{resumo:'Vaga anterior impedida; continuar na nova aba 42.'})
      s.atualizar({id:c.id,estado:'preenchendo',proximaAcao:'Preencher a vaga recém-selecionada.'})
      const contexto=o.onHistorico(o.mensagens)
      assert.match(contexto[0].content,/Checkpoint anterior.*nova aba 42\./s)
      assert.match(contexto[0].content,/Preencher a vaga recém-selecionada\./)
      assert.equal(contexto.filter(m=>m.role==='system').length,1)
      return {mensagem:'Checkpoint preservado'}
    }},
  })
})
test('executor padrão é nativo; transferência conserva candidatura e intenção', t => {
  const { s, m, c } = fixture(t)
  assert.equal(m.criterios.executor, 'nativo')
  s.controlar({ id: m.id, acao: 'pausar' })
  const r = s.controlar({ id: m.id, acao: 'retomar', executor: 'nativo' })
  assert.equal(r.id, m.id); assert.equal(s.obter(c.id).cv.sha256, c.cv.sha256)
})
test('conexão ausente não chama modelo e preserva motivo acionável', async t => {
  const { s, m, root } = fixture(t)
  let chamadas = 0
  const r = await executarMissao({ s, missaoId: m.id, repoRoot: root, agente: { configuracao() { chamadas++ } }, navegador: { conectar() { throw new Error('Conexão ausente') }, async fechar() {} } })
  assert.equal(chamadas, 0); assert.equal(r.tokensEntrada, 0)
  assert.equal(s.missao(m.id).estado, 'bloqueada'); assert.equal(r.erro, 'Conexão ausente')
})
test('endpoint ausente espera sem modelo e retoma sozinho quando disponível', async t => {
  const { s, m, root } = fixture(t)
  let tentativas = 0, esperas = 0, modelos = 0
  const r = await executarMissao({ s, missaoId: m.id, repoRoot: root, maxCiclos: 0,
    agente: { async configuracao() { modelos++; return { perfilPadrao: 'gpt-5-6-sol-medium', provider: '9router' } } },
    navegador: { async conectar() { tentativas++; if (tentativas < 3) throw Object.assign(new Error('Habilite a conexão'), { codigo: 'CHROMIUM_CONEXAO_AUSENTE' }) }, async fechar() {} },
    async esperar(ms) {
      assert.equal(ms, 30000); esperas++; assert.equal(modelos, 0)
      const est = s.estado().missoes.find(x => x.id === m.id)
      assert.equal(est.supervisor.estado, 'aguardando_conexao')
      assert.equal(est.supervisor.tokensEntrada, 0)
    },
  })
  assert.equal(esperas, 2); assert.equal(tentativas, 3); assert.equal(modelos, 1)
  assert.equal(r.modelo, 'gpt-5-6-sol-medium'); assert.equal(s.missao(m.id).confirmadas, 0)
})
test('controle humano com Chromium aberto espera sem fingir indisponível e retoma sozinho', async t => {
  const { s, m, root } = fixture(t)
  let tentativas = 0, esperas = 0, modelos = 0
  const r = await executarMissao({ s, missaoId: m.id, repoRoot: root, maxCiclos: 0,
    agente: { async configuracao() { modelos++; return { perfilPadrao: 'gpt-5-6-sol-medium', provider: '9router' } } },
    navegador: { async conectar() { tentativas++; if (tentativas < 3) throw Object.assign(new Error('Você está com o controle da bancada.'), { codigo: 'CONTROLE_HUMANO' }) }, async fechar() {} },
    async esperar(ms) {
      assert.equal(ms, 30000); esperas++; assert.equal(modelos, 0)
      const est = s.estado().missoes.find(x => x.id === m.id)
      assert.equal(est.supervisor.estado, 'aguardando_controle')
      assert.equal(est.atencao.codigo, 'CONTROLE')
      assert.notEqual(est.atencao.codigo, 'CHROMIUM')
    },
  })
  assert.equal(esperas, 2); assert.equal(tentativas, 3); assert.equal(modelos, 1)
  assert.equal(r.modelo, 'gpt-5-6-sol-medium')
})
test('pausa durante espera impede nova tentativa de conexão e qualquer chamada ao modelo', async t => {
  const { s, m, root } = fixture(t)
  let tentativas = 0, modelos = 0
  const r = await executarMissao({ s, missaoId: m.id, repoRoot: root,
    agente: { async configuracao() { modelos++ } },
    navegador: { async conectar() { tentativas++; throw Object.assign(new Error('Conexão ausente'), { codigo: 'CHROMIUM_CONEXAO_AUSENTE' }) }, async fechar() {} },
    async esperar() { s.controlar({ id: m.id, acao: 'pausar' }) },
  })
  assert.equal(tentativas, 1); assert.equal(modelos, 0); assert.equal(r.estado, 'pausada')
  assert.equal(s.missao(m.id).estado, 'pausada')
})
test('ciclo que termina cedo é continuado; confirmação exige screenshot e conta uma só vez', async t => {
  const { s, m, c, root } = fixture(t)
  let ciclos = 0, cliques = 0, limpezas = 0
  const navegador = { async conectar() {}, async fechar() {}, async concluir(id) { assert.equal(s.obter(id).estado,'confirmada');assert.ok(s.obter(id).evidencias.length);limpezas++ }, async executar(a) {
    if (a.acao === 'capturar') return { bytes: png, url: c.url }
    if (a.acao === 'ler') return { url: c.url, frames: [{ conteudo: 'Application submitted successfully — fixture' }] }
    if (a.acao === 'clicar') { assert.equal(s.obter(c.id).estado, 'enviando'); cliques++ }
    return { url: c.url }
  } }
  const agente = { async configuracao() { return { perfilPadrao: 'gpt-5-6-sol-medium', provider: '9router' } }, async executarComFerramentas(o) {
    assert.equal(o.perfilId, 'gpt-5-6-sol-medium'); ciclos++; o.onUso({ prompt_tokens: 1100000, completion_tokens: 10 })
    if (ciclos === 1) { await o.executarFerramenta('checkpoint', { resumo: 'Retomar vaga reservada no ciclo seguinte.' }); return { mensagem: 'Preparado' } }
    await o.executarFerramenta('registrar', { acao: 'atualizar', entrada: { id: c.id, estado: 'pronta', anexo: c.cv.nome, campos: [{ pergunta: 'Experiência', resposta: 'Fixture', fonte: 'teste' }], proximaAcao: 'Enviar' } })
    await o.executarFerramenta('navegador', { acao: 'enviar', candidaturaId: c.id, aba: '1', role: 'button', nome: 'Submit application' })
    await assert.rejects(o.executarFerramenta('navegador', { acao: 'enviar', candidaturaId: c.id, aba: '1', role: 'button', nome: 'Submit application' }))
    await assert.rejects(o.executarFerramenta('capturar', { candidaturaId: c.id, aba: '1', etapa: 'confirmacao', texto: 'Recibo inventado que não aparece na página' }), /trecho exato/)
    const e = await o.executarFerramenta('capturar', { candidaturaId: c.id, aba: '1', etapa: 'confirmacao', texto: 'Application submitted successfully — fixture' })
    await o.executarFerramenta('registrar', { acao: 'resultado', entrada: { id: c.id, estado: 'confirmada', evidenciaId: e.id } })
    return { mensagem: 'Comprovado na fixture' }
  } }
  const r = await executarMissao({ s, missaoId: m.id, repoRoot: root, agente, navegador })
  assert.equal(ciclos, 2); assert.equal(cliques, 1); assert.equal(r.estado, 'concluida')
  assert.equal(r.tokensEntrada, 2200000); assert.equal(s.missao(m.id).confirmadas, 1)
  assert.equal(limpezas,1)
})
test('pausa barra navegador e modelo; outras missões não podem ser alteradas', async t => {
  const { s, m, c, root } = fixture(t)
  let comandos = 0
  const executar = criarFerramentas({ s, missaoId: m.id, repoRoot: root, progresso: { acoes: 0 }, salvar() {}, autorizar() { s.autorizar({ missaoId: m.id }) }, navegador: { executar() { comandos++ } } })
  s.controlar({ id: m.id, acao: 'pausar' })
  await assert.rejects(executar('navegador', { acao: 'clicar', candidaturaId: c.id }), e => e.codigo === 'MISSAO_PAUSADA')
  assert.equal(comandos, 0)
})
test('supervisor registra etapa e candidatura atual sem copiar respostas do formulário', async t => {
  const { s, m, c, root } = fixture(t), progresso = { acoes: 0 }, snapshots = []
  const executar = criarFerramentas({ s, missaoId: m.id, repoRoot: root, progresso, salvar() { snapshots.push(JSON.parse(JSON.stringify(progresso))) }, autorizar() {}, navegador: { executar() {} } })
  await executar('registrar', { acao: 'atualizar', entrada: { id: c.id, estado: 'preenchendo', campos: [{ pergunta: 'Nome', resposta: 'valor privado da fixture', fonte: 'fixture' }], proximaAcao: 'Continuar formulário' } })
  assert.deepEqual(progresso.atividadeAtual, { ferramenta: 'registrar', acao: 'atualizar', candidaturaId: c.id, em: progresso.atividadeAtual.em })
  assert.equal(progresso.eventosRecentes.length, 1);assert.equal(progresso.eventosRecentes[0].acao, 'atualizar')
  assert.equal(JSON.stringify(snapshots).includes('valor privado da fixture'), false)
})
test('reserva do LinkedIn exige cargo e empresa da mesma página observada', async t => {
  const { s, m, root } = fixture(t)
  const url = 'https://www.linkedin.com/jobs/view/4466802646/'
  const navegador = { executar: async () => ({ url, titulo:'Cloud Integration Engineer | Avvale | LinkedIn', vagaAtual:{url:'https://www.linkedin.com/jobs/view/4466802646',cargo:'Cloud Integration Engineer',empresa:'Avvale'}, frames:[] }) }
  const executar = criarFerramentas({s,missaoId:m.id,repoRoot:root,navegador,progresso:{acoes:0,eventosRecentes:[]},salvar(){},autorizar(){}})
  await executar('navegador',{acao:'ler',aba:'1'})
  const base={url,empresa:'Avvale',foco:'software',idioma:'pt',qualificacao:{ativa:true,elegivel:true,requisitosAtendidos:true,modalidade:'remoto',motivo:'Vaga fixture observada na página concreta'}}
  await assert.rejects(executar('registrar',{acao:'reservar',entrada:{...base,cargo:'AI Engineer'}}),/Reserva divergente/)
  const correta=await executar('registrar',{acao:'reservar',entrada:{...base,cargo:'Cloud Integration Engineer'}})
  assert.equal(correta.cargo,'Cloud Integration Engineer')
})
test('preset com campo sensível pendente registra o bloqueio e libera a próxima vaga',async t=>{
  const {s,m,c,root}=fixture(t),pasta=path.join(root,'LucasOL/Portfolio/privacidade');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'dados-candidatura-canonicos.local.md'),'- Software: 3 anos\n')
  const navegador={candidaturaDaAba:()=>c.id,vincular:async()=>{},executar:async a=>a.acao==='capturar'?{bytes:png,url:c.url}:{ok:true,acao:'aplicar_preset',bloqueios:[{campo:'Pessoa com deficiência',motivo:'Exige valor exato do titular.'}]}}
  const executar=criarFerramentas({s,missaoId:m.id,repoRoot:root,navegador,progresso:{acoes:0,eventosRecentes:[]},salvar(){},autorizar(){}})
  const r=await executar('navegador',{acao:'aplicar_preset',aba:'1',candidaturaId:c.id})
  assert.equal(r.registroAtualizado,true);assert.equal(s.obter(c.id).estado,'aguardando_dado');assert.match(s.obter(c.id).proximaAcao,/valor exato/)
})
test('pergunta administrativa com estimativa autorizada não pode virar dado ausente',async t=>{
 const {s,m,c,root}=fixture(t),pasta=path.join(root,'LucasOL/Portfolio/privacidade');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'dados-candidatura-canonicos.local.md'),'- Software: 3 anos\n')
 const executar=criarFerramentas({s,missaoId:m.id,repoRoot:root,navegador:{},progresso:{acoes:0,eventosRecentes:[]},salvar(){},autorizar(){}})
 await assert.rejects(()=>executar('registrar',{acao:'atualizar',entrada:{id:c.id,estado:'aguardando_dado',campos:[{pergunta:'Are you willing to work exclusively for our company?',resposta:'ausente',fonte:'dados'}],proximaAcao:'Pedir ao titular'}}),/presets autorizados/)
 assert.equal(s.obter(c.id).estado,'reservada')
})
test('campo factual realmente ausente permite isolar a vaga mesmo com outro campo estimável',async t=>{
 const {s,m,c,root}=fixture(t),pasta=path.join(root,'LucasOL/Portfolio/privacidade');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'dados-candidatura-canonicos.local.md'),'- Software: 3 anos\n')
 const executar=criarFerramentas({s,missaoId:m.id,repoRoot:root,navegador:{},progresso:{acoes:0,eventosRecentes:[]},salvar(){},autorizar(){}})
 await executar('registrar',{acao:'atualizar',entrada:{id:c.id,estado:'aguardando_dado',campos:[{pergunta:'Are you willing to work exclusively for our company?',resposta:'pendente',fonte:'dados'},{pergunta:'Qual é seu nível de espanhol?',resposta:'ausente',fonte:'dados'}],proximaAcao:'Aguardar dado factual de espanhol'}})
 assert.equal(s.obter(c.id).estado,'aguardando_dado')
})
test('primeira leitura de ATS aplica o preset automaticamente antes de devolver o formulário',async t=>{
  const {s,m,c,root}=fixture(t),pasta=path.join(root,'LucasOL/Portfolio/privacidade');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'dados-candidatura-canonicos.local.md'),'- Software: 3 anos\n- Nome civil: Example User\n')
  const chamadas=[]
  const navegador={candidaturaDaAba:()=>c.id,vincular:async()=>{},executar:async a=>{chamadas.push(a.acao);if(a.acao==='capturar')return {bytes:png,url:'https://jobs.ashbyhq.com/acme/1/application'};if(a.acao==='ler')return {url:'https://jobs.ashbyhq.com/acme/1/application',frames:[]};if(a.acao==='aplicar_preset')return {ok:true,acao:'aplicar_preset',aplicavel:true,resultados:[{campo:'Full Name',estado:'preenchido'}],bloqueios:[],url:'https://jobs.ashbyhq.com/acme/1/application',frames:[]}}}
  const executar=criarFerramentas({s,missaoId:m.id,repoRoot:root,navegador,progresso:{acoes:0,eventosRecentes:[]},salvar(){},autorizar(){}})
  const r=await executar('navegador',{acao:'ler',aba:'1',candidaturaId:c.id})
  assert.equal(r.presetAutomatico,true);assert.deepEqual(chamadas,['capturar','ler','aplicar_preset']);assert.equal(s.obter(c.id).estado,'preenchendo')
})
test('pedido antigo de preset no LinkedIn é promovido ao fluxo multi-etapa',async t=>{
 const {s,m,c,root}=fixture(t),pasta=path.join(root,'LucasOL/Portfolio/privacidade');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'dados-candidatura-canonicos.local.md'),'- Software: 3 anos\n')
 const chamadas=[]
 const navegador={candidaturaDaAba:()=>c.id,vincular:async()=>{},executar:async a=>{chamadas.push(a.acao);if(a.acao==='capturar')return {bytes:png,url:'https://www.linkedin.com/jobs/view/1'};if(a.acao==='aplicar_preset')return {acao:a.acao,aplicavel:true,pendentes:[],url:'https://www.linkedin.com/jobs/view/1'};if(a.acao==='preparar_rapido')return {acao:a.acao,prontoParaRevisao:true,url:'https://www.linkedin.com/jobs/view/1'}}}
 const executar=criarFerramentas({s,missaoId:m.id,repoRoot:root,navegador,progresso:{acoes:0,eventosRecentes:[]},salvar(){},autorizar(){}})
 const r=await executar('navegador',{acao:'aplicar_preset',aba:'1',candidaturaId:c.id})
 assert.equal(r.fluxoRapidoAutomatico,true);assert.equal(r.prontoParaRevisao,true);assert.deepEqual(chamadas,['capturar','aplicar_preset','preparar_rapido'])
})

test('cada nova etapa do LinkedIn recebe o preset mesmo mantendo a mesma URL',async t=>{
 const {s,m,c,root}=fixture(t),pasta=path.join(root,'LucasOL/Portfolio/privacidade');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'dados-candidatura-canonicos.local.md'),'- Software: 3 anos\n');let etapa=1,presets=0
 const leitura=()=>({url:'https://www.linkedin.com/jobs/view/1',frames:[{frame:0,campos:[{campo:etapa===1?'phone':'years',label:etapa===1?'Phone':'Python years',tipo:'text'}]}]})
 const navegador={candidaturaDaAba:()=>c.id,vincular:async()=>{},executar:async a=>{if(a.acao==='capturar')return {bytes:png,url:c.url};if(a.acao==='ler')return leitura();if(a.acao==='aplicar_preset'){presets++;return {ok:true,acao:'aplicar_preset',aplicavel:true,resultados:[{campo:etapa===1?'Phone':'Python years',estado:'preenchido'}],bloqueios:[],...leitura()}}}}
 const executar=criarFerramentas({s,missaoId:m.id,repoRoot:root,progresso:{acoes:0,eventosRecentes:[]},salvar(){},autorizar(){},navegador})
 await executar('navegador',{acao:'ler',aba:'1',candidaturaId:c.id})
 await executar('navegador',{acao:'ler',aba:'1',candidaturaId:c.id})
 etapa=2
 await executar('navegador',{acao:'ler',aba:'1',candidaturaId:c.id})
 assert.equal(presets,2)
})
test('executor consulta telefone e CPF sem devolver o restante do cadastro privado', async t => {
  const { s, m, root } = fixture(t)
  const pasta = path.join(root, 'LucasOL/Portfolio/privacidade')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'dados-candidatura-canonicos.local.md'), [
    '# Dados privados para candidaturas',
    '- Nome civil: Pessoa de Teste',
    '- Telefone: +55 18 99999-0000',
    '- CPF: 111.444.777-35',
    '- Email: teste@example.com',
  ].join('\n'))
  const executar = criarFerramentas({ s, missaoId: m.id, repoRoot: root, progresso: { acoes: 0 }, salvar() {}, autorizar() {}, navegador: { executar() {} } })
  const r = await executar('consultar', { fonte: 'dados', termo: 'Telefone, CPF' })
  assert.deepEqual(r.campos, { Telefone: '+55 18 99999-0000', CPF: '111.444.777-35' })
  assert.deepEqual(r.ausentes, [])
  assert.equal('conteudo' in r, false)
})
test('preenchimento retorna recibo compacto e só relê o formulário quando solicitado', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-browser-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const pasta = path.join(home, '.agents/desktop/sessions/dailywork-candidaturas/chromium')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'DevToolsActivePort'), '9222\n/devtools/browser/test-compact\n')
  let snapshots = 0
  const alvo = { async fill() {}, async press() {} }
  const frame = { url: () => 'https://jobs.example.com/1', locator: () => ({ async ariaSnapshot() { snapshots++; return '- textbox "Telefone"' } }), getByLabel: () => alvo }
  const pagina = { isClosed: () => false, async title() { return 'Vaga' }, url: () => 'https://jobs.example.com/1', frames: () => [frame], async goto() {} }
  const browser = { contexts: () => [{ async newPage() { return pagina } }], async close() {} }
  const navegador = criarNavegador({conferirAlvos:async()=>({verificadas:0}), home, abrirAutomaticamente: false, autorizar() {}, chromium: { async connectOverCDP() { return browser } }, bancada: { async comControle(fn) { return fn() } } })
  const aberta = await navegador.executar({ acao: 'abrir', url: 'https://jobs.example.com/1' })
  assert.equal(aberta.frames[0].conteudo, '- textbox "Telefone"')
  const preenchida = await navegador.executar({ acao: 'preencher', aba: aberta.aba, label: 'Telefone', texto: '+55 18 99999-0000' })
  assert.deepEqual(preenchida, { ok: true, acao: 'preencher', url: 'https://jobs.example.com/1' })
  assert.equal(snapshots, 1)
  await navegador.executar({ acao: 'ler', aba: aberta.aba })
  assert.equal(snapshots, 2)
})
test('lote preenche a etapa inteira com um único controle e uma leitura final', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-browser-batch-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const pasta = path.join(home, '.agents/desktop/sessions/dailywork-candidaturas/chromium')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'DevToolsActivePort'), '9222\n/devtools/browser/test-batch\n')
  const valores = {}, cliques = []; let snapshots = 0, controles = 0
  const alvo = nome => ({
    async fill(valor) { valores[nome] = valor }, async press() {}, async inputValue() { return valores[nome] || '' },
    async click() { cliques.push(nome) },
  })
  const frame = {
    url: () => 'https://jobs.example.com/apply',
    locator: seletor => ({ async ariaSnapshot() { snapshots++; return '- textbox "Nome"\n- textbox "Email"\n- checkbox "Remoto"' } }),
    getByLabel: nome => alvo(nome),
  }
  const pagina = { isClosed: () => false, async title() { return 'Formulário' }, url: frame.url, frames: () => [frame], async goto() {}, async waitForTimeout() {} }
  const navegador = criarNavegador({conferirAlvos:async()=>({verificadas:0}), home, abrirAutomaticamente:false, autorizar() {}, chromium:{ async connectOverCDP(){ return {contexts:()=>[{async newPage(){return pagina}}],async close(){}} } }, bancada:{ async comControle(fn){controles++;return fn()} } })
  const aberta = await navegador.executar({acao:'abrir',url:frame.url()})
  const lote = await navegador.executar({acao:'lote',aba:aberta.aba,passos:[
    {acao:'preencher',label:'Nome',texto:'Example User'},
    {acao:'preencher',label:'Email',texto:'you@example.com'},
    {acao:'clicar',label:'Remoto'},
  ]})
  assert.equal(lote.executados,3);assert.deepEqual(valores,{Nome:'Example User',Email:'you@example.com'});assert.deepEqual(cliques,['Remoto'])
  assert.equal(controles,0);assert.equal(snapshots,2)
})
test('CDP segue com Chromium aberto mesmo se o helper de controle da bancada falhar', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-browser-cdp-ctrl-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const pasta = path.join(home, '.agents/desktop/sessions/dailywork-candidaturas/chromium')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'DevToolsActivePort'), '9222\n/devtools/browser/ctrl-test\n')
  const frame = {
    url: () => 'https://jobs.example.com/apply',
    locator: () => ({ async ariaSnapshot() { return '- heading "Vaga"' }, evaluateAll: async () => [] }),
  }
  const pagina = { isClosed: () => false, async title() { return 'Vaga' }, url: frame.url, frames: () => [frame], async goto() {} }
  let controles = 0
  const n = criarNavegador({
    conferirAlvos: async () => ({ verificadas: 0 }),
    home, abrirAutomaticamente: false, autorizar() {},
    bancada: {
      async estado() { return { controle: 'agente', conectado: true } },
      async comControle() { controles++; throw Object.assign(new Error('A bancada está com você ou indisponível.'), { codigo: 'CONTROLE_HUMANO' }) },
    },
    chromium: { connectOverCDP: async () => ({ contexts: () => [{ async newPage() { return pagina } }], async close() {} }) },
  })
  const r = await n.executar({ acao: 'abrir', url: frame.url() })
  assert.equal(typeof r.aba, 'string')
  assert.equal(controles, 0)
  await n.fechar()
})
test('Assumir da bancada ainda barra o CDP enquanto o humano está no controle', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-browser-humano-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const pasta = path.join(home, '.agents/desktop/sessions/dailywork-candidaturas/chromium')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'DevToolsActivePort'), '9222\n/devtools/browser/humano-test\n')
  const n = criarNavegador({
    conferirAlvos: async () => ({ verificadas: 0 }),
    home, abrirAutomaticamente: false, autorizar() {},
    bancada: { async estado() { return { controle: 'humano', conectado: true } }, async comControle() { throw new Error('não deve ser chamado') } },
    chromium: { connectOverCDP: async () => { throw new Error('não deve conectar') } },
  })
  await assert.rejects(n.executar({ acao: 'abas' }), e => e.codigo === 'CONTROLE_HUMANO')
})
test('preset Gupy completa datas compartilhadas e avança em uma chamada',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-gupy-preset-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/gupy-preset\n')
 let ativo=null,url='https://empresa.gupy.io/candidates/applications/1/steps/2/curriculum'
 const campo=value=>({value,disabled:false,checked:false,count:async()=>1,isDisabled:async function(){return this.disabled},inputValue:async function(){return this.value},click:async function(){ativo=this},isChecked:async function(){return this.checked},check:async function(){this.checked=true}})
 const meses=['','', 'Julho','', 'Abril',''].map(campo),anos=['2026','2027','2026','','',''].map(campo),empresas=['NexUnio','LojaSync'].map(campo),atuais=[campo('on'),campo('on')];atuais[0].checked=true
 const lista=itens=>({count:async()=>itens.length,nth:i=>itens[i]})
 const opcoes=texto=>{const opcao={click:async()=>{ativo.value=texto}};return {count:async()=>1,first:()=>opcao,evaluateAll:async()=>[0],nth:()=>opcao}}
 const salvar={count:async()=>1,click:async()=>{url='https://empresa.gupy.io/candidates/applications/1/steps/3/questions'}}
 const frame={url:()=>url,locator:()=>({ariaSnapshot:async()=>'- text: currículo',evaluateAll:async()=>[]})}
 const page={isClosed:()=>false,url:()=>url,title:async()=> 'Gupy',goto:async()=>{},frames:()=>[frame],waitForTimeout:async()=>{},waitForURL:async fn=>assert.equal(fn(new URL(url)),true),locator:s=>s.includes('monthValue')?lista(meses):s.includes('yearValue')?lista(anos):s.includes('companyName')?lista(empresas):s.includes('isCurrentJob')?lista(atuais):lista([]),getByRole:(role,o)=>role==='option'?opcoes(o.name):salvar}
 const n=criarNavegador({conferirAlvos:async()=>({verificadas:0}),home,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}})}})
 const aberta=await n.executar({acao:'abrir',url});const r=await n.executar({acao:'aplicar_preset',aba:aberta.aba,_preset:{respostasRapidas:{inicioCursoMes:'Janeiro',inicioCursoAno:'2026',fimCursoMes:'Dezembro',fimCursoAno:'2027',inicioNexUnio:'Julho de 2026',inicioLojaSync:'Junho de 2026'}}})
 assert.equal(r.acao,'aplicar_preset');assert.equal(r.url,url);assert.deepEqual(meses.map(v=>v.value),['Janeiro','Dezembro','Julho','', 'Junho','']);assert.deepEqual(anos.map(v=>v.value),['2026','2027','2026','','2026','']);assert.equal(atuais[1].checked,true)
})
test('conexão só aceita endpoint da bancada de candidaturas, sem fallback pessoal', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-chromium-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.throws(() => endpointChromium(root), e => e.codigo === 'CHROMIUM_CONEXAO_AUSENTE')
  const pasta = path.join(root, '.agents/desktop/sessions/dailywork-candidaturas/chromium'); fs.mkdirSync(pasta, { recursive: true })
  const arquivo = path.join(pasta, 'DevToolsActivePort')
  fs.writeFileSync(arquivo, '9222\n/devtools/browser/test-123\n')
  assert.equal(endpointChromium(root), 'ws://127.0.0.1:9222/devtools/browser/test-123')
  fs.writeFileSync(arquivo, '9222\n//external.example/devtools\n')
  assert.throws(() => endpointChromium(root), /inválida/)
})

test('formulário aberto por popup passa a ser uma aba própria e não adota abas alheias',async t=>{
 const {EventEmitter}=require('node:events')
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-popup-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/popup-test\n')
 function page(url){const p=new EventEmitter();Object.assign(p,{isClosed:()=>false,url:()=>url,title:async()=>url,goto:async()=>{},waitForLoadState:async()=>{},frames:()=>[{url:()=>url,locator:()=>({ariaSnapshot:async()=>'- textbox "Name"'}),getByRole:()=>({click:async()=>p.emit('popup',form)})}],waitForEvent:()=>new Promise(resolve=>p.once('popup',resolve))});return p}
 const form=page('https://ats.example.com/apply'),listing=page('https://jobs.example.com/1'),unrelated=page('https://unrelated.example.com')
 const navegador=criarNavegador({conferirAlvos:async()=>({verificadas:0}),home,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[{newPage:async()=>listing,pages:()=>[listing,form,unrelated]}],close:async()=>{}})}})
 const aberta=await navegador.executar({acao:'abrir',url:listing.url()})
 const clicada=await navegador.executar({acao:'clicar',aba:aberta.aba,role:'link',nome:'Apply'})
 assert.notEqual(clicada.aba,aberta.aba);assert.equal(clicada.url,form.url());assert.equal(clicada.origem,aberta.aba)
 assert.deepEqual((await navegador.executar({acao:'abas'})).map(p=>p.url),[listing.url(),form.url()])
 assert.equal((await navegador.executar({acao:'ler',aba:clicada.aba})).url,form.url())
})

test('timeout do Grok continua o ciclo e conserva histórico privado para retomada',async t=>{
 const {s,m,root}=fixture(t);let chamadas=0
 const historico=[{role:'user',content:'Histórico da fixture'},{role:'assistant',content:'Próxima vaga a consultar'}]
 const r=await executarMissao({s,missaoId:m.id,repoRoot:root,maxCiclos:2,navegador:{conectar:async()=>{},fechar:async()=>{}},agente:{configuracao:async()=>({perfilPadrao:'grok-4-6',provider:'grok-cli'}),executarComFerramentas:async o=>{
  chamadas++
  if(chamadas===1){o.onHistorico(historico);await o.executarFerramenta('checkpoint',{resumo:'Progresso antes do timeout'});throw Object.assign(new Error('timeout fixture'),{codigo:'TIMEOUT_GROK_CLI'})}
  assert.ok(o.mensagens.some(m=>m.content==='Próxima vaga a consultar'))
  return {mensagem:'Ciclo retomado'}
 }}})
 assert.equal(chamadas,2);assert.equal(r.estado,'interrompida')
 const arquivo=path.join(s.privateDir,'missoes',m.id,'historico-modelo.json')
 assert.deepEqual(JSON.parse(fs.readFileSync(arquivo)),historico);assert.equal(fs.statSync(arquivo).mode&0o777,0o600)
})

test('anexo usa input de arquivo único sem exigir botão e recusa campo ambíguo',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-upload-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/upload-test\n')
 let quantidade=1,anexo=null
 const frame={url:()=> 'https://ats.example.com/apply',locator:selector=>selector==='body'?{ariaSnapshot:async()=>'- text: Currículo'}:{count:async()=>quantidade,setInputFiles:async arquivo=>anexo=arquivo}}
 const page={isClosed:()=>false,url:frame.url,title:async()=> 'Formulário',goto:async()=>{},frames:()=>[frame]}
 const n=criarNavegador({conferirAlvos:async()=>({verificadas:0}),home,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}})}})
 const p=await n.executar({acao:'abrir',url:frame.url()})
 await n.executar({acao:'anexar',aba:p.aba},{caminho:'/fixture/cv-oficial.pdf'});assert.equal(anexo,'/fixture/cv-oficial.pdf')
 quantidade=2;anexo=null
 await assert.rejects(n.executar({acao:'anexar',aba:p.aba},{caminho:'/fixture/cv-oficial.pdf'}),/mais de um/);assert.equal(anexo,null)
})

test('reconexão recupera apenas alvos previamente registrados pela missão',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-owned-tabs-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/owned-test\n')
 const registroAbas=path.join(home,'private/abas.json');const frame={url:()=> 'https://jobs.example.com/1',locator:()=>({ariaSnapshot:async()=>'- text: Formulário'})}
 const propria={target:'owned-target',isClosed:()=>false,url:frame.url,title:async()=> 'Minha vaga',goto:async()=>{},frames:()=>[frame]}
 const alheia={...propria,target:'unrelated-target',url:()=> 'https://unrelated.example.com'}
 const context={newPage:async()=>propria,pages:()=>[propria,alheia],newCDPSession:async p=>({send:async()=>({targetInfo:{targetId:p.target}}),detach:async()=>{}})}
 const opts={home,registroAbas,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[context],close:async()=>{}})}}
 const n=criarNavegador({...opts,conferirAlvos:async()=>({verificadas:0})});const aberta=await n.executar({acao:'abrir',url:propria.url()});await n.fechar()
 const retomada=criarNavegador({...opts,conferirAlvos:async()=>({verificadas:0})});const abas=await retomada.executar({acao:'abas'})
 assert.equal(abas.length,1);assert.equal(abas[0].id,aberta.aba);assert.equal(abas[0].url,propria.url());assert.equal(fs.statSync(registroAbas).mode&0o777,0o600)
})

test('higiene reutiliza URL, protege formulário e fecha apenas abas vinculadas após reinício',async t=>{
 const {EventEmitter}=require('node:events');const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-tab-cleanup-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/hygiene-test\n')
 let dirty=false,created=0
 const p=new EventEmitter();Object.assign(p,{target:'owned',closed:false,isClosed:()=>p.closed,url:()=> 'https://jobs.example.com/1',title:async()=> 'Vaga',goto:async()=>{},frames:()=>[{url:p.url,locator:()=>({ariaSnapshot:async()=>'- textbox',evaluateAll:async()=>dirty})}],close:async()=>{p.closed=true;p.emit('close')}})
 const alheia={target:'other',isClosed:()=>false,url:()=> 'https://other.example.com/1'}
 const context={newPage:async()=>{created++;return p},pages:()=>[p,alheia].filter(p=>!p.isClosed()),newCDPSession:async p=>({send:async()=>({targetInfo:{targetId:p.target}}),detach:async()=>{}})}
 const registroAbas=path.join(home,'abas.json');const opts={home,registroAbas,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[context],close:async()=>{p.emit('close')}})}}
 const n=criarNavegador({...opts,conferirAlvos:async()=>({verificadas:0})});const aberta=await n.executar({acao:'abrir',url:p.url()});const repetida=await n.executar({acao:'abrir',url:p.url()})
 assert.equal(created,1);assert.equal(repetida.aba,aberta.aba);assert.equal(repetida.reutilizada,true)
 dirty=true;await assert.rejects(n.executar({acao:'fechar',aba:aberta.aba}),/preservada/)
 await n.vincular(aberta.aba,'candidate-1');await n.fechar();assert.equal(JSON.parse(fs.readFileSync(registroAbas)).abas[aberta.aba],'owned')
 const retomada=criarNavegador({...opts,conferirAlvos:async()=>({verificadas:0})});await retomada.executar({acao:'abas'});assert.deepEqual(await retomada.concluir('candidate-other'),[])
 assert.deepEqual(await retomada.concluir('candidate-1'),[aberta.aba]);assert.equal(p.closed,true);assert.equal(alheia.isClosed(),false)
 assert.deepEqual(JSON.parse(fs.readFileSync(registroAbas)).abas,{})
 assert.deepEqual(await retomada.executar({acao:'abas'}),[])
})

test('higiene remove pesquisa concluída e aba fechada externamente do registro',async t=>{
 const {EventEmitter}=require('node:events');const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-tabs-closed-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/closed-test\n')
 let seq=0;const pages=[];const context={pages:()=>pages,newPage:async()=>{const p=new EventEmitter();p.target=String(++seq);p.closed=false;p.u='';Object.assign(p,{isClosed:()=>p.closed,url:()=>p.u,title:async()=> 'Busca',goto:async u=>p.u=u,frames:()=>[{url:()=>p.u,locator:()=>({ariaSnapshot:async()=>'- text',evaluateAll:async()=>false})}],close:async()=>{p.closed=true;p.emit('close')}});pages.push(p);return p},newCDPSession:async p=>({send:async()=>({targetInfo:{targetId:p.target}}),detach:async()=>{}})}
 const registroAbas=path.join(home,'abas.json');const n=criarNavegador({conferirAlvos:async()=>({verificadas:0}),home,registroAbas,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[context],close:async()=>{}})}})
 const a=await n.executar({acao:'abrir',url:'https://search.example.com/1'});await n.executar({acao:'fechar',aba:a.aba});assert.deepEqual(JSON.parse(fs.readFileSync(registroAbas)).abas,{})
 await n.executar({acao:'abrir',url:'https://search.example.com/2'});await pages[1].close();assert.deepEqual(JSON.parse(fs.readFileSync(registroAbas)).abas,{})
})

test('higiene fecha detalhe do LinkedIn sem reserva apesar dos filtros da página',async t=>{
 const {EventEmitter}=require('node:events');const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-linkedin-cleanup-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/linkedin-cleanup\n')
 const p=new EventEmitter();Object.assign(p,{target:'linkedin-detail',closed:false,isClosed:()=>p.closed,url:()=> 'https://www.linkedin.com/jobs/view/4295786373/',title:async()=> 'Vaga | Empresa | LinkedIn',goto:async()=>{},frames:()=>[{url:p.url,locator:()=>({ariaSnapshot:async()=>'- select "Idioma"',evaluateAll:async()=>true})}],close:async()=>{p.closed=true;p.emit('close')}})
 const context={newPage:async()=>p,pages:()=>p.closed?[]:[p],newCDPSession:async()=>({send:async()=>({targetInfo:{targetId:p.target}}),detach:async()=>{}})}
 const n=criarNavegador({conferirAlvos:async()=>({verificadas:0}),home,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[context],close:async()=>{}})}})
 const a=await n.executar({acao:'abrir',url:p.url()});await n.executar({acao:'fechar',aba:a.aba});assert.equal(p.closed,true)
})

test('radio estilizado usa o label associado e mantém o clique nativo',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-radio-label-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/radio-test\n')
 let labels=0,inputs=0,disposed=0
 const alvo={evaluateHandle:async()=>({asElement:()=>({click:async()=>labels++}),dispose:async()=>disposed++}),click:async()=>inputs++}
 const frame={url:()=> 'https://jobs.example.com',locator:()=>({ariaSnapshot:async()=>'- radio "Contractor"'}),getByRole:()=>alvo,getByLabel:()=>alvo}
 const page={isClosed:()=>false,url:frame.url,title:async()=> 'Formulário',goto:async()=>{},frames:()=>[frame]}
 const n=criarNavegador({conferirAlvos:async()=>({verificadas:0}),home,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}})}})
 const a=await n.executar({acao:'abrir',url:frame.url()});await n.executar({acao:'clicar',aba:a.aba,role:'radio',nome:'Contractor'})
 await n.executar({acao:'clicar',aba:a.aba,label:'Contractor'});assert.equal(labels,2);assert.equal(inputs,0);assert.equal(disposed,4)
})

test('higiene preserva envio incerto mesmo sem campos editados e sem vínculo anterior',async t=>{
 const {s,m,c,root}=fixture(t);s.atualizar({id:c.id,estado:'pronta',anexo:c.cv.nome,campos:[{pergunta:'Nome',resposta:'Fixture',fonte:'fixture'}],proximaAcao:'Enviar'});s.intencao({id:c.id});s.resultado({id:c.id,estado:'a_verificar',motivo:'Resposta incerta fixture'})
 let fechamentos=0
 const executar=criarFerramentas({s,missaoId:m.id,repoRoot:root,progresso:{acoes:0},salvar(){},autorizar(){},navegador:{executar(){fechamentos++}}})
 await assert.rejects(executar('navegador',{acao:'fechar',aba:'1',candidaturaId:c.id}),/envio incerto/)
 assert.equal(fechamentos,0)
})

test('questionário recupera controle textual único após frame mudar de posição',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-dynamic-frame-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/frame-test\n')
 let clicks=0,duplicado=false
 const locator=count=>({count:async()=>count,click:async()=>clicks++})
 const frame=(found)=>({url:()=> 'https://form.example.com',locator:()=>({ariaSnapshot:async()=>'- text: Opção observada'}),getByText:()=>locator(found||duplicado?1:0)})
 const frames=[frame(false),frame(true)];const page={isClosed:()=>false,url:()=> 'https://jobs.example.com/1',title:async()=> 'Formulário',goto:async()=>{},frames:()=>frames}
 const n=criarNavegador({conferirAlvos:async()=>({verificadas:0}),home,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}})}})
 const a=await n.executar({acao:'abrir',url:page.url()});await n.executar({acao:'clicar',aba:a.aba,frame:4,textoAlvo:'Opção observada'});assert.equal(clicks,1)
 duplicado=true;await assert.rejects(n.executar({acao:'clicar',aba:a.aba,frame:4,textoAlvo:'Opção observada'}),/ambíguo/);assert.equal(clicks,1)
})

test('OK escolhe o único botão exposto e Enter sem alvo atua no frame atual',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-step-controls-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/step-test\n')
 const clicks=[],keys=[];const choices={count:async()=>3,evaluateAll:async()=>[1],nth:i=>({click:async()=>clicks.push(i)})}
 const frame={url:()=> 'https://form.example.com',getByRole:()=>choices,locator:()=>({ariaSnapshot:async()=>'- button "OK"',press:async k=>keys.push(k)})}
 const page={isClosed:()=>false,url:()=> 'https://jobs.example.com/1',title:async()=> 'Etapas',goto:async()=>{},frames:()=>[frame]}
 const n=criarNavegador({conferirAlvos:async()=>({verificadas:0}),home,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}})}})
 const a=await n.executar({acao:'abrir',url:page.url()});await n.executar({acao:'clicar',aba:a.aba,role:'button',nome:'OK',indice:2});await n.executar({acao:'tecla',aba:a.aba,tecla:'Enter'})
 assert.deepEqual(clicks,[1]);assert.deepEqual(keys,['Enter'])
})

test('índice observado permite operar controle repetido abaixo do painel',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-offscreen-index-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/offscreen-test\n')
 const clicks=[]
 const alvo=i=>({click:async()=>clicks.push(i),evaluateHandle:async fn=>String(fn).includes('getComputedStyle')?{evaluate:async()=>{},dispose:async()=>{}}:{asElement:()=>null,dispose:async()=>{}}})
 const repetidos={count:async()=>2,evaluateAll:async()=>[],nth:i=>alvo(i)}
 const frame={url:()=> 'https://form.example.com',getByRole:()=>repetidos,locator:()=>({ariaSnapshot:async()=>'- checkbox "Meu emprego atual"',evaluateAll:async()=>[]})}
 const page={isClosed:()=>false,url:frame.url,title:async()=> 'Formulário',goto:async()=>{},frames:()=>[frame]}
 const n=criarNavegador({conferirAlvos:async()=>({verificadas:0}),home,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}})}})
 const a=await n.executar({acao:'abrir',url:page.url()});await n.executar({acao:'clicar',aba:a.aba,role:'checkbox',nome:'Meu emprego atual',indice:1})
 assert.deepEqual(clicks,[1])
})

test('nome dinâmico do LinkedIn pode ser reutilizado como campo sem virar seletor livre',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-linkedin-field-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/linkedin-field\n')
 const clicks=[];const alvo=i=>({click:async()=>clicks.push(i),evaluateHandle:async fn=>String(fn).includes('getComputedStyle')?{evaluate:async()=>{},dispose:async()=>{}}:{asElement:()=>null,dispose:async()=>{}}})
 const repetidos={count:async()=>2,evaluateAll:async()=>[],nth:i=>alvo(i)}
 const frame={url:()=> 'https://www.linkedin.com/jobs/view/1',locator:selector=>{if(selector.startsWith('input[name='))assert.match(selector,/radio-group-«rt»/);return selector.startsWith('input[name=')?repetidos:{ariaSnapshot:async()=>'- radio Yes',evaluateAll:async()=>[]}}}
 const page={isClosed:()=>false,url:frame.url,title:async()=> 'LinkedIn',goto:async()=>{},frames:()=>[frame]}
 const n=criarNavegador({conferirAlvos:async()=>({verificadas:0}),home,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}})}})
 const a=await n.executar({acao:'abrir',url:frame.url()});await n.executar({acao:'clicar',aba:a.aba,campo:'radio-group-«rt»',indice:0});assert.deepEqual(clicks,[0])
})

test('envio sem alvo ou com botão inválido falha antes da intenção e permanece pronto',async t=>{
 const {s,m,c,root}=fixture(t);s.atualizar({id:c.id,estado:'pronta',anexo:c.cv.nome,campos:[{pergunta:'Nome',resposta:'Fixture',fonte:'fixture'}],proximaAcao:'Enviar'})
 let validacoes=0;const executar=criarFerramentas({s,missaoId:m.id,repoRoot:root,progresso:{acoes:0},salvar(){},autorizar(){},navegador:{executar(a){assert.equal(a.acao,'validarClique');validacoes++;throw new Error('Botão ausente fixture')}}})
 await assert.rejects(executar('navegador',{acao:'enviar',aba:'1',candidaturaId:c.id}),/Nenhuma intenção/)
 assert.equal(s.obter(c.id).estado,'pronta');assert.equal(s.obter(c.id).intencaoEm,null);assert.equal(validacoes,0)
 await assert.rejects(executar('navegador',{acao:'enviar',aba:'1',candidaturaId:c.id,role:'button',nome:'Enviar'}),/Botão ausente/)
 assert.equal(s.obter(c.id).estado,'pronta');assert.equal(s.obter(c.id).intencaoEm,null);assert.equal(validacoes,1)
 await assert.rejects(executar('navegador',{acao:'enviar',aba:'1',candidaturaId:c.id,passos:[{acao:'clicar',role:'button',nome:'Enviar'}]}),/Botão ausente/)
 assert.equal(validacoes,2)
})

test('captura recupera timeout de layout pela imagem do mesmo alvo CDP',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-shot-recovery-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 const pasta=path.join(home,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(pasta,{recursive:true});fs.writeFileSync(path.join(pasta,'DevToolsActivePort'),'9222\n/devtools/browser/shot-test\n')
 let shown=0,detached=0;const page={isClosed:()=>false,url:()=> 'https://jobs.example.com/1',title:async()=> 'Vaga',goto:async()=>{},frames:()=>[],bringToFront:async()=>shown++,screenshot:async()=>{throw new Error('Screenshot timeout fixture')}}
 const context={newPage:async()=>page,newCDPSession:async target=>{assert.equal(target,page);return {send:async name=>{assert.equal(name,'Page.captureScreenshot');return {data:png.toString('base64')}},detach:async()=>detached++}}}
 const n=criarNavegador({conferirAlvos:async()=>({verificadas:0}),home,abrirAutomaticamente:false,autorizar(){},bancada:{comControle:fn=>fn()},chromium:{connectOverCDP:async()=>({contexts:()=>[context],close:async()=>{}})}})
 const a=await n.executar({acao:'abrir',url:page.url()});const shot=await n.executar({acao:'capturar',aba:a.aba});assert.deepEqual(shot.bytes,png);assert.equal(shot.url,page.url());assert.equal(shown,1);assert.equal(detached,1)
})

test('leitura expõe seleção de controles customizados sem confundir clicked com selected', async () => {
  const anterior={innerWidth:global.innerWidth,innerHeight:global.innerHeight,document:global.document}
  const elements=['clicked','selected clicked'].map((classes,i)=>({innerText:`Opção ${i+1}`,className:classes,getAttribute:n=>n==='role'?'presentation':null,getBoundingClientRect:()=>({left:0,top:i*30,width:100,height:20}),contains(hit){return hit===this}}))
  const inputs=[['monthValue','Abril'],['yearValue','2026'],['monthValue','Junho']].map(([name,value])=>({name,value,type:'text',disabled:false,labels:[],getAttribute:n=>n==='label'?'Início *':n==='placeholder'?(name==='monthValue'?'Mês':'Ano'):null}))
  global.innerWidth=800;global.innerHeight=600;global.document={elementFromPoint:(_x,y)=>elements[Math.floor(y/30)]}
  const frame={url:()=> 'https://jobs.example.com/1',locator:selector=>({ariaSnapshot:async()=>'- text: Opção 1 Opção 2',evaluateAll:async fn=>fn(selector.startsWith('[role]')?elements:selector.startsWith('input')?inputs:[])})}
  const p={isClosed:()=>false,url:frame.url,title:async()=> 'Opções',goto:async()=>{},frames:()=>[frame]}
  // Supply a valid local endpoint fixture, without connecting to a real browser.
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-controls-'));const endpoint=path.join(root,'.agents/desktop/sessions/dailywork-candidaturas/chromium');fs.mkdirSync(endpoint,{recursive:true});fs.writeFileSync(path.join(endpoint,'DevToolsActivePort'),'9222\n/devtools/browser/fixture');
  const n=criarNavegador({conferirAlvos:async()=>({verificadas:0}),home:root,autorizar(){},bancada:{comControle:fn=>fn()},abrirAutomaticamente:false,chromium:{connectOverCDP:async()=>({contexts:()=>[{newPage:async()=>p}],close:async()=>{}})}})
  try{const result=await n.executar({acao:'abrir',url:frame.url()});assert.deepEqual(result.frames[0].controles.map(c=>c.classes),['clicked','selected clicked']);assert.equal(result.frames[0].controles[0].selecionado,null);assert.deepEqual(result.frames[0].campos.map(c=>[c.campo,c.indice,c.valor]),[['monthValue',0,'Abril'],['yearValue',0,'2026'],['monthValue',1,'Junho']])}finally{await n.fechar();fs.rmSync(root,{recursive:true,force:true});for(const [k,v] of Object.entries(anterior)){if(v===undefined)delete global[k];else global[k]=v}}
})
test('prompts nativo e Codex carregam o protocolo otimizado da bancada', () => {
  const nativo = fs.readFileSync(path.join(__dirname, '../electron/candidaturas/nativo.cjs'), 'utf8')
  const worker = fs.readFileSync(path.join(__dirname, '../electron/candidaturas/worker.cjs'), 'utf8')
  assert.match(nativo, /bancada-protocolo/)
  assert.match(worker, /bancada-protocolo/)
  assert.match(worker, /AGENT_BENCH_OWNER:'dailywork'/)
})
test('coordenador ausente vira interrupção recuperável, com espera curta antes de devolver à agenda', async t => {
  const { DatabaseSync } = require('node:sqlite')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-native-'))
  const cvs = path.join(root, 'LucasOL/Portfolio/curriculos/ativos'); fs.mkdirSync(cvs, { recursive: true })
  fs.writeFileSync(path.join(cvs, 'software-engineer-pt.pdf'), '%PDF-1.4 fixture')
  const s = criarServicoCandidaturas({ repoRoot: root, launch: () => ({ tipo: 'nativo', pid: null }), stop: () => {} })
  t.after(() => { s.close(); fs.rmSync(root, { recursive: true, force: true }) })
  // Agenda mínima com coordenador vivo: o guarda aceita enquanto a linha existir.
  const arquivo = path.join(root, 'agenda.sqlite'), db = new DatabaseSync(arquivo)
  const inicio = fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]
  db.exec('CREATE TABLE coordenador(id INTEGER PRIMARY KEY, data TEXT); CREATE TABLE ocorrencias(id TEXT PRIMARY KEY, data TEXT); CREATE TABLE rotinas(id TEXT PRIMARY KEY, data TEXT); CREATE TABLE pausas(escopo TEXT, dia TEXT); CREATE TABLE instrucoes(escopo TEXT, dia TEXT, data TEXT)')
  db.prepare('INSERT INTO coordenador VALUES(1,?)').run(JSON.stringify({ dono: 'x', pid: process.pid, inicio, em: Date.now() }))
  const dia = new Date().toISOString().slice(0, 10)
  db.prepare('INSERT INTO rotinas VALUES(?,?)').run('candidaturas', JSON.stringify({ id: 'candidaturas', modulo: 'candidaturas', ativa: true, fuso: 'UTC', fim: '23:59', minutos: 240 }))
  db.prepare('INSERT INTO ocorrencias VALUES(?,?)').run('oc', JSON.stringify({ id: 'oc', rotina: 'candidaturas', estado: 'executando', dia, manual: true, ateMeta: true, iniciadaEm: Date.now(), instrucaoRevisao: '' }))
  const m = s.iniciar({ criterios: { meta: 1 }, agenda: { id: 'oc', arquivo } })
  let esperas = 0
  const r = await executarMissao({ s, missaoId: m.id, repoRoot: root, navegador: { async conectar() {}, async fechar() {} },
    agente: { async configuracao() { return { perfilPadrao: 'grok', provider: '9router' } }, async executarComFerramentas() { db.exec('DELETE FROM coordenador'); throw Object.assign(new Error('O coordenador não está respondendo; aguardando recuperação antes de agir.'), { codigo: 'COORDENADOR_INDISPONIVEL' }) } },
    async esperar() { esperas++ } })
  assert.equal(r.estado, 'interrompida'); assert.equal(esperas, 4)
  const missao = s.missao(m.id)
  assert.equal(missao.estado, 'interrompida'); assert.equal(missao.interrupcao.codigo, 'COORDENADOR_INDISPONIVEL'); assert.match(missao.motivo, /reiniciado/)
  assert.equal(s.estado().missoes.find(x => x.id === m.id).atencao.codigo, 'REINICIO')
})
test('limite diário do LinkedIn esgota a fonte e muda a orientação de busca sem virar tarefa humana', async t => {
  const { s, m, root } = fixture(t)
  const c = s.reservar({ missaoId: m.id, url: 'https://www.linkedin.com/jobs/view/777/', empresa: 'Turing', cargo: 'Remote Software Engineer', foco: 'software', idioma: 'pt', qualificacao: { ativa: true, elegivel: true, requisitosAtendidos: true, modalidade: 'remoto', motivo: 'Fixture' } })
  const progresso = { acoes: 0 }
  const executar = criarFerramentas({ s, missaoId: m.id, repoRoot: root, progresso, salvar() {}, autorizar() {}, navegador: { executar() {} } })
  const r = await executar('registrar', { acao: 'atualizar', entrada: { id: c.id, estado: 'aguardando_acesso', proximaAcao: 'LinkedIn bloqueou candidatura simplificada pelo limite diário da conta profissional. Continuar amanhã.' } })
  assert.equal(r.fonteEsgotada, 'linkedinEasyApply'); assert.match(r.orientacao, /sem f_AL/)
  assert.equal(progresso.fontesEsgotadas.linkedinEasyApply, new Date().toISOString().slice(0, 10))
  assert.equal(s.estado().missoes[0].atencao, null)
  // O prompt do ciclo seguinte proíbe Easy Apply e o supervisor expõe a fonte esgotada.
  const pasta = path.join(s.privateDir, 'missoes', m.id); fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'supervisor.json'), JSON.stringify({ estado: 'executando', fontesEsgotadas: progresso.fontesEsgotadas, checkpoint: 'x' }))
  assert.equal(s.estado().missoes[0].atencao.codigo, 'LINKEDIN_ESGOTADO')
  let sistema = ''
  await executarMissao({ s, missaoId: m.id, repoRoot: root, maxCiclos: 1, navegador: { async conectar() {}, async fechar() {} },
    agente: { async configuracao() { return { perfilPadrao: 'grok', provider: '9router' } }, async executarComFerramentas(o) { sistema = o.mensagens[0].content; return { mensagem: 'ok' } } } })
  assert.match(sistema, /FONTE ESGOTADA HOJE/); assert.doesNotMatch(sistema, /f_AL=true/)
})
test('resposta recorrente do titular vale como estimativa e impede marcar a pergunta como ausente', async t => {
  const { s, m, c, root } = fixture(t)
  fs.mkdirSync(path.join(root, 'LucasOL/Portfolio/privacidade'), { recursive: true })
  fs.writeFileSync(path.join(root, 'LucasOL/Portfolio/privacidade/dados-candidatura-canonicos.local.md'), '- Software: 3 anos\n')
  s.responder({ pergunta: 'Are you willing to take a drug test, in accordance with local law/regulations?', resposta: 'Yes' })
  const executar = criarFerramentas({ s, missaoId: m.id, repoRoot: root, progresso: { acoes: 0 }, salvar() {}, autorizar() {}, navegador: { executar() {} } })
  const e = await executar('consultar', { fonte: 'estimativa', termo: 'Are you willing to take a drug test, in accordance with local law/regulations?' })
  assert.equal(e.valor, 'Yes'); assert.match(e.fonte, /Resposta recorrente/)
  await assert.rejects(executar('registrar', { acao: 'atualizar', entrada: { id: c.id, estado: 'aguardando_dado', campos: [{ pergunta: 'Are you willing to take a drug test?', resposta: 'ausente', fonte: 'x' }], proximaAcao: 'Sem fonte' } }), /presets autorizados.*=Yes/)
  const preset = criarPreset('- Software: 3 anos', {}, require('../electron/lib-candidaturas.cjs').criarRespostasRecorrentes(s.privateDir))
  assert.equal(preset.respostasRecorrentes['Are you willing to take a drug test, in accordance with local law/regulations?'], 'Yes')
})
test('checkpoint com limite do LinkedIn como bloqueio global não para a missão', async t => {
  const { s, m, root } = fixture(t)
  const progresso = { acoes: 0 }
  const executar = criarFerramentas({ s, missaoId: m.id, repoRoot: root, progresso, salvar() {}, autorizar() {}, navegador: { executar() {} } })
  const r = await executar('checkpoint', { resumo: 'Fila vazia.', bloqueioGlobal: 'LinkedIn Easy Apply bloqueado pelo limite diário da conta profissional; não impede ATS externos.' })
  assert.equal(r.bloqueioIgnorado, true); assert.equal(progresso.bloqueio, undefined); assert.ok(progresso.fontesEsgotadas.linkedinEasyApply)
  const controle = await executar('checkpoint', { resumo: 'Nash confirmada.', bloqueioGlobal: 'A ferramenta navegador informa: “A bancada está com você ou indisponível. Aguarde a devolução do controle.”' })
  assert.equal(controle.bloqueioIgnorado, true); assert.equal(progresso.bloqueio, undefined)
  await executar('checkpoint', { resumo: 'x', bloqueioGlobal: 'Permissão de conexão negada pela bancada.' })
  assert.match(progresso.bloqueio, /Permissão/)
})
