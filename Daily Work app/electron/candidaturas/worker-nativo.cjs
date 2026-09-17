const path = require('node:path')
const { criarServicoCandidaturas } = require('../lib-candidaturas.cjs')
const { criarServicoAgente } = require('../lib-agente-9router.cjs')
const { executarMissao } = require('./nativo.cjs')
const [privateDir, missaoId, repoRoot] = process.argv.slice(2)
const s = criarServicoCandidaturas({ privateDir, repoRoot })
const agente = criarServicoAgente({ lib: { DATA_DIR: path.join(repoRoot, 'Daily Work app/data') } })
// Re-read the deadline so an explicit "continue until today's goal" command can
// extend a running worker without spawning a duplicate process.
const timer = setInterval(() => {
  if (Date.now() < Date.parse(s.missao(missaoId).limite)) return
  s.executorEstado({ missaoId, estado: 'interrompida', motivo: 'Janela da missão encerrada. Progresso preservado.' })
  process.kill(-process.pid, 'SIGTERM')
}, 5000)
timer.unref?.()
executarMissao({ s, missaoId, repoRoot, agente }).then(r => {
  clearInterval(timer); console.log(JSON.stringify({ estado: r.estado, ciclos: r.ciclos, acoes: r.acoes, modelo: r.modelo, erro: r.erro })); s.close()
}).catch(e => { clearInterval(timer); console.error(e.message); s.close(); process.exitCode = 1 })
