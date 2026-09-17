const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { resolverDiretorios } = require('../electron/lib-sumario-diario.cjs')
const { candidatosDeRepositorio } = require('../electron/lib-executor-nativo.cjs')

test('sumário usa XDG no Linux e preserva AppData quando informado', () => {
  const home = path.join(os.tmpdir(), 'dailywork-home-xdg')
  const explicito = resolverDiretorios({
    appRoot: path.join(home, 'app'),
    homeDir: home,
    appDataDir: path.join(home, 'appdata'),
    localAppDataDir: path.join(home, 'local'),
    programDataDir: path.join(home, 'programdata'),
  })
  assert.equal(explicito.appDataDir, path.resolve(home, 'appdata'))
  assert.equal(explicito.localAppDataDir, path.resolve(home, 'local'))

  if (process.platform === 'win32') return
  const padrao = resolverDiretorios({
    appRoot: path.join(home, 'app'),
    homeDir: home,
  })
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  const dados = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  assert.equal(padrao.appDataDir, path.resolve(config))
  assert.equal(padrao.localAppDataDir, path.resolve(dados))
  assert.equal(padrao.programDataDir, path.resolve('/usr/share'))
})

test('candidatos de repositório incluem o equivalente Linux de C:/Projetos', () => {
  const projetos = '/home/user/Projects'
  const candidatos = candidatosDeRepositorio('C:\\Projetos\\DailyWork\\Daily Work app', projetos)
  assert.ok(candidatos.includes('C:\\Projetos\\DailyWork\\Daily Work app'))
  if (process.platform !== 'win32') {
    assert.ok(candidatos.includes(path.join(projetos, 'DailyWork', 'Daily Work app')))
  }
})
