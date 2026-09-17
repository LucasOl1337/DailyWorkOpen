const { DatabaseSync } = require('node:sqlite')
const { local, falha } = require('./servico.cjs')
// Workers read the current authority before an action; stale prompts cannot undo a pause.
function conferir(vinculo) {
  if (!vinculo) return null
  const db=new DatabaseSync(vinculo.arquivo,{readOnly:true})
  try {
    const ownerRow=db.prepare('SELECT data FROM coordenador WHERE id=1').get()
    const owner=ownerRow&&JSON.parse(ownerRow.data)
    let inicio
    try{inicio=require('node:fs').readFileSync(`/proc/${owner?.pid}/stat`,'utf8').split(') ')[1].split(' ')[19]}catch{}
    if(!owner||!inicio||inicio!==owner.inicio||Date.now()-owner.em>120000)throw falha('COORDENADOR_INDISPONIVEL','O coordenador não está respondendo; aguardando recuperação antes de agir.')
    const row=db.prepare('SELECT data FROM ocorrencias WHERE id=?').get(vinculo.id)
    if(!row)throw falha('AGENDA_PAUSADA','A atividade não existe mais.')
    const o=JSON.parse(row.data),r=JSON.parse(db.prepare('SELECT data FROM rotinas WHERE id=?').get(o.rotina).data),l=local(Date.now(),r.fuso)
    if(o.estado!=='executando'||(!r.ativa&&!o.avulsa)||db.prepare("SELECT 1 FROM pausas WHERE escopo IN ('todos',?,?) AND dia IN (?, '*')").get(r.modulo,r.id,l.dia))throw falha('AGENDA_PAUSADA','Atividade pausada pela agenda.')
    if(o.dia!==l.dia||(!o.manual&&l.hora>r.fim)||(!o.ateMeta&&Date.now()>o.iniciadaEm+r.minutos*60000))throw falha('JANELA_ENCERRADA','Janela de execução encerrada.')
    const instrucoes=db.prepare("SELECT data FROM instrucoes WHERE dia=? AND escopo IN ('todos',?) ORDER BY escopo='todos' DESC").all(o.dia,r.modulo).map(v=>JSON.parse(v.data))
    if(instrucoes.map(i=>`${i.escopo}:${i.revisao}`).join('|')!==o.instrucaoRevisao)throw falha('ORIENTACAO_ALTERADA','As orientações do dia mudaram.')
    return {o,r,instrucoes}
  } finally {db.close()}
}
function ambiente(){return process.env.DAILYWORK_AGENDA_ID?{id:process.env.DAILYWORK_AGENDA_ID,arquivo:process.env.DAILYWORK_AGENDA_DB}:null}
module.exports={conferir,ambiente}
