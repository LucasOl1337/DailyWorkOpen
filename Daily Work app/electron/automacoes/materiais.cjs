const path = require('node:path')
const { erro, comTrava, lerJson, gravarJson, listarJson, arquivoPorId } = require('./arquivos.cjs')
const estilo = require('../lib-estilo-slop.cjs')

function processoVivo(pid) {
  if (!Number.isInteger(pid)) return false
  try { process.kill(pid, 0); return true } catch (falha) { return falha.code !== 'ESRCH' }
}

function extrairJson(resposta) {
  try { return JSON.parse(String(resposta?.mensagem || '').trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')) } catch { return null }
}

function materialValido(dados, ids) {
  return Boolean(dados && typeof dados.texto === 'string' && dados.texto.trim() && dados.texto.length <= 30_000 && typeof dados.titulo === 'string' && dados.titulo.trim() && dados.titulo.length <= 200 && Array.isArray(dados.fontesUsadas) && dados.fontesUsadas.length && dados.fontesUsadas.every(id => ids.has(id)) && Array.isArray(dados.lacunas) && dados.lacunas.every(l => typeof l === 'string' && l.length <= 500) && dados.lacunas.length <= 20)
}

function criarMateriais(arquivos, biblioteca, completar) {
  const { runs } = arquivos
  const pasta = path.join(runs, 'materiais')
  function obter(id) {
    const material = lerJson(arquivoPorId(pasta, id))
    if (!material) throw erro('NAO_ENCONTRADO', 'Material não encontrado.', 404)
    return material
  }
  function listar() {
    return listarJson(pasta).filter(m => m && typeof m.id === 'string' && typeof m.criadoEm === 'string').map(m => {
      if (m.status === 'gerando' && !processoVivo(m.pid)) return { ...m, status: 'interrompido', erro: 'A geração foi interrompida. Gere novamente.' }
      return m
    }).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
  }
  async function gerar({ contextoId } = {}) {
    const contexto = biblioteca.obterContexto(contextoId)
    if (['ciclo', 'pesquisa'].includes(contexto.tipo)) throw erro('TIPO_INVALIDO', 'Use um contexto de mensagem, candidatura ou currículo.')
    if (typeof completar !== 'function') throw erro('MODELO_INDISPONIVEL', 'O modelo do app não está disponível.', 503)
    return comTrava(path.join(pasta, `${contexto.id}.lock`), async () => {
      const destino = arquivoPorId(pasta, contexto.id)
      const existente = lerJson(destino)
      if (existente?.status === 'pronto') return existente
      const material = { id: contexto.id, contextoId: contexto.id, tipo: contexto.tipo, idioma: contexto.idioma, alvoUrl: contexto.alvoUrl, criadoEm: new Date().toISOString(), status: 'gerando', pid: process.pid, titulo: 'Preparando material', fontesUsadas: [], lacunas: [] }
      gravarJson(destino, material, { backup: Boolean(existente) })
      arquivos.auditar('material-iniciar', { materialId: material.id, contextoId: contexto.id, tipo: contexto.tipo })
      try {
        const resposta = await completar({ mensagens: contexto.mensagens, maxTokens: 4000, timeoutMs: 120_000 })
        let dados = extrairJson(resposta)
        const ids = new Set(contexto.fontes.map(f => f.id))
        if (!materialValido(dados, ids)) {
          throw erro('RESPOSTA_INVALIDA', 'O modelo não devolveu um material com referências válidas. Nada foi enviado.', 502)
        }
        // Gate de estilo: o catálogo de AI slop cita o trecho e nomeia o
        // padrão. Um padrão duro ou dois suaves pedem uma única reescrita
        // sem mudar fatos; o que sobrar vira ponto para conferir, não erro.
        const formato = contexto.tipo === 'curriculo' ? 'markdown' : 'texto'
        let sinais = estilo.detectar(dados.texto, { idioma: contexto.idioma, formato })
        let reescrito = false
        if (estilo.resumo(sinais).gravidade !== 'ok') {
          const pedido = [...contexto.mensagens, { role: 'assistant', content: String(resposta.mensagem || '') }, { role: 'user', content: `O texto tem padrões de AI slop:\n${estilo.descreverSinais(sinais)}\nReescreva o mesmo JSON sem esses padrões, sem mudar fatos, fontesUsadas ou lacunas, mantendo a voz de Lucas. Responda somente JSON.` }]
          const novo = extrairJson(await completar({ mensagens: pedido, maxTokens: 4000, timeoutMs: 120_000 }))
          if (materialValido(novo, ids)) {
            dados = novo
            reescrito = true
            sinais = estilo.detectar(dados.texto, { idioma: contexto.idioma, formato })
          }
        }
        const restantes = estilo.resumo(sinais).gravidade === 'ok' ? [] : sinais
        const lacunas = [...new Set(dados.lacunas)]
        for (const sinal of restantes) lacunas.push(`Estilo (${sinal.padrao}): “${sinal.trecho}”. ${sinal.correcao}`)
        Object.assign(material, { titulo: dados.titulo, texto: dados.texto, fontesUsadas: [...new Set(dados.fontesUsadas)], lacunas, estilo: { catalogo: estilo.VERSAO_CATALOGO, reescrito, sinais: sinais.map(s => ({ padrao: s.padrao, nivel: s.nivel, trecho: s.trecho, correcao: s.correcao })) }, status: 'pronto', concluidoEm: new Date().toISOString(), modelo: resposta.perfil || null, fallback: Boolean(resposta.fallback) })
        gravarJson(destino, material)
        arquivos.auditar('material-concluir', { materialId: material.id, contextoId: contexto.id, modelo: material.modelo?.id, quantidadeFontes: material.fontesUsadas.length, estiloReescrito: reescrito, estiloSinais: sinais.length })
        return material
      } catch (e) {
        Object.assign(material, { status: 'falhou', erro: e.codigo === 'RESPOSTA_INVALIDA' ? e.message : 'A geração não terminou. Confira o provedor na aba Agente e tente novamente.', concluidoEm: new Date().toISOString() })
        gravarJson(destino, material)
        arquivos.auditar('material-falhar', { materialId: material.id, codigo: e.codigo || 'MODELO_INDISPONIVEL' })
        throw erro(e.codigo || 'MODELO_INDISPONIVEL', material.erro, e.status || 502)
      }
    })
  }
  return { gerar, obter, listar }
}
module.exports = { criarMateriais }
