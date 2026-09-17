#!/usr/bin/env node
// O CLI e a interface compartilham as regras e o banco privado do módulo.
const fs=require('node:fs')
const {criarServicoCandidaturas}=require('../electron/lib-candidaturas.cjs')
const contrato={
  estado:'Sem argumentos. Critérios, missões e candidaturas persistidas.',
  missao:'{id}: missão com candidaturas, eventos, critérios e confirmações.',
  obter:'{id}: candidatura com respostas, CV, eventos e evidências.',
  iniciar:'{criterios?}: inicia executor real; retorna missão persistida.',
  controlar:'{id,acao: pausar|retomar|encerrar}',
  assumir:'{id,threadId}: transfere uma missão inativa para execução nesta tarefa Codex, sem iniciar CLI; requer executor anterior terminado. Preserva envios pendentes. Conferir autorizar antes de cada entrada; pausar/encerrar continuam valendo.',
  autorizar:'{missaoId}: conferir antes de cada entrada no navegador; falha quando pausada, vencida ou meta atingida.',
  reservar:'{missaoId,url,empresa,cargo,foco:software|ai,idioma:pt|en,qualificacao:{ativa:true,elegivel:true,requisitosAtendidos:true,modalidade:remoto|hibrido|presencial,motivo,senioridade?,contratacao?,salario?:{valor,moeda,periodo}}}: cria reserva única e snapshot do CV; retorna pastaEntrada para capturas.',
  atualizar:'{id,estado:preenchendo|pronta|aguardando_dado|aguardando_acesso|descartada,campos?:[{pergunta,resposta,fonte}],alias?:URL,anexo?:nomePDF,proximaAcao}: pronta exige campos e anexo correto.',
  intencao:'{id}: registrar ANTES de enviar no portal; aceita apenas estado pronta e apenas uma vez.',
  complementar:'{id,campos:[{pergunta,resposta,fonte}]}: acrescenta respostas de etapas posteriores em inscrição já iniciada. Preserva intenção e respostas anteriores; não autoriza repetir envio.',
  captura:'{id,etapa:vaga|revisao|confirmacao|falha,arquivo:nome.png|nome.jpg,url,texto}: captura real já salva em pastaEntrada; URL deve ser vaga/alias associado; retorna evidenciaId no campo id.',
  resultado:'{id,estado:confirmada|a_verificar|nao_enviada,evidenciaId?,motivo?}: confirmação exige captura posterior à intenção. nao_enviada exige captura de falha comprovando não envio.',
  executorEstado:'{missaoId,estado:executando|bloqueada|interrompida|finalizada,motivo?}',
  configurar:'Objeto completo de critérios; só altera preferências para missões futuras.',
  reiniciar:'{criterios?}: encerra qualquer missão viva (ativa, bloqueada, interrompida ou pausada), salva os critérios informados e inicia uma missão nova agora.',
  responder:'{pergunta,resposta}: grava resposta recorrente do titular para perguntas de formulário sem fonte; reabre as candidaturas em aguardando_dado que só esperavam por ela.',
  reabrir:'{id,proximaAcao?}: devolve uma candidatura impedida ou descartada para preenchendo; se a missão dela terminou, transfere para a missão viva mais recente.'
}
async function main(){
 const [acao='contrato',arg='{}']=process.argv.slice(2)
 if(acao==='contrato'){console.log(JSON.stringify(contrato,null,2));return}
 if(!Object.hasOwn(contrato,acao))throw new Error('Operação desconhecida. Use contrato.')
 const entrada=JSON.parse(arg==='-'?fs.readFileSync(0,'utf8'):arg.startsWith('@')?fs.readFileSync(arg.slice(1),'utf8'):arg)
 const s=criarServicoCandidaturas({privateDir:process.env.DAILYWORK_CANDIDATURAS_DIR})
 try{const result=await s[acao](['missao','obter'].includes(acao)?entrada.id:entrada);console.log(JSON.stringify({ok:true,data:result},null,2))}finally{s.close()}
}
main().catch(e=>{console.error(JSON.stringify({ok:false,erro:{codigo:e.codigo||'ERRO',mensagem:e.message}}));process.exitCode=1})
