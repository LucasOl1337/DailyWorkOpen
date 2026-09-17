// Lógica editável da geração de posts: roteiro, voz e imagem.
// O código fixa evidência, JSON e contratos; esta página dirige a história.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const VERSAO = 1
const LIMITE_TEXTO = 4_000
const LIMITE_NOTAS = 8_000
const BEATS_IDS = Object.freeze(['tema', 'problema', 'resolucao', 'conclusao'])

function sha256(valor) {
  return crypto.createHash('sha256').update(String(valor)).digest('hex')
}

function texto(valor, limite = LIMITE_TEXTO) {
  return String(valor || '').replace(/\r\n/g, '\n').trim().slice(0, limite)
}

function falha(codigo, mensagem) {
  return Object.assign(new Error(mensagem), { codigo })
}

const PADRAO_BEATS = Object.freeze([
  {
    id: 'tema',
    rotulo: 'Tema',
    papel: 'abertura',
    proposito: 'anunciar o assunto de imediato, para o leitor saber de que se trata',
    instrucao: 'Abra dizendo o que é, em uma ou duas frases, como alguém que começa a contar uma história. Sem título, sem caixa alta e sem “hoje vou falar sobre”. O tema precisa caber numa fala natural.',
  },
  {
    id: 'problema',
    rotulo: 'Problema',
    papel: 'meio',
    proposito: 'mostrar o atrito, a falta ou a confusão que deu origem ao assunto',
    instrucao: 'Em seguida mostre o problema concreto: o que faltava, o que doía, o que ficava lento ou confuso. Não invente um vilão e não dramatize. Use só o que a evidência sustenta.',
  },
  {
    id: 'resolucao',
    rotulo: 'Resolução',
    papel: 'meio',
    proposito: 'contar o que foi feito, por quem, e como isso entra numa situação real de uso',
    instrucao: 'Conte a resolução: o que você fez ou o que o projeto passou a fazer. Quem agiu, como se usa, o que mudou na prática. Em projeto próprio, deixe claro o papel do titular. Mostre a coisa em uso, não uma lista de recursos.',
  },
  {
    id: 'conclusao',
    rotulo: 'Conclusão',
    papel: 'fim',
    proposito: 'fechar a ideia com o valor para quem lê, sem reciclar a abertura',
    instrucao: 'Feche a ideia. Diga o que isso muda para quem lê: uma vantagem, uma possibilidade ou um próximo passo. Não recicle a abertura, não termine com moral, lição, pergunta automática nem hashtag.',
  },
])

const PADRAO = Object.freeze({
  versao: VERSAO,
  roteiro: PADRAO_BEATS,
  voz: {
    tom: 'Fale como uma pessoa contando uma coisa concreta para outra pessoa, não como um relatório nem como um anúncio.',
    naturalidade: 'Começo, meio e fim existem, mas não viram subtítulos nem frases-fórmula. Varie o tamanho dos parágrafos. Cada um precisa acrescentar informação. Texto simples, sem Markdown.',
    evitar: 'Inventário de funcionalidades, abertura genérica, repetir a tese três vezes, moral no fechamento, pergunta ao leitor por hábito, hashtags, travessão de aparte, linguagem de relatório.',
  },
  imagem: {
    funcao: 'A imagem ilustra o mesmo arco do texto. De preferência mostra a resolução concreta: a tela, o objeto ou a situação de uso. O leitor precisa reconhecer o assunto só de olhar.',
    cena: 'Se a história é de um produto, mostre o produto em operação. Se for uma ideia sem tela, invente uma cena específica daquele tema, não uma metáfora de “tecnologia”. A direção visual segue o tema anunciado e a resolução, nunca um conceito abstrato paralelo.',
    evitar: 'Salas 3D escuras, cubos luminosos, hologramas, circuitos, robôs geométricos, colagens genéricas, texto torto gerado por modelo, marcas de terceiros, métricas inventadas.',
  },
  notas: '',
})

function padrao() {
  return JSON.parse(JSON.stringify(PADRAO))
}

function rotulos(logica = padrao()) {
  return Object.fromEntries((logica.roteiro || PADRAO_BEATS).map((beat) => [beat.id, beat.proposito]))
}

function ids(logica = padrao()) {
  const lista = (logica.roteiro || []).map((beat) => beat.id)
  return lista.length === BEATS_IDS.length && BEATS_IDS.every((id, i) => lista[i] === id) ? lista : [...BEATS_IDS]
}

function validarBeat(entrada, indice) {
  const esperado = PADRAO_BEATS[indice]
  if (!entrada || typeof entrada !== 'object' || entrada.id !== esperado.id) {
    throw falha('LOGICA_INVALIDA', `O passo ${indice + 1} do roteiro precisa ser “${esperado.id}”.`)
  }
  const rotulo = texto(entrada.rotulo, 40)
  const proposito = texto(entrada.proposito, 240)
  const instrucao = texto(entrada.instrucao)
  if (!rotulo || !proposito || instrucao.length < 40) {
    throw falha('LOGICA_INVALIDA', `Preencha rótulo, propósito e uma instrução clara para “${esperado.rotulo}”.`)
  }
  return { id: esperado.id, rotulo, papel: esperado.papel, proposito, instrucao }
}

function validar(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) throw falha('LOGICA_INVALIDA', 'A lógica precisa ser um objeto.')
  if (!Array.isArray(entrada.roteiro) || entrada.roteiro.length !== BEATS_IDS.length) {
    throw falha('LOGICA_INVALIDA', 'O roteiro tem quatro passos fixos: tema, problema, resolução e conclusão.')
  }
  const roteiro = entrada.roteiro.map(validarBeat)
  const voz = entrada.voz && typeof entrada.voz === 'object' ? entrada.voz : {}
  const imagem = entrada.imagem && typeof entrada.imagem === 'object' ? entrada.imagem : {}
  const tom = texto(voz.tom)
  const naturalidade = texto(voz.naturalidade)
  const evitarVoz = texto(voz.evitar)
  const funcao = texto(imagem.funcao)
  const cena = texto(imagem.cena)
  const evitarImagem = texto(imagem.evitar)
  if (tom.length < 20 || naturalidade.length < 20 || evitarVoz.length < 20) {
    throw falha('LOGICA_INVALIDA', 'A voz precisa de tom, naturalidade e o que evitar.')
  }
  if (funcao.length < 20 || cena.length < 20 || evitarImagem.length < 20) {
    throw falha('LOGICA_INVALIDA', 'A imagem precisa de função, cena e o que evitar.')
  }
  return {
    versao: VERSAO,
    roteiro,
    voz: { tom, naturalidade, evitar: evitarVoz },
    imagem: { funcao, cena, evitar: evitarImagem },
    notas: texto(entrada.notas, LIMITE_NOTAS),
  }
}

function mesclar(salvo) {
  const base = padrao()
  if (!salvo || typeof salvo !== 'object') return base
  try {
    return validar({
      roteiro: (Array.isArray(salvo.roteiro) ? salvo.roteiro : base.roteiro).map((beat, indice) => ({ ...base.roteiro[indice], ...(beat && typeof beat === 'object' ? beat : {}) })),
      voz: { ...base.voz, ...(salvo.voz && typeof salvo.voz === 'object' ? salvo.voz : {}) },
      imagem: { ...base.imagem, ...(salvo.imagem && typeof salvo.imagem === 'object' ? salvo.imagem : {}) },
      notas: salvo.notas,
    })
  } catch {
    return base
  }
}

function numerar(logica) {
  return (logica.roteiro || []).map((beat, indice) => `${indice + 1}. ${beat.rotulo} — ${beat.instrucao}`).join('\n')
}

function notasExtras(logica) {
  const notas = texto(logica?.notas, LIMITE_NOTAS)
  return notas ? `\nNotas extras do editor humano:\n${notas}\n` : ''
}

function compilarPauta(logica = padrao()) {
  const vigente = mesclar(logica)
  const campos = vigente.roteiro.map((beat) => `"${beat.id}":"${beat.proposito}"`).join(',')
  return `A pauta precisa sustentar uma história completa, mesmo quando o texto final for curto. Siga este roteiro, sem rotular os parágrafos com esses nomes e sem forçar drama:
${numerar(vigente)}
No JSON, preencha ${campos}. Não use novidade inventada nem transforme intenção, pedido, estudo gerado ou status "feito" isolado em entrega.${notasExtras(vigente)}`
}

function compilarRedacao(logica = padrao()) {
  const vigente = mesclar(logica)
  return `ROTEIRO DO POST (começo, meio e fim, falado de forma natural; sem subtítulos nem nomes dos passos no texto):
${numerar(vigente)}

VOZ: ${vigente.voz.tom}
${vigente.voz.naturalidade}
Evite: ${vigente.voz.evitar}
Transforme a pauta nessa progressão, não num inventário de funcionalidades. Os papéis cabem em poucos parágrafos. A pauta é orientação, não texto para parafrasear.${notasExtras(vigente)}`
}

function compilarRevisao(logica = padrao()) {
  const vigente = mesclar(logica)
  const cobertura = vigente.roteiro.map((beat) => `- ${beat.id}: ${beat.proposito}`).join('\n')
  return `Avalie a progressão da história segundo o roteiro vigente. Cada papel precisa aparecer no texto, sem exigir subtítulos:
${cobertura}
Voz esperada: ${vigente.voz.tom} ${vigente.voz.naturalidade}
Reprove texto que só lista funções, faz propaganda abstrata ou recicla a abertura na conclusão. Não exija comparação, incidente, lição, pergunta, hashtags ou CTA; o desfecho pode assumir qualquer forma que conclua a ideia.${notasExtras(vigente)}`
}

function esquemaCobertura(logica = padrao()) {
  const vigente = mesclar(logica)
  return vigente.roteiro.map((beat) => `"${beat.id}":{"atendido":true|false,"trecho":"citação literal da peça ou vazio"}`).join(',')
}

function compilarImagem(logica = padrao()) {
  const vigente = mesclar(logica)
  return `Direção visual ligada ao roteiro do post:
- Função: ${vigente.imagem.funcao}
- Cena: ${vigente.imagem.cena}
- Evite: ${vigente.imagem.evitar}
A imagem precisa combinar com o tema anunciado e, de preferência, mostrar a resolução. Uma ilustração genérica de IA não substitui a prova visual do assunto.${notasExtras(vigente)}`
}

function resumoProducao(logica = padrao()) {
  const vigente = mesclar(logica)
  const passos = vigente.roteiro.map((beat) => beat.rotulo.toLocaleLowerCase('pt-BR')).join(', ')
  return `Conte uma coisa concreta com começo, meio e fim, falando de forma natural. Siga o roteiro ${passos}. Não transforme isso num molde repetitivo nem plano ou pedido em entrega.`
}

function snapshot(logica, extra = {}) {
  const vigente = mesclar(logica)
  return {
    versao: vigente.versao,
    hash: sha256(JSON.stringify({
      roteiro: vigente.roteiro,
      voz: vigente.voz,
      imagem: vigente.imagem,
      notas: vigente.notas,
    })),
    roteiro: vigente.roteiro.map((beat) => beat.id),
    ...extra,
  }
}

function preview(logica = padrao()) {
  const vigente = mesclar(logica)
  return {
    logica: vigente,
    pauta: compilarPauta(vigente),
    redacao: compilarRedacao(vigente),
    revisao: compilarRevisao(vigente),
    imagem: compilarImagem(vigente),
    resumo: resumoProducao(vigente),
    cobertura: esquemaCobertura(vigente),
  }
}

function gravarJson(arquivo, valor) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true })
  const temporario = `${arquivo}.${process.pid}.tmp`
  fs.writeFileSync(temporario, `${JSON.stringify(valor, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporario, arquivo)
}

function criarLogicaEditorial({ dataDir } = {}) {
  const arquivo = dataDir ? path.join(path.resolve(dataDir), 'editorial', 'logica.json') : null

  function ler() {
    if (!arquivo || !fs.existsSync(arquivo)) return padrao()
    try {
      return mesclar(JSON.parse(fs.readFileSync(arquivo, 'utf8')))
    } catch {
      return padrao()
    }
  }

  function envelopar(valor, origem) {
    const vigente = mesclar(valor)
    return {
      ...vigente,
      origem,
      padrao: origem === 'padrao',
      atualizadoEm: origem === 'arquivo' && arquivo && fs.existsSync(arquivo) ? fs.statSync(arquivo).mtime.toISOString() : null,
      snapshot: snapshot(vigente),
      preview: preview(vigente),
    }
  }

  function obter() {
    return envelopar(ler(), arquivo && fs.existsSync(arquivo) ? 'arquivo' : 'padrao')
  }

  function salvar(entrada) {
    if (!arquivo) throw falha('LOGICA_SEM_ARQUIVO', 'Não há pasta de dados para gravar a lógica.')
    const vigente = validar(entrada)
    gravarJson(arquivo, { ...vigente, atualizadoEm: new Date().toISOString() })
    return envelopar(vigente, 'arquivo')
  }

  function restaurar() {
    if (arquivo && fs.existsSync(arquivo)) fs.unlinkSync(arquivo)
    return envelopar(padrao(), 'padrao')
  }

  return { obter, salvar, restaurar, arquivo }
}

module.exports = {
  BEATS_IDS,
  PADRAO,
  VERSAO,
  padrao,
  rotulos,
  ids,
  validar,
  mesclar,
  snapshot,
  preview,
  compilarPauta,
  compilarRedacao,
  compilarRevisao,
  compilarImagem,
  resumoProducao,
  esquemaCobertura,
  criarLogicaEditorial,
}
