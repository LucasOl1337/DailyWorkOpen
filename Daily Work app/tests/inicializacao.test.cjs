const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const root = path.resolve(__dirname, '..')

test('entrada Electron é JavaScript válido antes de abrir uma janela', () => {
  const filename = path.join(root, 'electron/main.cjs')
  assert.doesNotThrow(() => new vm.Script(fs.readFileSync(filename, 'utf8'), {filename}))
})
test('build instalada resolve scripts e estilos pelo protocolo file do Electron', {skip:!fs.existsSync(path.join(root,'dist/index.html'))}, () => {
  const dist = path.join(root, 'dist')
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
  const assets = [...html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g)].map(m=>m[1])
  assert.ok(assets.length >= 2)
  for(const asset of assets){
    assert.ok(asset.startsWith('./'), `Asset não é relativo ao index.html: ${asset}`)
    assert.ok(fs.existsSync(path.join(dist,asset)), `Asset ausente: ${asset}`)
  }
})

test('Electron abre Hoje usando a build instalada e dados isolados', {skip:process.env.DAILYWORK_E2E!=='1',timeout:45000}, async t=>{
  const tmp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'dw-startup-'))
  const env={...process.env,DAILYWORK_DATA_DIR:path.join(tmp,'data'),DAILYWORK_USER_DATA_DIR:path.join(tmp,'userData'),DAILYWORK_SESSOES_DIR:path.join(tmp,'sessoes'),LUCAS_KNOWLEDGE_DIR:path.join(tmp,'knowledge'),LUCASOL_DIR:path.join(tmp,'LucasOL'),DAILYWORK_CAPTURE_PATH:path.join(tmp,'capture.png'),DAILYWORK_CAPTURE_HOLD:'1',DAILYWORK_CAPTURE_VIEW:'hoje',DAILYWORK_API_DISABLED:'1'}
  delete env.ELECTRON_RUN_AS_NODE
  fs.mkdirSync(env.LUCASOL_DIR,{recursive:true})
  let app
  t.after(async()=>{await app?.close();fs.rmSync(tmp,{recursive:true,force:true})})
  app=await require('playwright-core')._electron.launch({executablePath:require('electron'),args:[path.join(root,'electron/main.cjs'),'--ozone-platform=x11'],env,timeout:20000})
  const page=await app.firstWindow(),errors=[],failed=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('requestfailed',r=>failed.push(r.url()))
  await page.getByRole('heading',{name:/^Hoje/}).waitFor()
  await page.getByRole('button',{name:'Rotinas e horários',exact:true}).waitFor()
  await page.getByText('Lendo o estado dos módulos…',{exact:true}).waitFor({state:'hidden'})
  assert.ok(page.url().startsWith('file:'))
  assert.deepEqual(errors,[])
  assert.deepEqual(failed,[])
  if(process.env.DW_SMOKE_SCREENSHOT)await page.screenshot({path:process.env.DW_SMOKE_SCREENSHOT})
})
