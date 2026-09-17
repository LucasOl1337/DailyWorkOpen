const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { localizarBin } = require('../automacoes/executores.cjs')
function inicioProcesso(pid) { try { return fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ')[19] } catch { return null } }
function lancarMissao({missao,repoRoot,privateDir}) {
  const nativo = missao.criterios.executor === 'nativo'
  if(!nativo&&!localizarBin('codex'))throw new Error('Codex CLI não está instalado neste computador.')
  const pasta=path.join(privateDir,'missoes',missao.id);fs.mkdirSync(pasta,{recursive:true,mode:0o700})
  const log=fs.openSync(path.join(pasta,'executor.log'),'a',0o600)
  try {
    const child=spawn(process.execPath,[path.join(__dirname,nativo?'worker-nativo.cjs':'worker.cjs'),privateDir,missao.id,repoRoot],{cwd:repoRoot,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',AGENT_BENCH_OWNER:'dailywork',...(missao.agenda?{DAILYWORK_AGENDA_ID:missao.agenda.id,DAILYWORK_AGENDA_DB:missao.agenda.arquivo}:{})},detached:true,stdio:['ignore',log,log]})
    child.on('error',()=>{});child.unref()
    if(!child.pid)throw new Error('Não foi possível iniciar o executor de candidaturas.')
    return {tipo:nativo?'nativo':'codex-cli',pid:child.pid,inicio:inicioProcesso(child.pid),log:path.join(pasta,'executor.log')}
  } finally {fs.closeSync(log)}
}
function processosMissao(execucao){
 if(!execucao?.pid||!execucao.inicio||inicioProcesso(execucao.pid)!==execucao.inicio)return []
 return fs.readdirSync('/proc').filter(n=>/^\d+$/.test(n)).flatMap(n=>{try{const dados=fs.readFileSync(`/proc/${n}/stat`,'utf8').split(') ')[1].split(' ');return Number(dados[2])===execucao.pid&&dados[0]!=='Z'?[{pid:Number(n),inicio:dados[19]}]:[]}catch{return []}})
}
function pararMissao(execucao) {
 const processos=processosMissao(execucao);if(!processos.length)return {restantes:0}
 try{process.kill(-execucao.pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')throw e}
 const vivo=p=>inicioProcesso(p.pid)===p.inicio
 const ate=Date.now()+1500
 while(Date.now()<ate&&processos.some(vivo))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50)
 for(const p of processos.filter(vivo))try{process.kill(p.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}
 return {sinalizados:processos.map(p=>p.pid)}
}
module.exports={lancarMissao,pararMissao,inicioProcesso,processosMissao}
