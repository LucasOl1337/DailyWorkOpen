#!/usr/bin/env node
// Cliente local para agentes. Aprovar/publicar não são comandos deste cliente.
const fs = require('node:fs')
const { DATA_DIR } = require('../electron/lib-md.cjs')
const { criarServicoSessoes } = require('../electron/sessoes/servico.cjs')
async function main() {
  const acao = process.argv[2] || 'estado'
  if (!['estado', 'verificar', 'perfil', 'jobs', 'cancelar', 'propor'].includes(acao))
    throw new Error(
      'Use estado, verificar, perfil, jobs, cancelar JOB ou propor (JSON por stdin). A aprovação é feita na interface.',
    )
  const s = criarServicoSessoes({ dataDir: DATA_DIR })
  try {
    if (acao === 'estado') return await s.obterEstado()
    if (acao === 'verificar') return await s.verificar()
    if (acao === 'perfil') return await s.consultar()
    if (acao === 'jobs') return s.listarJobs()
    if (acao === 'cancelar') return s.cancelar(process.argv[3])
    const entrada = JSON.parse(fs.readFileSync(0, 'utf8'))
    if (entrada.midias?.length || entrada.formato && entrada.formato !== 'texto') throw new Error('O cliente visual aceita texto; mídia não será descartada.')
    const { criarFilaEditorial } = require('../electron/lib-fila-editorial.cjs')
    const indisponivel = () => {
      throw new Error('Este cliente só cria peças para revisão.')
    }
    const fila = criarFilaEditorial({
      dataDir: DATA_DIR,
      registro: { prepararPublicacao: indisponivel, confirmarPublicacao: indisponivel },
    })
    return await fila.criar({ ...entrada, conta: 'linkedin', formato: 'texto', midias: [] })
  } finally {
    s.fechar()
  }
}
main()
  .then((r) => console.log(JSON.stringify({ ok: true, data: r }, null, 2)))
  .catch((e) => {
    console.error(JSON.stringify({ ok: false, erro: { codigo: e.codigo || 'ERRO', mensagem: e.message } }))
    process.exitCode = 1
  })
