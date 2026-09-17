const {AsyncLocalStorage}=require('node:async_hooks')
const {DatabaseSync}=require('node:sqlite')
const contexto=new AsyncLocalStorage()
function vinculo(){return contexto.getStore()||require('./guarda.cjs').ambiente()}
function antes(){const v=vinculo();if(v)require('./guarda.cjs').conferir(v)}
function registrar(uso){
 const v=vinculo();if(!v)return
 const n=Number(uso?.prompt_tokens||uso?.input_tokens||0)+Number(uso?.completion_tokens||uso?.output_tokens||0)
 if(!n)return
 const db=new DatabaseSync(v.arquivo)
 try{db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');const row=db.prepare('SELECT data FROM ocorrencias WHERE id=?').get(v.id);if(row){const o=JSON.parse(row.data);o.tokens=(o.tokens||0)+n;db.prepare('UPDATE ocorrencias SET data=? WHERE id=?').run(JSON.stringify(o),o.id)}db.exec('COMMIT')}catch(e){try{db.exec('ROLLBACK')}catch{}throw e}finally{db.close()}
}
module.exports={contexto,antes,registrar,vinculo}
