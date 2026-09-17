// O Maestri pode enfileirar a entrega enquanto o agente de destino está ocupado.
const ATRASO_MAXIMO_ENTREGA_MS = 30 * 60_000
const TOLERANCIA_RELOGIO_ENTREGA_MS = 10_000
const COMANDO_ENTREGA = /(?:\bmaestri(?:\.exe)?\b|\bMAESTRI_CLI\b)[\\"'\s]{1,12}ask\b/i

function criarProvenienciaMaestri({ hash, sanitizarTexto, timestampMs }) {
  const EVIDENCIA_MENSAGEM = Symbol('dailywork.maestri.mensagem')
  const ENVIOS_CONVERSA = Symbol('dailywork.maestri.conversa')

  function extrairComandos(
    valor,
    aceitarTexto = false,
    resultado = [],
    vistos = new Set(),
    profundidade = 0
  ) {
    if (valor == null || profundidade > 30 || Buffer.isBuffer(valor)) return resultado
    if (typeof valor === 'string') {
      if (!aceitarTexto) return resultado
      const texto = sanitizarTexto(valor)
      if (COMANDO_ENTREGA.test(texto)) resultado.push(texto)
      if (/^\s*[\[{]/.test(valor)) {
        try {
          extrairComandos(JSON.parse(valor), false, resultado, vistos, profundidade + 1)
        } catch {}
      }
      return resultado
    }
    if (typeof valor !== 'object' || vistos.has(valor)) return resultado
    vistos.add(valor)
    if (Array.isArray(valor)) {
      for (const item of valor) {
        extrairComandos(item, aceitarTexto, resultado, vistos, profundidade + 1)
      }
      return resultado
    }
    for (const [chave, item] of Object.entries(valor)) {
      const campoDeComando = /^(?:command|cmd|script|shellCommand|rawInput|arguments)$/i.test(chave)
      extrairComandos(item, campoDeComando, resultado, vistos, profundidade + 1)
    }
    return resultado
  }

  function extrairArquivosEscritos(valor, resultado = [], vistos = new Set(), profundidade = 0) {
    if (valor == null || profundidade > 30 || typeof valor !== 'object' || Buffer.isBuffer(valor)) {
      return resultado
    }
    if (vistos.has(valor)) return resultado
    vistos.add(valor)
    if (!Array.isArray(valor)) {
      const nome = String(valor.name || valor.toolName || '')
      const entrada = valor.input || valor.arguments || valor.rawInput
      if (/^(?:write|write[_-]?file)$/i.test(nome) && entrada && typeof entrada === 'object') {
        const caminho = entrada.file_path || entrada.filePath || entrada.path
        if (typeof caminho === 'string' && typeof entrada.content === 'string') {
          resultado.push({ path: caminho, content: entrada.content })
        }
      }
    }
    for (const item of Array.isArray(valor) ? valor : Object.values(valor)) {
      extrairArquivosEscritos(item, resultado, vistos, profundidade + 1)
    }
    return resultado
  }

  function lerArgumentosShell(texto, inicio) {
    const argumentos = []
    let atual = ''
    let iniciou = false
    let aspas = null

    function guardar() {
      if (iniciou) argumentos.push(atual)
      atual = ''
      iniciou = false
    }

    for (let indice = inicio; indice < texto.length; indice += 1) {
      const caractere = texto[indice]
      const proximo = texto[indice + 1]
      if (aspas === "'") {
        if (caractere === "'") {
          if (proximo === "'") {
            atual += "'"
            indice += 1
          } else {
            aspas = null
          }
        } else {
          atual += caractere
        }
        continue
      }
      if (aspas === '"') {
        if (caractere === '"') {
          aspas = null
        } else if (caractere === '`' && proximo != null) {
          atual += proximo
          indice += 1
        } else if (caractere === '\\' && proximo != null && '"\\$`'.includes(proximo)) {
          atual += proximo
          indice += 1
        } else {
          atual += caractere
        }
        continue
      }
      if (caractere === '"' || caractere === "'") {
        aspas = caractere
        iniciou = true
      } else if (/\s/.test(caractere)) {
        guardar()
      } else if (';|&'.includes(caractere)) {
        guardar()
        break
      } else if ((caractere === '\\' || caractere === '`') && proximo != null) {
        atual += proximo
        iniciou = true
        indice += 1
      } else {
        atual += caractere
        iniciou = true
      }
    }
    guardar()
    return argumentos
  }

  function nomeDoArquivo(referencia) {
    const limpa = referencia.trim().replace(/^['"]|['"]$/g, '')
    return limpa.split(/[\\/]/).at(-1)?.toLowerCase() || ''
  }

  function expandirArquivosDoPrompt(prompt, arquivos, indiceDoEnvio, timestampDoEnvio) {
    let falhou = false
    const expandido = prompt.replace(
      /\$\(\s*(?:cat\s+|Get-Content(?:\s+-Raw)?\s+)([^)]+?)\s*\)/gi,
      (trecho, referencia) => {
        const nome = nomeDoArquivo(String(referencia).split(/\s+/).at(-1) || '')
        const candidatas = arquivos
          .filter((arquivo) => arquivo.name === nome)
          .filter((arquivo) => (
            arquivo.indice <= indiceDoEnvio
            || (
              arquivo.timestampMs != null
              && timestampDoEnvio != null
              && arquivo.timestampMs <= timestampDoEnvio
            )
          ))
          .sort((a, b) => (b.timestampMs ?? b.indice) - (a.timestampMs ?? a.indice))
        if (!candidatas[0]) {
          falhou = true
          return trecho
        }
        return sanitizarTexto(candidatas[0].content)
      }
    )
    return falhou || expandido.includes('$(') ? null : expandido
  }

  function variaveisDoComando(comando, arquivos, indiceDoEnvio, timestampDoEnvio) {
    const variaveis = new Map()
    const atribuicao = /(?:^|[;&]\s*)(\$?[A-Za-z_][\w]*)\s*=\s*('(?:''|[^'])*'|"(?:`.|\\.|[^"])*"|\$\([^;\r\n]*\)|[^;\r\n]+)/g
    for (const encontrada of comando.matchAll(atribuicao)) {
      const nome = encontrada[1].replace(/^\$/, '')
      let valor = encontrada[2].trim()
      if (valor.startsWith("'") && valor.endsWith("'")) {
        valor = valor.slice(1, -1).replace(/''/g, "'")
      } else if (valor.startsWith('"') && valor.endsWith('"')) {
        valor = lerArgumentosShell(valor, 0)[0] || ''
      }
      const expandida = expandirArquivosDoPrompt(
        valor,
        arquivos,
        indiceDoEnvio,
        timestampDoEnvio
      )
      if (expandida != null) variaveis.set(nome, expandida)
    }
    const aquiString = /\$([A-Za-z_][\w]*)\s*=\s*@(["'])\r?\n([\s\S]*?)\r?\n\2@/g
    for (const encontrada of comando.matchAll(aquiString)) {
      variaveis.set(encontrada[1], encontrada[3])
    }
    return variaveis
  }

  function resolverVariavel(argumento, variaveis) {
    const referencia = /^\$\{?([A-Za-z_][\w]*)\}?$/.exec(argumento)
    return referencia && variaveis.has(referencia[1])
      ? variaveis.get(referencia[1])
      : argumento
  }

  function enviosDoComando(comando, arquivos, indiceDoEnvio, timestampDoEnvio) {
    const envios = []
    const variaveis = variaveisDoComando(comando, arquivos, indiceDoEnvio, timestampDoEnvio)
    const padrao = new RegExp(COMANDO_ENTREGA.source, 'ig')
    for (const entrega of comando.matchAll(padrao)) {
      const argumentos = lerArgumentosShell(comando, entrega.index + entrega[0].length)
      if (argumentos[0] === '--batch') {
        try {
          const loteExpandido = expandirArquivosDoPrompt(
            resolverVariavel(argumentos[1], variaveis),
            arquivos,
            indiceDoEnvio,
            timestampDoEnvio
          )
          if (loteExpandido == null) continue
          const lote = JSON.parse(loteExpandido)
          if (lote && typeof lote === 'object' && !Array.isArray(lote)) {
            for (const [target, prompt] of Object.entries(lote)) {
              if (typeof prompt === 'string') envios.push({ target, prompt })
            }
          }
        } catch {}
        continue
      }
      const target = argumentos.shift()
      const raw = argumentos[0] === '--raw'
      if (raw) argumentos.shift()
      let prompt = resolverVariavel(argumentos[0], variaveis)
      if (!target || !prompt) continue
      prompt = expandirArquivosDoPrompt(prompt, arquivos, indiceDoEnvio, timestampDoEnvio)
      if (prompt == null) continue
      if (raw) {
        prompt = prompt
          .replace(/\\r/g, '\r')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
      }
      envios.push({ target, prompt })
    }
    const unicos = new Map()
    for (const envio of envios) unicos.set(`${envio.target}\u0000${envio.prompt}`, envio)
    return [...unicos.values()]
  }

  function textoComparavel(valor) {
    return sanitizarTexto(valor)
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/\[Image #\d+\]\s*(?=[.,;:!?\"'`)\]])/gi, '')
      .replace(/\[Image #\d+\]/gi, '')
      .trim()
  }

  function mesmoPrompt(enviado, recebido) {
    if (enviado === recebido) return true
    // Um shell pode cortar a entrega na primeira aspa interna sem avisar o emissor.
    return recebido.length >= 80 && enviado.startsWith(recebido)
  }

  function enviosUnicos(envios) {
    const unicos = new Map()
    for (const envio of envios) {
      const chave = `${envio.conversationId}\u0000${envio.messageId}\u0000${envio.target}\u0000${hash(envio.prompt)}`
      if (!unicos.has(chave)) unicos.set(chave, envio)
    }
    return [...unicos.values()]
  }

  function anotarMensagem(mensagem, original = mensagem) {
    if (mensagem.kind !== 'tool_call') return mensagem
    const comandos = [...new Set([
      ...extrairComandos(original.text, true),
      ...extrairComandos(original.content),
    ])]
    const arquivos = extrairArquivosEscritos(original.content)
    if (!comandos.length && !arquivos.length) return mensagem
    Object.defineProperty(mensagem, EVIDENCIA_MENSAGEM, {
      configurable: true,
      value: { comandos, arquivos },
    })
    return mensagem
  }

  // Guarda a prova antes da amostragem técnica, que pode descartar o tool call emissor.
  function enviosDaConversa(conversa) {
    const envios = Array.isArray(conversa[ENVIOS_CONVERSA])
      ? [...conversa[ENVIOS_CONVERSA]]
      : []
    const arquivos = conversa.messages.flatMap((mensagem, indice) => (
      (mensagem[EVIDENCIA_MENSAGEM]?.arquivos || []).map((arquivo) => ({
        ...arquivo,
        name: nomeDoArquivo(arquivo.path),
        indice,
        timestampMs: timestampMs(mensagem.timestamp),
      }))
    ))
    for (let indice = 0; indice < conversa.messages.length; indice += 1) {
      const mensagem = conversa.messages[indice]
      if (mensagem?.kind !== 'tool_call') continue
      for (const comando of mensagem[EVIDENCIA_MENSAGEM]?.comandos || []) {
        for (const { target, prompt } of enviosDoComando(
          comando,
          arquivos,
          indice,
          timestampMs(mensagem.timestamp)
        )) {
          envios.push({
            source: conversa.source,
            conversationId: conversa.id,
            messageId: mensagem.id,
            timestamp: mensagem.timestamp,
            target,
            prompt,
          })
        }
      }
    }
    return enviosUnicos(envios)
  }

  function anexarEnvios(conversa, envios) {
    Object.defineProperty(conversa, ENVIOS_CONVERSA, {
      configurable: true,
      value: enviosUnicos(envios),
      writable: true,
    })
    return conversa
  }

  function adicionarEnvios(conversa, envios) {
    conversa[ENVIOS_CONVERSA] = enviosUnicos([
      ...(conversa[ENVIOS_CONVERSA] || []),
      ...envios,
    ])
  }

  function limparMensagem(mensagem) {
    const { [EVIDENCIA_MENSAGEM]: _evidencia, ...limpa } = mensagem
    return limpa
  }

  function classificar(conversas) {
    const envios = conversas
      .flatMap((conversa) => conversa[ENVIOS_CONVERSA] || [])
      .map((envio) => ({
        ...envio,
        timestampMs: timestampMs(envio.timestamp),
        promptComparavel: textoComparavel(envio.prompt),
      }))
      .filter((envio) => envio.timestampMs != null)

    return conversas.map((conversa) => {
      const messages = conversa.messages.map((mensagem) => {
        if (mensagem.role !== 'user' || mensagem.kind !== 'message' || !mensagem.text) return mensagem
        const recebidoEm = timestampMs(mensagem.timestamp)
        if (recebidoEm == null) return mensagem
        const texto = textoComparavel(mensagem.text)
        if (!texto) return mensagem
        const envio = envios
          .filter((item) => item.conversationId !== conversa.id)
          .map((item) => ({ ...item, atraso: recebidoEm - item.timestampMs }))
          .filter((item) => (
            item.atraso >= -TOLERANCIA_RELOGIO_ENTREGA_MS
            && item.atraso <= ATRASO_MAXIMO_ENTREGA_MS
            && mesmoPrompt(item.promptComparavel, texto)
          ))
          .sort((a, b) => Math.abs(a.atraso) - Math.abs(b.atraso))[0]
        if (!envio) return mensagem
        return {
          ...mensagem,
          role: 'system',
          kind: 'delegated_task',
          provenance: {
            ...mensagem.provenance,
            delegation: {
              mechanism: 'maestri',
              source: envio.source,
              conversationId: envio.conversationId,
              messageId: envio.messageId,
              target: envio.target,
              sentAt: envio.timestamp,
            },
          },
        }
      })
      return { ...conversa, messages }
    })
  }

  return {
    adicionarEnvios,
    anexarEnvios,
    anotarMensagem,
    classificar,
    enviosDaConversa,
    limparMensagem,
  }
}

module.exports = { criarProvenienciaMaestri }
