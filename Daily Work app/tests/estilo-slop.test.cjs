const { test } = require('node:test')
const assert = require('node:assert/strict')
const { detectar, resumo, orientacaoCompacta, hashCatalogo, PADROES } = require('../electron/lib-estilo-slop.cjs')
const { validarRevisao, validarPauta, defeitosMecanicos } = require('../electron/lib-editor-editorial.cjs')
const { pautaFixture, coberturaCompleta } = require('./helpers/editorial.cjs')

const ids = (sinais) => sinais.map((s) => s.padrao)

// Calibração: os dois exemplos aprovados pelo titular usam pergunta de abertura,
// fragmento final e rótulo em caixa alta. O catálogo não pode reprová-los.
const APROVADO_EN = 'If you had the opportunity to be a pioneer would you?\n\nI’m going all in on Omarchy and dumping Mac now.\n\nI’ve spoken to many intelligent people and the suspicion and doubt only gives me more conviction.\n\nThe OS for local AI. All in.'
const APROVADO_PT = 'DICA CONTRAINTUITIVA:\nto gastando muito menos tokens usando GPT6 Astra no Ultra do que em todos outros tipos de GPT Astra\n\nTo trabalhando a manha toda em coisas bem complexas com 3 chats abertos e gastei só 3% até agora depois de 2h'

test('exemplos aprovados passam pelo catálogo sem sinal duro nem reescrita', () => {
  for (const [texto, idioma] of [[APROVADO_EN, 'en'], [APROVADO_PT, 'pt-BR']]) {
    const r = resumo(detectar(texto, { idioma, conta: 'x' }))
    assert.equal(r.gravidade, 'ok', `${idioma}: ${JSON.stringify(r)}`)
  }
})

test('travessão de aparte reprova sozinho e cita a frase', () => {
  const texto = 'Uma pauta pode gerar versões diferentes — mas a aprovação não deveria acompanhar a pauta inteira.'
  const sinais = detectar(texto, { idioma: 'pt-BR', conta: 'linkedin' })
  assert.deepEqual(ids(sinais), ['travessao-aparte'])
  assert.equal(sinais[0].nivel, 'duro')
  assert.match(sinais[0].trecho, /aprovação não deveria/)
  assert.equal(resumo(sinais).gravidade, 'reprovar')
})

test('hífen de lista e hífen de palavra composta não contam como travessão', () => {
  assert.equal(detectar('Ferramentas:\n- Codex\n- Claude Code\n\nBem-vindo ao multi-tenant.', { idioma: 'pt-BR' }).some((s) => s.padrao === 'travessao-aparte'), false)
  assert.equal(detectar('Texto com aparte - assim no meio - da frase.', { idioma: 'pt-BR' }).some((s) => s.padrao === 'travessao-aparte'), true)
})

test('contraste binário, puffery, atribuição vaga e recap final são duros em PT e EN', () => {
  const pt = detectar('Não é sobre velocidade. É sobre controle.\n\nEspecialistas dizem que isso é um divisor de águas.\n\nEm resumo, mudou tudo.', { idioma: 'pt-BR', conta: 'x' })
  for (const id of ['contraste-binario', 'atribuicao-vaga', 'inflacao-importancia', 'recap-final']) assert.ok(ids(pt).includes(id), `pt faltou ${id}: ${ids(pt)}`)
  const en = detectar('It’s not about speed. It’s about control.\n\nExperts agree this is a game changer, highlighting the team’s commitment.\n\nUltimately, we leverage it all.', { idioma: 'en', conta: 'x' })
  for (const id of ['contraste-binario', 'atribuicao-vaga', 'inflacao-importancia', 'analise-superficial', 'recap-final', 'palavra-banida']) assert.ok(ids(en).includes(id), `en faltou ${id}: ${ids(en)}`)
  assert.ok(pt.every((s) => s.nivel === 'duro') && en.every((s) => s.nivel === 'duro'))
})

test('sinais suaves só pedem reescrita a partir de dois', () => {
  const um = detectar('Vou ser sincero: o Sonora resolve isso.', { idioma: 'pt-BR' })
  assert.deepEqual(ids(um), ['abertura-pigarro'])
  assert.equal(resumo(um).gravidade, 'ok')
  const dois = detectar('Vou ser sincero: o Sonora resolve isso.\n\nVale ressaltar que é local.', { idioma: 'pt-BR' })
  assert.equal(resumo(dois).gravidade, 'reescrever')
})

test('formato markdown libera marcadores e listas do currículo, mas não a puffery', () => {
  const curriculo = '## Experiência\n\n- **NexUnio**: agentes para WhatsApp.\n- Impulsionei a sinergia do time.'
  const sinais = detectar(curriculo, { idioma: 'pt-BR', formato: 'markdown' })
  assert.equal(sinais.some((s) => s.padrao === 'markdown' || s.padrao === 'travessao-aparte'), false)
  assert.ok(ids(sinais).includes('palavra-banida'))
})

test('orientação compacta nomeia os padrões por idioma e cabe no prompt', () => {
  const pt = orientacaoCompacta('pt-BR')
  const en = orientacaoCompacta('en')
  for (const p of PADROES) assert.ok(pt.includes(`- ${p.id} [`) || en.includes(`- ${p.id} [`), p.id)
  assert.ok(pt.length < 4000 && en.length < 4000)
  assert.match(pt, /Preserve a voz/)
  assert.equal(hashCatalogo().length, 64)
})

test('editor: sinal duro do catálogo reprova mesmo com o modelo aprovando; problemas estruturados viram texto e sinais', () => {
  const fonte = 'A fila preserva as fontes e revoga a aprovação quando o texto muda.'
  const pauta = validarPauta(pautaFixture(fonte), fonte)
  const texto = 'A fila preserva as fontes — e revoga a aprovação quando o texto muda.'
  const modelo = { aprovado: true, notas: { evidencia: 5, especificidade: 4, utilidade: 4, voz: 4, adequacao: 4 }, cobertura: coberturaCompleta(texto), afirmacoes: [{ trecho: texto, sustentada: true, evidencias: ['e1'], motivo: 'ok' }], problemas: [], parecer: 'ok' }
  const r = validarRevisao(modelo, { campos: { texto }, pauta, conta: 'x', idioma: 'pt-BR' })
  assert.equal(r.aprovado, false)
  assert.match(r.problemas.join(' '), /travessao-aparte/)
  assert.equal(r.sinais.find((s) => s.origem === 'catalogo').padrao, 'travessao-aparte')
  const limpo = 'A fila preserva as fontes e revoga a aprovação quando o texto muda.'
  const estruturado = { ...modelo, aprovado: false, cobertura: coberturaCompleta(limpo), afirmacoes: [{ trecho: limpo, sustentada: true, evidencias: ['e1'], motivo: 'ok' }], problemas: [{ padrao: 'jargao-interno', trecho: 'revoga a aprovação', correcao: 'Diga que a peça volta para revisão.' }] }
  const r2 = validarRevisao(estruturado, { campos: { texto: limpo }, pauta, conta: 'x', idioma: 'pt-BR' })
  assert.equal(r2.aprovado, false)
  assert.equal(r2.problemas[0], 'jargao-interno: “revoga a aprovação”. Diga que a peça volta para revisão.')
  assert.deepEqual(r2.sinais.map((s) => s.origem), ['editor'])
  assert.match(defeitosMecanicos({ texto: 'Use **negrito** aqui.' }, pauta, 'x', 'pt-BR').join(' '), /Markdown/)
})
