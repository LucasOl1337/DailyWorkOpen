const { test } = require('node:test')
const assert = require('node:assert/strict')
const { criarCuradoriaMidia, PROPOSITOS_PADRAO } = require('../electron/lib-curadoria-midia.cjs')

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const PAUTA = { titulo: 'Fila editorial vira galeria', texto: 'Os cards viraram capas quadradas com a arte do post.', idioma: 'pt-BR', conta: 'linkedin', fontes: [{ rotulo: 'commit', url: 'https://example.test' }], origem: { tipo: 'dia', dia: '2026-09-09' } }
const INTENCAO = { output_purpose: 'information-explainer', output_topology: 'single-frame', text_policy: 'optional', aspect_ratio: '4:5', consulta: 'editorial gallery covers', must_not_infer: ['revenue'], publico: 'pt-BR technical readers' }
const PLANO = { id: 'editorial-proof', title: 'T', scene: 'S', action: 'A', composition: 'C', camera: '50mm', lighting: 'L', styling: 'ST', palette: 'ink', mood: 'M', style_direction: 'SD', aspect_ratio: '4:5', avoid: ['x'], text_content: '' }

function curadoriaCom(respostas) {
  const fila = [...respostas]
  const completar = async () => {
    const proxima = fila.shift()
    if (!proxima) throw new Error('sem resposta programada')
    if (proxima instanceof Error) throw proxima
    return { mensagem: typeof proxima === 'string' ? proxima : JSON.stringify(proxima) }
  }
  const completarComImagens = completar
  return criarCuradoriaMidia({ completar, completarComImagens })
}

test('intenção e revisão visual usam o mesmo perfil editorial preservado na peça', async () => {
  const perfil = { tipo: 'perfil_editorial', versao: 4, hash: 'snapshot-da-peca', diretrizes: 'Captura simples do assunto descrito.' }
  const historia = { tema: 'Uma necessidade concreta.', problema: 'Faltava um fluxo visível.', resolucao: 'A pessoa criou e usa diariamente.', conclusao: 'O projeto está disponível e mantém o fluxo.', tese: 'Uma tese.', leitor: 'Quem escreve.', limites: 'Sem adoção.', midia: {}, evidencias: [] }
  const pauta = { ...PAUTA, editorial: { perfilEditorial: perfil, pauta: historia } }
  const vistas = []
  const curadoria = criarCuradoriaMidia({
    completar: async entrada => { vistas.push(entrada); return { mensagem: JSON.stringify(INTENCAO) } },
    completarComImagens: async entrada => {
      vistas.push(entrada)
      return { mensagem: JSON.stringify({ vereditos: [{ provedor: 'codex', accepted: true, identity_fidelity: 'pass', topology: 'pass', text: 'pass', intent_alignment: 'pass', notes: 'Captura pertinente.' }], vencedor: 'codex' }) }
    },
  })
  await curadoria.intencao({ pauta })
  await curadoria.revisarSaidas({ pauta, intencao: { ...INTENCAO, reference_mode: 'unchanged-verified-capture' }, saidas: [{ provedor: 'codex', base64: PNG_1PX }] })
  assert.match(vistas[1].mensagens[0].content, /arquivo exato que o editor já selecionou/)
  assert.equal(JSON.parse(vistas[1].mensagens[1].content).intencao.reference_mode, 'unchanged-verified-capture')
  for (const chamada of vistas) {
    const pacote = JSON.parse(chamada.mensagens[1].content).pauta
    assert.deepEqual(pacote.perfil_editorial, perfil)
    assert.equal(pacote.historia.tema, historia.tema)
    assert.equal(pacote.historia.problema, historia.problema)
    assert.equal(pacote.historia.resolucao, historia.resolucao)
    assert.equal(pacote.historia.conclusao, historia.conclusao)
  }
  assert.equal(vistas[1].imagens.length, 1)
  assert.equal(vistas[1].imagens[0].base64, PNG_1PX)
})

test('intenção valida taxonomia, enums e proporção', async () => {
  const curadoria = curadoriaCom([INTENCAO])
  const saida = await curadoria.intencao({ pauta: PAUTA, propositos: PROPOSITOS_PADRAO })
  assert.equal(saida.output_purpose, 'information-explainer')
  assert.equal(saida.text_policy, 'optional')

  const invalida = curadoriaCom([
    { ...INTENCAO, output_purpose: 'proposito-inventado' },
    { ...INTENCAO, output_topology: 'holograma' },
    { ...INTENCAO, aspect_ratio: 'largo' },
  ])
  await assert.rejects(() => invalida.intencao({ pauta: PAUTA, propositos: PROPOSITOS_PADRAO }), /propósito fora da taxonomia|topologia inválida|proporção inválida/)
})

test('seleção exige casos e templates do conjunto buscado', async () => {
  const casos = [{ id: 261, title_pt: 'A', semantics: {} }, { id: 262, title_pt: 'B', semantics: {} }]
  const templates = [{ id: '02-charts-infographics/01-standard', topologia: 'single-frame' }]
  const curadoria = curadoriaCom([{ case_ids: [261], template_id: '02-charts-infographics/01-standard' }])
  const saida = await curadoria.selecionarMecanismos({ pauta: PAUTA, intencao: INTENCAO, casos, templates })
  assert.deepEqual(saida.case_ids, [261])

  const fora = curadoriaCom([{ case_ids: [999], template_id: '02-charts-infographics/01-standard' }, { case_ids: [261], template_id: 'template/inventado' }])
  await assert.rejects(() => fora.selecionarMecanismos({ pauta: PAUTA, intencao: INTENCAO, casos, templates }), /fora do conjunto|fora da listagem/)

  const vazia = curadoriaCom([])
  await assert.rejects(() => vazia.selecionarMecanismos({ pauta: PAUTA, intencao: INTENCAO, casos: [], templates }), /não devolveu casos/)
})

test('plano criativo exige campos e honra a política de texto', async () => {
  const curadoria = curadoriaCom([PLANO])
  const plano = await curadoria.planoCriativo({ pauta: PAUTA, intencao: INTENCAO, selecao: { case_ids: [261], template_id: 't/1' } })
  assert.equal(plano.id, 'editorial-proof')
  assert.equal(plano.text_content, '')

  // Política forbidden descarta texto mesmo quando o modelo insiste.
  const comTexto = curadoriaCom([{ ...PLANO, text_content: 'TEXTO GRANDE' }])
  const proibido = await comTexto.planoCriativo({ pauta: PAUTA, intencao: { ...INTENCAO, text_policy: 'forbidden' }, selecao: { case_ids: [261], template_id: 't/1' } })
  assert.equal(proibido.text_content, '')

  // Política required sem text_content reprova.
  const semTexto = curadoriaCom([{ ...PLANO, text_content: '' }, { ...PLANO, text_content: '' }])
  await assert.rejects(() => semTexto.planoCriativo({ pauta: PAUTA, intencao: { ...INTENCAO, text_policy: 'required' }, selecao: { case_ids: [261], template_id: 't/1' } }), /text_content/)

  // avoid como frase única é normalizado para array.
  const frase = curadoriaCom([{ ...PLANO, avoid: 'logos; métricas inventadas' }])
  const normalizado = await frase.planoCriativo({ pauta: PAUTA, intencao: INTENCAO, selecao: { case_ids: [261], template_id: 't/1' } })
  assert.deepEqual(normalizado.avoid, ['logos', 'métricas inventadas'])
})

test('revisão visual sem completador de visão falha com VISAO_INDISPONIVEL', async () => {
  const curadoria = criarCuradoriaMidia({ completar: async () => ({ mensagem: '{}' }) })
  await assert.rejects(
    () => curadoria.revisarSaidas({ pauta: PAUTA, intencao: INTENCAO, plano: PLANO, saidas: [{ provedor: 'grok', base64: PNG_1PX }] }),
    (e) => e.codigo === 'VISAO_INDISPONIVEL',
  )
})

test('revisão visual cobre todos os provedores e coerência accepted/critérios', async () => {
  const saidas = [
    { provedor: 'grok', nome: 'grok.png', mimeType: 'image/png', base64: PNG_1PX },
    { provedor: 'codex', nome: 'codex.png', mimeType: 'image/png', base64: PNG_1PX },
  ]
  // accepted=true com critério fail não pode coexistir: vira reprovado.
  const incoerente = curadoriaCom([{ vereditos: [
    { provedor: 'grok', accepted: true, identity_fidelity: 'pass', topology: 'fail', text: 'pass', intent_alignment: 'pass', notes: 'topologia errada' },
    { provedor: 'codex', accepted: true, identity_fidelity: 'pass', topology: 'pass', text: 'pass', intent_alignment: 'pass', notes: 'boa' },
  ], vencedor: 'grok' }])
  const revisao = await incoerente.revisarSaidas({ pauta: PAUTA, intencao: INTENCAO, plano: PLANO, saidas })
  assert.equal(revisao.vereditos[0].accepted, false)
  // Vencedor inválido (reprovado) cai para o primeiro aceito.
  assert.equal(revisao.vencedor, 'codex')

  // Veredito faltante para um provedor reprova a resposta (duas vezes: a
  // curadoria tenta de novo com correção e a validação se mantém).
  const parcial = { vereditos: [{ provedor: 'grok', accepted: true, topology: 'pass', text: 'pass', intent_alignment: 'pass', identity_fidelity: 'pass', notes: 'ok' }], vencedor: 'grok' }
  const faltante = curadoriaCom([parcial, parcial])
  await assert.rejects(() => faltante.revisarSaidas({ pauta: PAUTA, intencao: INTENCAO, plano: PLANO, saidas }), /sem veredito para codex/)
})

test('retentativa de parse anexa correção e respostas em prosa são extraídas', async () => {
  const curadoria = curadoriaCom(['não é json', `Aqui está o plano:\n\`\`\`json\n${JSON.stringify(INTENCAO)}\n\`\`\``])
  const saida = await curadoria.intencao({ pauta: PAUTA, propositos: PROPOSITOS_PADRAO })
  assert.equal(saida.output_purpose, 'information-explainer')
})
