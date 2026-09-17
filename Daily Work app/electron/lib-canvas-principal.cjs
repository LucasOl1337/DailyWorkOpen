const fs = require('node:fs')
const path = require('node:path')
function criarCanvasPrincipal({ dataDir }) {
  const arquivo = path.join(dataDir, 'principal-canvas.json')
  return {
    carregar() { return fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : null },
    salvar(snapshot) {
      if (!snapshot?.document?.store || !snapshot.document.schema) throw Object.assign(new Error('Snapshot nativo inválido.'), { codigo: 'SNAPSHOT_INVALIDO', status: 400 })
      fs.mkdirSync(dataDir, { recursive: true })
      const temporario = `${arquivo}.tmp`
      fs.writeFileSync(temporario, JSON.stringify(snapshot), { mode: 0o600 })
      if (fs.existsSync(arquivo)) fs.copyFileSync(arquivo, `${arquivo}.bak`)
      fs.renameSync(temporario, arquivo)
      return { salvo: true }
    },
  }
}
module.exports = { criarCanvasPrincipal }
