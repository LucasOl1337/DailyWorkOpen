# Editorial, automacoes e publicacao

SOMENTE ao alterar fila editorial, midia, automacoes ou publicacao externa no DailyWork.

## Fila editorial

- Opere a fila pela interface ou pelas operacoes `editorial:*` descobertas com `node scripts/api.cjs capacidades`.
- Trate `data/editorial/itens/*.json` como estado canonico e `data/editorial/_auditoria.ndjson` como trilha de auditoria.
- Envie a `revisao` atual em cada edicao, agendamento ou publicacao. Edicao de conteudo incrementa a revisao e revoga agenda anterior.
- Mantenha midias dentro de `data/editorial/midias/`. O servico valida caminho, hash e revisao.
- Trate resultado de rede incerto como `incerto`; confira a plataforma antes de repetir.

## Automacoes

O painel tem dois módulos: **Campanhas** e **Candidaturas**. Para busca de
vagas, envio de currículo, respostas e comprovantes, seguir
[candidaturas.md](./candidaturas.md). Os itens abaixo pertencem a Campanhas;
a fila de candidaturas não é a Fila editorial.

- Descubra campanhas e executores por `automacoes:catalogo`.
- Guarde cada campanha em `LucasOL/Portfolio/empresas/<id>/`.
- Trate `estado.json.local`, filas, locks, sessoes e execucoes como runtime local; nao os versione.
- Prepare o ciclo com o contexto e o material da campanha.
- Preserve a `revisao` ao salvar campanha, pesquisa ou selecao; em conflito, releia e reconcilie.
- Registre o recibo externo antes de marcar a interacao como enviada.

## Validar

Projetos com `captura` em `data/editorial/fontes-projetos/<id>.json` produzem a sequência do produto antes da redação. O pedido declara executor, capacidade e uma a quatro cenas em ordem. O serviço `electron/lib-captura-editorial.cjs` exige arquivos, versão, origem dos dados, estado observado e inspeção visual; mantém manifesto e recibo em `data/editorial/capturas/`. A seleção e o job final preservam todas as cenas aprovadas.

O executor inicial `omarchy-agents` abre o componente QML real em bancada exclusiva e lê o estado local real em modo somente leitura. A adaptação X11 afeta a hospedagem da janela; os controles e números vêm do produto. Capturas editoriais precisam declarar `ambiente: produto-real` e `dados: reais`; demo, mock, fixture, conta fictícia e dados sintéticos são recusados antes de chegar à Fila. Outros aplicativos precisam de executor próprio registrado no serviço. A skill `captura-editorial` descreve a integração. Uma história sem tela adequada retorna `CAPTURA_NECESSARIA`, sem ser convertida em post sobre documentação.

Para validar captura, texto, visão e anexo usando os modelos locais e uma Fila isolada, execute `node scripts/validar-captura-omarchy.cjs <diretório novo> <caminho-do-produto>` dentro do app. O ensaio não tem transporte de publicação. A suíte normal usa fixtures e não abre bancada nem chama modelos.

```bash
cd "Daily Work app"
npm test
npm run build
```

As fontes principais sao `electron/lib-fila-editorial.cjs`, `electron/lib-producao-editorial.cjs`, `electron/lib-jobs-midias-editoriais.cjs` e `electron/automacoes/`.

## Agenda compartilhada

A programação diária e os comandos manuais integrados ao coordenador estão documentados em [Agenda diária](./agenda.md). A ativação Linux migra o disparador anterior e mantém os históricos especializados deste módulo.

## Produção automática e retomada

A Fila mostra `Gerar agora`, `Recomeçar produção` e `Ativar/Pausar automático`.
A Agenda é o único coordenador recorrente: o servidor Vite não inicia produtores
nem publicadores em paralelo. A geração avulsa preserva a recorrência desativada
e as pausas dos outros módulos. As preferências de quantidade, redes, idiomas,
estoque e perfil são compartilhadas com a rotina de produção da Agenda.

A descoberta automática inclui fontes verificadas dos projetos com atividade nos
últimos 30 dias e o contexto diário. Uma fonte já produzida é reconhecida pelo
projeto, hash, rede e idioma, mesmo que tenha entrado antes por um lote mensal.
Impedimentos por falta de evidência ficam registrados por até 24 horas; mudar a
fonte ou escolher `Recomeçar produção` permite reavaliar. Uma história recusada
não consome a quantidade solicitada: o produtor passa à próxima fonte.

`Recomeçar fila` pede confirmação antes de arquivar rascunhos elegíveis e iniciar
um lote. Publicações, agendamentos e envios em andamento permanecem preservados.
Gerar e publicar são permissões separadas.

Nas preferências, `Vídeo curto com imagens` monta as imagens revisadas em cenas
sem narração, renderiza um MP4 e revisa os quadros antes do anexo. A retomada de
uma imagem incompleta também termina o vídeo solicitado antes de contar sucesso.
O perfil da produção orienta seleção, redação e revisão; uma correção pode usar o
perfil explícito do editor. O prazo do provedor reserva tempo para o fallback.
