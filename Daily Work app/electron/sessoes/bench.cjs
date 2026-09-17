// Canal local da bancada: o hub segura a trava humana durante TODO o comando.
const net = require('node:net')
const path = require('node:path')
const os = require('node:os')

const NOME = 'dailywork-redes'
const runtime = () => path.join('/run/user', String(process.getuid()), 'agent-bench', NOME)
function rpc(entrada, timeout = 55_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path.join(runtime(), 'control.sock'))
    let dados = ''
    let terminou = false
    const fim = (erro, valor) => {
      if (terminou) return
      terminou = true
      socket.destroy()
      erro ? reject(erro) : resolve(valor)
    }
    socket.setTimeout(timeout, () =>
      fim(Object.assign(new Error('A bancada não respondeu.'), { codigo: 'BANCADA_TIMEOUT' })),
    )
    socket.on('error', () =>
      fim(Object.assign(new Error('Bancada dailywork-redes indisponível.'), { codigo: 'BANCADA_OFFLINE' })),
    )
    socket.on('connect', () => socket.write(JSON.stringify(entrada) + '\n'))
    socket.on('end', () => fim(Object.assign(new Error('A bancada encerrou a resposta.'), { codigo: 'BANCADA_OFFLINE' })))
    socket.on('data', (chunk) => {
      dados += chunk
      if (dados.length > 12 * 1024 * 1024) return fim(new Error('Resposta da bancada excedeu o limite.'))
      if (!dados.includes('\n')) return
      try {
        const resposta = JSON.parse(dados.split('\n')[0])
        if (resposta.error)
          return fim(
            Object.assign(
              new Error(
                /humano/i.test(resposta.error)
                  ? 'O humano assumiu a bancada.'
                  : 'A bancada recusou a operação.',
              ),
              { codigo: /humano/i.test(resposta.error) ? 'CONTROLE_HUMANO' : 'BANCADA_ERRO' },
            ),
          )
        fim(null, resposta)
      } catch {
        fim(new Error('Resposta inválida da bancada.'))
      }
    })
  })
}
function criarDriverBancada({ conta = 'linkedin' } = {}) {
  const rede = conta === 'x'
    ? { script: 'x-browser.cjs', dominios: ['x.com', 'twitter.com'], nome: 'X' }
    : { script: 'linkedin-browser.cjs', dominios: ['linkedin.com'], nome: 'LinkedIn' }
  async function executar(acao, entrada = {}) {
    const info = await rpc({ action: 'status' }, 3000)
    if (info.control_mode === 'humano')
      throw Object.assign(new Error('O humano assumiu a bancada.'), { codigo: 'CONTROLE_HUMANO' })
    const esperado = path.join(os.homedir(), '.agents/desktop/sessions', NOME)
    if (info.protocol_version < 2 || info.state !== esperado || info.display === ':0')
      throw new Error('Bancada fora do contrato de isolamento.')
    const resposta = await rpc({
      action: 'exec',
      argv: [
        '/usr/bin/env',
        'ELECTRON_RUN_AS_NODE=1',
        process.execPath,
        path.join(__dirname, rede.script),
      ],
      cwd: path.join(__dirname, '../..'),
      timeout: conta === 'x' ? 90 : 45,
      input: JSON.stringify({ acao, ...entrada }),
    })
    let resultado
    try {
      resultado = JSON.parse(resposta.stdout)
    } catch {
      throw Object.assign(new Error('Driver de navegador não retornou um resultado válido.'), {
        codigo: 'DRIVER_ERRO',
      })
    }
    if (!resultado.ok)
      throw Object.assign(new Error(resultado.erro.mensagem), { codigo: resultado.erro.codigo })
    return resultado.data
  }
  return {
    async disponivel() {
      try {
        const info = await rpc({ action: 'status' }, 3000)
        return info.control_mode === 'humano' ? 'controle_humano' : 'livre'
      } catch {
        return 'offline'
      }
    },
    verificar: () => executar('verificar'),
    preparar: (entrada) => executar('preparar', entrada),
    enviar: (entrada) => executar('enviar', entrada),
    capturar: (entrada) => executar('capturar', entrada),
    descartar: () => executar('descartar'),
    consultar: (entrada) => executar('consultar', entrada),
    async importar() {
      // Ler o keyring no processo chamador, nunca no display da bancada.
      const { criarImportadorSessaoChromium } = require('../integracoes/sessao-chromium.cjs')
      const importador = criarImportadorSessaoChromium()
      const resultado = await importador.lerCookies(rede.dominios)
      if (!resultado.cookies.length)
        throw Object.assign(
          new Error(resultado.motivo || `Nenhuma sessão ${rede.nome} encontrada no Chromium instalado.`),
          { codigo: 'SEM_SESSAO' },
        )
      return executar('importar', { cookies: resultado.cookies })
    },
  }
}
module.exports = { criarDriverBancada, rpc, runtime }
