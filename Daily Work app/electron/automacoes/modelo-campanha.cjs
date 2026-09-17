function textosCampanha({ nome, site, objetivo }) {
  const destino = site || `o domínio oficial de ${nome}, ainda não informado`
  const busca = objetivo || 'oportunidades compatíveis e contatos com a equipe'
  return {
    findings: `# Pesquisa de ${nome}\n\n${busca}\n\nSite: ${site || `não informado — descubra o domínio, o time e as vagas a partir do nome ${nome}`}\n`,
    playbook: `# Playbook — campanha ${nome}

Objetivo: ${busca}. O DailyWork autoriza envio ao criar esta campanha. O agente redige, envia e registra; presença importa mais que volume.

## Ordem do ciclo

1. Leia a base e o estado. Preserve toques já confirmados. Alvos manuais na fila entram primeiro.
2. Use só a ponte da bancada DailyWork. Confira a identidade visível na página. Uma conta desconectada interrompe só a ação daquele serviço.
3. Priorize o primeiro alvo \`na_fila\`. Sem alvo manual, use a rotação de argumentos e a pesquisa.
4. Antes de enviar, registre texto e referências pelo controle.cjs. Depois confirme com evidência.
5. Nunca o mesmo destinatário em dias seguidos; a mesma pessoa só após 5 dias úteis e com argumento novo.
6. Resposta humana tem prioridade. Pedido para parar encerra os contatos.

## Voz

Primeira pessoa, frase curta, um fato concreto. Sem travessão, sem "estou animado", sem buzzword. Não invente métrica, experiência ou cargo.
`,
    argumentos: `# Banco de argumentos — ${nome}

Cada toque usa UM argumento, com prova real. Nunca repetir o mesmo argumento para o mesmo destinatário.

### A01 — Por que ${nome} agora
Tese: ${busca}
Prova: site.example, github.com/example
CTA: 15 min de conversa ou o canal certo do processo.
`,
    alvos: `# Alvos — ${nome}

Regra: nunca repetir canal para a mesma pessoa em menos de 5 dias úteis. Se a pessoa responder, ela sai da rotação.

A pesquisa e a fila manual alimentam esta lista. Não invente destinatários.

| Pessoa | Papel | Canal | Identidade |
| --- | --- | --- | --- |
| | | | |
`,
    ciclo: `Execute um ciclo da campanha ${nome}. Use a base incluída neste pedido para fatos profissionais, argumentos, critérios e limites. O contexto contém cópias versionadas; não substitua essas fontes por arquivos mais novos durante a execução.

O DailyWork autorizou envio nesta campanha. Pesquise ${destino} quando faltar contexto; quando houver alvo elegível, redija e envie.

1. Leia a base incluída e o estado operacional. Preserve os toques já confirmados. Novos alvos manuais continuam elegíveis depois de outros toques do dia, respeitando os limites de contato do playbook.
2. Verifique o navegador e a identidade visível na página. Use exclusivamente a ponte da bancada dailywork-campanhas (workspaces 6–11) fornecida no contexto; leia a skill dailywork-bancada se a ponte faltar. Não conecte ao navegador pessoal por CDP. Não deduza a conta do Gmail pelo índice \`/u/0/\` ou \`/u/1/\`. Sessão ausente, CAPTCHA ou verificação interrompem somente a ação daquele serviço: registre o impedimento e continue pelos demais canais e alvos elegíveis.
3. Priorize o primeiro alvo manual na_fila: LinkedIn = mensagem/nota conforme a sessão; X = resposta contextual ao post ou perfil; Ashby = verificar a vaga e preparar candidatura elegível. Sem alvo manual, siga a rotação do playbook. Se os toques do dia já estiverem confirmados e não houver alvo novo elegível, encerre sem enviar.
4. Redija com as fontes incluídas. Se consultar uma pessoa, vaga ou post na web, registre URL e trecho em fontesExternas. Fonte externa informa o destinatário; não comprova experiência profissional sua.
5. Antes de cada envio, registre o texto exato pelo controle.cjs. Crie um JSON local em runs/ com contextoId, tipo (email, linkedin, x, candidatura ou curriculo), alvo, texto, fontesUsadas e fontesExternas. Se atender a fila manual, inclua filaId e use a URL exata daquele item. Rode \`node <controle> registrar <arquivo-json>\`. Só prossiga quando ok=true.
6. Realize a ação e conclua pelo mesmo controle: \`node <controle> concluir <arquivo-json>\` com id, status e evidencia/nota. Confirmado exige recibo visível. Sem certeza, use incerto. Tentativa incerta bloqueia o próximo ciclo até conferência.
7. Atualize o estado somente pelo controle: \`node <controle> estado\`, depois \`node <controle> atualizar <arquivo-json>\`. A fila manual está em arquivos próprios; não a copie para estado.json.local.
8. Registre uma linha no diario.md. Uma resposta humana tem prioridade.

Encerre com um resumo curto das confirmações, bloqueios e pendências. Um processo concluído não é evidência de envio.
`,
    diario: `# Diário — ${nome}\n\n`,
  }
}
module.exports = { textosCampanha }
