import { useEffect, useState } from 'react'
import { gerarMaterialAutomacao, obterMaterialAutomacao, prepararContextoAutomacao } from '../../lib/api'
import type { ContextoAutomacao, MaterialAutomacao, PedidoContextoAutomacao, TipoMaterialAutomacao } from '../../lib/automacoes'
import { TextoFonte } from './Contexto'

export function Materiais({ campanhaId, materiais, fontes, revisao, selecaoPendente, atualizar, abrirContexto }: { campanhaId: string; materiais: MaterialAutomacao[]; fontes: number; revisao: string; selecaoPendente: boolean; atualizar: () => void; abrirContexto: (id: string) => void }) {
  const [tipo, setTipo] = useState<TipoMaterialAutomacao>('mensagem')
  const [idioma, setIdioma] = useState<'pt-BR' | 'en'>('pt-BR')
  const [alvoUrl, setAlvoUrl] = useState('')
  const [briefing, setBriefing] = useState('')
  const [contexto, setContexto] = useState<ContextoAutomacao | null>(null)
  const [material, setMaterial] = useState<MaterialAutomacao | null>(null)
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  useEffect(() => { setContexto(null) }, [tipo, idioma, alvoUrl, briefing, revisao])
  async function preparar() {
    setOcupado('contexto'); setErro(''); setMaterial(null); setAviso('')
    try { setContexto(await prepararContextoAutomacao({ tipo, idioma, alvoUrl, briefing } satisfies PedidoContextoAutomacao, campanhaId)) }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível preparar o contexto.') }
    finally { setOcupado('') }
  }
  async function gerar() {
    if (!contexto) return
    setOcupado('gerando'); setErro(''); setAviso('')
    try { setMaterial(await gerarMaterialAutomacao({ contextoId: contexto.id }, campanhaId)); atualizar() }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível gerar.'); atualizar() }
    finally { setOcupado('') }
  }
  async function abrir(id: string) {
    setOcupado('abrindo'); setErro(''); setAviso('')
    try { setMaterial(await obterMaterialAutomacao(id, campanhaId)) }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível abrir.') }
    finally { setOcupado('') }
  }
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('materialAutomacao')
    if (id) void abrir(id)
  }, [])
  function baixar() {
    if (!material?.texto) return
    const url = URL.createObjectURL(new Blob([material.texto], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `${material.tipo}-${material.id}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="auto-workspace" data-testid="automacoes-materiais">
    <section className="auto-composer">
      <span className="auto-eyebrow">Preparar com a sua base</span><h2>Do contexto ao texto</h2><p className="auto-muted">Prepare um rascunho para revisar. Nada é enviado nesta etapa.</p>
      <form onSubmit={e => { e.preventDefault(); void preparar() }}>
        <fieldset disabled={Boolean(ocupado)}><legend className="auto-sr-only">Pedido do material</legend>
          <div className="auto-form-row"><label className="auto-field">Material<select value={tipo} onChange={e => setTipo(e.target.value as TipoMaterialAutomacao)}><option value="mensagem">Mensagem</option><option value="candidatura">Candidatura / formulário</option><option value="curriculo">Currículo adaptado</option></select></label><label className="auto-field">Idioma<select value={idioma} onChange={e => setIdioma(e.target.value as 'pt-BR' | 'en')}><option value="pt-BR">Português</option><option value="en">English</option></select></label></div>
          <label className="auto-field">Link da pessoa ou vaga <span>opcional</span><input type="text" inputMode="url" autoComplete="url" spellCheck={false} value={alvoUrl} onChange={e => setAlvoUrl(e.target.value)} placeholder="https://…" maxLength={2000} /></label>
          <label className="auto-field">O que você quer comunicar?<textarea value={briefing} onChange={e => setBriefing(e.target.value)} minLength={10} maxLength={8000} required rows={6} placeholder="Cole os requisitos da vaga ou explique quem é a pessoa, o motivo do contato e o que vale destacar." /></label>
          <p className="auto-muted">O conteúdo do link não é buscado automaticamente. Cole no pedido as informações relevantes. Currículos são preparados como texto editável.</p>
          <button className="auto-button auto-button--primary" type="submit" disabled={selecaoPendente || !fontes}>{ocupado === 'contexto' ? 'Preparando…' : `Preparar contexto · ${fontes} fontes`}</button>
        </fieldset>
      </form>
      {selecaoPendente && <p className="auto-notice">Salve a seleção da biblioteca para usar a nova base.</p>}
      {contexto && <div className="auto-context-ready"><strong>Base pronta para esta geração</strong><p>{contexto.fontes.length} fontes · {contexto.caracteres.toLocaleString('pt-BR')} caracteres</p><div className="auto-actions"><button className="auto-button" onClick={() => abrirContexto(contexto.id)}>Inspecionar contexto</button><button className="auto-button auto-button--primary" disabled={Boolean(ocupado) || selecaoPendente} onClick={() => void gerar()}>{ocupado === 'gerando' ? 'Gerando material…' : 'Gerar material'}</button></div></div>}
      {erro && <p className="auto-notice auto-notice--error" role="alert">{erro}</p>}
    </section>
    <section className="auto-material-reader" aria-live="polite" aria-busy={Boolean(ocupado)}>
      {material ? <><span className="auto-eyebrow">{material.status === 'pronto' ? 'Rascunho · ainda não enviado' : material.status}</span><h2>{material.titulo}</h2>
        <p className="auto-muted">{new Date(material.criadoEm).toLocaleString('pt-BR')}{material.modelo && ` · ${material.modelo.nome}`}{material.fallback && ' · modelo alternativo utilizado'}</p>
        <div className="auto-actions"><button className="auto-button" onClick={() => abrirContexto(material.contextoId)}>Ver a base usada</button><span className="auto-muted">{material.fontesUsadas.length} referências citadas</span></div>
        {material.erro && <p className="auto-notice auto-notice--error">{material.erro}</p>}
        {material.texto && <TextoFonte texto={material.texto} />}
        {material.lacunas.length > 0 && <div className="auto-notice"><strong>Pontos para conferir</strong><ul>{material.lacunas.map((l, i) => <li key={i}>{l}</li>)}</ul></div>}
        <div className="auto-attribution"><strong>{material.fontesUsadas.length} referências citadas pelo modelo</strong><p>A atribuição é declarada pelo modelo. Confira o conteúdo e os limites das fontes antes de usar.</p><ul>{material.fontesUsadas.map(f => <li key={f}>{f.split('/').pop()}</li>)}</ul></div>
        <div className="auto-actions">{material.texto && <><button className="auto-button" onClick={() => void navigator.clipboard.writeText(material.texto!).then(() => setAviso('Texto copiado.')).catch(() => setErro('Não foi possível copiar. Use Baixar texto.'))}>Copiar texto</button><button className="auto-button" onClick={baixar}>Baixar texto</button></>}</div>
        {aviso && <p role="status">{aviso}</p>}
      </> : <div className="auto-empty auto-empty--material"><span className="auto-empty-symbol" aria-hidden="true">Aa</span><h2>Texto e referências, lado a lado</h2><p>O material aparecerá aqui com as fontes usadas, a versão do contexto e o modelo responsável.</p></div>}
    </section>
    <section className="auto-material-history"><h2>Materiais anteriores</h2>{materiais.length ? <ul className="auto-history-list">{materiais.map(m => <li key={m.id}><button disabled={Boolean(ocupado)} className="auto-history-button" onClick={() => void abrir(m.id)}><strong>{m.titulo}</strong><span>{m.tipo} · {m.status} · {new Date(m.criadoEm).toLocaleString('pt-BR')}</span></button></li>)}</ul> : <p className="auto-empty">As gerações ficam salvas aqui com seu contexto original.</p>}</section>
  </div>
}
