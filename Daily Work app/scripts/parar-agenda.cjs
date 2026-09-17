#!/usr/bin/env node
// By default only lists the scope. --execute persists a global pause and waits for domain cancellation.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
async function main(){
 const base=process.env.DAILYWORK_USER_DATA_DIR||path.join(os.homedir(),'.config/DailyWork')
 const candidato=[path.join(base,'api-local.json'),path.join(os.homedir(),'.config/dailywork/api-local.json')].find(p=>fs.existsSync(p))
 if(!candidato)throw new Error('Abra o DailyWork para parar a agenda pela API autenticada.')
 const {baseUrl,token}=JSON.parse(fs.readFileSync(candidato,'utf8')),url=new URL(baseUrl)
 if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('A API precisa estar em loopback.')
 async function op(acao,entrada){const r=await fetch(`${url.origin}/api/v1/operacoes/agenda/${acao}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({args:[entrada]}),signal:AbortSignal.timeout(30000)});const v=await r.json();if(!v.ok)throw new Error(v.erro?.mensagem||'Falha na API.');return v.data}
 const antes=await op('estado',{})
 if(!process.argv.includes('--execute'))return console.log(JSON.stringify({executado:false,ativas:antes.ocorrencias.filter(o=>o.estado==='executando').map(o=>({id:o.id,nome:o.nome,referencia:o.referencia})),instrucao:'--execute desliga a recorrência de todos os módulos e encerra os executores associados.'},null,2))
 for(const r of antes.rotinas)await op('configurar',{id:r.id,revisao:r.revisao,ativa:false})
 await op('controlar',{modulo:'todos',acao:'pausar_hoje'})
 const depois=await op('estado',{}),ativas=depois.ocorrencias.filter(o=>o.estado==='executando')
 console.log(JSON.stringify({executado:true,ativas:ativas.map(o=>({id:o.id,nome:o.nome})),pausada:depois.rotinas.every(r=>r.pausada&&!r.ativa)},null,2))
 if(ativas.length)process.exitCode=1
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1})
