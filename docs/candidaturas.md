# Candidaturas no DailyWork

SOMENTE ao operar, integrar ou alterar missões de candidaturas.

## Operação

Abra **Candidaturas** na barra lateral (a antiga aba dentro de Automações; a URL
`?view=automacoes&moduloAutomacoes=candidaturas` continua aceita). **Todos os
critérios** permite escolher
cargos, área, modalidade, localização elegível, senioridade, contratação,
idioma, faixa salarial/moeda/período, empresas excluídas, meta e duração.
Salvar critérios altera as preferências das próximas missões. Iniciar missão
dispara um executor real, capaz de buscar, preencher e enviar dentro do escopo.

Cada missão preserva seus critérios. **Missão atual** mostra a contagem de
envios comprovados, impedimentos e vagas. **Histórico** permite procurar uma
candidatura por empresa, cargo ou situação. Selecione uma vaga para ver:

- justificativa de compatibilidade e URL;
- currículo oficial selecionado, idioma e hash;
- perguntas, respostas efetivamente preenchidas e fontes;
- screenshots, confirmação do destino e eventos da candidatura.

O painel da missão separa o progresso de **hoje**, da **execução atual** e do
histórico completo. Ele mostra a etapa que o executor está realizando, a vaga
em uso, a última atualização, os formulários em andamento e os envios já
comprovados. A lista abre em **Hoje**, para que bloqueios antigos não escondam
o andamento atual. Os filtros de período, situação e faixa de horário usam o
horário real do evento mais recente de cada candidatura.

### Atenção, fila travada e retomada

O painel da missão diz **o que está travando e o que fazer**, não só o motivo
técnico. O bloco de atenção classifica a parada: reinício do DailyWork
(retoma sozinho), Chromium da bancada ausente (abrir a bancada), ciclos sem
progresso, prazo vencido, provedor de IA ou executor. Cada caso traz a ação
humana concreta e os botões **Retomar missão**, **Encerrar missão** e
**Nova missão com a busca atual**. Uma missão bloqueada ou interrompida nunca
fica sem saída: **Encerrar atual e iniciar nova missão** (`candidaturas:reiniciar`)
encerra a fila viva, salva a busca digitada e começa outra na hora.

**Fila travada** lista o que o agente não resolve sozinho. Perguntas de
formulário sem fonte (teste de drogas, nível de espanhol, pay rate C2C…) são
agrupadas; uma resposta digitada ali (`candidaturas:responder`) fica salva em
`LucasOL/Private/candidaturas/respostas-recorrentes.json`, entra no preset do
executor, vale como estimativa autorizada e reabre as vagas que só esperavam
por ela. Bloqueios de acesso são separados por causa: limite diário do LinkedIn
não pede nada de você; login de ATS e CAPTCHA pedem a bancada e o botão
**Reabrir** (`candidaturas:reabrir`), que devolve a vaga a `preenchendo` e,
se a missão dela terminou, transfere para a missão viva mais recente.

Reinícios do DailyWork não bloqueiam a missão: o app marca a missão como
`interrompida` com código `DAILYWORK_REINICIADO` ao desligar, o worker ganha
uma folga curta se o coordenador só atrasou, e a agenda retoma em ~20 s sem
consumir tentativas. Ver [Agenda diária](./agenda.md#persistência-e-recuperação).

Quando o LinkedIn atinge o limite diário de Candidatura simplificada, o
executor marca a fonte como esgotada no supervisor (`fontesEsgotadas`), o
prompt do ciclo seguinte proíbe Easy Apply e orienta busca sem `f_AL` e ATS
externos, e o painel avisa que não há ação sua.

**Observar agente** exibe o viewer da bancada `dailywork-candidaturas`, sem
trocar o workspace nem mover o ponteiro do usuário. A UI informa o workspace
alocado; workspaces 6–10 têm atalho `Super+n` (`Super+0` no 10) e o 11 pode ser
aberto por **Bancada dos agentes** no lançador.

O executor padrão é **nativo do DailyWork**: um processo supervisionado usa
`lib-agente-9router.cjs` e o modelo/provedor configurado no aplicativo. Ele não
abre Codex CLI nem depende desta conversa. Ciclos de até 30 rodadas continuam
com contexto e checkpoint, preservando a mesma missão. O prazo escolhido encerra a rodada; falhas sem nenhuma ação são reportadas para recuperação. Não há teto de ciclos ou de tokens;
atingir a meta conclui a missão. A interface mostra modelo, ações, ciclos,
consumo reportado e última atividade. Tokens são apenas uma métrica: não há orçamento diário nem bloqueio por consumo. Consumo monetário não é estimado.

Pausar e encerrar revogam novas ações e encerram somente o grupo de processos
da missão. Retomar abre nova janela, preserva vagas e provas e usa o executor
nativo pela interface. Envios iniciados exigem reconciliação no destino antes de
qualquer repetição. Checkpoint, histórico recente do modelo e impedimentos sobrevivem ao reinício; abas são
relidas ao reconectar. Uma falha de processo fica interrompida, nunca disfarçada
de execução ativa. Timeouts do Grok CLI continuam em outro ciclo, como os do 9Router. Abas abertas por links de vagas são acompanhadas pelo conector.

O executor carrega um preset compacto da identidade, formação, experiência,
faixa e respostas recorrentes antes da primeira decisão. Depois de ler uma
etapa do formulário, envia os preenchimentos independentes em lote e relê a
página apenas ao terminar o lote ou quando ocorre navegação/erro. O alvo de um
formulário comum é até dois minutos, com três decisões do modelo: abrir e ler,
preencher em lote, revisar e enviar. Cada ação e comprovante continua
persistido individualmente.

O antigo executor `codex` e `assumir {id,threadId}` permanecem disponíveis
para compatibilidade e diagnóstico explícito. Não são o fluxo autônomo padrão.
`execucao.tipo=sessao-codex` depende da tarefa identificada para progredir.

### Chromium da bancada de candidaturas

Toda navegação usa **`dailywork-candidaturas`**, nos workspaces **6–11**.
Agentes (nativo, Codex, jobsv3) seguem a skill `dailywork-bancada`: nome estável,
`ensure`/`cdp`, higiene de abas, sem Chromium pessoal e sem `stop` no meio da
missão. O endpoint vem exclusivamente do perfil persistente dessa bancada. O preparo
abre o navegador, recupera a sessão profissional autorizada e valida CDP antes
de chamar a IA. A conta é conferida pelos controles de edição do LinkedIn. O
conjunto importado inclui a identidade Google, Gupy e os ATS suportados. Se uma
atualização acrescentar um domínio, o preparo detecta que a sessão antiga está
incompleta e reimporta os vínculos disponíveis antes de abrir a vaga.
O Chromium pessoal dos workspaces 1–5 não é destino das automações, mesmo com
a mesma conta autorizada. A conexão da bancada dispensa “Allow” repetido.
Ver [Agenda diária — Chromium](./agenda.md#chromium).

Com a missão ativa, o supervisor aguarda a conexão e verifica a presença do
arquivo a cada 30 segundos, sem chamar o modelo. Ao habilitar, a execução
continua automaticamente dentro do prazo da missão. Pausar e encerrar também
interrompem essa espera. Recusas de conexão ou permissão não são repetidas.
Se a missão já estiver inativa, use **Retomar missão**. O anexo usa
`filechooser` e somente o PDF oficial da reserva. Screenshot é capturada pelo
processo, não recebida em base64 do modelo. Operações por aba não usam ponteiro
ou teclado globais. O aplicativo não contorna CAPTCHA, restrições de URL,
limites de plataforma ou recusas de permissão. Em páginas de login do ATS, o
executor tenta a sessão importada, o login social já autenticado e o retorno ao
formulário. `aguardando_acesso` só é registrado depois de o fluxo visível chegar
a senha, OTP, CAPTCHA ou permissão realmente indisponível; o registro informa
qual controle foi tentado.

Antes de registrar falta de informação, o executor consulta a política de
estimativas autorizadas. Meses ausentes da FIAP usam janeiro/dezembro como
limites do ano registrado; anos de stack sem valor próprio usam a experiência
total em software; pretensão usa o ponto médio da faixa aprovada, respeitando o
piso da missão. Stack específica não elimina a vaga. As respostas ficam
marcadas como estimativas com justificativa. Identidade, autorização legal,
endereço, cidadania e saúde permanecem fora dessa política.

Falta de informação que não possa ser estimada fica `aguardando_dado`; impedimento de navegador ou anexo
fica `aguardando_acesso`. Após resolver a causa, retome o registro existente
pelo `atualizar`, preservando respostas e evidências. Uma vaga descartada sem
intenção de envio também pode ser reaberta; não crie uma reserva duplicada.

O botão Iniciar autoriza a execução autônoma da missão inteira, incluindo envio
final dentro dos critérios. Não há nova confirmação por candidatura. Agendamento por
horário, conectores de retorno de
recrutadores e importação completa do histórico legado são extensões futuras.

## Perfil e fontes profissionais

Leia [carreira.md](./carreira.md) antes de selecionar o CV ou responder sobre
experiência profissional. Apenas AI Engineer e Software Engineer oficiais,
em PT/EN, podem ser anexados pelo módulo; cada reserva guarda uma cópia privada
do arquivo e seu hash.

No Omarchy, o perfil lógico `krocodile` usa o vínculo autorizado em
`~/.local/share/lucasol-skills/browserjobs/configuracao/perfis.json` (ou na raiz
`LUCASOL_SKILLS_DATA`). Siga `selecionar-perfil/references/omarchy.md`: fingerprint
da conexão mais identidade autenticada visível no LinkedIn. O antigo seletor
Windows e a obrigatoriedade de `metadata.profileName` não se aplicam a esse
vínculo. Não substituir a sessão profissional pelo navegador de Campanhas.

## API e execução por agentes

UI, IPC, API local e CLI usam `electron/lib-candidaturas.cjs`. Descubra operações
`candidaturas:*` pela [API local](./api.md). Também existe o cliente direto do
módulo, que funciona com o app fechado:

```bash
cd "Daily Work app"
node scripts/candidaturas.cjs contrato
node scripts/candidaturas.cjs estado
node scripts/candidaturas.cjs missao '{"id":"ID_DA_MISSAO"}'
node scripts/candidaturas.cjs controlar '{"id":"ID_DA_MISSAO","acao":"pausar"}'
node scripts/candidaturas.cjs reiniciar '{"criterios":{"termos":"FDE, Forward Deployed Engineer"}}'
node scripts/candidaturas.cjs responder '{"pergunta":"Are you willing to take a drug test?","resposta":"Yes"}'
node scripts/candidaturas.cjs reabrir '{"id":"ID_DA_CANDIDATURA"}'
```

`estado` devolve, por missão, `atencao` (diagnóstico com ação humana) e, no
topo, `pendencias` (perguntas sem fonte e bloqueios de acesso agrupados) e
`respostas` recorrentes. Pelo CLI, `reiniciar` e `iniciar` não passam pela
reserva da agenda; prefira a interface ou a API local com o app aberto.

Para objetos com dados pessoais, use `@arquivo.json` privado ou stdin (`-`),
preservando novas linhas. Não coloque respostas pessoais nos argumentos do
shell, em documentação pública ou no log geral do dia.

O fluxo é `reservar → atualizar → intencao → captura → resultado`. A ação
`autorizar` precede cada entrada no navegador. `pronta` exige respostas e nome
do PDF anexado. `confirmada` exige uma captura posterior à intenção de envio,
ligada à candidatura e ao destino. Resultado incerto fica `a_verificar`.

Capture o PNG/JPEG real na `pastaEntrada` da candidatura; `captura` recebe o nome
do arquivo, etapa, URL e texto observado. Registre um alias quando o formulário
mudar de URL. A leitura de evidências valida caminho e hash. Uma saída textual
do modelo, sozinha, não comprova envio.

Para anexar pelo navegador, inicie a espera de `filechooser` com tratamento de
erro antes de clicar no botão visível do currículo, identificado na página atual.
Um `input[type=file]` oculto pode não abrir o seletor. No Ashby, o botão de
autofill e o botão de anexo do campo Resume têm nomes parecidos; selecione o
controle do campo correto e confira o nome do PDF após `setFiles`. Timeout do
seletor, por si só, não indica falta de permissão. Se a leitura do DOM divergir
da tela, confira uma screenshot antes de repetir o preenchimento.

O banco impede reservas duplicadas por URL canônica e aliases. Antes de reservar,
consulte também `LucasOL/Portfolio/jobs/CONTINUAR-CANDIDATURAS.md`: ele contém
candidaturas anteriores à integração. Outros escritores só compartilham a
deduplicação transacional quando usam o serviço; não existe exclusividade sobre
um agente externo que ignore o módulo. Não executar um segundo helper de
contagem para missões já registradas aqui.

## Persistência e manutenção

Banco SQLite, respostas, snapshots de CV, capturas e logs ficam em
`LucasOL/Private/candidaturas/`, ignorados pelo Git. A pasta tem acesso restrito
ao usuário; UI e API são locais. Preserve eventos e evidências ao retomar.

Código do domínio em `electron/lib-candidaturas.cjs`; processos em
`electron/candidaturas/`; interface em `src/components/Candidaturas.tsx`.
Para validar: `node --test tests/candidaturas*.test.cjs`, `npm test` e
`npm run build`. Os testes isolam estado e executor e não enviam candidaturas.
O piloto real é uma missão normal, com confirmação externa e captura real;
seus dados continuam privados.

Conexão conforme [cliente oficial Chrome DevTools](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/browser.ts); suporte ao próprio perfil depende da depuração remota habilitada pelo usuário.

## Agenda compartilhada

A programação diária e os comandos manuais integrados ao coordenador estão documentados em [Agenda diária](./agenda.md). A ativação Linux migra o disparador anterior e mantém os históricos especializados deste módulo.

### Ciclo de vida das abas

O executor reutiliza URLs já abertas e oferece `navegador:fechar` para pesquisas e vagas concluídas. Formulários editados são preservados. As abas vinculadas à candidatura fecham automaticamente somente depois de persistir uma confirmação válida e seu comprovante. O vínculo sobrevive ao reinício do executor; fechar uma aba também a remove do registro. A limpeza nunca adota abas de outras missões.

### Cargos livres e alteração da busca

O painel mostra “Que vagas procurar agora?” com texto livre, por exemplo `FDE, Forward Deployed Engineer`. “Aplicar busca” grava as preferências e altera as próximas seleções da missão aberta pela operação `candidaturas:reorientar`. Preserva pausa, prazo, meta, confirmações e o snapshot dos critérios de cada candidatura já selecionada. As revisões ficam no histórico. A área identifica o CV de referência; os cargos não pertencem a um catálogo fechado. Modalidade e localização vêm dos filtros atuais, sem regra fixa de remoto/Brasil no executor. Formulários externos e de múltiplas etapas fazem parte da busca.
