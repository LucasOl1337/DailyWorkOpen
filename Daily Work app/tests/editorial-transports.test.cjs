const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')

test('transport HTTP usa envelope, cria item e recusa origem/URI inválidas', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-http-'))
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-user-'))
  process.env.DAILYWORK_DATA_DIR = dataDir
  process.env.DAILYWORK_USER_DATA_DIR = userDir
  process.env.DAILYWORK_CAPTURE_PATH = path.join(dataDir, 'capture.png')
  const { createServer } = require('vite')
  const vite = await createServer({ configFile: path.resolve(__dirname, '../vite.config.ts'), optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port: 0 } })
  await vite.listen()
  const address = vite.httpServer.address()
  const base = `http://127.0.0.1:${address.port}`
  try {
    const lista = await fetch(`${base}/api/editorial/itens`)
    assert.equal(lista.status, 200); assert.deepEqual((await lista.json()).data, [])
    const capacidades = await fetch(`${base}/api/editorial/capacidades`)
    assert.equal(capacidades.status, 200)
    const capacidadesData = (await capacidades.json()).data
    assert.equal(capacidadesData.find((conexao) => conexao.id === 'linkedin').capacidades.midia.video, true)
    assert.equal(capacidadesData.find((conexao) => conexao.id === 'x').capacidades.midia.escopo, 'media.write')
    const criar = await fetch(`${base}/api/editorial/itens`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pautaId: 'p-http', conta: 'x', idioma: 'pt-BR', formato: 'texto', titulo: 'HTTP', texto: 'corpo' }) })
    assert.equal(criar.status, 201); const itemCriado = (await criar.json()).data; assert.equal(itemCriado.texto, 'corpo')
    const excluir = await fetch(`${base}/api/editorial/itens`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itens: [{ id: itemCriado.id, revisao: itemCriado.revisao }] }) })
    assert.equal(excluir.status, 200); assert.deepEqual((await excluir.json()).data.excluidos, [itemCriado.id])
    const listaAposExcluir = await fetch(`${base}/api/editorial/itens`)
    assert.deepEqual((await listaAposExcluir.json()).data, [])
    const origem = await fetch(`${base}/api/editorial/itens`, { headers: { Origin: 'https://attacker.example' } })
    assert.equal(origem.status, 403); assert.equal((await origem.json()).erro.codigo, 'ORIGEM_NAO_PERMITIDA')
    const uri = await fetch(`${base}/api/editorial/itens/%E0%A4%A`)
    assert.ok(uri.status >= 400); assert.equal((await uri.json()).ok, false)
    const jobs = await fetch(`${base}/api/editorial/midia/jobs`)
    assert.equal(jobs.status, 200); assert.deepEqual((await jobs.json()).data, [])
    const retomar = await fetch(`${base}/api/editorial/midia/jobs/retomar`, { method: 'POST' })
    assert.equal(retomar.status, 200); assert.deepEqual((await retomar.json()).data, { retomados: [] })
    const idInvalido = await fetch(`${base}/api/editorial/midia/jobs/%2e%2e%2fsegredo`)
    assert.equal(idInvalido.status, 400); assert.equal((await idInvalido.json()).erro.codigo, 'ID_INVALIDO')
    const logica = await fetch(`${base}/api/editorial/logica`)
    assert.equal(logica.status, 200)
    const logicaData = (await logica.json()).data
    assert.deepEqual(logicaData.roteiro.map((passo) => passo.id), ['tema', 'problema', 'resolucao', 'conclusao'])
    const salva = await fetch(`${base}/api/editorial/logica`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...logicaData, notas: 'Abrir pelo detalhe mais específico.' }) })
    assert.equal(salva.status, 200); assert.equal((await salva.json()).data.notas, 'Abrir pelo detalhe mais específico.')
    const restaurada = await fetch(`${base}/api/editorial/logica/restaurar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(restaurada.status, 200); assert.equal((await restaurada.json()).data.notas, '')
  } finally {
    await vite.close()
    delete process.env.DAILYWORK_DATA_DIR
    delete process.env.DAILYWORK_USER_DATA_DIR
    delete process.env.DAILYWORK_CAPTURE_PATH
  }
})
