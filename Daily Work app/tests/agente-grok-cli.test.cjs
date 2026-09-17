const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-agente-grok-cli-test-'))
process.env.DAILYWORK_DATA_DIR = path.join(TMP, 'data')
process.env.DAILYWORK_SESSOES_DIR = path.join(TMP, 'sessoes')
process.env.DAILYWORK_ASSETS_DIR = path.join(TMP, 'assets')
process.env.LUCAS_KNOWLEDGE_DIR = path.join(TMP, 'LucasKnowledge')
fs.mkdirSync(process.env.LUCAS_KNOWLEDGE_DIR, { recursive: true })

const lib = require('../electron/lib-md.cjs')
const {
  PERFIS_GROK_CLI,
  ErroAgente,
  criarServicoAgente,
  resolverProvider,
} = require('../electron/lib-agente-9router.cjs')
const { respostaParaOpenAI, schemaDasFerramentas } = require('../electron/lib-grok-cli.cjs')

after(() => fs.rmSync(TMP, { recursive: true, force: true }))

function grokCliFila(respostas) {
  const chamadas = []
  return {
    chamadas,
    grokCli: {
      async completarChat(entrada) {
        chamadas.push(entrada)
        assert.ok(respostas.length > 0, 'chamada inesperada ao Grok CLI')
        const proxima = respostas.shift()
        if (typeof proxima === 'function') return proxima(entrada)
        if (proxima instanceof Error) throw proxima
        return proxima
      },
      async sondar() {
        return { ok: true, modelos: ['grok-4.6', 'grok-4.5'] }
      },
    },
  }
}

function respostaTexto(texto) {
  return { choices: [{ message: { role: 'assistant', content: texto } }] }
}

test('sem fetch injetado o DailyWork usa o Grok CLI', () => {
  assert.equal(resolverProvider({}), 'grok-cli')
  assert.equal(resolverProvider({ fetchImpl: globalThis.fetch }), 'grok-cli')
  assert.equal(resolverProvider({ fetchImpl: async () => ({}) }), '9router')
  assert.equal(resolverProvider({ provider: '9router' }), '9router')
})

test('catálogo do Grok CLI tem Grok 4.6 com fallback para Grok 4.5', () => {
  const porId = new Map(PERFIS_GROK_CLI.map((perfil) => [perfil.id, perfil]))
  assert.equal(porId.get('grok-4-6').rota, 'grok-4.6')
  assert.equal(porId.get('grok-4-6').fallbackId, 'grok-4-5')
  assert.equal(porId.get('grok-4-6-high').effort, 'high')
  assert.equal(porId.has('gpt-5-6-sol-high'), false)
})

test('configuração reporta o Grok CLI e os modelos sondados', async () => {
  const { grokCli } = grokCliFila([])
  const servico = criarServicoAgente({ lib, provider: 'grok-cli', grokCli })
  const config = await servico.configuracao()
  assert.equal(config.provider, 'grok-cli')
  assert.equal(config.conectado, true)
  assert.equal(config.perfilPadrao, 'grok-4-6')
  assert.equal(config.perfis.length, 4)
  assert.equal(config.perfis.find((perfil) => perfil.id === 'grok-4-6').catalogado, true)
  assert.equal(config.perfis.find((perfil) => perfil.id === 'grok-4-6').fallback, 'grok-4.5')
})

test('completar usa o Grok CLI e não o 9Router', async () => {
  const { chamadas, grokCli } = grokCliFila([respostaTexto('Síntese pelo CLI.')])
  let fetchChamado = false
  const servico = criarServicoAgente({
    lib,
    provider: 'grok-cli',
    grokCli,
    fetchImpl: async () => {
      fetchChamado = true
      throw new Error('não deveria chamar o 9Router')
    },
  })
  const resultado = await servico.completar({
    perfilId: 'grok-4-6',
    mensagens: [{ role: 'user', content: 'Resuma o dia.' }],
  })
  assert.equal(fetchChamado, false)
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].perfil.rota, 'grok-4.6')
  assert.equal(resultado.mensagem, 'Síntese pelo CLI.')
  assert.equal(resultado.perfil.rota, 'grok-4.6')
})

test('Grok 4.6 cai para Grok 4.5 quando o CLI falha', async () => {
  const falha = new Error('modelo indisponível')
  falha.codigo = 'FALHA_GROK_CLI'
  const { chamadas, grokCli } = grokCliFila([falha, respostaTexto('Continuei no 4.5.')])
  const servico = criarServicoAgente({ lib, provider: 'grok-cli', grokCli })
  const resultado = await servico.completar({
    perfilId: 'grok-4-6',
    mensagens: [{ role: 'user', content: 'Faça o trabalho.' }],
  })
  assert.equal(chamadas.length, 2)
  assert.equal(chamadas[0].perfil.rota, 'grok-4.6')
  assert.equal(chamadas[1].perfil.rota, 'grok-4.5')
  assert.equal(resultado.perfil.id, 'grok-4-5')
  assert.equal(resultado.fallback.de.id, 'grok-4-6')
  assert.equal(resultado.fallback.para.id, 'grok-4-5')
})

test('conversa envia schema das tools do DailyWork ao Grok CLI', async () => {
  const dia = '2026-09-05'
  lib.criarBloco({ id: 'b-cli-hoje', titulo: 'Frente local', corpo: 'Ação atual' }, dia)
  const { chamadas, grokCli } = grokCliFila([
    {
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'consultar_dia', arguments: '{}' },
          }],
        },
      }],
    },
    respostaTexto('Dia relido.'),
  ])
  const servico = criarServicoAgente({ lib, provider: 'grok-cli', grokCli })
  const resultado = await servico.conversar({
    dia,
    perfilId: 'grok-4-6',
    mensagens: [{ role: 'user', content: 'Consulte o dia.' }],
  })
  assert.ok(Array.isArray(chamadas[0].tools))
  assert.equal(chamadas[0].tools[0].function.name, 'consultar_dia')
  assert.equal(resultado.mensagem, 'Dia relido.')
})

test('schema das ferramentas lista somente as tools do DailyWork', () => {
  const schema = schemaDasFerramentas([
    { type: 'function', function: { name: 'consultar_dia' } },
    { type: 'function', function: { name: 'criar_bloco' } },
  ])
  assert.deepEqual(schema.properties.tool_calls.items.properties.name.enum, ['consultar_dia', 'criar_bloco'])
})

test('JSON estruturado do Grok CLI vira tool_calls no formato interno', () => {
  const resposta = respostaParaOpenAI(JSON.stringify({
    text: '{"message":"","tool_calls":[{"name":"mudar_status","arguments":{"id":"b-1","status":"feito"}}]}',
  }))
  assert.equal(resposta.choices[0].message.tool_calls[0].function.name, 'mudar_status')
})

test('perfil GPT some no modo Grok CLI', async () => {
  const servico = criarServicoAgente({
    lib,
    provider: 'grok-cli',
    grokCli: grokCliFila([]).grokCli,
  })
  await assert.rejects(
    servico.completar({
      perfilId: 'gpt-5-6-sol-high',
      mensagens: [{ role: 'user', content: 'Oi' }],
    }),
    (erro) => erro instanceof ErroAgente && erro.codigo === 'PERFIL_NAO_PERMITIDO'
  )
})

test('contrato do Grok preserva parâmetros obrigatórios e enums de cada ferramenta',async()=>{
 const {criarTransporteGrokCli}=require('../electron/lib-grok-cli.cjs')
 const fs=require('node:fs')
 const tools=[{type:'function',function:{name:'navegador',description:'Use abas para listar.',parameters:{type:'object',properties:{acao:{type:'string',enum:['abas','abrir']}},required:['acao'],additionalProperties:false}}}]
 const schema=schemaDasFerramentas(tools)
 assert.deepEqual(schema.properties.tool_calls.items.oneOf[0].properties.arguments,tools[0].function.parameters)
 const transporte=criarTransporteGrokCli({execFileImpl:async(_bin,args)=>{
  const prompt=fs.readFileSync(args[args.indexOf('--prompt-file')+1],'utf8')
  assert.ok(prompt.includes('=== FERRAMENTAS ==='));assert.ok(prompt.includes('Use abas para listar.'));assert.ok(prompt.includes('"enum":["abas","abrir"]'));assert.ok(prompt.includes('"required":["acao"]'))
  return {stdout:JSON.stringify({text:'{"message":"","tool_calls":[{"name":"navegador","arguments":{"acao":"abas"}}]}'})}
 }})
 const r=await transporte.completarChat({perfil:{rota:'grok-4.6'},messages:[{role:'user',content:'Liste abas.'}],tools,timeoutMs:10000})
 assert.equal(JSON.parse(r.choices[0].message.tool_calls[0].function.arguments).acao,'abas')
})

test('compactação do executor vale para a próxima chamada dentro do mesmo ciclo',async()=>{
 const {grokCli}=grokCliFila([
  {choices:[{message:{role:'assistant',content:'',tool_calls:[{id:'call-compact',type:'function',function:{name:'ler',arguments:'{}'}}]}}]},
  entrada=>{assert.equal(entrada.messages.length,3);assert.equal(entrada.messages[0].role,'system');assert.equal(entrada.messages[1].tool_calls[0].id,'call-compact');assert.equal(entrada.messages[2].tool_call_id,'call-compact');return respostaTexto('Pronto')},
 ])
 const s=criarServicoAgente({lib,provider:'grok-cli',grokCli})
 const r=await s.executarComFerramentas({perfilId:'grok-4-6',mensagens:[{role:'system',content:'Tarefa'},{role:'user',content:'Histórico anterior'}],ferramentas:[{type:'function',function:{name:'ler',parameters:{type:'object',properties:{}}}}],executarFerramenta:async()=>({texto:'Estado atual'}),onHistorico:h=>[h[0],...h.slice(-2)]})
 assert.equal(r.mensagem,'Pronto')
})
