import { useEffect, useState, type ClipboardEvent, type ReactNode } from 'react'
import { configurarCampanha, criarCampanha, importarSessaoCampanha, mostrarNavegadorCampanha, obterCatalogoCampanhas, abrirPerfilAutomacao } from '../../lib/api'
import type { CatalogoCampanhas } from '../../lib/automacoes'

function colarTexto(evento: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>, atual: string, definir: (valor: string) => void) {
  const texto = evento.clipboardData?.getData('text')
  if (!texto) return
  evento.preventDefault()
  const campo = evento.currentTarget
  const inicio = campo.selectionStart ?? atual.length
  const fim = campo.selectionEnd ?? atual.length
  definir(`${atual.slice(0, inicio)}${texto.trim()}${atual.slice(fim)}`)
}

export function Campanhas({ campanhaId, selecionar, children }: { campanhaId: string; selecionar: (id: string) => void; children: ReactNode | ((barra: ReactNode) => ReactNode) }) {
  const [catalogo, setCatalogo] = useState<CatalogoCampanhas | null>(null)
  const [nova, setNova] = useState(() => new URLSearchParams(location.search).get('novaCampanha') === '1')
  const [nome, setNome] = useState('')
  const [site, setSite] = useState('')
  const [objetivo, setObjetivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  async function atualizar() { setCatalogo(await obterCatalogoCampanhas()) }
  useEffect(() => { let vivo = true; const ler = () => obterCatalogoCampanhas().then(c => { if (vivo) setCatalogo(c) }).catch(e => { if (vivo) setErro(e.message) }); void ler(); const timer = setInterval(() => void ler(), 15000); return () => { vivo = false; clearInterval(timer) } }, [])
  const atual = catalogo?.campanhas.find(c => c.id === campanhaId)
  async function agir(acao: () => Promise<unknown>, mensagem = '') { setOcupado(true); setErro(''); setAviso(''); try { await acao(); await atualizar(); setAviso(mensagem) } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível concluir.') } finally { setOcupado(false) } }
  function trocar(id: string) { selecionar(id); const url = new URL(location.href); url.searchParams.set('campanha', id); url.searchParams.set('abaAutomacoes', 'pesquisa'); url.searchParams.delete('secao'); url.searchParams.delete('contextoAutomacao'); url.searchParams.delete('materialAutomacao'); history.replaceState(null, '', url) }
  // A tela da campanha decide onde a barra de empresa aparece (cabeçalho da página).
  const barra = <div className="auto-campaign-bar">
      <div className="auto-campaign-controls"><label className="auto-field">Empresa<span className="auto-company-pick">{atual?.identidade?.logo?.startsWith('data:image/') && <img src={atual.identidade.logo} alt="" />}<select value={campanhaId} disabled={!catalogo || ocupado} onChange={e => trocar(e.target.value)}>{catalogo?.campanhas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></span></label><button className="auto-button auto-button--primary" onClick={() => setNova(!nova)} aria-expanded={nova}>{nova ? 'Fechar cadastro' : '+ Nova empresa'}</button>
        <details className="auto-bench-settings" open={new URLSearchParams(location.search).get('configCampanha') === '1' || undefined}><summary>Agente e navegador <span>{catalogo?.executores.find(e => e.id === atual?.executor)?.nome || 'Configurar'}</span></summary><div className="auto-bench-body"><label className="auto-field">Executor desta empresa<select value={atual?.executor || 'codex'} disabled={!atual || ocupado} onChange={e => void agir(() => configurarCampanha({ revisao: atual!.revisao, executor: e.target.value }, campanhaId), 'Executor salvo para os próximos ciclos.')}>{catalogo?.executores.map(e => <option key={e.id} value={e.id} disabled={!e.instalado}>{e.nome}{!e.instalado ? ' · não instalado' : ''}</option>)}</select></label><p className="auto-muted">Usa o login e as permissões da CLI escolhida. Todos acessam o Chromium da bancada do DailyWork.</p><div className="auto-bench-status"><strong>{catalogo?.navegador.workspace ? `Workspace ${catalogo.navegador.workspace}` : 'Bancada do DailyWork'}</strong><span>{catalogo?.navegador.controle === 'humano' ? 'Controle com você' : catalogo?.navegador.conectado ? 'Navegador conectado' : 'Navegador desconectado'}</span></div><div className="auto-actions"><button className="auto-button" disabled={ocupado} onClick={() => void agir(() => abrirPerfilAutomacao(campanhaId), 'Navegador preparado. Confira a conta na bancada.')}>Preparar navegador</button><button className="auto-button" disabled={ocupado} onClick={() => void agir(() => mostrarNavegadorCampanha(campanhaId))}>Ver bancada</button><button className="auto-text-button" disabled={ocupado} onClick={() => void agir(() => importarSessaoCampanha(campanhaId), 'Sessão de trabalho importada do Chromium. Confira os logins na bancada.')}>Atualizar login do Chromium</button></div>{catalogo?.navegador.sessao && <p className="auto-muted">Sessão importada em {new Date(catalogo.navegador.sessao.importadaEm).toLocaleString('pt-BR')}. O login pode expirar em cada site.</p>}<details><summary>Como o agente acessa o navegador</summary><p className="auto-muted">A campanha fornece comandos para ler abas, navegar e interagir na bancada compartilhada. O @Browser do aplicativo Codex pertence à sessão do aplicativo; executores CLI usam a conexão da bancada.</p></details></div></details>
      </div>
      {catalogo && catalogo.campanhas.length < 2 && !nova && <p className="auto-notice" role="status">Só a Cognition está cadastrada. Adicione outra empresa-alvo para pesquisar e disparar no mesmo fluxo.</p>}
      {nova && <form className="auto-new-campaign" onSubmit={e => { e.preventDefault(); void agir(async () => { const c = await criarCampanha({ nome, site, objetivo }); trocar(c.id); setNova(false); setNome(''); setSite(''); setObjetivo('') }, 'Empresa adicionada. Pesquise o time ou enfileire um alvo para disparar.') }}>
        <h2>Nova empresa-alvo</h2>
        <p className="auto-muted">O nome já abre a campanha. Site é opcional: se não tiver, a pesquisa acha domínio e time a partir dele. O envio fica autorizado desde o cadastro.</p>
        <div className="auto-form-row">
          <label className="auto-field">Nome<input autoFocus required maxLength={100} value={nome} onChange={e => setNome(e.target.value)} onPaste={e => colarTexto(e, nome, setNome)} placeholder="Nome da empresa" /></label>
          <label className="auto-field">Site oficial<input type="text" inputMode="url" autoComplete="url" spellCheck={false} maxLength={2000} value={site} onChange={e => setSite(e.target.value)} onPaste={e => colarTexto(e, site, setSite)} placeholder="https://empresa.com" /><span className="auto-field-hint">Opcional. Cole o endereço ou o domínio; sem site, o nome basta.</span></label>
        </div>
        <label className="auto-field">O que você procura nessa empresa?<textarea rows={2} maxLength={2000} value={objetivo} onChange={e => setObjetivo(e.target.value)} onPaste={e => colarTexto(e, objetivo, setObjetivo)} placeholder="Áreas de interesse, tipo de vaga e o que vale investigar. Pode deixar em branco." /></label>
        <button className="auto-button auto-button--primary" disabled={ocupado}>{ocupado ? 'Criando…' : 'Adicionar empresa'}</button>
      </form>}
      {erro && <p className="auto-notice auto-notice--error" role="alert">{erro}</p>}{aviso && <p className="auto-notice" role="status">{aviso}</p>}
    </div>
  return typeof children === 'function' ? children(barra) : <>{barra}{children}</>
}
