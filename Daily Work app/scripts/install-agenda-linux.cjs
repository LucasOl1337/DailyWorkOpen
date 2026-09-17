#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process')
function quote(v){return '"'+v.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"'}
function processosAnteriores(electron,proc='/proc'){
 return fs.readdirSync(proc).filter(n=>/^\d+$/.test(n)).flatMap(n=>{try{
  const cmd=fs.readFileSync(path.join(proc,n,'cmdline'),'utf8').replaceAll('\0',' ')
  return fs.readlinkSync(path.join(proc,n,'exe'))===electron&&!/(?:^|\s)--type(?:=|\s|$)/.test(cmd)?[Number(n)]:[]
 }catch{return []}})
}
async function verificarAgenda(home=os.homedir()){
 const pid=Number(execFileSync('systemctl',['--user','show','dailywork.service','--property=MainPID','--value'],{encoding:'utf8'}))
 for(const nome of ['dailywork','DailyWork'])try{
  const c=JSON.parse(fs.readFileSync(path.join(home,'.config',nome,'api-local.json'),'utf8')),url=new URL(c.baseUrl)
  if(c.pid!==pid||url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))continue
  const r=await fetch(url.origin+'/api/v1/operacoes/agenda/estado',{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify({args:[{}]}),signal:AbortSignal.timeout(2000)})
  const v=await r.json()
  if(v.ok&&v.data?.servico?.ativo&&Date.now()-v.data.servico.ultimaVerificacao<60000)return true
 }catch{}
 return false
}
function configuracao({root=path.resolve(__dirname,'..'),home=os.homedir(),node=process.execPath}={}){
 const electron=path.join(root,'node_modules/electron/dist/electron')
 const unidade=`[Unit]\nDescription=DailyWork — agenda e aplicativo em segundo plano\nAfter=graphical-session.target\nPartOf=graphical-session.target\nStartLimitIntervalSec=120\nStartLimitBurst=5\n\n[Service]\nType=simple\nWorkingDirectory=${root.replaceAll('%','%%')}\nExecStart=${quote(electron)} ${quote(root)} --background\nRestart=on-failure\nRestartSec=10\nTimeoutStopSec=20\nKillMode=mixed\nEnvironment=${quote('PATH='+[path.dirname(node),path.join(home,'.local/bin'),'/usr/local/bin','/usr/bin','/bin'].join(':'))}\n\n[Install]\nWantedBy=graphical-session.target\n`
 const hook='#!/usr/bin/env bash\nset -euo pipefail\nsystemctl --user import-environment DISPLAY WAYLAND_DISPLAY XDG_CURRENT_DESKTOP\nsystemctl --user start dailywork.service\n'
 return {root,electron,unidade,hook,unitPath:path.join(home,'.config/systemd/user/dailywork.service'),hookPath:path.join(home,'.config/omarchy/hooks/post-boot.d/dailywork-agenda'),autostart:path.join(home,'.config/hypr/autostart.lua')}
}
async function instalar({execute=false,activate=false,force=false,...opts}={}){
 if(activate&&!force){
  // Reiniciar o serviço mata a rodada de candidaturas em andamento e o que você digitou na tela.
  try{const s=require('../electron/lib-candidaturas.cjs').criarServicoCandidaturas({});try{const ativa=s.estado().missoes.find(m=>['iniciando','executando'].includes(m.estado));if(ativa)throw Object.assign(new Error(`Há uma missão de candidaturas em execução (${ativa.criterios.termos}). Espere terminar ou use --force para reiniciar mesmo assim.`),{codigo:'MISSAO_ATIVA'})}finally{s.close()}}
  catch(e){if(e.codigo==='MISSAO_ATIVA')throw e}
 }
 const c=configuracao(opts)
 if(!execute)return {executado:false,unidade:c.unitPath,hook:c.hookPath,ativacao:'Use --execute --activate para migrar e iniciar a agenda. Sem --activate, apenas instala os arquivos.'}
 if(!fs.existsSync(c.electron)||!fs.existsSync(path.join(c.root,'dist/index.html')))throw new Error('Faça npm run build e confira a instalação do Electron antes de instalar a agenda.')
 for(const [file,body] of [[c.unitPath,c.unidade],...(activate?[[c.hookPath,c.hook]]:[])]){fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file))fs.copyFileSync(file,file+'.bak.'+Date.now());fs.writeFileSync(file,body,{mode:file===c.hookPath?0o700:0o600})}
 execFileSync('systemd-analyze',['--user','verify',c.unitPath],{stdio:'pipe'})
 execFileSync('systemctl',['--user','daemon-reload'])
 if(!activate)return {executado:true,ativo:false,unidade:c.unitPath,observacao:'Serviço instalado; ativação e migração ainda não executadas.'}
 let timerAtivo=false
 try{timerAtivo=execFileSync('systemctl',['--user','is-enabled','cognition-campanha.timer'],{encoding:'utf8'}).trim()==='enabled'}catch{}
 const pids=processosAnteriores(c.electron)
 try{
  if(timerAtivo)execFileSync('systemctl',['--user','disable','--now','cognition-campanha.timer'])
  if(fs.existsSync(c.autostart)){
   const texto=fs.readFileSync(c.autostart,'utf8');fs.copyFileSync(c.autostart,c.autostart+'.bak.'+Date.now())
   const inicio='-- DailyWork (managed by scripts/install-linux.sh)',fim='-- End DailyWork',a=texto.indexOf(inicio),b=texto.indexOf(fim)
   if(a>=0&&b>a)fs.writeFileSync(c.autostart,texto.slice(0,a)+inicio+'\no.launch_on_start("systemctl --user start dailywork.service")\n'+texto.slice(b))
  }
  for(const pid of pids)try{process.kill(pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')throw e}
  const limite=Date.now()+20000
  while(pids.some(pid=>fs.existsSync(`/proc/${pid}`))&&Date.now()<limite)await new Promise(r=>setTimeout(r,200))
  if(pids.some(pid=>fs.existsSync(`/proc/${pid}`)))throw new Error('A instância anterior não encerrou; nenhum SIGKILL foi enviado.')
  execFileSync('systemctl',['--user','import-environment','DISPLAY','WAYLAND_DISPLAY','XDG_CURRENT_DESKTOP'])
  execFileSync('systemctl',['--user','enable','--now','dailywork.service'])
  await new Promise(r=>setTimeout(r,1500))
  execFileSync('systemctl',['--user','is-active','--quiet','dailywork.service'])
  const prazoSaude=Date.now()+15000
  while(!await verificarAgenda(opts.home)&&Date.now()<prazoSaude)await new Promise(r=>setTimeout(r,500))
  if(!await verificarAgenda(opts.home))throw new Error('O processo iniciou, mas a API da agenda não ficou saudável. Confira journalctl --user -u dailywork.service.')
  return {executado:true,ativo:true,timerAnteriorMigrado:timerAtivo}
 }catch(e){
  // Never restore the old timer while the new coordinator may still run.
  execFileSync('systemctl',['--user','stop','dailywork.service'])
  if(timerAtivo)execFileSync('systemctl',['--user','enable','--now','cognition-campanha.timer'])
  throw e
 }
}
if(require.main===module)instalar({execute:process.argv.includes('--execute'),activate:process.argv.includes('--activate'),force:process.argv.includes('--force')}).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1})
module.exports={configuracao,instalar,processosAnteriores,verificarAgenda}
