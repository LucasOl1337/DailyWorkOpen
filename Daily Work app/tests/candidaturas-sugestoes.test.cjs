const test = require('node:test')
const assert = require('node:assert/strict')
const { sugerirRespostas } = require('../electron/candidaturas/sugestoes.cjs')
const preset = { perfil: { software: '3 anos', python: '3', agentes: '2', aws: '0', ingles: 'Conversational' }, respostasRapidas: { pretensao: '11000 BRL/mes', pretensaoUsdMensal: '3250 USD/mes', pretensaoUsdAnual: '39000 USD/ano', anosStackSemValorExato: 3 }, identidade: { linkedin: 'https://linkedin.com/in/x', github: 'https://github.com/x' } }
test('presets seguem o tipo da pergunta e o idioma, sem inventar dado pessoal', () => {
  assert.deepEqual(sugerirRespostas('Are you willing to take a drug test?', preset), ['Yes', 'No'])
  assert.deepEqual(sugerirRespostas('Você aceita teste de drogas?', preset), ['Sim', 'Não'])
  assert.deepEqual(sugerirRespostas('Pay rate on C2C', preset), ['20 USD/h', '25 USD/h', '39000 USD/year', 'Negotiable'])
  assert.deepEqual(sugerirRespostas('Há quanto tempo você trabalha com .NET?', preset), ['3', '2', '0', 'Menos de 1'])
  assert.deepEqual(sugerirRespostas('Do you prefer to work as PJ or CLT?', preset), ['PJ', 'CLT', 'Either'])
  assert.ok(sugerirRespostas('[ES] Qual é o seu nível de confiança ao se comunicar em espanhol?', preset).includes('Básico'))
  assert.deepEqual(sugerirRespostas('SOLID/sistemas distribuídos fundamentados', preset), [])
  assert.deepEqual(sugerirRespostas('CPF', preset), [])
  assert.deepEqual(sugerirRespostas('Link do seu perfil no LinkedIn', preset), ['https://linkedin.com/in/x', 'https://github.com/x'])
})
test('sem preset canônico as sugestões numéricas somem mas o sim/não continua', () => {
  assert.deepEqual(sugerirRespostas('What is your hourly rate in USD?', {}), ['Negotiable'])
  assert.deepEqual(sugerirRespostas('Are you authorized to work in Brazil?', {}), ['Yes', 'No'])
})
