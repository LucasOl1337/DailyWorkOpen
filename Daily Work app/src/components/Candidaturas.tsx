import {useDestinoPagina,destacarSecao} from '../lib/destinos'
import {useCallback,useEffect,useRef,useState} from 'react'
import {candidaturas,type EstadoCandidaturas,type CriteriosCandidatura,type Candidatura,type EvidenciaCandidatura,type MissaoCandidatura,type PendenciaPergunta,type RespostaRecorrente,parseLocalidades,serializeLocalidades} from '../lib/candidaturas'
import type {Tom} from '../lib/estado-global'
import {Bloco,Botao,Chip,Faixa,Kpi,Pagina,Tabela,type Coluna} from './ui/ui'
import {ColunaDia} from './ui/ColunaDia'
import {AgendaModulo} from './AgendaModulo'
import './candidaturas.css'
const nomes:Record<string,string>={iniciando:'Iniciando',executando:'Rodando',bloqueada:'Parada',interrompida:'Interrompida',finalizada:'Rodada finalizada',concluida:'Meta atingida',pausada:'Pausada',encerrada:'Encerrada',reservada:'Na fila',preenchendo:'Preenchendo',pronta:'Pronta para envio',enviando:'Envio iniciado',a_verificar:'Envio a confirmar',aguardando_dado:'Precisa de você',aguardando_acesso:'Bloqueio de acesso',confirmada:'Comprovada',descartada:'Descartada'}
const tomEstado:Record<string,Tom>={reservada:'neutro',preenchendo:'ativo',pronta:'ativo',enviando:'info',a_verificar:'info',aguardando_dado:'atencao',aguardando_acesso:'atencao',confirmada:'ok',descartada:'neutro'}
const diaLocal=(v:string|Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date(v))
const quando=(v:string)=>new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})
const horaLocal=(v:string)=>new Date(v).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'})
const eventoMaisRecente=(c:Candidatura)=>[c.criadaEm,c.atualizadaEm,c.confirmacao?.em].filter(Boolean).sort((a,b)=>Date.parse(String(b))-Date.parse(String(a)))[0] as string
const emAndamento=new Set(['reservada','preenchendo','pronta','enviando','a_verificar'])
const LIMITE_LINKEDIN=/limite di[aá]rio|daily limit|candidatura simplificada/i
function descricaoAtividade(ferramenta?:string,acao?:string){
 const chave=`${ferramenta||''}:${acao||''}`
 const textos:Record<string,string>={'modelo:planejando':'Analisando vagas e decidindo o próximo passo','consultar:estado':'Conferindo meta e fila atual','consultar:legado':'Verificando se a vaga já foi trabalhada','consultar:carreira':'Consultando o perfil profissional aprovado','registrar:reservar':'Registrando uma vaga compatível','registrar:atualizar':'Atualizando o andamento do formulário','registrar:complementar':'Registrando uma etapa complementar','registrar:resultado':'Conferindo e registrando o resultado','navegador:abas':'Organizando as abas da rodada','navegador:abrir':'Abrindo uma vaga na bancada','navegador:navegar':'Avançando no processo da vaga','navegador:ler':'Lendo a etapa atual do formulário','navegador:preencher':'Preenchendo o formulário','navegador:digitar':'Preenchendo um campo do formulário','navegador:selecionar':'Selecionando uma resposta','navegador:anexar':'Anexando o currículo oficial','navegador:enviar':'Enviando a candidatura','capturar:':'Salvando uma captura de comprovação','checkpoint:':'Salvando o progresso da rodada'}
 return textos[chave]||textos[`${ferramenta||''}:`]||'Preparando o próximo passo da rodada'
}
// Próximo passo em uma linha: o que a vaga espera, sem o parágrafo técnico do executor.
function proximoPasso(c:Candidatura){
 if(c.estado==='aguardando_acesso'&&LIMITE_LINKEDIN.test(c.proximaAcao))return 'Volta amanhã (limite diário do LinkedIn)'
 if(c.estado==='confirmada')return 'Acompanhar retorno'
 const m=c.proximaAcao.match(/pede\s+(.+?)(?:\s+sem fonte|\.|;|$)/i)
 if(c.estado==='aguardando_dado'&&m)return 'Pergunta: '+m[1].replace(/\s*\([^)]*\)/g,'').slice(0,90)
 return c.proximaAcao.split(/(?<=[.!?])\s/)[0].slice(0,110)
}
export {useRelogio,haQuanto}
export function Candidaturas(){
 const [dados,setDados]=useState<EstadoCandidaturas|null>(null),[criterios,setCriterios]=useState<CriteriosCandidatura|null>(null),[aba,setAba]=useState('historico')
 const [detalhe,setDetalhe]=useState<Candidatura|null>(null),[imagem,setImagem]=useState<EvidenciaCandidatura|null>(null),[busca,setBusca]=useState(''),[erro,setErro]=useState(''),[aviso,setAviso]=useState(''),[ocupado,setOcupado]=useState(false)
 const [periodo,setPeriodo]=useState<'execucao'|'hoje'|'missao'>('hoje'),[situacao,setSituacao]=useState('todas'),[agendaAberta,setAgendaAberta]=useState(false)
 const vivo=useRef(true),alterado=useRef(false),selecionada=useRef<string|null>(null),lendo=useRef(false)
 useDestinoPagina('candidaturas',d=>{if(d.secao){setAba('historico');if(d.secao==='cand-historico'){setPeriodo('missao');setSituacao('todas')}destacarSecao(d.secao)}},Boolean(dados))
 const evidenciasRecentes=[...(detalhe?.evidencias||[])].reverse()
 const evidenciaPadraoId=(evidenciasRecentes.find(e=>e.etapa==='confirmacao')||evidenciasRecentes[0])?.id
 useEffect(()=>{setImagem(null);if(!evidenciaPadraoId)return;let cancelado=false;void candidaturas<EvidenciaCandidatura>('evidencia',evidenciaPadraoId).then(e=>{if(!cancelado)setImagem(e)}).catch(e=>{if(!cancelado)setErro(String(e))});return()=>{cancelado=true}},[detalhe?.id,evidenciaPadraoId])
 // O app reinicia com frequência (agenda, instaladores): o texto digitado na busca sobrevive à recarga.
 const RASCUNHO='dw.candidaturas.busca'
 const lerRascunho=()=>{try{return localStorage.getItem(RASCUNHO)||''}catch{return ''}}
 const gravarRascunho=(v:string)=>{try{if(v)localStorage.setItem(RASCUNHO,v);else localStorage.removeItem(RASCUNHO)}catch{}}
 const atualizar=useCallback(async()=>{if(lendo.current)return;lendo.current=true;try{const d=await candidaturas<EstadoCandidaturas>('estado');if(!vivo.current)return;setDados(d);if(!alterado.current){const rascunho=lerRascunho();if(rascunho&&rascunho!==d.preferencias.termos){alterado.current=true;setCriterios({...d.preferencias,executor:'nativo',termos:rascunho})}else setCriterios({...d.preferencias,executor:'nativo'})}if(selecionada.current){const c=await candidaturas<Candidatura>('obter',selecionada.current);if(vivo.current&&selecionada.current===c.id)setDetalhe(c)}}catch(e){if(vivo.current)setErro(e instanceof Error?e.message:'Falha ao consultar candidaturas.')}finally{lendo.current=false}},[])
 useEffect(()=>{vivo.current=true;void atualizar();const t=setInterval(()=>void atualizar(),4000);return()=>{vivo.current=false;clearInterval(t)}},[atualizar])
 async function agir(acao:string,entrada?:unknown){setOcupado(true);setErro('');setAviso('');try{const resposta=await candidaturas<{workspace?:number|null}>(acao,entrada);if(['configurar','reorientar','iniciar','reiniciar'].includes(acao))gravarRascunho('');if(acao==='configurar'){alterado.current=false;setAviso('Preferências salvas para as próximas missões.')}if(acao==='reorientar'){alterado.current=false;setAviso('Busca atualizada para as próximas vagas. Formulários em andamento preservados.')}if(acao==='iniciar'){alterado.current=false;setAba('rodada');setAviso('Missão iniciada. Resultados e impedimentos aparecem na tabela.')}if(acao==='reiniciar'){alterado.current=false;setAba('rodada');selecionada.current=null;setDetalhe(null);setAviso('Missão anterior encerrada. Nova missão iniciada agora com esta busca.')}if(acao==='responder'){const r=resposta as unknown as {reabertas?:string[]};setAviso(`Resposta salva${r.reabertas?.length?`; ${r.reabertas.length} vaga(s) voltaram pra fila`:''}.`)}if(acao==='reabrir')setAviso('Vaga reaberta. O agente retoma o formulário na próxima rodada.');if(acao==='controlar'&&(entrada as {acao?:string})?.acao==='completar_meta')setAviso('Execução contínua ativada até completar a meta de hoje ou até você pausar.')
 if(acao==='observar'){const atalho=resposta.workspace&&resposta.workspace<=10?`Super+${resposta.workspace===10?'0':resposta.workspace} pra acompanhar.`:'Abra “Bancada dos agentes” no lançador.';setAviso(`Bancada exibida${resposta.workspace?` no workspace ${resposta.workspace}`:''}. ${atalho}`)}window.dispatchEvent(new CustomEvent('dailywork:estado'));await atualizar()}catch(e){setErro(e instanceof Error?e.message:'Não foi possível concluir.')}finally{setOcupado(false)}}
 async function abrir(c:Candidatura){selecionada.current=c.id;setDetalhe(c);try{const v=await candidaturas<Candidatura>('obter',c.id);if(selecionada.current===v.id)setDetalhe(v)}catch(e){setErro(String(e))}}
 function fecharDetalhe(){selecionada.current=null;setDetalhe(null);setImagem(null)}
 async function verImagem(e:EvidenciaCandidatura){const candidaturaId=selecionada.current;try{const v=await candidaturas<EvidenciaCandidatura>('evidencia',e.id);if(selecionada.current===candidaturaId)setImagem(v)}catch(err){if(selecionada.current===candidaturaId)setErro(String(err))}}
 function mudar<K extends keyof CriteriosCandidatura>(chave:K,valor:CriteriosCandidatura[K]){alterado.current=true;if(chave==='termos')gravarRascunho(String(valor));setCriterios(c=>c?{...c,[chave]:valor}:c)}
 const ativa=dados?.missoes.find(m=>['iniciando','executando'].includes(m.estado)),ultima=ativa||dados?.missoes[0]
 const viva=Boolean(ultima&&!['concluida','encerrada'].includes(ultima.estado)),retomavel=Boolean(ultima&&['pausada','bloqueada','interrompida','finalizada'].includes(ultima.estado))
 const hoje=diaLocal(new Date())
 const confirmadasHoje=(dados?.candidaturas||[]).filter(c=>c.confirmacao&&diaLocal(c.confirmacao.em)===hoje).length
 const inicioExecucao=Date.parse(ultima?.supervisor?.iniciadoEm||''),candidaturaAtual=ultima?.progresso?.atividadeAtual?.candidatura
 const metaDiaria=ultima?.agenda?.limiteDiario||criterios?.meta||0,progressoHoje=ultima?.progresso?.hoje
 const perguntas=(dados?.pendencias?.perguntas||[]).filter(p=>p.respondivel),acessos=dados?.pendencias?.acessos||[]
 const vagasPresas=new Set(perguntas.flatMap(p=>p.candidaturas.map(c=>c.id))).size
 const acessosHumanos=acessos.filter(a=>!a.automatica),linkedinEsgotado=acessos.find(a=>a.codigo==='linkedin_limite')
 const atencao=ultima?.atencao
 async function continuarPorAts(){
  if(!ultima||!criterios)return
  setOcupado(true);setErro('');setAviso('')
  try{
   if(['iniciando','executando'].includes(ultima.estado))await candidaturas('controlar',{id:ultima.id,acao:'pausar'})
   const externos={...criterios,origem:'ats_externo' as const}
   await candidaturas('reorientar',{id:ultima.id,criterios:externos})
   await candidaturas('controlar',{id:ultima.id,acao:'retomar',executor:'nativo'})
   alterado.current=false;gravarRascunho('');setCriterios(externos);setAba('rodada')
   setAviso('Missão retomada em ATS externo. Easy Apply foi excluído desta busca; formulários e comprovantes anteriores foram preservados.')
   window.dispatchEvent(new CustomEvent('dailywork:estado'));await atualizar()
  }catch(e){setErro(e instanceof Error?e.message:'Não foi possível continuar por ATS externo.')}finally{setOcupado(false)}
 }
 const lista=(dados?.candidaturas||[]).filter(c=>{
   if(aba!=='historico'&&c.missaoId!==ultima?.id)return false
   const evento=eventoMaisRecente(c),ts=Date.parse(evento)
   if(periodo==='hoje'&&diaLocal(evento)!==hoje)return false
   if(periodo==='execucao'&&(!Number.isFinite(inicioExecucao)||ts<inicioExecucao)&&c.id!==candidaturaAtual?.id)return false
   if(situacao==='andamento'&&!emAndamento.has(c.estado))return false
   if(situacao==='confirmadas'&&c.estado!=='confirmada')return false
   if(situacao==='impedidas'&&!['aguardando_dado','aguardando_acesso'].includes(c.estado))return false
   if(situacao==='incertas'&&!['enviando','a_verificar'].includes(c.estado))return false
   if(situacao==='descartadas'&&c.estado!=='descartada')return false
   return `${c.empresa} ${c.cargo} ${nomes[c.estado]} ${c.proximaAcao}`.toLowerCase().includes(busca.toLowerCase())
 }).sort((a,b)=>Date.parse(eventoMaisRecente(b))-Date.parse(eventoMaisRecente(a)))
 const populacao=(dados?.candidaturas||[]).filter(c=>aba==='historico'?(periodo!=='hoje'||diaLocal(eventoMaisRecente(c))===hoje):c.missaoId===ultima?.id)
 const contagem=(f:(c:Candidatura)=>boolean)=>populacao.filter(f).length
 const fonte=(c:Candidatura)=>{try{const h=new URL(c.url).hostname.replace(/^www\./,'');if(h.includes('linkedin'))return LIMITE_LINKEDIN.test(c.proximaAcao)||/easy apply|simplificada/i.test(c.proximaAcao)?'LinkedIn Easy Apply':'LinkedIn';if(h.includes('greenhouse'))return 'Greenhouse';if(h.includes('lever'))return 'Lever';if(h.includes('ashby'))return 'Ashby';if(h.includes('gupy'))return 'Gupy';if(h.includes('workday'))return 'Workday';return h.split('.').slice(-2,-1)[0]||h}catch{return ''}}
 const colunas:Coluna<Candidatura>[]=[
  {chave:'vaga',titulo:'Vaga',largura:'minmax(0, 2fr)',render:c=><><strong title={c.cargo}>{c.cargo}</strong><small>{c.empresa}</small></>},
  {chave:'fonte',titulo:'Fonte',largura:'118px',render:c=><span title={c.url}>{fonte(c)}</span>},
  {chave:'estado',titulo:'Estado',largura:'128px',render:c=><Chip tone={c.estado==='aguardando_acesso'&&LIMITE_LINKEDIN.test(c.proximaAcao)?'neutro':tomEstado[c.estado]||'neutro'}>{c.estado==='aguardando_acesso'&&LIMITE_LINKEDIN.test(c.proximaAcao)?'Sem ação sua':nomes[c.estado]||c.estado}</Chip>},
  {chave:'proximo',titulo:'Próximo passo',largura:'minmax(0, 1.5fr)',render:c=><span title={c.proximaAcao}>{proximoPasso(c)}</span>},
  {chave:'hora',titulo:'Hora',largura:'46px',render:c=><span title={quando(eventoMaisRecente(c))}>{horaLocal(eventoMaisRecente(c))}</span>},
  {chave:'acoes',titulo:'',largura:'132px',alinhar:'right',render:c=><div className="dw-tabela-acoes" onClick={e=>e.stopPropagation()}>{['aguardando_acesso','descartada'].includes(c.estado)&&!LIMITE_LINKEDIN.test(c.proximaAcao)&&<Botao kind="ghost" disabled={ocupado} onClick={()=>void agir('reabrir',{id:c.id})}>Reabrir</Botao>}{c.estado==='aguardando_dado'&&<Botao kind="ghost" onClick={()=>document.getElementById('cand-responder')?.scrollIntoView({behavior:'smooth'})}>Responder</Botao>}<Botao kind="ghost" onClick={()=>void abrir(c)}>{c.estado==='confirmada'?'Recibo':'Abrir'}</Botao></div>},
 ]
 const tituloEstado=!ultima?'Sem missão':ativa?(ultima.supervisor?.estado==='aguardando_conexao'?'Aguardando Chromium':ultima.supervisor?.estado==='aguardando_controle'?'Aguardando devolução':'Rodando'):atencao?(atencao.automatica?'Retomando sozinha':'Parada'):nomes[ultima.estado]||ultima.estado
 const tomTitulo:Tom=!ultima?'neutro':ativa?'ativo':atencao?(atencao.automatica?'info':'atencao'):'neutro'
 const acoes=<>
  <Botao icone="eye" disabled={ocupado} onClick={()=>void agir('observar')}>Observar</Botao>
  {ultima&&viva&&<Botao kind="primary" icone="play" disabled={ocupado} onClick={()=>void continuarPorAts()}>Continuar por ATS externo</Botao>}
  {ultima&&viva&&confirmadasHoje<metaDiaria&&atencao?.codigo!=='ACESSO'&&<Botao kind="primary" icone="play" disabled={ocupado} onClick={()=>void agir('controlar',{id:ultima.id,acao:'completar_meta'})}>Executar até completar {metaDiaria}</Botao>}
  {ativa?<><Botao icone="pause" disabled={ocupado} onClick={()=>void agir('controlar',{id:ativa.id,acao:'pausar'})}>Pausar</Botao><Botao disabled={ocupado} onClick={()=>void agir('controlar',{id:ativa.id,acao:'encerrar'})}>Encerrar</Botao></>
   :<>{retomavel&&atencao?.codigo!=='ACESSO'&&<Botao kind={atencao&&!atencao.automatica?'primary':'secondary'} icone="play" disabled={ocupado} onClick={()=>void agir('controlar',{id:ultima!.id,acao:'retomar',executor:'nativo'})}>Retomar missão</Botao>}{ultima&&viva&&<Botao disabled={ocupado} onClick={()=>void agir('controlar',{id:ultima.id,acao:'encerrar'})}>Encerrar missão</Botao>}{(!ultima||!viva)&&criterios&&<Botao kind="primary" icone="play" disabled={ocupado} onClick={()=>void agir(ultima?'reiniciar':'iniciar',{criterios})}>Iniciar missão · {criterios.meta} envios</Botao>}</>}
 </>
 return <Pagina titulo="Candidaturas" eyebrow="Automações · Carreira" acoes={acoes} chips={ultima&&<><Chip tone={tomTitulo}>{tituloEstado}</Chip>{ultima.supervisor?.fontesEsgotadas?.linkedinEasyApply&&<Chip tone="neutro" title="Limite diário de Candidatura simplificada; o agente segue por ATS externos">LinkedIn Easy Apply esgotado hoje</Chip>}</>}>
  {erro&&<Faixa tone="erro" acoes={<Botao kind="ghost" onClick={()=>setErro('')}>Fechar</Botao>}>{erro}</Faixa>}{aviso&&<Faixa tone="ok" acoes={<Botao kind="ghost" onClick={()=>setAviso('')}>Fechar</Botao>}>{aviso}</Faixa>}
  {!dados||!criterios?<p className="dw-vazio">Carregando candidaturas…</p>:aba==='preferencias'?<Bloco titulo="Critérios de busca"><form className="cand-form cand-form--bloco" onSubmit={e=>{e.preventDefault();void agir('configurar',criterios)}}>
    <div className="cand-form-title"><h2>Que vagas procurar?</h2><p>Defina cargos, localização e condições. Você pode aplicar a mudança às próximas buscas da missão atual; cada candidatura conserva os critérios usados na sua seleção.</p></div>
    <label className="cand-wide">Cargos e palavras-chave<input value={criterios.termos} onChange={e=>mudar('termos',e.target.value)} required maxLength={1000}/></label>
    <label>Currículo de referência<select value={criterios.area} onChange={e=>mudar('area',e.target.value as CriteriosCandidatura['area'])}><option value="ambas">Escolher conforme a vaga</option><option value="software">Engenharia de software</option><option value="ai">AI Engineer</option></select></label>
    <label>Modalidade<select value={criterios.modalidade} onChange={e=>mudar('modalidade',e.target.value as CriteriosCandidatura['modalidade'])}><option value="remoto">Remoto</option><option value="hibrido">Híbrido</option><option value="presencial">Presencial</option><option value="qualquer">Qualquer modalidade</option></select></label>
    <label>Origem da candidatura<select value={criterios.origem} onChange={e=>mudar('origem',e.target.value as CriteriosCandidatura['origem'])}><option value="qualquer">Automática · melhor disponível</option><option value="ats_externo">ATS externo e site da empresa</option><option value="linkedin_easy_apply">LinkedIn Easy Apply</option></select></label>
     <fieldset className="cand-locations"><legend>Localização elegível</legend>{(() => {
       const loc = parseLocalidades(criterios.localidade)
       const togglePais = (chave: 'brasil' | 'eua' | 'ue') => {
         const novo = { ...loc, [chave]: !loc[chave] }
         if (novo[chave]) {
           novo.semRestricao = false
         } else if (!novo.brasil && !novo.eua && !novo.ue && !novo.outros.trim()) {
           novo.semRestricao = true
         }
         mudar('localidade', serializeLocalidades(novo))
       }
       const toggleSemRestricao = () => {
         mudar('localidade', 'Sem restrição por país')
       }
       const mudarOutros = (texto: string) => {
         const novo = { ...loc, outros: texto }
         if (texto.trim()) {
           novo.semRestricao = false
         } else if (!novo.brasil && !novo.eua && !novo.ue) {
           novo.semRestricao = true
         }
         mudar('localidade', serializeLocalidades(novo))
       }
       return <>
         <div className="cand-locations-options">
           <label className="cand-check"><input type="checkbox" checked={loc.brasil} onChange={() => togglePais('brasil')} />Brasil</label>
           <label className="cand-check"><input type="checkbox" checked={loc.eua} onChange={() => togglePais('eua')} />Estados Unidos</label>
           <label className="cand-check"><input type="checkbox" checked={loc.ue} onChange={() => togglePais('ue')} />Países da União Europeia</label>
           <label className="cand-check"><input type="checkbox" checked={loc.semRestricao} onChange={toggleSemRestricao} />Sem restrição por país</label>
         </div>
         <div className="cand-locations-custom">
           <input value={loc.outros} onChange={e => mudarOutros(e.target.value)} placeholder="Outros locais ou países (opcional)" maxLength={120} />
         </div>
       </>
     })()}</fieldset>
    <label>Idioma da candidatura<select value={criterios.idioma} onChange={e=>mudar('idioma',e.target.value as CriteriosCandidatura['idioma'])}><option value="auto">Acompanhar o idioma da vaga</option><option value="pt">Português</option><option value="en">Inglês</option></select></label>
    <label>Senioridades · separadas por vírgula<input value={criterios.senioridades.join(', ')} onChange={e=>mudar('senioridades',e.target.value.split(',').map(s=>s.trim()))} onBlur={()=>mudar('senioridades',criterios.senioridades.filter(Boolean))} placeholder="Sem restrição adicional"/></label>
    <label>Contratação · separada por vírgula<input value={criterios.contratacoes.join(', ')} onChange={e=>mudar('contratacoes',e.target.value.split(',').map(s=>s.trim()))} onBlur={()=>mudar('contratacoes',criterios.contratacoes.filter(Boolean))} placeholder="CLT, PJ, contractor…"/></label>
    <fieldset className="cand-wide cand-salary"><legend>Faixa salarial desejada</legend><label>Mínimo<input type="number" min="0" value={criterios.salarioMin??''} onChange={e=>mudar('salarioMin',e.target.value===''?null:Number(e.target.value))}/></label><label>Máximo<input type="number" min="0" value={criterios.salarioMax??''} onChange={e=>mudar('salarioMax',e.target.value===''?null:Number(e.target.value))}/></label><label>Moeda<select value={criterios.moeda} onChange={e=>mudar('moeda',e.target.value as CriteriosCandidatura['moeda'])}><option>BRL</option><option>USD</option><option>EUR</option></select></label><label>Período<select value={criterios.periodo} onChange={e=>mudar('periodo',e.target.value as CriteriosCandidatura['periodo'])}><option value="mes">Mensal</option><option value="ano">Anual</option><option value="hora">Por hora</option></select></label><label className="cand-check cand-wide"><input type="checkbox" checked={criterios.aceitarSemSalario} onChange={e=>mudar('aceitarSemSalario',e.target.checked)}/>Considerar vagas sem salário divulgado</label></fieldset>
    <label className="cand-wide">Empresas excluídas · uma por linha<textarea value={criterios.excluirEmpresas.join('\n')} onChange={e=>mudar('excluirEmpresas',e.target.value.split('\n'))} onBlur={()=>mudar('excluirEmpresas',criterios.excluirEmpresas.map(s=>s.trim()).filter(Boolean))}/></label>
    <p className="cand-wide cand-note">Execução autônoma pelo modelo configurado no DailyWork. Não depende de uma conversa Codex. Cada rodada preserva o progresso e registra o consumo reportado pelo executor.</p>
    <label>Meta diária de envios comprovados<input type="number" min="1" value={criterios.meta} onChange={e=>mudar('meta',Number(e.target.value))} required/></label><label>Tempo máximo da rodada · minutos<input type="number" min="5" max="240" value={criterios.minutos} onChange={e=>mudar('minutos',Number(e.target.value))} required/></label>
    <p className="cand-wide cand-note">Currículos: AI Engineer e Software Engineer oficiais, em PT/EN. O foco é escolhido pela vaga. Respostas e screenshots ficam no armazenamento privado local.</p>
    <div className="cand-wide auto-actions"><button className="dw-btn" type="submit" disabled={ocupado}>Salvar para próximas rodadas</button>{ultima&&!['concluida','encerrada'].includes(ultima.estado)&&<button className="dw-btn" type="button" disabled={ocupado} onClick={()=>void agir('reorientar',{id:ultima.id,criterios})}>Aplicar às próximas buscas desta missão</button>}<button className="dw-btn dw-btn--primary" type="button" disabled={ocupado||Boolean(ativa)} onClick={()=>void agir('iniciar',{criterios})}>Iniciar missão com estes critérios</button><button className="dw-btn dw-btn--ghost" type="button" onClick={()=>setAba('rodada')}>Voltar</button></div>
   </form></Bloco>:<>
   <form id="cand-missao" className="cand-busca" onSubmit={e=>{e.preventDefault();void agir(ultima&&viva?'reorientar':'configurar',ultima&&viva?{id:ultima.id,criterios}:criterios)}}>
    <label><span>Que vagas procurar agora?</span><input value={criterios.termos} onChange={e=>mudar('termos',e.target.value)} placeholder="Ex.: FDE, Forward Deployed Engineer, Solutions Engineer" required maxLength={1000}/></label>
    <Botao kind={ativa?'primary':'secondary'} disabled={ocupado} type="submit">Aplicar busca</Botao>
    <Botao kind={ativa?'secondary':'primary'} icone="refresh" disabled={ocupado} onClick={()=>void agir('reiniciar',{criterios})}>{ultima&&viva?'Encerrar atual e iniciar nova missão':'Iniciar nova missão com esta busca'}</Botao>
    <Botao kind="ghost" onClick={()=>setAba('preferencias')}>Todos os critérios</Botao>
    {ultima&&ultima.criterios.termos!==criterios.termos&&<small>Texto ainda não aplicado. Em uso nesta missão: <strong>{ultima.criterios.termos}</strong> · <button type="button" className="dw-btn dw-btn--ghost" onClick={()=>{gravarRascunho('');alterado.current=false;setCriterios(c=>c?{...c,termos:ultima.criterios.termos}:c)}}>descartar</button></small>}
   </form>
   {atencao&&!atencao.automatica?<Faixa tone={atencao.codigo==='MODELO'?'erro':'atencao'} detalhe={atencao.motivo} acoes={<>{['CHROMIUM','ACESSO'].includes(atencao.codigo)&&<Botao icone="eye" disabled={ocupado} onClick={()=>void agir('observar')}>Abrir bancada</Botao>}{retomavel&&atencao.codigo!=='ACESSO'&&<Botao kind="primary" icone="play" disabled={ocupado} onClick={()=>void agir('controlar',{id:ultima!.id,acao:'retomar',executor:'nativo'})}>Retomar missão</Botao>}</>}><strong>{atencao.titulo}.</strong> {atencao.acao}</Faixa>
   :atencao?.automatica&&atencao.codigo!=='LINKEDIN_ESGOTADO'?<Faixa tone="info" detalhe={atencao.motivo}><strong>{atencao.titulo}.</strong> {atencao.acao}</Faixa>
   :perguntas.length?<Faixa tone="atencao" acoes={<Botao kind="primary" onClick={()=>document.getElementById('cand-responder')?.scrollIntoView({behavior:'smooth'})}>Responder</Botao>}><strong>{perguntas.length===1?'1 pergunta trava':`${perguntas.length} perguntas travam`} {vagasPresas} vaga{vagasPresas>1?'s':''}:</strong> {perguntas.slice(0,3).map(p=>`${p.pergunta.slice(0,48)}${p.pergunta.length>48?'…':''} (${p.candidaturas[0].empresa}${p.candidaturas.length>1?` ×${p.candidaturas.length}`:''})`).join(' · ')}. Responda uma vez e elas voltam pra fila.</Faixa>
   :acessosHumanos.length?<Faixa tone="atencao" acoes={<Botao icone="eye" disabled={ocupado} onClick={()=>void agir('observar')}>Abrir bancada</Botao>}><strong>{acessosHumanos[0].titulo}</strong> em {acessosHumanos.reduce((n,a)=>n+a.candidaturas.length,0)} vaga(s). {acessosHumanos[0].acao}</Faixa>
   :ultima&&ativa?<Faixa tone="ok">Rodando sem pendências suas.{linkedinEsgotado?` LinkedIn Easy Apply esgotado hoje (${linkedinEsgotado.candidaturas.length} vagas voltam amanhã); o agente segue por ATS externos.`:''}</Faixa>:null}
   <div className="dw-kpis">
    <Kpi valor={`${confirmadasHoje}/${metaDiaria}`} rotulo="comprovadas hoje" tone="ok"/>
    <Kpi valor={progressoHoje?.emAndamento||0} rotulo="em andamento"/>
    <Kpi valor={vagasPresas+acessosHumanos.reduce((n,a)=>n+a.candidaturas.length,0)} rotulo="precisam de você" tone={vagasPresas||acessosHumanos.length?'atencao':undefined}/>
    <Kpi valor={linkedinEsgotado?.candidaturas.length||0} rotulo="sem ação sua · LinkedIn"/>
    <Kpi valor={ultima?horaLocal(ultima.limite):'—'} rotulo={ultima&&ativa?'fim da janela':'última janela'}/>
   </div>
   <div className="dw-grade cand-grade">
    <Bloco id="cand-historico" scroll className="cand-tabela-bloco" titulo={<>{aba==='historico'?(periodo==='hoje'?'Vagas de hoje':'Todas as vagas'):'Vagas desta missão'} <span className="cand-contagem">{lista.length}</span></>} aside={<>
      {[['todas','Todas',null],['impedidas','Precisam de você',contagem(c=>['aguardando_dado','aguardando_acesso'].includes(c.estado))],['andamento','Em andamento',contagem(c=>emAndamento.has(c.estado))],['confirmadas','Comprovadas',contagem(c=>c.estado==='confirmada')]].map(([id,nome,n])=><button key={String(id)} type="button" className={`cand-filtro ${situacao===id?'is-on':''}`} onClick={()=>setSituacao(String(id))}>{nome}{n!==null&&<span>{String(n)}</span>}</button>)}
      <select aria-label="Período" value={periodo} onChange={e=>setPeriodo(e.target.value as typeof periodo)}><option value="execucao">Execução atual</option><option value="hoje">Hoje</option><option value="missao">Todo o período</option></select>
      <input className="cand-busca-lista" aria-label="Buscar candidatura" placeholder="Empresa, cargo…" value={busca} onChange={e=>setBusca(e.target.value)}/>
      <Botao kind="ghost" onClick={()=>setAba(aba==='historico'?'rodada':'historico')}>{aba==='historico'?'Só esta missão':'Todas as missões'}</Botao>
     </>}>
     <Tabela colunas={colunas} linhas={lista} chave={c=>c.id} aoClicar={c=>void abrir(c)} selecionada={detalhe?.id} vazio="Nenhuma vaga corresponde ao período e situação escolhidos."/>
    </Bloco>
    {detalhe?<DetalheVaga c={detalhe} imagem={imagem} verImagem={verImagem} fechar={fecharDetalhe} ocupado={ocupado} agir={agir}/>
    :<ColunaDia modulo="candidaturas" agora={<Agora ultima={ultima} ativa={ativa} candidaturaAtual={candidaturaAtual} ocupado={ocupado} agir={agir}/>}/>}
   </div>
   {perguntas.length>0&&<Responder perguntas={perguntas} respostas={dados.respostas||[]} ocupado={ocupado} agir={agir}/>}
   {acessosHumanos.length>0&&<Bloco id="cand-acessos" titulo="Bloqueios de acesso"><ul className="dw-pendencias">{acessosHumanos.map(a=><li key={a.codigo}><div><strong>{a.titulo} · {a.candidaturas.length} vaga(s)</strong><small>{a.acao}</small></div><div className="dw-tabela-acoes">{a.candidaturas.slice(0,4).map(c=><Botao key={c.id} kind="ghost" disabled={ocupado} title={c.motivo} onClick={()=>void agir('reabrir',{id:c.id})}>Reabrir {c.empresa}</Botao>)}</div></li>)}</ul></Bloco>}
   <details className="cand-schedule" open={agendaAberta} onToggle={e=>setAgendaAberta((e.target as HTMLDetailsElement).open)}><summary>Agenda, orientações e horários</summary>{agendaAberta&&<AgendaModulo modulo="candidaturas"/>}</details>
  </>}
 </Pagina>
}
function useRelogio(ms=1000){const [,tick]=useState(0);useEffect(()=>{const t=setInterval(()=>tick(n=>n+1),ms);return()=>clearInterval(t)},[ms]);return Date.now()}
const haQuanto=(v:string|undefined,agora:number)=>{if(!v)return '';const s=Math.max(0,Math.round((agora-Date.parse(v))/1000));return s<60?`há ${s}s`:s<3600?`há ${Math.floor(s/60)} min`:`há ${Math.floor(s/3600)} h`}
function Agora({ultima,ativa,candidaturaAtual,ocupado,agir}:{ultima:MissaoCandidatura|undefined;ativa:MissaoCandidatura|undefined;candidaturaAtual:{cargo:string;empresa:string;proximaAcao:string}|null|undefined;ocupado:boolean;agir:(acao:string,entrada?:unknown)=>Promise<void>}){
 const agora=useRelogio()
 if(!ultima)return <p className="dw-vazio">Nenhuma missão iniciada. Escolha a busca e clique Iniciar.</p>
 const atividade=ultima.progresso?.atividadeAtual,sup=ultima.supervisor
 const parado=!ativa,silencio=sup?.atualizadoEm?agora-Date.parse(sup.atualizadoEm):Infinity
 const semSinal=ativa&&silencio>120000
 const recentes=[...(ultima.progresso?.eventosRecentes||[])].reverse().slice(0,5)
 return <div className="cand-agora">
  <div className="cand-agora-titulo"><span className={`cand-agora-ponto ${ativa&&!semSinal?'is-on':semSinal?'is-warn':''}`}/><strong>{parado?'Executor parado':semSinal?'Sem sinal do executor':'Ação imediata'}</strong>{parado&&sup?.atualizadoEm&&<time title={quando(sup.atualizadoEm)}>{haQuanto(sup.atualizadoEm,agora)}</time>}</div>
  {!parado&&<p className="cand-agora-acao"><strong>{descricaoAtividade(atividade?.ferramenta,atividade?.acao)}</strong>{atividade?.em&&<span> · {haQuanto(atividade.em,agora)}</span>}{semSinal&&<span className="cand-agora-aviso"> · nenhuma ação registrada nos últimos 2 min; se continuar, pause e retome.</span>}</p>}
  {candidaturaAtual?<p><strong>{candidaturaAtual.cargo}</strong> · {candidaturaAtual.empresa}<br/><span>{candidaturaAtual.proximaAcao}</span></p>:<p>{ativa?sup?.ultimaAcao||'Preparando o próximo passo.':sup?.checkpoint?sup.checkpoint.slice(0,220):'Sem checkpoint.'}</p>}
  {recentes.length>0&&<ol className="cand-agora-recentes" aria-label="Últimas ações">{recentes.map((e,i)=><li key={i}><time>{horaLocal(e.em)}</time><span>{descricaoAtividade(e.ferramenta,e.acao)}</span></li>)}</ol>}
  <dl><dt>Motor</dt><dd>{sup?.modelo||'conectando'} · {sup?.acoes||0} ações · {sup?.ciclos||0} ciclos</dd><dt>Busca</dt><dd>{ultima.criterios.termos}</dd><dt>Missão</dt><dd>{quando(ultima.criadaEm)} · {ultima.confirmadas} comprovadas</dd></dl>
  <div className="cand-agora-acoes"><Botao icone="eye" disabled={ocupado} onClick={()=>void agir('observar')}>Observar</Botao>{ativa&&<Botao icone="pause" disabled={ocupado} onClick={()=>void agir('controlar',{id:ativa.id,acao:'pausar'})}>Pausar</Botao>}</div>
  <details className="cand-diag"><summary>Critérios e diagnóstico técnico</summary>{sup&&<p className="cand-note">{sup.ciclos} ciclos · {(sup.tokensEntrada+sup.tokensSaida).toLocaleString('pt-BR')} tokens</p>}{sup?.checkpoint&&<p className="cand-note"><strong>Checkpoint:</strong> {sup.checkpoint}</p>}{ultima.motivo&&<p className="cand-note"><strong>Motivo:</strong> {ultima.motivo}</p>}<CriteriosResumo c={ultima.criterios}/></details>
 </div>
}
function Responder({perguntas,respostas,ocupado,agir}:{perguntas:PendenciaPergunta[];respostas:RespostaRecorrente[];ocupado:boolean;agir:(acao:string,entrada?:unknown)=>Promise<void>}){
 const [rascunho,setRascunho]=useState<Record<string,string>>({}),[todas,setTodas]=useState(false),[salvando,setSalvando]=useState('')
 const visiveis=todas?perguntas:perguntas.slice(0,5)
 const vagas=new Set(perguntas.flatMap(p=>p.candidaturas.map(c=>c.id))).size
 async function salvar(pergunta:string,resposta:string){const v=resposta.trim();if(!v)return;setSalvando(pergunta);try{await agir('responder',{pergunta,resposta:v});setRascunho(r=>({...r,[pergunta]:''}))}finally{setSalvando('')}}
 return <Bloco className="cand-responder" titulo={<span id="cand-responder">Responder e destravar · {perguntas.length} pergunta{perguntas.length>1?'s':''} travam {vagas} vaga{vagas>1?'s':''}</span>} aside={<>{perguntas.length>5&&<Botao kind="ghost" onClick={()=>setTodas(t=>!t)}>{todas?'Mostrar só as 5 primeiras':`Ver todas (${perguntas.length})`}</Botao>}</>}>
  <p className="cand-note cand-responder-nota">Clique num preset ou digite. A resposta fica salva pra todo formulário que fizer a mesma pergunta, e as vagas presas voltam pra fila sozinhas. Nada é enviado agora: o agente usa a resposta quando retomar o formulário.</p>
  <ol className="cand-responder-lista">{visiveis.map((q,i)=>{const chave=q.pergunta,ja=respostas.find(r=>r.pergunta===q.pergunta),empresas=[...new Set(q.candidaturas.map(c=>c.empresa))];return <li key={chave}>
   <div className="cand-responder-pergunta"><span className="cand-responder-n">{i+1}</span><div><strong>{q.pergunta}</strong><small>{q.candidaturas.length} vaga{q.candidaturas.length>1?'s':''} · {empresas.slice(0,3).join(', ')}{empresas.length>3?` +${empresas.length-3}`:''}{q.candidaturas[0]?.total&&q.candidaturas[0].total>1?` · faltam ${q.candidaturas[0].restantes} de ${q.candidaturas[0].total} perguntas dessa vaga`:''}{ja?<> · <em>resposta atual: {ja.resposta}</em></>:null}</small></div></div>
   <div className="cand-responder-entrada">
    {(q.sugestoes?.length||0)>0&&<div className="cand-presets" aria-label="Sugestões">{q.sugestoes!.map(sug=><button key={sug} type="button" className={`cand-preset ${rascunho[chave]===sug?'is-on':''}`} disabled={ocupado} title="Usar esta resposta" onClick={()=>void salvar(chave,sug)}>{sug}</button>)}</div>}
    <form onSubmit={e=>{e.preventDefault();void salvar(chave,rascunho[chave]||'')}}><input aria-label={`Resposta para ${q.pergunta}`} placeholder={q.sugestoes?.length?'Ou digite outra resposta':'Sua resposta'} value={rascunho[chave]||''} onChange={e=>setRascunho(r=>({...r,[chave]:e.target.value}))} maxLength={4000}/><Botao kind="primary" type="submit" disabled={ocupado||!(rascunho[chave]||'').trim()}>{salvando===chave?'Salvando…':'Salvar'}</Botao></form>
   </div>
  </li>})}</ol>
 </Bloco>
}
function DetalheVaga({c,imagem,verImagem,fechar,ocupado,agir}:{c:Candidatura;imagem:EvidenciaCandidatura|null;verImagem:(e:EvidenciaCandidatura)=>Promise<void>;fechar:()=>void;ocupado:boolean;agir:(acao:string,entrada?:unknown)=>Promise<void>}){
 return <Bloco scroll className="cand-detalhe" titulo={<><strong>{c.empresa}</strong> <span className="cand-detalhe-cargo">{c.cargo}</span></>} aside={<><Chip tone={tomEstado[c.estado]||'neutro'}>{nomes[c.estado]}</Chip><Botao kind="ghost" onClick={fechar}>Fechar</Botao></>}>
  <div className="cand-detalhe-corpo">
   <p><a href={c.url} target="_blank" rel="noreferrer">Abrir vaga ↗</a> · {c.proximaAcao}</p>
   {['aguardando_acesso','descartada'].includes(c.estado)&&!LIMITE_LINKEDIN.test(c.proximaAcao)&&<div><Botao disabled={ocupado} onClick={()=>void agir('reabrir',{id:c.id})}>Reabrir esta vaga</Botao></div>}
   <p className="cand-reason">{c.qualificacao.motivo}</p>
   <h3>Currículo</h3><p className="cand-file">{c.cv.nome}</p><details><summary>Versão do arquivo e critérios</summary><p className="cand-hash">SHA-256: {c.cv.sha256}</p><CriteriosResumo c={c.criterios}/></details>
   <h3>Respostas registradas</h3>{c.campos.length?<dl className="cand-answers">{c.campos.map((f,i)=><div key={i}><dt>{f.pergunta}</dt><dd>{f.resposta}<small>Fonte: {f.fonte}</small></dd></div>)}</dl>:<p className="cand-note">O formulário ainda não foi registrado.</p>}
   <h3>Screenshots e comprovação</h3>{c.evidencias?.length?<div className="cand-evidence">{c.evidencias.map(e=><Botao key={e.id} onClick={()=>void verImagem(e)}>{e.etapa} · {quando(e.em)}</Botao>)}</div>:<p className="cand-note">Nenhuma captura registrada ainda.</p>}{imagem&&<figure className="cand-image"><a href={imagem.dataUrl} target="_blank" rel="noreferrer"><img src={imagem.dataUrl} alt={`Captura real: ${imagem.etapa}`}/></a><figcaption>{imagem.texto}</figcaption></figure>}
   <details><summary>Eventos da candidatura</summary><ol className="cand-events">{c.eventos?.map((e,i)=><li key={i}><time>{quando(e.em)}</time> {nomes[e.tipo]||e.tipo}{e.proximaAcao&&<p>{e.proximaAcao}</p>}</li>)}</ol></details>
  </div>
 </Bloco>
}
function CriteriosResumo({c}:{c:CriteriosCandidatura}){const origem=c.origem==='ats_externo'?'ATS externo / site da empresa':c.origem==='linkedin_easy_apply'?'LinkedIn Easy Apply':'Melhor origem disponível';return <dl className="cand-criteria"><dt>Busca</dt><dd>{c.termos}</dd><dt>Origem</dt><dd>{origem}</dd><dt>Área e local</dt><dd>{c.area==='ambas'?'Software e IA':c.area==='ai'?'IA aplicada':'Software'} · {c.modalidade} · {c.localidade}</dd><dt>Remuneração</dt><dd>{c.salarioMin??'Sem mínimo'} – {c.salarioMax??'Sem máximo'} · {c.moeda}/{c.periodo}{c.aceitarSemSalario?' · aceita não divulgado':''}</dd><dt>Senioridade / contrato</dt><dd>{c.senioridades.join(', ')||'Sem restrição'} / {c.contratacoes.join(', ')||'Sem restrição'}</dd><dt>Idioma</dt><dd>{c.idioma==='auto'?'Idioma da vaga':c.idioma.toUpperCase()}</dd><dt>Exclusões</dt><dd>{c.excluirEmpresas.join(', ')||'Nenhuma'}</dd><dt>Limite</dt><dd>{c.meta} confirmações · {c.minutos} minutos</dd></dl>}
