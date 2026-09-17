const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { criarServicoSessoes } = require('../electron/sessoes/servico.cjs')

test('sessão visual do X preserva as imagens aprovadas até o recibo remoto', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-sessao-x-'))
  const midiasDir = path.join(dataDir, 'editorial/midias/teste')
  fs.mkdirSync(midiasDir, { recursive: true })
  const arquivo = path.join(midiasDir, 'cena.png')
  fs.writeFileSync(arquivo, 'imagem aprovada')
  let envios = 0
  const perfilUrl = 'https://x.com/example_user'
  const driver = {
    disponivel: async () => 'livre',
    verificar: async () => ({ sessao: 'autenticada', contaVerificada: { perfilUrl, nome: 'Lucas' } }),
    preparar: async (entrada) => ({ preparado: true, midias: entrada.midias.length }),
    enviar: async (entrada) => { envios++; return { id: '123', url: `${perfilUrl}/status/123`, perfilUrl, texto: entrada.texto, midias: entrada.midias.length } },
    consultar: async () => ({}),
    importar: async () => ({ importados: 1 }),
  }
  const servico = criarServicoSessoes({ dataDir, conta: 'x', driver, now: () => 1000 })
  t.after(() => { servico.fechar(); fs.rmSync(dataDir, { recursive: true, force: true }) })
  await servico.vincular({ perfilUrl })
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex')
  const proposta = servico.preparar({ texto: 'Texto aprovado', formato: 'imagem', midias: [{ id: 'm1', tipo: 'imagem', arquivo: 'midias/teste/cena.png', sha256 }] })
  const job = servico.confirmar(proposta)
  assert.equal(job.estado, 'aguardando_executor')
  assert.equal(envios, 0)
  await servico.processar()
  assert.equal(envios, 1)
  assert.equal(servico.obterJob(job.id).estado, 'publicado')
  assert.equal(servico.obterJob(job.id).recibo.url, `${perfilUrl}/status/123`)
})
