// Argumentos públicos do registro; a suíte exige paridade com todas as operações.
const contratos = {
  "blocos:listar": {
    "descricao": "blocos — listar",
    "argumentos": [
      "dia"
    ],
    "exemplo": [
      "2026-09-10"
    ]
  },
  "blocos:obter": {
    "descricao": "blocos — obter",
    "argumentos": [
      "id",
      "dia"
    ]
  },
  "blocos:criar": {
    "descricao": "blocos — criar",
    "argumentos": [
      "b",
      "dia"
    ],
    "exemplo": [
      {
        "tipo": "tarefa",
        "titulo": "Validar API",
        "corpo": "Objetivo: verificar o contrato.\n- [ ] Executar leitura e escrita.\nPRONTO = leitura confirma a mudança."
      },
      "2026-09-10"
    ]
  },
  "blocos:atualizar": {
    "descricao": "blocos — atualizar",
    "argumentos": [
      "id",
      "patch",
      "dia"
    ],
    "exemplo": [
      "b-id",
      {
        "status": "feito"
      },
      "2026-09-10"
    ]
  },
  "blocos:excluir": {
    "descricao": "blocos — excluir",
    "argumentos": [
      "id",
      "dia"
    ]
  },
  "blocos:salvar": {
    "descricao": "blocos — salvar",
    "argumentos": [
      "blocos",
      "opts"
    ]
  },
  "dias:listar": {
    "descricao": "dias — listar",
    "argumentos": []
  },
  "sessoes:listar": {
    "descricao": "sessoes — listar",
    "argumentos": []
  },
  "sessoes:criar": {
    "descricao": "sessoes — criar",
    "argumentos": [
      "id"
    ],
    "exemplo": [
      "minha-lousa"
    ]
  },
  "sessoes:carregar": {
    "descricao": "sessoes — carregar",
    "argumentos": [
      "id"
    ]
  },
  "sessoes:salvar": {
    "descricao": "sessoes — salvar",
    "argumentos": [
      "id",
      "snapshot"
    ]
  },
  "sessoes:excluir": {
    "descricao": "sessoes — excluir",
    "argumentos": [
      "id"
    ]
  },
  "asset:foto": {
    "descricao": "asset — foto",
    "argumentos": []
  },
  "portfolio:midia-salvar": {
    "descricao": "portfolio — midia salvar",
    "argumentos": [
      "entrada"
    ]
  },
  "portfolio:midia-ler": {
    "descricao": "portfolio — midia ler",
    "argumentos": [
      "caminho"
    ]
  },
  "conhecimento:listar": {
    "descricao": "conhecimento — listar",
    "argumentos": []
  },
  "conhecimento:obter": {
    "descricao": "conhecimento — obter",
    "argumentos": [
      "caminho"
    ],
    "exemplo": [
      "Painel Essencial/nota.md"
    ]
  },
  "conhecimento:salvar": {
    "descricao": "conhecimento — salvar",
    "argumentos": [
      "caminho",
      "conteudo",
      "etag"
    ]
  },
  "conhecimento:salvar-posicoes": {
    "descricao": "conhecimento — salvar posicoes",
    "argumentos": [
      "novasPosicoes"
    ]
  },
  "conhecimento:remover-posicao": {
    "descricao": "conhecimento — remover posicao",
    "argumentos": [
      "caminho"
    ]
  },
  "conhecimento:excluir": {
    "descricao": "conhecimento — excluir",
    "argumentos": [
      "caminho"
    ]
  },
  "conhecimento:contexto-principal": {
    "descricao": "conhecimento — contexto principal",
    "argumentos": []
  },
  "fluxo:preparar-dia": {
    "descricao": "fluxo — preparar dia",
    "argumentos": [
      "entrada"
    ],
    "exemplo": [
      {
        "dia": "2026-09-10",
        "projetoId": "dailywork"
      }
    ]
  },
  "fluxo:confirmar-propostas": {
    "descricao": "fluxo — confirmar propostas",
    "argumentos": [
      "entrada"
    ]
  },
  "fluxo:revisar-fechamento": {
    "descricao": "fluxo — revisar fechamento",
    "argumentos": [
      "entrada"
    ]
  },
  "fluxo:confirmar-fechamento": {
    "descricao": "fluxo — confirmar fechamento",
    "argumentos": [
      "entrada"
    ]
  },
  "fluxo:revisar-semana": {
    "descricao": "fluxo — revisar semana",
    "argumentos": [
      "entrada"
    ]
  },
  "fluxo:rascunhar-dia": {
    "descricao": "fluxo — rascunhar dia",
    "argumentos": [
      "entrada"
    ]
  },
  "agente:config": {
    "descricao": "agente — config",
    "argumentos": []
  },
  "agente:salvar-config": {
    "descricao": "agente — salvar config",
    "argumentos": [
      "entrada"
    ]
  },
  "agente:sondar-provedores": {
    "descricao": "agente — sondar provedores",
    "argumentos": []
  },
  "agente:contexto": {
    "descricao": "agente — contexto",
    "argumentos": [
      "entrada"
    ],
    "exemplo": [
      {
        "escopo": "global"
      }
    ]
  },
  "agente:chat": {
    "descricao": "agente — chat",
    "argumentos": [
      "entrada"
    ]
  },
  "agente:confirmar": {
    "descricao": "agente — confirmar",
    "argumentos": [
      "entrada"
    ]
  },
  "executor:iniciar": {
    "descricao": "executor — iniciar",
    "argumentos": [
      "entrada"
    ]
  },
  "executor:estado": {
    "descricao": "executor — estado",
    "argumentos": [
      "dia"
    ]
  },
  "executor:cancelar": {
    "descricao": "executor — cancelar",
    "argumentos": [
      "entrada"
    ]
  },
  "sumario:obter": {
    "descricao": "sumario — obter",
    "argumentos": [
      "dia"
    ]
  },
  "sumario:inputs-obter": {
    "descricao": "sumario — inputs obter",
    "argumentos": [
      "dia"
    ]
  },
  "sumario:coletar": {
    "descricao": "sumario — coletar",
    "argumentos": [
      "dia"
    ]
  },
  "sumario:analise-obter": {
    "descricao": "sumario — analise obter",
    "argumentos": [
      "dia"
    ]
  },
  "sumario:analisar": {
    "descricao": "sumario — analisar",
    "argumentos": [
      "dia",
      "perfilId"
    ]
  },
  "sumario:interagir": {
    "descricao": "sumario — interagir",
    "argumentos": [
      "dia",
      "entrada"
    ]
  },
  "integracoes:listar": {
    "descricao": "integracoes — listar",
    "argumentos": []
  },
  "integracoes:status": {
    "descricao": "integracoes — status",
    "argumentos": [
      "id"
    ]
  },
  "integracoes:configurar": {
    "descricao": "integracoes — configurar",
    "argumentos": [
      "id",
      "entrada"
    ]
  },
  "integracoes:desconectar": {
    "descricao": "integracoes — desconectar",
    "argumentos": [
      "id"
    ]
  },
  "integracoes:autorizar": {
    "descricao": "integracoes — autorizar",
    "argumentos": [
      "id"
    ]
  },
  "integracoes:perfil": {
    "descricao": "integracoes — perfil",
    "argumentos": [
      "id"
    ]
  },
  "integracoes:sessao-visual": {
    "descricao": "integracoes — sessao visual",
    "argumentos": [
      "acao",
      "entrada"
    ]
  },
  "integracoes:sinais": {
    "descricao": "integracoes — sinais",
    "argumentos": [
      "id",
      "dia",
      "opcoes"
    ]
  },
  "integracoes:preparar-publicacao": {
    "descricao": "integracoes — preparar publicacao",
    "argumentos": [
      "id",
      "entrada"
    ]
  },
  "integracoes:confirmar-publicacao": {
    "descricao": "integracoes — confirmar publicacao",
    "argumentos": [
      "entrada"
    ]
  },
  "integracoes:cancelar-publicacao": {
    "descricao": "integracoes — cancelar publicacao",
    "argumentos": [
      "entrada"
    ]
  },
  "integracoes:rascunhar": {
    "descricao": "integracoes — rascunhar",
    "argumentos": [
      "entrada"
    ]
  },
  "editorial:listar": {
    "descricao": "editorial — listar",
    "argumentos": [
      "filtros"
    ]
  },
  "editorial:capacidades": {
    "descricao": "editorial — capacidades",
    "argumentos": []
  },
  "editorial:obter": {
    "descricao": "editorial — obter",
    "argumentos": [
      "id"
    ]
  },
  "editorial:criar": {
    "descricao": "editorial — criar",
    "argumentos": [
      "entrada"
    ]
  },
  "editorial:atualizar": {
    "descricao": "editorial — atualizar",
    "argumentos": [
      "id",
      "entrada"
    ]
  },
  "editorial:excluir-muitos": {
    "descricao": "editorial — excluir muitos",
    "argumentos": [
      "entrada"
    ],
    "exemplo": [
      {
        "itens": [
          { "id": "ed-exemplo", "revisao": 1 }
        ]
      }
    ]
  },
  "editorial:publicar": {
    "descricao": "editorial — publicar",
    "argumentos": [
      "id",
      "entrada"
    ]
  },
  "editorial:agendar": {
    "descricao": "editorial — agendar",
    "argumentos": [
      "id",
      "entrada"
    ]
  },
  "editorial:verificar": {
    "descricao": "editorial — portão de publicação da peça (pronta, modo e bloqueios); publicar/agendar por agente só passam sem bloqueio e com publicação automática ligada",
    "argumentos": [
      "id"
    ]
  },
  "editorial:politica-publicacao": {
    "descricao": "editorial — política de publicação vigente (supervisionado ou automatico)",
    "argumentos": []
  },
  "editorial:configurar-publicacao": {
    "descricao": "editorial — muda a política de publicação; somente pela interface do app (HTTP responde SOMENTE_DESKTOP)",
    "argumentos": [
      "entrada"
    ],
    "exemplo": [
      { "modo": "supervisionado" }
    ]
  },
  "editorial:recusar": {
    "descricao": "editorial — recusar",
    "argumentos": [
      "id",
      "entrada"
    ]
  },
  "editorial:reabrir": {
    "descricao": "editorial — reabrir",
    "argumentos": [
      "id",
      "entrada"
    ]
  },
  "editorial:espelhar": {
    "descricao": "editorial — espelhar",
    "argumentos": [
      "id",
      "entrada"
    ]
  },
  "editorial:estado": {
    "descricao": "editorial — estado",
    "argumentos": []
  },
  "editorial:gerar": {
    "descricao": "editorial — gerar",
    "argumentos": [
      "entrada"
    ]
  },
  "editorial:cancelar-producao": {
    "descricao": "editorial — cancelar producao",
    "argumentos": []
  },
  "editorial:config": {
    "descricao": "editorial — config",
    "argumentos": [
      "entrada"
    ]
  },
  "editorial:logica": {
    "descricao": "editorial — lê a lógica editável do roteiro, da voz e da imagem",
    "argumentos": []
  },
  "editorial:logica-salvar": {
    "descricao": "editorial — grava a lógica do roteiro, da voz e da imagem",
    "argumentos": [
      "entrada"
    ]
  },
  "editorial:logica-restaurar": {
    "descricao": "editorial — restaura a lógica padrão do roteiro",
    "argumentos": []
  },
  "editorial:midia": {
    "descricao": "editorial — midia",
    "argumentos": [
      "itemId",
      "midiaId"
    ]
  },
  "editorial:historico": {
    "descricao": "editorial — histórico de publicações com recibo e comprovante",
    "argumentos": [
      "filtros"
    ]
  },
  "editorial:comprovante": {
    "descricao": "editorial — lê o screenshot de comprovante como data URL",
    "argumentos": [
      "id"
    ]
  },
  "editorial:capturar-comprovante": {
    "descricao": "editorial — captura o comprovante visual de uma peça publicada",
    "argumentos": [
      "id"
    ]
  },
  "editorial:midia-job-listar": {
    "descricao": "editorial — midia job listar",
    "argumentos": [
      "filtros"
    ]
  },
  "editorial:midia-configuracao": {
    "descricao": "editorial — midia configuracao",
    "argumentos": []
  },
  "editorial:midia-configurar": {
    "descricao": "editorial — midia configurar",
    "argumentos": [
      "entrada"
    ]
  },
  "editorial:midia-job-obter": {
    "descricao": "editorial — midia job obter",
    "argumentos": [
      "id"
    ]
  },
  "editorial:midia-job-iniciar": {
    "descricao": "editorial — midia job iniciar",
    "argumentos": [
      "entrada"
    ]
  },
  "editorial:midia-job-cancelar": {
    "descricao": "editorial — midia job cancelar",
    "argumentos": [
      "id"
    ]
  },
  "editorial:midia-job-retomar": {
    "descricao": "editorial — midia job retomar",
    "argumentos": []
  },
  "integracoes:preparar-sessao": {
    "descricao": "integracoes — preparar sessao",
    "argumentos": [
      "id",
      "opcoes"
    ]
  },
  "integracoes:limpar-sessao": {
    "descricao": "integracoes — limpar sessao",
    "argumentos": [
      "id"
    ]
  },
  "interface:escala": {
    "descricao": "interface — escala",
    "argumentos": []
  },
  "interface:escala-alterar": {
    "descricao": "interface — escala alterar",
    "argumentos": [
      "direcao"
    ]
  },
  "interface:escala-resetar": {
    "descricao": "interface — escala resetar",
    "argumentos": []
  },
  "site:status": {
    "descricao": "site — status",
    "argumentos": []
  },
  "site:configurar": {
    "descricao": "site — configurar",
    "argumentos": [
      "entrada"
    ]
  },
  "site:metricas": {
    "descricao": "site — metricas",
    "argumentos": []
  },
  "site:preparar-publicacao": {
    "descricao": "site — preparar publicacao",
    "argumentos": []
  },
  "site:confirmar-publicacao": {
    "descricao": "site — confirmar publicacao",
    "argumentos": [
      "entrada"
    ]
  }
}
Object.assign(contratos, {
  "automacoes:estado": {
    "descricao": "Automações: estado",
    "argumentos": []
  },
  "automacoes:executar": {
    "descricao": "Automações: executar",
    "argumentos": []
  },
  "automacoes:abrir-perfil": {
    "descricao": "Automações: abrir-perfil",
    "argumentos": []
  },
  "automacoes:evidencia": {
    "descricao": "Automações: evidencia",
    "argumentos": [
      "arquivo"
    ]
  },
  "automacoes:alvo": {
    "descricao": "Automações: alvo",
    "argumentos": [
      "entrada"
    ]
  },
  "automacoes:biblioteca": {
    "descricao": "Automações: biblioteca",
    "argumentos": []
  },
  "automacoes:fonte": {
    "descricao": "Automações: fonte",
    "argumentos": [
      "id"
    ]
  },
  "automacoes:selecao": {
    "descricao": "Automações: selecao",
    "argumentos": [
      "entrada"
    ]
  },
  "automacoes:contexto-preparar": {
    "descricao": "Automações: contexto-preparar",
    "argumentos": [
      "entrada"
    ]
  },
  "automacoes:contexto": {
    "descricao": "Automações: contexto",
    "argumentos": [
      "id"
    ]
  },
  "automacoes:material-gerar": {
    "descricao": "Automações: material-gerar",
    "argumentos": [
      "entrada"
    ]
  },
  "automacoes:material": {
    "descricao": "Automações: material",
    "argumentos": [
      "id"
    ]
  }
})
contratos['automacoes:interacao-conferir'] = { descricao: 'Conferir o resultado de uma interação após o ciclo', argumentos: ['entrada'] }
for (const [nome, c] of Object.entries(contratos)) if (nome.startsWith('automacoes:')) { c.minArgs = c.argumentos.length; c.argumentos.push('campanhaId') }
contratos['automacoes:catalogo'] = { descricao: 'Campanhas, executores instalados e bancada', argumentos: [], minArgs: 0 }
contratos['automacoes:campanha-criar'] = { descricao: 'Criar campanha por empresa', argumentos: ['entrada'], minArgs: 1 }
contratos['automacoes:campanha-configurar'] = { descricao: 'Configurar campanha e executor', argumentos: ['entrada', 'campanhaId'], minArgs: 2 }
contratos['automacoes:pesquisa'] = { descricao: 'Ler pesquisa da empresa', argumentos: ['campanhaId'], minArgs: 0 }
contratos['automacoes:pesquisa-salvar'] = { descricao: 'Salvar notas, pessoas e fontes com revisão', argumentos: ['entrada','campanhaId'], minArgs: 1 }
contratos['automacoes:pesquisar'] = { descricao: 'Iniciar pesquisa sem contato externo', argumentos: ['campanhaId'], minArgs: 0 }
contratos['automacoes:cancelar'] = { descricao: 'Encerrar executor e seus subprocessos', argumentos: ['entrada','campanhaId'], minArgs: 1 }
contratos['automacoes:navegador-importar'] = { descricao: 'Atualizar sessão de trabalho na bancada', argumentos: [], minArgs: 0 }
contratos['automacoes:navegador-abrir'] = { descricao: 'Abrir link HTTPS no navegador da bancada', argumentos: ['entrada'], minArgs: 1 }
contratos['automacoes:navegador-mostrar'] = { descricao: 'Abrir visualização da bancada', argumentos: [], minArgs: 0 }
module.exports = { contratos }

for (const acao of ['estado','observar','configurar','reorientar','iniciar','reiniciar','responder','reabrir','controlar','missao','obter','reservar','atualizar','intencao','captura','resultado','evidencia','executorEstado','autorizar']) {
  contratos['candidaturas:' + acao] = { descricao: 'Candidaturas — ' + acao, argumentos: ['estado','observar'].includes(acao) ? [] : [ ['missao','obter','evidencia'].includes(acao) ? 'id' : 'entrada' ], minArgs: ['estado','observar'].includes(acao) ? 0 : 1 }
}

const string = { type: 'string' }
const objeto = { type: 'object' }
const dia = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Data local em America/Sao_Paulo. Omitir somente para Principal.' }
const bloco = { type: 'object', properties: {
  id: string, tipo: { enum: ['nota', 'tarefa', 'projeto', 'link', 'pessoa', 'imagem'] },
  titulo: string, corpo: string, status: { enum: ['pendente', 'fazendo', 'feito'] },
  x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
  conexoes: { type: 'array', items: string }, midia: string,
} }
const campos = { campanhaId: string, dia, arquivo: string, id: string, caminho: string, conteudo: string, etag: string,
  perfilId: string, itemId: string, midiaId: string, acao: string, direcao: { type: 'number' },
  b: bloco, patch: bloco, blocos: { type: 'array', items: bloco }, snapshot: { type: 'object', description: 'Snapshot nativo tldraw {document:{store,schema},session}. Use canvas.snapshot para obter.' } }
const entradas = {
  'agente:chat': { type: 'object', required: ['mensagens'], properties: { escopo: {enum:['global','dia','principal']}, dia, perfilId:string, mensagens:{type:'array',items:{type:'object',required:['role','content'],properties:{role:{enum:['user','assistant']},content:string}}}, usarContextoDuravel:{type:'boolean'}, anexos:{type:'array',items:objeto} } },
  'agente:salvar-config': { type:'object',required:['provider','perfilId'],properties:{provider:{enum:['9router','grok-cli']},perfilId:string} },
  'agente:confirmar': {type:'object',required:['acaoId'],properties:{acaoId:string,escopo:{enum:['global','dia','principal']},dia}},
  'agente:contexto': {type:'object',properties:{escopo:{enum:['global','dia','principal']},dia,usarContextoDuravel:{type:'boolean'}}},
  'executor:iniciar': {type:'object',required:['dia'],properties:{dia,blocoId:string}},
  'executor:cancelar': {type:'object',required:['execucaoId'],properties:{execucaoId:string}},
  'portfolio:midia-salvar': {type:'object',required:['nome','mimeType','base64'],properties:{nome:string,mimeType:{enum:['image/png','image/jpeg','image/webp','image/gif']},base64:string}},
  'fluxo:preparar-dia': {type:'object',required:['dia'],properties:{dia,projetoId:string}},
  'fluxo:rascunhar-dia': {type:'object',required:['dia'],properties:{dia,perfilId:string}},
  'fluxo:revisar-fechamento': {type:'object',required:['dia'],properties:{dia}},
  'fluxo:revisar-semana': {type:'object',properties:{ate:dia}},
  'site:configurar': {type:'object',required:['token'],properties:{token:{type:'string',writeOnly:true}}},
}
Object.assign(entradas, {
  'automacoes:alvo': {type:'object',required:['url'],properties:{url:string,agora:{type:'boolean'},forcarContato:{type:'boolean'},identidadeX:string}},
  'automacoes:selecao': {type:'object',required:['fontes','revisao'],properties:{fontes:{type:'array',items:string},revisao:string}},
  'automacoes:contexto-preparar': {type:'object',properties:{tipo:{enum:['mensagem','candidatura','curriculo','ciclo','pesquisa']},briefing:string,idioma:{enum:['pt-BR','en']},alvoUrl:string}},
  'automacoes:interacao-conferir': {type:'object',required:['id','status'],properties:{id:string,status:{enum:['confirmado','nao_enviado']},evidencia:string,nota:string}},
  'automacoes:material-gerar': {type:'object',required:['contextoId'],properties:{contextoId:string}},
})
for(const nome of ['site:confirmar-publicacao','integracoes:confirmar-publicacao','integracoes:cancelar-publicacao']) entradas[nome]={type:'object',required:['proposalId'],properties:{proposalId:string}}
for (const acao of require('./agenda/runtime.cjs').ACOES) contratos['agenda:'+acao]={descricao:'Agenda persistente — '+acao,argumentos:['entrada'],minArgs:acao==='estado'?0:1}
const minimos = {'blocos:listar':0,'blocos:obter':1,'blocos:criar':1,'blocos:atualizar':2,'blocos:excluir':1,'blocos:salvar':1,'agente:contexto':0,'executor:estado':0,'sumario:analisar':1,'integracoes:sessao-visual':1,'integracoes:sinais':2,'integracoes:preparar-sessao':1,'editorial:listar':0,'editorial:midia-job-listar':0,'editorial:historico':0,'editorial:logica':0,'editorial:logica-restaurar':0}
for(const [nome,c] of Object.entries(contratos)) {
  c.minArgs = c.minArgs ?? minimos[nome] ?? c.argumentos.length
  c.esquemas = c.argumentos.map((a,i) => {
    const esquema = a === 'entrada' ? entradas[nome] || {...objeto,description:'Campos de domínio descritos em /api/v1/referencia. Conexões retornam seus esquemas em integracoes:listar.'} : campos[a] || objeto
    return i >= c.minArgs ? {anyOf:[esquema,{type:'null'}]} : esquema
  })
  c.referencia = '/api/v1/referencia'
  if (nome.startsWith('site:') || /^(interface:escala|integracoes:(preparar|limpar)-sessao)/.test(nome)) c.ambientes = ['desktop']
  else c.ambientes = ['desktop','dev']
}
