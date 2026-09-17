// Catálogo determinístico de padrões de AI slop em PT-BR e EN, adaptado da
// skill no-ai-slop (Peter Yang, MIT; cópia versionada em skills/no-ai-slop).
// Cita o trecho, nomeia o padrão e sugere a correção. Não julga autoria.
//
// Dois níveis. "duro" reprova sozinho: marcador Markdown, travessão de
// aparte, contraste binário, puffery, atribuição vaga, recap final. "suave"
// só orienta o modelo e a reescrita: os exemplos aprovados pelo titular usam
// pergunta de abertura, fragmento curto e rótulo em caixa alta de propósito,
// então esses sinais não podem reprovar por conta própria.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const VERSAO_CATALOGO = '2026-09-12.1'
const sha256 = (valor) => crypto.createHash('sha256').update(String(valor)).digest('hex')

const PT = 'pt-BR'
const EN = 'en'

const PADROES = [
  {
    id: 'markdown', nivel: 'duro',
    descricao: 'Marcador Markdown (__, **, crase) em texto de rede social ou mensagem.',
    correcao: 'Texto simples; a ênfase vem da escolha da frase.',
    regex: [[/__|\*\*|`/g]],
  },
  {
    id: 'travessao-aparte', nivel: 'duro',
    descricao: 'Travessão (—) ou hífen espaçado usado como aparte ou muleta de ritmo.',
    correcao: 'Vírgula, ponto ou duas frases.',
    regex: [[/—|–|(?<=\S)[ \t]+-[ \t]+(?=\S)|(?<=\S)[ \t]+--[ \t]+(?=\S)/g]],
  },
  {
    id: 'contraste-binario', nivel: 'duro',
    descricao: 'Contraste "Não é X. É Y." / "It\'s not X, it\'s Y." / "A questão não é X, é Y."',
    correcao: 'Diga Y diretamente.',
    regex: [
      // \b do JS é ASCII: depois de "É" ou "são" use lookahead unicode.
      [/(?:^|[.!?\n]\s*)(?:isso |isto |ele |ela |o \S+ |a \S+ )?não (?:é|se trata de|era) (?:só |apenas |sobre |uma questão de )?[^.!?\n]{2,90}[.;,:]\s*(?:é|são|era|se trata de|e sim|mas sim)(?!\p{L})/giu, PT],
      [/(?:a questão|o problema|o ponto|o segredo|o lance|a diferença|o difícil|o importante) não (?:é|está|era) [^.!?\n]{2,90}[.;,:]\s*(?:é|está|são|e sim|mas sim)(?!\p{L})/giu, PT],
      [/\bnão é (?:só |apenas )[^.!?\n]{2,80}[,;]?\s*(?:é|mas|e sim) [^.!?\n]{2,80}/gi, PT],
      [/(?:it|this|that|which)(?:'s| is| was|'?s not) not (?:just |only |about |merely )?[^.!?\n]{2,90}[.;,:]\s*(?:it'?s|it is|but|this is|that'?s)\b/gi, EN],
      [/the (?:question|problem|point|issue|secret|hard part|difference) (?:isn'?t|is not|wasn'?t) [^.!?\n]{2,90}[.;,:]\s*(?:it'?s|it is|but)\b/gi, EN],
      [/\bnot (?:just|only|merely) [^.!?\n]{2,80}[,;]?\s*but (?:also )?[^.!?\n]{2,80}/gi, EN],
    ],
  },
  {
    id: 'listagem-negativa', nivel: 'duro',
    descricao: 'Lista de negações antes da afirmação: "Não é X. Não é Y. É Z."',
    correcao: 'Afirme Z e corte as negações.',
    regex: [
      [/não (?:é|são) [^.!?\n]{1,50}\.\s*não (?:é|são) [^.!?\n]{1,50}\./gi, PT],
      [/\bnot (?:a |an |the )?[^.!?\n]{1,50}\.\s*not (?:a |an |the )?[^.!?\n]{1,50}\./gi, EN],
    ],
  },
  {
    id: 'falsa-revelacao', nivel: 'duro',
    descricao: 'Setup de falsa exclusividade: "o que ninguém te conta", "a parte que todo mundo erra".',
    correcao: 'Corte o setup e faça a afirmação sozinha.',
    regex: [
      [/o que (?:ninguém|quase ninguém|poucos|pouca gente|a maioria|todo mundo) (?:te |lhe )?(?:conta|fala|diz|explica|percebe|entende|erra|ignora)/gi, PT],
      [/a parte que (?:todo mundo|a maioria|quase todo mundo|ninguém) (?:ignora|esquece|pula|erra|não vê)/gi, PT],
      [/(?:pouca gente|ninguém|quase ninguém) (?:fala|comenta|percebe) (?:disso|isso|sobre isso)/gi, PT],
      [/what (?:nobody|no one|most people|everyone) (?:tells you|gets? wrong|misses?|won'?t tell you|doesn'?t tell you)/gi, EN],
      [/the part (?:everyone|most people|nobody) (?:misses|skips|gets wrong|ignores)/gi, EN],
      [/here'?s what nobody/gi, EN],
    ],
  },
  {
    id: 'setup-retorico', nivel: 'duro',
    descricao: 'Setup retórico artificial: "E se eu te dissesse", "Plot twist:", "Spoiler:", "What if I told you".',
    correcao: 'Vá direto ao fato.',
    regex: [
      [/e se eu (?:te |lhe )?(?:dissesse|contasse|falasse)|plot twist|spoiler:|pense nisso:|pensa nisso:/gi, PT],
      [/what if i told you|think about it:|plot twist|spoiler:/gi, EN],
    ],
  },
  {
    id: 'analise-superficial', nivel: 'duro',
    descricao: 'Gerúndio de encerramento que finge explicar: ", destacando o compromisso", ", highlighting".',
    correcao: 'Diga a consequência concreta ou corte.',
    regex: [
      [/,\s*(?:destacando|reforçando|evidenciando|ressaltando|sublinhando|refletindo|consolidando|demonstrando|mostrando) (?:o |a |seu |sua |nosso |nossa |um |uma )?(?:compromisso|importância|potencial|força|relevância|dedicação|capacidade|maturidade|excelência|visão)/gi, PT],
      [/,\s*(?:highlighting|underscoring|showcasing|reflecting|demonstrating|solidifying|reinforcing) (?:the |its |our |their |a )?(?:team'?s |company'?s )?(?:commitment|importance|potential|dedication|strength|maturity|excellence|vision)/gi, EN],
    ],
  },
  {
    id: 'inflacao-importancia', nivel: 'duro',
    descricao: 'Puffery de importância: "divisor de águas", "marco", "muda tudo", "game changer", "pivotal moment", "testament to".',
    correcao: 'Diga o fato e deixe o leitor julgar se importa.',
    regex: [
      [/divisor de águas|marco (?:histórico|importante|decisivo)|momento (?:decisivo|crucial|histórico)|papel (?:fundamental|vital|crucial|central)|(?:um |uma )?(?:verdadeiro )?testemunho d[aeo]|consolida (?:sua|a|o) (?:posição|lugar)|game[- ]?changer|muda tudo|isso é (?:enorme|gigante)|sem precedentes|revolucion(?:a|ou|ar|ário|ária)|transformador[a]?\b|disruptiv[oa]|de ponta\b|next[- ]level|(?:elevar?|eleva|subir) (?:o|seu|a|de) (?:jogo|nível|patamar)/gi, PT],
      [/stands? as a testament|testament to|marks? a pivotal moment|pivotal moment|plays? a (?:vital|crucial|pivotal) role|solidif(?:y|ies) (?:its|their|our) position|underscores? (?:its|the) significance|game[- ]?changer|this is huge|this changes everything|paradigm shift|cutting[- ]edge|unprecedented|revolutioniz|transformative|next[- ]level/gi, EN],
    ],
  },
  {
    id: 'palavra-banida', nivel: 'duro',
    descricao: 'Vocabulário genérico de IA: potencializar, alavancar, impulsionar, robusto, sinergia, empoderar; delve, leverage, foster, streamline, harness, tapestry.',
    correcao: 'Troque pelo verbo ou substantivo concreto do caso.',
    regex: [
      [/\b(?:potencializ\w*|alavanc\w*|impulsion\w*|robust[oa]s?|sinergi\w*|empoder\w*|meticulos\w*|multifacetad\w*|mergulh(?:ar|e|emos) (?:n[oa]s?|em)|aprimor\w* (?:a |o )?(?:experiência|jornada)|jornada d[oa] (?:usuário|cliente)|no mundo (?:de hoje|atual)|na era d[aeo]|em um mundo (?:onde|em que|cada vez))\b/gi, PT],
      [/\b(?:delve|delves|delving|foster|fosters|fostering|leverage|leverages|leveraging|utilize|utilizes|utilizing|facilitate|facilitates|empower|empowers|empowering|streamline|streamlines|streamlining|robust|cutting-edge|tapestry|realm|beacon|multifaceted|meticulous|meticulously|intricate|paramount|elevate|elevates|embark|embarks|supercharge|supercharges|harness|harnesses|harnessing|ever-evolving|in today'?s world|in the age of|in the world of|let'?s dive in)\b/gi, EN],
    ],
  },
  {
    id: 'atribuicao-vaga', nivel: 'duro',
    descricao: 'Fonte sem nome: "especialistas dizem", "estudos mostram", "experts agree", "widely regarded".',
    correcao: 'Nomeie a fonte ou corte a afirmação.',
    regex: [
      [/(?:especialistas|estudos|pesquisas|relatórios|muitos|a maioria|o mercado) (?:dizem|mostram|apontam|concordam|afirmam|indicam|sugerem|diz|mostra|aponta|concorda|afirma|indica|sugere)|amplamente (?:reconhecid|considerad)|todo mundo sabe|é consenso/gi, PT],
      [/(?:experts|studies|reports|researchers|many|most people|the industry) (?:agree|show|suggest|argue|say|indicate)|widely (?:regarded|considered|seen)|industry reports|it'?s well known/gi, EN],
    ],
  },
  {
    id: 'recap-final', nivel: 'duro',
    descricao: 'Parágrafo final que recapitula: "Em resumo", "No fim das contas", "In conclusion", "Ultimately".',
    correcao: 'Termine no último ponto concreto.',
    ultimoParagrafo: [
      [/^(?:em resumo|resumindo|em conclusão|concluindo|no fim das contas|no final das contas|em suma|no geral|de modo geral|moral da história|lição:|em síntese)\b/i, PT],
      [/^(?:in conclusion|ultimately|overall|to sum up|in summary|all in all|at the end of the day|the takeaway|key takeaway|tl;?dr)\b/i, EN],
    ],
  },
  {
    id: 'kicker-profundo', nivel: 'duro',
    descricao: 'Frase final "profunda" pronta: "O futuro já chegou", "The future isn\'t coming. It\'s already here.", "O resto é detalhe".',
    correcao: 'Delete a frase; encerre na última informação concreta.',
    ultimoParagrafo: [
      [/o futuro (?:não vem|já chegou|é agora|não espera)|o resto é detalhe|e é isso que importa|no fim,? (?:é|tudo se resume)|tudo se resume a/i, PT],
      [/the future (?:isn'?t coming|is already here|is now|won'?t wait)|the rest is (?:noise|details?|history)|that'?s what matters|it all comes down to|and that changes everything/i, EN],
    ],
  },
  {
    id: 'hashtags-automaticas', nivel: 'duro',
    descricao: 'Bloco de hashtags no fim do texto.',
    correcao: 'Remova; hashtags só quando tiverem função real no canal.',
    regex: [[/(?:^|\s)#[\p{L}\d_]+(?:\s+#[\p{L}\d_]+){1,}\s*$/u]],
  },
  {
    id: 'frase-vazia', nivel: 'suave',
    descricao: 'Frase que adia o ponto: "vale ressaltar", "é importante destacar", "it\'s worth noting", "in order to".',
    correcao: 'Corte quando só atrasa; mantenha se for fala natural do autor.',
    regex: [
      [/vale (?:ressaltar|destacar|mencionar|lembrar) que|é importante (?:destacar|ressaltar|notar|lembrar|mencionar)|é (?:válido|interessante) (?:notar|destacar)|com isso em mente|nesse sentido,|dito isso,|em outras palavras/gi, PT],
      [/it'?s worth noting|it'?s important to note|it'?s worth mentioning|with that in mind|that being said|in other words|in order to|when it comes to|at its core|the reality is|the truth is/gi, EN],
    ],
  },
  {
    id: 'abertura-pigarro', nivel: 'suave',
    descricao: 'Pigarro antes do ponto: "vou ser sincero", "a verdade é que", "here\'s the thing", "let me be clear".',
    correcao: 'Corte e comece pelo ponto, a não ser que seja a fala do autor de verdade.',
    regex: [
      [/(?:^|\n)\s*(?:vou ser (?:sincero|honesto|direto|franco)|a (?:verdade|realidade) é que|sejamos (?:sinceros|honestos|francos)|deixa eu ser (?:claro|direto)|para ser (?:sincero|honesto|franco)|é o seguinte:|o lance é o seguinte)/gi, PT],
      [/(?:^|\n)\s*(?:here'?s the thing|here'?s what i mean|let me be clear|i'?ll be honest|to be honest|the uncomfortable truth|real talk)/gi, EN],
    ],
  },
  {
    id: 'metadiscurso', nivel: 'suave',
    descricao: 'Comentário sobre o próprio texto: "essa parte importa", "o ponto principal é", "as you can see", "the key point is".',
    correcao: 'Se o ponto já está claro, delete; senão, substitua por fato.',
    regex: [
      [/(?:essa|esta|aquela) (?:parte|distinção|diferença) (?:importa|é importante|faz diferença)|o (?:ponto|detalhe|ponto) (?:principal|chave|central) (?:é|aqui é)|como (?:você |vocês )?pode(?:m)? (?:ver|notar|perceber)|repare que|note que|perceba que/gi, PT],
      [/that (?:last )?part matters|the key (?:point|takeaway|thing) (?:is|here)|as you can see|notice that|note that|this distinction matters|this matters because/gi, EN],
    ],
  },
  {
    id: 'dois-pontos-dramatico', nivel: 'suave',
    descricao: 'Sintagma curto, dois-pontos e revelação: "O melhor: ele aprende." / "The best part: it learns."',
    correcao: 'Frase normal. Dois-pontos para lista, rótulo ou citação.',
    regex: [
      [/(?:^|[.!?\n]\s*)(?:o (?:melhor|detalhe|segredo|resultado|problema|truque|pulo do gato|ponto)|a (?:parte boa|melhor parte|diferença|sacada|surpresa|pegadinha))(?: [^:\n]{0,40})?:\s+[a-záéíóúâêôãõç]/gi, PT],
      [/(?:^|[.!?\n]\s*)(?:the (?:best part|catch|kicker|result|secret|detail|trick|twist|surprise|problem|thing is))(?: [^:\n]{0,40})?:\s+[a-z]/gi, EN],
    ],
  },
  {
    id: 'fragmentacao-dramatica', nivel: 'suave',
    descricao: 'Fragmento de efeito: "É isso. Só isso.", "Simples assim.", "That\'s it. That\'s the whole thing."',
    correcao: 'Frase completa ou corte.',
    regex: [
      [/(?:^|[.!?\n]\s*)(?:é isso\.|só isso\.|simples assim\.|e pronto\.|ponto final\.|sem mais\.)/gi, PT],
      [/(?:^|[.!?\n]\s*)(?:that'?s it\.|that'?s the whole thing\.|that'?s all\.|simple as that\.|full stop\.|period\.)/gi, EN],
    ],
  },
  {
    id: 'ritmo-robotico', nivel: 'suave',
    descricao: 'Três ou mais frases seguidas de até três palavras, ou parágrafos com a mesma forma.',
    correcao: 'Varie a forma só quando ajudar o ponto.',
    teste: (texto) => {
      const frases = texto.split(/(?<=[.!?])\s+/).map((f) => f.trim()).filter(Boolean)
      const curtas = []
      let sequencia = 0
      for (const frase of frases) {
        const palavras = frase.replace(/[^\p{L}\d\s']/gu, '').split(/\s+/).filter(Boolean)
        if (palavras.length && palavras.length <= 3) {
          sequencia += 1
          if (sequencia === 3) curtas.push(frases.slice(frases.indexOf(frase) - 2, frases.indexOf(frase) + 1).join(' '))
        } else sequencia = 0
      }
      return curtas
    },
  },
  {
    id: 'cadencia-uniforme', nivel: 'suave',
    descricao: 'Quatro ou mais parágrafos começando do mesmo jeito.',
    correcao: 'Abra pelo detalhe específico de cada parágrafo.',
    teste: (texto) => {
      const paragrafos = texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      if (paragrafos.length >= 4 && paragrafos.every((p) => /^(?:no|na|o|a|eu|isso|the|in|on|what)\b/i.test(p))) return [paragrafos.map((p) => p.split(/\s+/).slice(0, 3).join(' ')).join(' / ')]
      return []
    },
  },
  {
    id: 'estrutura-de-case', nivel: 'suave',
    descricao: 'Molde problema → decisão técnica → trade-off → efeito verificável → lição.',
    correcao: 'Conte a coisa; corte os rótulos de seção.',
    regex: [[/(?:^|\n)(?:a decisão (?:técnica|de engenharia)|o trade-?off|o efeito verificável|a lição (?:que levo|é)|o que (?:eu )?levo (?:daqui|disso))/gim]],
  },
  {
    id: 'conclusao-sintetica', nivel: 'suave',
    descricao: 'Moral de fechamento: "regra reutilizável", "aprendizado que levo", "prova antes da promessa".',
    correcao: 'Encerre na última consequência concreta.',
    regex: [[/(?:regra reutilizável|aprendizado (?:que levo|principal)|prova antes da promessa|lição (?:aprendida|do dia))/gim]],
  },
  {
    id: 'cta-automatico', nivel: 'suave',
    descricao: 'Pergunta ao leitor no fim por hábito.',
    correcao: 'Só pergunte se quiser mesmo a resposta.',
    regex: [[/\?\s*(?:\n\s*#[\p{L}\d_]+(?:\s+#[\p{L}\d_]+)*)?\s*$/u]],
  },
  {
    id: 'abertura-generica', nivel: 'suave',
    descricao: 'Abertura de modelo: "Meu trabalho ficava espalhado", "Em um mundo", "Hoje eu aprendi".',
    correcao: 'Abra pelo detalhe mais específico.',
    regex: [[/^(?:meu trabalho .{0,80} espalhad|criar .{0,80} deveria ser|em um mundo|hoje (?:eu )?aprendi|imagine (?:que|se|um)|imagine (?:a|an|if))/i]],
  },
  {
    id: 'emoji-decorativo', nivel: 'suave',
    descricao: 'Emoji abrindo parágrafo ou três ou mais emojis no texto.',
    correcao: 'Corte os emojis decorativos.',
    teste: (texto) => {
      const emojis = texto.match(/\p{Extended_Pictographic}/gu) || []
      const abrindo = texto.match(/(?:^|\n)\s*\p{Extended_Pictographic}/gu) || []
      return emojis.length >= 3 || abrindo.length ? [abrindo[0]?.trim() || emojis.slice(0, 3).join(' ')] : []
    },
  },
]

const PRESERVAR = 'Preserve a voz: pergunta de abertura, fragmento curto de opinião, rótulo em CAIXA ALTA, gíria (tá, pra, né, cara), palavrão leve, opinião forte e admissão de dúvida não são slop quando pertencem ao autor. Corte só o que é molde.'

function frase(texto, indice, fim) {
  const antes = texto.slice(0, indice)
  const inicio = Math.max(antes.lastIndexOf('\n'), antes.search(/[.!?][^.!?]*$/) + 1)
  const resto = texto.slice(fim)
  const termino = resto.search(/[.!?\n]/)
  const trecho = texto.slice(Math.max(0, inicio), termino >= 0 ? fim + termino + 1 : texto.length).replace(/\s+/g, ' ').trim()
  return trecho.length > 180 ? `${trecho.slice(0, 177)}…` : trecho
}

function idiomaAceito(idiomas, idioma) {
  if (!idiomas) return true
  const lista = Array.isArray(idiomas) ? idiomas : [idiomas]
  return lista.includes(idioma)
}

function normalizarIdioma(idioma) {
  const valor = String(idioma || '').toLowerCase()
  return valor.startsWith('en') ? EN : PT
}

// formato 'markdown' (currículo editável) libera marcadores e listas com
// hífen; o restante do catálogo vale igual.
function detectar(valor, { idioma = PT, conta = null, formato = 'texto' } = {}) {
  // Apóstrofo tipográfico (’) vira reto para os padrões em inglês.
  const texto = String(valor || '').replace(/[’‘]/g, "'")
  if (!texto.trim()) return []
  const lingua = normalizarIdioma(idioma)
  const sinais = []
  const paragrafos = texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const ultimo = paragrafos.at(-1) || ''
  for (const padrao of PADROES) {
    if (padrao.id === 'markdown' && (formato === 'markdown' || (conta && !['x', 'linkedin', 'reddit', 'mensagem', 'email'].includes(conta)))) continue
    const trechos = []
    for (const [re, idiomas] of padrao.regex || []) {
      if (!idiomaAceito(idiomas, lingua)) continue
      if (re.global) {
        for (const m of texto.matchAll(re)) trechos.push(frase(texto, m.index, m.index + m[0].length))
      } else {
        const m = texto.match(re)
        if (m) trechos.push(frase(texto, m.index, m.index + m[0].length))
      }
    }
    for (const [re, idiomas] of padrao.ultimoParagrafo || []) {
      if (!idiomaAceito(idiomas, lingua)) continue
      const m = ultimo.match(re)
      if (m) trechos.push(frase(ultimo, m.index, m.index + m[0].length))
    }
    if (padrao.teste) trechos.push(...padrao.teste(texto))
    const unicos = [...new Set(trechos.filter(Boolean))]
    if (unicos.length) sinais.push({ padrao: padrao.id, nivel: padrao.nivel, ocorrencias: trechos.length, trecho: unicos[0], trechos: unicos.slice(0, 4), descricao: padrao.descricao, correcao: padrao.correcao })
  }
  return sinais
}

function resumo(sinais) {
  const duros = sinais.filter((s) => s.nivel === 'duro')
  const suaves = sinais.filter((s) => s.nivel === 'suave')
  const gravidade = duros.length ? 'reprovar' : suaves.length >= 2 ? 'reescrever' : 'ok'
  return { duros, suaves, gravidade }
}

function descreverSinais(sinais) {
  return sinais.map((s) => `${s.padrao} (${s.nivel}): “${s.trecho}”. ${s.correcao}`).join('\n')
}

function orientacaoCompacta(idioma = PT) {
  const lingua = normalizarIdioma(idioma)
  const linhas = PADROES.filter((p) => !p.regex || p.regex.some(([, idiomas]) => idiomaAceito(idiomas, lingua)) || p.ultimoParagrafo || p.teste)
    .map((p) => `- ${p.id} [${p.nivel}]: ${p.descricao}`)
  return `PADRÕES DE AI SLOP (catálogo ${VERSAO_CATALOGO}; níveis: duro reprova, suave orienta). Ao apontar um, cite a linha, nomeie o padrão e dê a correção em poucas palavras. Não deduza autoria de IA por estilo.\n${linhas.join('\n')}\nTambém: rodízio de sinônimos para o mesmo objeto, negrito decorativo, voz passiva com coisa inanimada fazendo verbo humano, abstração no lugar de nome, número, data ou mecanismo, e frase que serviria para qualquer produto (teste de portabilidade).\n${PRESERVAR}`
}

function hashCatalogo(skillsDir = path.resolve(__dirname, '../skills')) {
  const partes = [JSON.stringify(PADROES.map((p) => ({ id: p.id, nivel: p.nivel, regex: (p.regex || []).map(([re]) => re.source), ultimo: (p.ultimoParagrafo || []).map(([re]) => re.source) })))]
  for (const nome of ['SKILL.md', 'eval.md', 'references/padroes-pt-br.md']) {
    const arquivo = path.join(skillsDir, 'no-ai-slop', nome)
    if (fs.existsSync(arquivo)) partes.push(fs.readFileSync(arquivo, 'utf8'))
  }
  return sha256(partes.join('\n'))
}

module.exports = { PADROES, VERSAO_CATALOGO, PRESERVAR, detectar, resumo, descreverSinais, orientacaoCompacta, hashCatalogo, normalizarIdioma }
