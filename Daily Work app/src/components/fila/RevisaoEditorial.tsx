import type { ItemEditorial } from '../../lib/editorial'

export function RevisaoEditorial({ item }: { item: ItemEditorial }) {
  if (item.origem?.tipo === 'manual') {
    return <p className="fila-helper" data-testid="fila-revisao-manual">Escrito à mão. Revise o texto e publique quando estiver pronto.</p>
  }
  const editorial = item.editorial
  if (!editorial) return <p className="fila-helper">Esta peça não tem avaliação do novo editor. Revise o texto e suas fontes antes de publicar.</p>
  const { pauta, qualidade } = editorial
  if (qualidade?.estado === 'pedido_direto') {
    return <section className="fila-revisao-editorial" data-testid="fila-revisao-pedido">
      <div className="fila-revisao-heading"><strong>Pedido direto, sem revisão de evidências</strong><span>Confira o texto antes de publicar</span></div>
      {pauta?.tese && <p className="fila-revisao-tese">{pauta.tese}</p>}
      {qualidade.parecer && <p>{qualidade.parecer}</p>}
      <p className="fila-helper">O redator escreveu a partir do seu pedido. A decisão final é sua.</p>
    </section>
  }
  if (!pauta?.midia || !Array.isArray(pauta.evidencias) || !qualidade) return <p className="fila-helper">Avaliação editorial incompleta. Confira as fontes desta peça.</p>
  const aprovada = qualidade.estado === 'aprovada' && qualidade.aprovado
  return <section className="fila-revisao-editorial" data-testid="fila-revisao-editorial">
    <div className="fila-revisao-heading"><strong>{aprovada ? 'Texto revisado pelo editor' : 'Texto alterado após a revisão'}</strong><span>{aprovada ? 'Aguardando sua decisão' : 'Confira novamente as afirmações'}</span></div>
    <p className="fila-revisao-tese">{pauta.tese}</p>
    <dl className="fila-historia">
      {pauta.tema && <div><dt>Tema</dt><dd>{pauta.tema}</dd></div>}
      {pauta.problema && <div><dt>Problema</dt><dd>{pauta.problema}</dd></div>}
      {pauta.resolucao && <div><dt>Resolução</dt><dd>{pauta.resolucao}</dd></div>}
      {pauta.conclusao && <div><dt>Conclusão</dt><dd>{pauta.conclusao}</dd></div>}
      <div><dt>Para quem</dt><dd>{pauta.leitor}</dd></div>
      <div><dt>Por que vale publicar</dt><dd>{pauta.interesse}</dd></div>
      <div><dt>Limite da afirmação</dt><dd>{pauta.limites}</dd></div>
      <div><dt>Direção da mídia · {pauta.midia.tipo === 'nenhuma' ? 'só texto' : pauta.midia.tipo === 'captura' ? 'captura real' : 'ilustração'}</dt><dd>{pauta.midia.objetivo}</dd></div>
    </dl>
    <details><summary>Evidências e avaliação</summary><div className="fila-evidencias">{pauta.evidencias.map(e => <blockquote key={e.id}><p>{e.trecho}</p><footer>{e.sustenta}</footer></blockquote>)}</div>{qualidade.parecer && <p>{qualidade.parecer}</p>}<p className="fila-helper">Revisão automática do registro selecionado; a decisão final é sua.</p><details><summary>Detalhes da produção</summary><ul>{editorial.execucoes?.map((e, i) => <li key={i}>{e.etapa}: {e.perfilUsado || e.perfilSolicitado || 'modelo não registrado'}{e.duracaoMs ? ` · ${Math.round(e.duracaoMs / 1000)} s` : ''}</li>)}</ul><small>Critérios editoriais: {editorial.versao}</small></details></details>
    {item.feedback?.motivo && <p><strong>Seu feedback:</strong> {item.feedback.motivo}</p>}
  </section>
}
