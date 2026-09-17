// Presets de resposta para perguntas de formulário sem fonte. a pessoa clica no preset em vez
// de digitar; o valor vira resposta recorrente como qualquer outra. Nada aqui inventa dado
// pessoal: salário, anos e disponibilidade vêm do preset canônico já autorizado.
const normalizar = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const numero = v => { const m = String(v || '').match(/\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(',', '.')) : null }
function ingles(q) { return /\b(you|your|are|do|how|what|which|years?|rate|salary|willing|currently|reason)\b/.test(q) }
function sugerirRespostas(pergunta, preset = {}) {
  const q = normalizar(pergunta), en = ingles(q)
  const r = preset.respostasRapidas || {}, p = preset.perfil || {}
  const anos = [...new Set([numero(p.software), numero(p.python), numero(p.agentes), numero(p.aws), numero(r.anosStackSemValorExato)].filter(v => Number.isFinite(v) && v >= 0).map(String))]
  const usdMes = numero(r.pretensaoUsdMensal), usdAno = numero(r.pretensaoUsdAnual), brlMes = numero(r.pretensao)
  const hora = usdMes ? Math.round(usdMes / 160) : null
  const simNao = en ? ['Yes', 'No'] : ['Sim', 'Não']
  const lista = []
  const add = (...v) => { for (const x of v) if (x !== null && x !== undefined && x !== '' && !lista.includes(String(x))) lista.push(String(x)) }
  if (/pj|clt|contract type|tipo de contrat|regime/.test(q)) add('PJ', 'CLT', en ? 'Either' : 'Ambos')
  if (/hourly|per hour|por hora|\/h\b|hora/.test(q) && /rate|salar|pretens|valor|usd|gbp|eur|brl/.test(q)) { if (hora) add(`${hora} USD/h`, `${Math.round(hora * 1.25)} USD/h`); add(en ? 'Negotiable' : 'A combinar') }
  else if (/c2c|corp to corp|fte|w2|pay rate|rate expectation/.test(q)) { if (hora) add(`${hora} USD/h`, `${Math.round(hora * 1.25)} USD/h`); if (usdAno) add(`${usdAno} USD/year`); add('Negotiable') }
  else if (/salary|salario|pretens|compensation|remunera|expected pay|faixa/.test(q)) {
    if (/anual|annual|year|ano|yearly/.test(q)) { if (usdAno) add(`${usdAno} USD/year`); if (brlMes) add(`${brlMes * 12} BRL/ano`) }
    else if (/usd|dolar|dollar|\$/.test(q)) { if (usdMes) add(`${usdMes} USD/month`); if (usdAno) add(`${usdAno} USD/year`) }
    else { if (brlMes) add(`R$ ${brlMes}/mês`); if (usdMes) add(`${usdMes} USD/month`) }
    add(en ? 'Negotiable' : 'A combinar')
  }
  if (/quantos anos|how many years|years of|anos de|tempo.*trabalha|ha quanto tempo|experience with|experiencia com/.test(q)) add(...anos.slice(0, 4), en ? 'Less than 1' : 'Menos de 1')
  if (/nivel|level|proficien|fluen|confianca|confidence/.test(q) && /espanhol|spanish|ingles|english|idioma|language|comunicar/.test(q)) {
    if (/espanhol|spanish|\[es\]/.test(q)) add(en ? 'Basic' : 'Básico', en ? 'None' : 'Nenhum', en ? 'Intermediate' : 'Intermediário')
    else add(p.ingles || (en ? 'Conversational' : 'Intermediário'), en ? 'Advanced' : 'Avançado', en ? 'Basic' : 'Básico')
  }
  if (/1 basico|2 intermed|3 avanc|escala|scale of|1-5|1 a 5/.test(q)) add('1', '2', '3')
  if (/drug test|teste de droga|background check|antecedentes|willing to|disposto|disponivel para|exclusiv|monitoring|monitoramento|relocat|mudar|remote|remoto|travel|viajar|authori[sz]ed|autoriza/.test(q)) add(...simNao)
  if (/currently|atualmente|on project|em projeto|employed|empregado|working now/.test(q)) add(...simNao, en ? 'Between projects' : 'Entre projetos')
  if (/reason.*(change|leaving)|motivo.*(mudan|saida|troca)|why.*(leav|look)|por que.*(sair|procur)/.test(q)) add(en ? 'Looking for AI/agents projects with more technical ownership.' : 'Buscando projetos de IA e agentes com mais autonomia técnica.', en ? 'Current project is ending.' : 'Projeto atual está encerrando.')
  if (/notice|aviso previo|availability|disponibilidade|start date|inicio|when can you/.test(q)) add(en ? 'Immediately' : 'Imediata', en ? '15 days' : '15 dias', en ? '30 days' : '30 dias')
  if (/linkedin|github|portfolio|website|site/.test(q) && /url|link|perfil|profile/.test(q)) add(preset.identidade?.linkedin, preset.identidade?.github)
  if (!lista.length && /\?$/.test(String(pergunta).trim()) && /^(are|do|does|have|is|can|will|would|voce|tem|esta|possui|aceita)\b/.test(q)) add(...simNao)
  return lista.slice(0, 5)
}
module.exports = { sugerirRespostas }
