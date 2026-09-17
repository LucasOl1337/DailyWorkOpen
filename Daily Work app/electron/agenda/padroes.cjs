function padroes({ campanhas = [], candidaturas = {}, editorial = {} } = {}) {
  const base={ativa:true,dias:[0,1,2,3,4,5,6],fuso:'America/Sao_Paulo',fim:'20:00',intervalo:null,metaDiaria:0,quantidade:1,minutos:50,tentativas:3,perfilId:'',executor:'',fontes:[],contas:[],idiomas:[]}
  const r=(id,modulo,tipo,nome,horarios,extra={})=>({...base,id,modulo,tipo,nome,horarios,recurso:modulo,...extra})
  return [
    r('planejamento','sumario','planejamento','Planejamento do dia',['08:00'],{recurso:'contexto'}),
    r('coleta','sumario','coleta','Atualizar sumário',[],{intervalo:15,fim:'23:59',recurso:'sumario'}),
    r('balanco','sumario','balanco','Balanço do dia',['20:00'],{fim:'23:59'}),
    ...campanhas.flatMap(c=>[
      r(`pesquisa:${c.id}`,`campanha:${c.id}`,'pesquisa',`Inteligência · ${c.nome}`,['09:00'],{recurso:'navegador:campanhas',campanhaId:c.id,executor:c.executor}),
      r(`campanha:${c.id}`,`campanha:${c.id}`,'campanha',`Ações · ${c.nome}`,['09:30'],{recurso:'navegador:campanhas',campanhaId:c.id,dependencia:`pesquisa:${c.id}`,executor:c.executor,metaDiaria:2,quantidade:2}),
    ]),
    r('candidaturas','candidaturas','candidaturas','Buscar e enviar candidaturas',['10:00','15:00'],{recurso:'navegador:candidaturas',metaDiaria:candidaturas.meta||60,quantidade:Math.ceil((candidaturas.meta||60)/2),minutos:candidaturas.minutos||120,executor:candidaturas.executor||'nativo'}),
    r('producao','editorial','producao','Produzir conteúdo',['11:00','17:00'],{recurso:'editorial',quantidade:editorial.quantidade||3,estoqueAlvo:editorial.estoqueAlvo??12,perfilId:editorial.perfilId||'',contas:editorial.contas||['linkedin','x'],idiomas:editorial.idiomas||['pt-BR','en'],ativa:editorial.ativa!==false}),
    r('publicacoes-agendadas','editorial','publicacao_agendada','Conferir publicações agendadas',[],{recurso:'publicacao',intervalo:1,fim:'23:59',minutos:15}),
    r('publicacao','editorial','publicacao','Publicar peças prontas',['12:00','18:00'],{recurso:'publicacao',quantidade:editorial.estoqueAlvo||12}),
  ]
}
module.exports={padroes}
