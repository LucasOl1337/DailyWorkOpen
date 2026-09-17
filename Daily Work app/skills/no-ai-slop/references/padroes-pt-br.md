# Padrões de AI slop em PT-BR (adaptação do DailyWork)

`SKILL.md` e `eval.md` são a cópia versionada da skill no-ai-slop de Peter
Yang (MIT, commit 000650b de 01/09/2026). Este arquivo é a adaptação para
os textos que o DailyWork produz: posts em português e inglês para X e
LinkedIn, mensagens e candidaturas das Automações. A camada determinística
que aplica esta lista está em `electron/lib-estilo-slop.cjs`; o modelo recebe
o resumo compacto do catálogo e o instrução de citar linha, nomear padrão e
dar a correção.

## Dois níveis, por causa da calibração

Os exemplos que o titular aprovou em `LucasOL/Knowledge/Editorial/referencias.json`
violam padrões da skill original de propósito: 0xSero abre com pergunta
retórica e fecha com fragmento ("The OS for local AI. All in."); Alan Nicolas
abre com rótulo em caixa alta e dois-pontos ("DICA CONTRAINTUITIVA:"). Se o
catálogo reprovasse por isso, reprovaria a referência. Por isso:

- **duro** reprova sozinho e pede reescrita: marcador Markdown, travessão de
  aparte, contraste binário, listagem negativa, falsa revelação, setup
  retórico, gerúndio de análise superficial, puffery de importância, palavra
  banida, atribuição vaga, recap final, kicker profundo, bloco de hashtags.
- **suave** só orienta: frase vazia, pigarro de abertura, metadiscurso,
  dois-pontos dramático, fragmento de efeito, ritmo robótico, cadência
  uniforme, estrutura de case, conclusão sintética, CTA automático, abertura
  genérica, emoji decorativo. Dois ou mais suaves pedem reescrita.

O que o regex não pega e fica com o revisor de modelo: rodízio de sinônimos,
voz passiva com coisa fazendo verbo humano, abstração no lugar de nome,
número ou mecanismo, e a frase portável que serviria para qualquer produto.

## Equivalentes em português

| Padrão da skill | Forma em PT-BR que o catálogo procura |
| --- | --- |
| Binary contrast | "Não é X. É Y.", "A questão não é X, é Y", "não é só X, é Y" |
| Throat-clearing opener | "Vou ser sincero", "A verdade é que", "Sejamos honestos", "É o seguinte:" |
| Faux-insight setup | "O que ninguém te conta", "A parte que todo mundo erra", "Pouca gente fala disso" |
| Colon reveal | "O melhor: ele aprende.", "A sacada: um agente separado avalia." |
| Dramatic fragment | "É isso. Só isso.", "Simples assim.", "E pronto." |
| Superficial analysis | ", destacando o compromisso", ", reforçando a importância" |
| Importance puffery | "divisor de águas", "marco", "muda tudo", "revoluciona", "de ponta", "transformador" |
| Weasel attribution | "especialistas dizem", "estudos mostram", "amplamente reconhecido", "todo mundo sabe" |
| Fake-profound kicker | "O futuro já chegou", "O resto é detalhe", "Tudo se resume a" |
| Summary-recap ending | "Em resumo", "No fim das contas", "Moral da história" |
| Interpretive metadiscourse | "Essa parte importa", "O ponto principal é", "Como você pode ver", "Repare que" |
| Words to cut | potencializar, alavancar, impulsionar, robusto, sinergia, empoderar, meticuloso, multifacetado, "mergulhar em", "jornada do usuário", "no mundo de hoje", "na era da" |
| Empty phrases | "vale ressaltar", "é importante destacar", "dito isso", "nesse sentido", "em outras palavras" |
| Em dashes | qualquer travessão (—, –) ou hífen espaçado dentro da frase; regra permanente de Lucas |

## O que preservar

Pergunta de abertura, fragmento curto de opinião, rótulo em CAIXA ALTA, gíria
(tá, pra, né, cara), palavrão leve, opinião forte e admissão de dúvida são a
voz de Lucas, não slop. O critério é o da skill original: corte o molde,
mantenha o que só ele diria. Um texto curto, específico e com opinião passa
sem precisar parecer relatório.

## Como o feedback entra

Quando o titular recusa uma peça e explica o motivo, o registro vai para
`Daily Work app/data/editorial/feedback.ndjson` e, se for preferência
explícita, para o perfil em `LucasOL/Knowledge/Editorial/perfil-editorial.md`.
Novos padrões PT-BR descobertos nesse feedback entram aqui e no catálogo com
um teste de calibração: os exemplos aprovados continuam passando, os
rejeitados continuam sendo pegos.
