const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { hash, erro, lerJson, gravarJson, listarJson, arquivoPorId, comTrava, validarEstado } = require('./arquivos.cjs')

function criarCampanha(arquivos, biblioteca) {
  const { base, runs, lerEstado, auditar } = arquivos
  const estadoPath = path.join(base, 'estado.json.local')
  const pasta = path.join(runs, 'interacoes')
  function estado() {
    const dados = lerEstado()
    return { dados, revisao: hash(JSON.stringify(dados)), fila: [...(dados.fila_manual || []).map((v, i) => ({ ...v, id: v.id || `legado-${i}` })), ...listarJson(path.join(runs, 'fila'))] }
  }
  async function atualizarEstado({ revisao, patch } = {}) {
    const permitidos = ['toques', 'candidaturas', 'fila_argumentos', 'fila_alvos_email', 'bloqueios', 'threads_abertas']
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !permitidos.includes(k))) throw erro('PATCH_INVALIDO', 'Patch de estado inválido.')
    return comTrava(path.join(runs, 'estado.lock'), () => {
      const atual = estado()
      if (revisao !== atual.revisao) throw erro('CONFLITO', 'Releia o estado antes de atualizar.', 409)
      gravarJson(estadoPath, validarEstado({ ...atual.dados, ...patch }), { backup: true })
      auditar('estado-atualizar', { campos: Object.keys(patch) })
      return estado()
    })
  }
  function listarInteracoes() { return listarJson(pasta).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).slice(0, 60) }
  function pendentes() { return listarJson(pasta).filter(i => ['enviando', 'incerto'].includes(i.status)) }
  async function registrar({ contextoId, tipo, alvo, texto, fontesUsadas, fontesExternas = [], filaId } = {}) {
    require('../agenda/consumo.cjs').antes()
    const limite=Number(process.env.AUTOMACOES_LIMITE||0)
    if(limite&&listarInteracoes().filter(i=>i.contextoId===contextoId&&i.status!=='nao_enviado').length>=limite)throw erro('META_ATINGIDA','Limite de interações desta rodada atingido.',409)
    const contexto = biblioteca.obterContexto(contextoId)
    if (contexto.tipo !== 'ciclo') throw erro('CONTEXTO_INVALIDO', 'O envio precisa de um contexto de ciclo.')
    if (!['email', 'linkedin', 'x', 'candidatura', 'curriculo'].includes(tipo) || typeof alvo !== 'string' || !alvo.trim() || alvo.length > 2000 || typeof texto !== 'string' || !texto.trim() || texto.length > 30_000) throw erro('REGISTRO_INVALIDO', 'Informe tipo, alvo e texto da interação.')
    const ids = new Set(contexto.fontes.map(f => f.id))
    if (!Array.isArray(fontesUsadas) || !fontesUsadas.length || fontesUsadas.some(id => !ids.has(id))) throw erro('FONTES_INVALIDAS', 'As referências devem pertencer ao contexto da execução.')
    if (!Array.isArray(fontesExternas) || fontesExternas.length > 10 || fontesExternas.some(f => { try { const u = new URL(f.url); return u.protocol !== 'https:' || u.username || u.password || typeof f.trecho !== 'string' || f.trecho.length > 4000 } catch { return true } })) throw erro('FONTES_INVALIDAS', 'Fontes externas precisam de URL HTTPS sem credenciais e trecho de até 4 mil caracteres.')
    const hoje = require('../sumario/shared.cjs').diaLocal()
    const chave = hash(`${hoje}|${tipo}|${alvo.trim().toLowerCase()}`)
    return comTrava(path.join(runs, 'interacoes.lock'), () => {
      if (filaId) {
        const itemFila = estado().fila.find(f => f.id === filaId)
        const canalTipo = { linkedin: 'linkedin', x: 'x', ashby: 'candidatura' }
        if (!itemFila || itemFila.status !== 'na_fila' || itemFila.url !== alvo || canalTipo[itemFila.canal] !== tipo) throw erro('FILA_INCOMPATIVEL', 'O alvo e o canal precisam corresponder ao item da fila.', 409)
      }
      const anterior = listarJson(pasta).find(i => i.chave === chave && i.status !== 'nao_enviado')
      if (anterior) throw erro('ENVIO_JA_REGISTRADO', 'Já existe uma tentativa para esse alvo e canal hoje. Confira o registro antes de enviar.', 409)
      const id = randomUUID()
      const destino = arquivoPorId(pasta, id)
      const item = { id, chave, contextoId, tipo, alvo, texto, fontesUsadas: [...new Set(fontesUsadas)], fontesExternas, ...(filaId ? { filaId } : {}), criadoEm: new Date().toISOString(), status: 'enviando' }
      gravarJson(destino, item)
      auditar('interacao-iniciar', { interacaoId: id, contextoId, tipo })
      return item
    })
  }
  async function concluir({ id, status, evidencia = '', nota = '', filaId } = {}) {
    if (!['confirmado', 'incerto', 'nao_enviado'].includes(status) || typeof evidencia !== 'string' || evidencia.length > 2000 || typeof nota !== 'string' || nota.length > 2000) throw erro('RESULTADO_INVALIDO', 'Informe um resultado válido.')
    if (status === 'confirmado' && !evidencia.trim()) throw erro('EVIDENCIA_OBRIGATORIA', 'Um envio confirmado precisa de evidência ou recibo verificável.')
    return comTrava(path.join(runs, 'interacoes.lock'), async () => {
      const destino = arquivoPorId(pasta, id)
      const item = lerJson(destino)
      if (!item) throw erro('NAO_ENCONTRADO', 'Interação não encontrada.', 404)
      if (filaId && filaId !== item.filaId) throw erro('FILA_INCOMPATIVEL', 'A fila não corresponde à interação registrada.', 409)
      if (['confirmado', 'nao_enviado'].includes(item.status) && (status !== item.status || evidencia !== item.evidencia || nota !== item.nota)) throw erro('CONFLITO', 'Essa tentativa já foi encerrada. O resultado anterior foi preservado.', 409)
      const alvoVinculado = item.filaId && estado().fila.find(f => f.id === item.filaId)
      if (item.filaId && (!alvoVinculado || alvoVinculado.url !== item.alvo)) throw erro('FILA_INCOMPATIVEL', 'O alvo da fila mudou. Nenhum resultado foi alterado.', 409)
      const resultado = ['confirmado', 'nao_enviado'].includes(item.status) ? item : { ...item, status, evidencia, nota, concluidoEm: new Date().toISOString() }
      gravarJson(destino, resultado, { backup: true })
      if (item.filaId && status === 'confirmado') {
        await comTrava(path.join(runs, 'estado.lock'), () => {
          if (/^legado-\d+$/.test(item.filaId)) {
            const est = lerEstado()
            const indice = Number(item.filaId.slice(7))
            if (est.fila_manual?.[indice]) {
              est.fila_manual[indice] = { ...est.fila_manual[indice], status: 'feito', evidencia, contextoId: item.contextoId }
              gravarJson(estadoPath, est, { backup: true })
            }
          } else {
            const filaPath = arquivoPorId(path.join(runs, 'fila'), item.filaId)
            const alvoFila = lerJson(filaPath)
            if (alvoFila) gravarJson(filaPath, { ...alvoFila, status: 'feito', evidencia, contextoId: item.contextoId }, { backup: true })
          }
        })
      }
      auditar('interacao-concluir', { interacaoId: id, contextoId: item.contextoId, status })
      return resultado
    })
  }
  return { estado, atualizarEstado, listarInteracoes, pendentes, registrar, concluir }
}
module.exports = { criarCampanha }
