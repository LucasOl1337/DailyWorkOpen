const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')}\n${result.stderr}`)
  }
  return result.stdout
}

function stagedNames(cwd) {
  return git(cwd, ['diff', '--cached', '--name-only'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort()
}

test('gitignore blocks git add of conversas.json; git add -f stages the current day; siblings stay addable', (t) => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dailywork-conversas-git-'))
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }))

  git(raiz, ['init', '-q'])
  git(raiz, ['config', 'user.email', 'test@example.com'])
  git(raiz, ['config', 'user.name', 'test'])

  const appDir = path.join(raiz, 'Daily Work app')
  const dayDir = path.join(appDir, 'data', 'sumarios', '2099-12-31')
  fs.mkdirSync(dayDir, { recursive: true })
  fs.copyFileSync(path.join(__dirname, '..', '.gitignore'), path.join(appDir, '.gitignore'))
  fs.writeFileSync(path.join(dayDir, 'conversas.json'), '{"note":"current-day dump"}\n')
  fs.writeFileSync(path.join(dayDir, 'resumo.json'), '{"note":"index"}\n')
  fs.writeFileSync(path.join(dayDir, 'inputs.json'), '{"note":"inputs"}\n')
  fs.mkdirSync(path.join(appDir, 'data', 'editorial'), { recursive: true })
  fs.writeFileSync(path.join(appDir, 'data', 'editorial', 'midia-config.json'), '{"fila":true}\n')

  git(raiz, ['add', 'Daily Work app/data/sumarios/2099-12-31', 'Daily Work app/data/editorial/midia-config.json'])
  assert.deepEqual(stagedNames(raiz), [
    'Daily Work app/data/editorial/midia-config.json',
    'Daily Work app/data/sumarios/2099-12-31/inputs.json',
    'Daily Work app/data/sumarios/2099-12-31/resumo.json',
  ])

  const ignored = git(raiz, [
    'check-ignore',
    '-v',
    '--',
    'Daily Work app/data/sumarios/2099-12-31/conversas.json',
  ])
  assert.match(ignored, /data\/sumarios\/\*\*\/conversas\.json/)

  git(raiz, ['add', '-A', '--', 'Daily Work app/data/sumarios/2099-12-31'])
  assert.equal(
    stagedNames(raiz).includes('Daily Work app/data/sumarios/2099-12-31/conversas.json'),
    false
  )

  git(raiz, ['add', '-f', 'Daily Work app/data/sumarios/2099-12-31/conversas.json'])
  assert.ok(
    stagedNames(raiz).includes('Daily Work app/data/sumarios/2099-12-31/conversas.json')
  )
})
