export interface RotinaAgenda {
 id:string;nome:string;modulo:string;tipo:string;ativa:boolean;dias:number[];horarios:string[];intervalo:number|null;fuso:string;fim:string
 metaDiaria:number;quantidade:number;minutos:number;tentativas:number;perfilId:string;executor:string;fontes:string[];contas:string[];idiomas:string[];estoqueAlvo?:number;revisao:number;pausada:boolean;proxima:number|null;uso:{realizado:number;tokens:number}
}
export interface OcorrenciaAgenda {id:string;rotina:string;modulo:string;nome:string;tipo:string;dia:string;prevista:number;estado:string;codigo?:string;tentativas:number;tokens:number;realizado:number;versoes?:number;mensagem:string;iniciadaEm?:number;atualizadaEm:number;tentarEm?:number;referencia?:{id?:string;itens?:string[]};decisao?:{resumo:string;interpretacao?:string;justificativa?:string;briefing?:string;fontesUsadas?:string[]};bloqueios?:{id:string;motivo:string}[];eventos?:{em:string;tipo:string;codigo?:string}[]}
export interface OrientacaoAgenda {escopo:string;dia:string;texto:string;revisao:number}
export interface EstadoAgenda {dia:string;servico:{ativo:boolean;ultimaVerificacao:number|null};rotinas:RotinaAgenda[];ocorrencias:OcorrenciaAgenda[];orientacoes:OrientacaoAgenda[]}
declare global {interface Window {agendaApi?:{operar:(acao:string,entrada?:unknown)=>Promise<{ok:boolean;data?:unknown;erro?:{mensagem:string}}>}}}
export async function agenda<T>(acao:string,entrada?:unknown):Promise<T>{
 const r=window.agendaApi?await window.agendaApi.operar(acao,entrada):await fetch('/api/agenda/'+acao,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entrada})}).then(r=>r.json())
 if(!r.ok)throw new Error(r.erro?.mensagem||'A agenda não respondeu.')
 return r.data as T
}

export function ultimasOcorrencias(ocorrencias: OcorrenciaAgenda[]) {
 const ultimas = new Map<string, OcorrenciaAgenda>()
 for (const o of ocorrencias) {
  if(o.estado === 'agendada')continue
  const anterior=ultimas.get(o.rotina)
  if(!anterior || (o.atualizadaEm || o.prevista) > (anterior.atualizadaEm || anterior.prevista))ultimas.set(o.rotina,o)
 }
 return [...ultimas.values()]
}
