export interface CriteriosCandidatura {
  termos: string; area: 'ambas'|'software'|'ai'; modalidade: 'remoto'|'hibrido'|'presencial'|'qualquer'; localidade: string
  origem: 'qualquer'|'ats_externo'|'linkedin_easy_apply'
  senioridades: string[]; contratacoes: string[]; salarioMin: number|null; salarioMax: number|null; moeda: 'BRL'|'USD'|'EUR'; periodo: 'mes'|'ano'|'hora'; aceitarSemSalario: boolean
  idioma: 'auto'|'pt'|'en'; excluirEmpresas: string[]; meta: number; minutos: number; perfil: string; executor: 'nativo'|'codex'
}
export interface ContagemCandidaturas {selecionadas:number;confirmadas:number;emAndamento:number;impedidas:number;descartadas:number}
export interface AtividadeCandidaturas {ferramenta:string;acao:string;em:string;candidatura:{id:string;empresa:string;cargo:string;estado:string;proximaAcao:string}|null}
export interface ProgressoCandidaturas {hoje:ContagemCandidaturas;execucao:ContagemCandidaturas;total:ContagemCandidaturas;atividadeAtual:AtividadeCandidaturas|null;eventosRecentes:{ferramenta:string;acao:string;em:string}[]}
export interface AtencaoCandidaturas {codigo:string;titulo:string;acao:string;automatica:boolean;motivo?:string}
export interface MissaoCandidatura { id: string; estado: string; criterios: CriteriosCandidatura; criadaEm: string; limite: string; confirmadas: number; motivo: string|null; interrupcao?:{codigo:string|null;em:string}|null; atencao?:AtencaoCandidaturas|null; agenda?:{id?:string;metaInicial?:number;limiteDiario?:number}; progresso?:ProgressoCandidaturas; supervisor?: {estado:string;modelo?:string;provider?:string;ciclos:number;acoes:number;tokensEntrada:number;tokensSaida:number;ultimaAcao?:string;iniciadoEm?:string;atualizadoEm:string;erro?:string;checkpoint?:string;fontesEsgotadas?:Record<string,string>|null;atividadeAtual?:{ferramenta:string;acao:string;candidaturaId?:string|null;em:string};eventosRecentes?:{ferramenta:string;acao:string;em:string}[]} }
export interface PendenciaPergunta {pergunta:string;respondivel:boolean;sugestoes?:string[];candidaturas:{id:string;empresa:string;cargo:string;restantes?:number;total?:number}[]}
export interface PendenciaAcesso {codigo:string;titulo:string;acao:string;automatica:boolean;candidaturas:{id:string;empresa:string;cargo:string;motivo:string}[]}
export interface RespostaRecorrente {pergunta:string;resposta:string;em:string}
export interface EvidenciaCandidatura {id:string;etapa:string;em:string;texto:string;url:string;dataUrl?:string}
export interface Candidatura { id:string;missaoId:string;url:string;empresa:string;cargo:string;estado:string;foco:string;idioma:string;criadaEm:string;atualizadaEm?:string;criterios:CriteriosCandidatura;qualificacao:{motivo:string};cv:{nome:string;sha256:string;caminho:string};campos:{pergunta:string;resposta:string;fonte:string}[];proximaAcao:string;confirmacao:{em:string;texto:string}|null;evidencias?:EvidenciaCandidatura[];eventos?:{tipo:string;em:string;proximaAcao?:string}[] }
export interface EstadoCandidaturas {preferencias:CriteriosCandidatura;missoes:MissaoCandidatura[];candidaturas:Candidatura[];pendencias?:{perguntas:PendenciaPergunta[];acessos:PendenciaAcesso[]};respostas?:RespostaRecorrente[]}
declare global {interface Window {candidaturasApi?:{operar:(acao:string,entrada?:unknown)=>Promise<{ok:boolean;data?:unknown;erro?:{mensagem:string}}>}}}
export async function candidaturas<T>(acao:string,entrada?:unknown):Promise<T>{
 const resposta=window.candidaturasApi ? await window.candidaturasApi.operar(acao,entrada) : await fetch('/api/candidaturas/'+acao,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entrada})}).then(r=>r.json())
 if(!resposta.ok)throw new Error(resposta.erro?.mensagem || 'Não foi possível concluir a operação.')
 return resposta.data as T
}
export interface LocalidadeParsed {
  brasil: boolean
  eua: boolean
  ue: boolean
  semRestricao: boolean
  outros: string
}
export function parseLocalidades(valor: string | undefined | null): LocalidadeParsed {
  const v = (valor || '').trim()
  if (!v || /^(sem restri[cç][aã]o|qualquer|qualquer pa[ií]s|sem restri[cç][aã]o por pa[ií]s)$/i.test(v)) {
    return { brasil: false, eua: false, ue: false, semRestricao: true, outros: '' }
  }
  const partes = v.split(/[,;]/).map(s => s.trim()).filter(Boolean)
  let brasil = false, eua = false, ue = false, semRestricao = false
  const outrosList: string[] = []
  for (const p of partes) {
    if (/^(brasil|brazil)$/i.test(p)) brasil = true
    else if (/^(estados unidos|eua|usa|united states)$/i.test(p)) eua = true
    else if (/^(pa[ií]ses da uni[aã]o europ[eé]ia|pa[ií]ses da uni[aã]o europeia|uni[aã]o europ[eé]ia|uni[aã]o europeia|ue|eu|european union)$/i.test(p)) ue = true
    else if (/^(sem restri[cç][aã]o|qualquer|qualquer pa[ií]s|sem restri[cç][aã]o por pa[ií]s)$/i.test(p)) semRestricao = true
    else outrosList.push(p)
  }
  if (semRestricao || (!brasil && !eua && !ue && outrosList.length === 0)) {
    return { brasil: false, eua: false, ue: false, semRestricao: true, outros: '' }
  }
  return { brasil, eua, ue, semRestricao: false, outros: outrosList.join(', ') }
}
export function serializeLocalidades(p: LocalidadeParsed): string {
  if (p.semRestricao) return 'Sem restrição por país'
  const lista: string[] = []
  if (p.brasil) lista.push('Brasil')
  if (p.eua) lista.push('Estados Unidos')
  if (p.ue) lista.push('Países da União Europeia')
  if (p.outros && p.outros.trim()) lista.push(p.outros.trim())
  if (lista.length === 0) return 'Sem restrição por país'
  return lista.join(', ')
}
