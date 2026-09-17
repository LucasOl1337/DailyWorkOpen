# Agenda diária do DailyWork

## Operação

Os painéis de Campanhas (por empresa), Candidaturas, Fila e Sumário mostram a programação do dia, atividade atual, próximo horário, impedimentos, consumo reportado e referências aos resultados especializados. Abra **Rotinas e horários** para alterar dias, fuso, metas, executores e contas. Rodadas extras usam o saldo diário; aumentar a meta exige salvar a configuração.

**Orientações para hoje** são internas, prevalecem nas próximas decisões e expiram na virada do dia. A opção global vale para todos os módulos. Alterações invalidam a autorização dos trabalhadores antes da próxima ação; não apagam envios já feitos. Pausas humanas e horários alterados manualmente não são desfeitos pelo planejamento.

Horários iniciais em America/Sao_Paulo, todos os dias: planejamento 08h; pesquisa das campanhas 09h e ações 09h30; candidaturas 10h/15h; produção 11h/17h; publicação 12h/18h; balanço 20h. A coleta mantém o intervalo de 15 minutos até 23h59 e a reconciliação de análises anteriores. Publicações com horário próprio são verificadas a cada minuto. No painel, verificações concluídas repetidas são agrupadas; erros continuam visíveis.

As preferências salvas de candidaturas e produção são importadas na primeira criação das rotinas. A meta padrão de candidaturas é de 60 confirmações diárias, distribuída em duas rodadas de 30; meta, quantidade e duração continuam editáveis. Quantidade de pautas e quantidade de versões editoriais são registradas separadamente. A publicação preserva a política existente, revisão e exigência de mídia; uma rotina ativa não libera peças reprovadas.

Tokens reportados são uma métrica de acompanhamento, sem teto diário ou bloqueio do executor. A configuração antiga é removida automaticamente na abertura do banco; o histórico de consumo permanece preservado. O perfil padrão do aplicativo é Grok 4.6.

## Persistência e recuperação

`Daily Work app/electron/agenda/` contém o coordenador. O banco privado fica em `LucasOL/Private/agenda/estado.sqlite` com permissão 0600. Armazena rotinas, ocorrências, instruções, pausas, eventos e contexto; comprovantes e dados de candidaturas permanecem nos serviços especializados.

Uma reserva única por recurso integra disparos manuais e agendados. O processo coordenador é identificado por PID e instante de criação, atualiza seu sinal de vida a cada ciclo e os trabalhadores conferem sua autoridade antes das ações. Falhas transitórias têm novas tentativas após 1, 5 e 15 minutos, dentro da janela diária; o limite de tentativas conta **falhas seguidas** (`falhas`), zeradas quando a rodada registra progresso real ou quando você retoma manualmente. Reinício do DailyWork (`REINICIO_DAILYWORK`, vindo de uma missão de candidaturas marcada `DAILYWORK_REINICIADO`, `COORDENADOR_INDISPONIVEL` ou `PROCESSO_TERMINOU`) retoma em 20 s e não consome tentativas. Reinícios consultam referências e checkpoints; dias anteriores não geram disparos acumulados. Envios incertos exigem reconciliação nos módulos antes de qualquer repetição.

O contexto reúne blocos, inputs e análises dos últimos 30 dias, acervo e histórico editorial. A IA escolhe dias e argumentos, registra fontes e justificativa e reutiliza a análise quando o conteúdo não muda. Fontes são tratadas como dados, nunca como instruções humanas. Identificadores aceitos na seleção incluem `dia:AAAA-MM-DD` e IDs de blocos do acervo.

## Chromium

Candidaturas usam o Chromium persistente de **`dailywork-candidaturas`**, exclusivamente nos workspaces **6–11**. Agentes carregam `dailywork-bancada` e o script `preparar`; o app já faz `ensure`/`cdp` e grava `.keep` no login. O conector lê somente `~/.agents/desktop/sessions/dailywork-candidaturas/chromium/DevToolsActivePort`; não há fallback para o endpoint do Chromium pessoal. O preparo recupera a bancada, valida CDP e importa a sessão dos sites profissionais selecionados pelo mecanismo existente, mantendo os dados no armazenamento privado. A conta é conferida na interface da bancada.

O `agent-bench browser` configura depuração local em porta aleatória e dispensa “Allow” por conexão. Esse modo de inicialização é diferente da aprovação por conexão em `chrome://inspect/#remote-debugging`, conforme o [código do Chromium](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/devtools/remote_debugging_server.cc). A autorização de depuração não permite usar janelas humanas.

**Correção de 15/09/2026:** o pedido de usar a conta pessoal foi inicialmente interpretado como uso da janela pessoal. Ficou esclarecido que toda navegação de agentes, inclusive CDP/Playwright, deve ficar na bancada. O executor e as políticas globais foram corrigidos. Campanhas usam `dailywork-campanhas`; candidaturas usam a bancada própria, com trava de controle humano antes de cada ação. Conexão ausente é verificada antes de chamadas à IA. CAPTCHA, credenciais ou dados ausentes ficam como impedimentos por item.

## Instalação Linux

No diretório `Daily Work app`:

```bash
npm run build
npm run install:agenda
npm run install:agenda -- --execute
npm run install:agenda -- --execute --activate
```

Sem flags, somente mostra os caminhos. `--execute` instala a unidade sem iniciar ou habilitar. `--activate` instala o hook de sessão, migra o autostart e o timer antigo da Cognition, encerra a instância anterior com SIGTERM e inicia `dailywork.service`. Requer sessão gráfica iniciada. Fechar a janela mantém a execução; sair explicitamente do app encerra o serviço até novo início.

```bash
systemctl --user status dailywork.service
journalctl --user -u dailywork.service -n 60
npm run agenda:parar
npm run agenda:parar -- --execute
```

O comando de parada sem flag lista o que pode agir. Com `--execute`, desliga recorrências, pausa os módulos, solicita cancelamento aos executores e verifica as ocorrências ativas. A API permanece disponível. Para voltar, reative as rotinas e escolha **Retomar hoje**.

## API e validação

IPC e API local autenticada expõem `agenda:estado`, `agenda:detalhes`, `agenda:configurar`, `agenda:instruir`, `agenda:executar` e `agenda:controlar`. Configuração e instruções usam revisão otimista. O servidor Vite utiliza banco isolado e não inicia a agenda.

Testes: `tests/agenda.test.cjs` cobre relógio controlado, três dias, reinício, concorrência, pausas, metas, consumo informativo e revisão. `tests/agenda-integracao.test.cjs` cobre contexto, adaptadores, qualidade editorial, recibos e Chromium indisponível, além da validação da unidade pelo systemd. Capturas Electron usam dados isolados; não comprovam um envio real.
