---
name: aprendizado-em-post
description: Transforme um aprendizado diário comprovado em versões de publicação PT-BR ou EN para uma conta escolhida, preservando evidências e separando resultado, tentativa e plano.
---

Use esta skill quando houver um pedido para produzir uma pauta ou post a partir do trabalho registrado no DailyWork. A entrada é um recorte editorial publicável: tese, contexto mínimo, evidências e fontes. Não peça um dump do vault, transcripts privados ou credenciais.

1. Escolha uma tese que ajude o leitor a entender uma decisão técnica, uma descoberta ou uma entrega observável. Use o briefing e os exemplos aprovados do perfil editorial para escolher um assunto reconhecível por quem não conhece o projeto.
2. Classifique cada afirmação como resultado observado, tentativa ou plano. Escreva resultados somente quando houver registro ou evidência correspondente. Trate pedidos, intenções e desenhos como planos.
3. Adapte a versão ao idioma e à conta. PT-BR e EN são peças distintas; não coloque tradução bilíngue no mesmo texto. Mantenha linguagem fácil e direta, em primeira pessoa quando o contexto sustentar isso.
4. Devolva os campos do conector em JSON válido, sem texto fora do JSON. Respeite os limites do esquema antes de enfileirar. Um texto que excede limite ou inventa um campo é uma falha revisável.
5. Preserve `pautaId`, origem e fontes no artefato editorial. O texto é uma proposta para revisão humana; não publique, agende nem trate potencial de repercussão como fato.

Leia [quality.md](references/quality.md) antes de revisar a peça. A pauta deve explicar a função da mídia: captura, ilustração ou nenhuma. Imagens só ficam prontas após validação do arquivo e revisão visual aprovada contra a história; sem visão, registre a pendência. Uma captura do mesmo projeto não comprova uma função que não aparece nela.

Critério de conclusão: cada versão tem uma tese clara, afirmações rastreáveis às evidências da entrada, idioma adaptado, JSON compatível com o conector e uma pendência explícita quando a prova não basta.
