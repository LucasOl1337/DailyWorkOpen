const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const numero = valor => { const m = String(valor ?? '').match(/\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(',', '.')) : null }

function anosExperiencia(pergunta, perfil, fallback = null) {
  const q = normalizar(pergunta)
  const exatas = [[/python/, 'python'], [/javascript/, 'javascript'], [/node/, 'node'], [/\baws\b/, 'aws'], [/llm|agente|artificial intelligence|inteligencia artificial/, 'agentes']]
  for (const [padrao, campo] of exatas) {
    if (!padrao.test(q)) continue
    const valor = numero(perfil[campo])
    if (valor !== null) return { valor, campo, exato: true }
  }
  const valor = numero(perfil.software) ?? numero(fallback)
  return valor === null ? null : { valor, campo: 'software', exato: false }
}
function unidadeDaPergunta(pergunta, padrao) {
  const q = normalizar(pergunta)
  const moeda = /\beur\b|\beuros?\b/.test(q) ? 'EUR' : /brl|reais|r\$/.test(q) ? 'BRL' : /usd|dolares?|dollars?|\$/.test(q) ? 'USD' : padrao.moeda
  const periodo = /hour|hora/.test(q) ? 'hora' : /annual|year|anual|por ano/.test(q) ? 'ano' : /month|mensal|por mes/.test(q) ? 'mes' : padrao.periodo
  return { moeda, periodo }
}
function salarioAutorizado(pergunta, criterios = {}) {
  const { moeda, periodo } = unidadeDaPergunta(pergunta, { moeda: criterios.moeda || 'BRL', periodo: criterios.periodo || 'mes' })
  // Faixas já autorizadas. Não inferir câmbio ou jornada para criar taxa por hora.
  const faixa = { BRL: [8000, 14000], USD: [2500, 4000] }[moeda]
  if (!faixa || !['mes', 'ano'].includes(periodo)) return null
  let piso = 0
  if ((!criterios.moeda || criterios.moeda === moeda) && Number(criterios.salarioMin) > 0) {
    const unidadePiso = criterios.periodo || 'mes'
    if (!['mes', 'ano'].includes(unidadePiso)) return null
    piso = Number(criterios.salarioMin) / (unidadePiso === 'ano' ? 12 : 1)
  }
  if (piso > faixa[1]) return null
  const mensal = Math.max(piso, (faixa[0] + faixa[1]) / 2)
  return { valor: periodo === 'ano' ? mensal * 12 : mensal, moeda, periodo }
}
function salarioDoPreset(pergunta, preset) {
  if (preset.remuneracao) {
    const resolvida = salarioAutorizado(pergunta, preset.remuneracao)
    return resolvida ? String(resolvida.valor) : null
  }
  // Compatibilidade com presets já construídos por integrações: só converte ano/mês.
  const r = preset.respostasRapidas || {}
  const ler = texto => {
    const m = String(texto || '').match(/^(\d+(?:\.\d+)?)\s+(BRL|USD|EUR)\/(mes|ano|hora)$/)
    return m ? { valor: Number(m[1]), moeda: m[2], periodo: m[3] } : null
  }
  const padrao = ler(r.pretensao)
  const unidade = unidadeDaPergunta(pergunta, padrao || { moeda: 'BRL', periodo: 'mes' })
  if (!['mes', 'ano'].includes(unidade.periodo)) return null
  const opcoes = [padrao, ler(r.pretensaoUsdMensal), ler(r.pretensaoUsdAnual)]
  const origem = opcoes.find(v => v && v.moeda === unidade.moeda && ['mes', 'ano'].includes(v.periodo))
  if (!origem) return null
  return String(origem.valor / (origem.periodo === 'ano' ? 12 : 1) * (unidade.periodo === 'ano' ? 12 : 1))
}
module.exports = { anosExperiencia, salarioAutorizado, salarioDoPreset }
