import { useEffect, useState, type ReactNode } from 'react'
import { alterarEscalaInterface, aoMudarEscalaInterface, criarSessao, escalaDisponivelNoDesktop, excluirSessao, listarSessoes, obterEscalaInterface, resetarEscalaInterface, type EstadoEscalaInterface } from '../lib/api'
import { hojeLocal, podeAvancarData } from '../lib/data-local'
import { useEstadoGlobal } from '../lib/estado-global'
import sitePublico from '../lib/site-publico.json'
import './sidebar.css'

const CONEXOES = [
  { id: 'github', nome: 'GitHub', dominio: 'github.com' },
  { id: 'linkedin', nome: 'LinkedIn', dominio: 'linkedin.com' },
  { id: 'x', nome: 'X', dominio: 'x.com' },
  { id: 'reddit', nome: 'Reddit', dominio: 'reddit.com' },
]
const ICONES: Record<string, string> = {
  hoje: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h3v3H8z"/>',
  agente: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
  skills: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  principal: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  lousas: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
  site: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  fila: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  logica: '<path d="M4 19V5M4 19H20M8 15l3-8 3 5 2-3 4 6"/>',
  campanhas: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  candidaturas: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
  conexoes: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  diario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  sumario: '<path d="M6 3.5h9l3 3V20.5H6z"/><path d="M15 3.5v4h3M9 11h6M9 14.5h6M9 18h4"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  arquivo: '<path d="M3 7h18v13H3zM2 4h20v3H2zM10 11h4"/>',
}
const Ic = ({ n, s = 15 }: { n: string; s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONES[n] || '' }} />

function somarDias(data: string, quantidade: number): string {
  const [ano, mes, dia] = data.split('-').map(Number)
  const valor = new Date(ano, mes - 1, dia, 12)
  valor.setDate(valor.getDate() + quantidade)
  return [valor.getFullYear(), String(valor.getMonth() + 1).padStart(2, '0'), String(valor.getDate()).padStart(2, '0')].join('-')
}
function rotuloData(data: string): string {
  const [ano, mes, dia] = data.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(ano, mes - 1, dia, 12)).replace(/\./g, '').replace(/ de /g, ' ')
}
function slugificar(texto: string): string { return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) }

function Item({ ativo, icone, children, badge, onClick, sub, testid, aberto }: { ativo?: boolean; icone: string; children: ReactNode; badge?: { n: number; atencao: boolean }; onClick: () => void; sub?: string; testid?: string; aberto?: boolean }) {
  return <button type="button" data-testid={testid} className={`dw-side-item ${ativo ? 'is-active' : ''}`} aria-current={ativo ? 'page' : undefined} aria-expanded={aberto} onClick={onClick}>
    <Ic n={icone} /><span className="dw-side-rotulo">{children}{sub && <small>{sub}</small>}</span>
    {badge && badge.n > 0 && <span className={`dw-side-badge ${badge.atencao ? 'is-atencao' : ''}`}>{badge.n}</span>}
    {aberto !== undefined && <span className={`dw-side-chev ${aberto ? 'is-open' : ''}`}><Ic n="chev" s={13} /></span>}
  </button>
}

// Sidebar fixa: substitui a pílula flutuante. Um nível só de navegação, com badge do que
// precisa de você em cada módulo e os controles de dia e zoom que a pílula tinha.
export function Sidebar({ view, onMudar }: { view: string; onMudar: (view: string) => void }) {
  const g = useEstadoGlobal()
  const [sessoes, setSessoes] = useState<string[]>([])
  const [lousasAberto, setLousasAberto] = useState(false)
  const [conexoesAberto, setConexoesAberto] = useState(false)
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [erroLousa, setErroLousa] = useState('')
  const [escala, setEscala] = useState<EstadoEscalaInterface | null>(null)
  const hoje = hojeLocal()
  const dataAtual = view.startsWith('dia:') ? view.slice(4) : view.startsWith('sumario:') ? view.slice(8) : hoje
  const modoDaData = view.startsWith('sumario:') ? 'sumario' : 'dia'
  const conexaoAtual = view.startsWith('conexao:') ? view.slice(8) : ''
  const sessaoAtual = view.startsWith('sessao:') ? view.slice(7) : ''

  useEffect(() => {
    if (!escalaDisponivelNoDesktop()) return
    obterEscalaInterface().then(setEscala).catch(() => {})
    return aoMudarEscalaInterface(setEscala)
  }, [])
  useEffect(() => {
    listarSessoes().then(ids => { setSessoes(ids.filter(id => !/^dia-\d{4}-\d{2}-\d{2}$/.test(id))); setErroLousa('') }).catch(() => setErroLousa('Não foi possível carregar as lousas.'))
  }, [])
  useEffect(() => { if (sessaoAtual) setLousasAberto(true); if (conexaoAtual) setConexoesAberto(true) }, [sessaoAtual, conexaoAtual])

  function ir(v: string) { setCriando(false); setNome(''); onMudar(v) }
  async function confirmarCriacao() {
    const id = slugificar(nome); if (!id) return
    try { await criarSessao(id); if (!sessoes.includes(id)) setSessoes(a => [...a, id].sort()); setErroLousa(''); ir(`sessao:${id}`) }
    catch { setErroLousa('Não foi possível criar a lousa.') }
  }
  async function arquivar(id: string) {
    try { await excluirSessao(id); setSessoes(a => a.filter(s => s !== id)); setErroLousa(''); if (view === `sessao:${id}`) ir('principal') }
    catch { setErroLousa('Não foi possível arquivar a lousa.') }
  }
  const podeAvancar = podeAvancarData(modoDaData, dataAtual, hoje)
  const totalHumanas = g.pendencias.filter(p => !p.automatica).length

  return <nav className="dw-sidebar" aria-label="DailyWork">
    <div className="dw-side-marca"><span className="dw-side-logo" /><strong>DailyWork</strong></div>
    <Item testid="navegar-hoje" ativo={view === 'hoje'} icone="hoje" badge={{ n: totalHumanas, atencao: true }} onClick={() => ir('hoje')}>Hoje</Item>
    <div className="dw-side-sep" />
    <Item ativo={view === 'agente'} icone="agente" sub="IA global" onClick={() => ir('agente')}>Agente</Item>
    <Item ativo={view === 'skills'} icone="skills" sub="Inventário" onClick={() => ir('skills')}>Skills</Item>
    <Item ativo={view === 'principal'} icone="principal" sub="Acervo" onClick={() => ir('principal')}>Principal</Item>
    <Item ativo={Boolean(sessaoAtual)} icone="lousas" sub={sessoes.length === 1 ? '1 lousa' : `${sessoes.length} lousas`} aberto={lousasAberto} onClick={() => setLousasAberto(a => !a)}>Lousas</Item>
    {lousasAberto && <div className="dw-side-sub" role="group" aria-label="Lousas">
      {sessoes.map(id => <div key={id} className={`dw-side-subrow ${view === `sessao:${id}` ? 'is-active' : ''}`}><button type="button" onClick={() => ir(`sessao:${id}`)}>{id}</button><button type="button" className="dw-side-mini" title="Arquivar lousa" aria-label={`Arquivar ${id}`} onClick={() => void arquivar(id)}><Ic n="arquivo" s={13} /></button></div>)}
      {!sessoes.length && <p className="dw-side-nota">Nenhuma lousa criada.</p>}
      {criando ? <form className="dw-side-nova" onSubmit={e => { e.preventDefault(); void confirmarCriacao() }}><input autoFocus placeholder="Nome da lousa" value={nome} onChange={e => setNome(e.target.value)} maxLength={40} /><button type="submit" disabled={!slugificar(nome)}>Criar</button></form>
        : <button type="button" className="dw-side-subacao" onClick={() => setCriando(true)}><Ic n="mais" s={13} />Nova lousa</button>}
      {erroLousa && <p className="dw-side-nota is-erro">{erroLousa}</p>}
    </div>}
    <Item ativo={view === 'site'} icone="site" sub={sitePublico.host} onClick={() => ir('site')}>Site</Item>
    <div className="dw-side-sep" />
    <Item ativo={view === 'fila'} icone="fila" sub="Publicações" badge={g.badges.fila} onClick={() => ir('fila')}>Fila</Item>
    <Item ativo={view === 'logica'} icone="logica" sub="Roteiro e imagem" onClick={() => ir('logica')}>Lógica</Item>
    <Item ativo={view === 'automacoes'} icone="campanhas" sub="Networking" badge={g.badges.campanhas} onClick={() => ir('automacoes')}>Campanhas</Item>
    <Item ativo={view === 'candidaturas'} icone="candidaturas" sub="Carreira" badge={g.badges.candidaturas} onClick={() => ir('candidaturas')}>Candidaturas</Item>
    <Item ativo={Boolean(conexaoAtual)} icone="conexoes" sub={CONEXOES.find(c => c.id === conexaoAtual)?.nome || 'Contas externas'} aberto={conexoesAberto} onClick={() => setConexoesAberto(a => !a)}>Conexões</Item>
    {conexoesAberto && <div className="dw-side-sub" role="group" aria-label="Contas conectadas">
      {CONEXOES.map(c => <div key={c.id} className={`dw-side-subrow ${conexaoAtual === c.id ? 'is-active' : ''}`}><button type="button" data-testid={`navegar-conexao-${c.id}`} onClick={() => ir(`conexao:${c.id}`)}>{c.nome}<small>{c.dominio}</small></button></div>)}
    </div>}
    <div className="dw-side-sep" />
    <Item testid="navegar-diario" ativo={view.startsWith('dia:')} icone="diario" sub={rotuloData(dataAtual)} onClick={() => ir(`dia:${dataAtual}`)}>Diário</Item>
    <div className="dw-side-data" aria-label="Escolher dia">
      <button type="button" data-testid="dia-anterior" title="Dia anterior" aria-label="Dia anterior" onClick={() => ir(`${modoDaData}:${somarDias(dataAtual, -1)}`)}>‹</button>
      <label><input data-testid="escolher-dia" type="date" aria-label="Escolher dia" value={dataAtual} max={modoDaData === 'sumario' ? hoje : undefined} onChange={e => e.target.value && ir(`${modoDaData}:${e.target.value}`)} /></label>
      <button type="button" data-testid="proximo-dia" title="Próximo dia" aria-label="Próximo dia" disabled={!podeAvancar} onClick={() => ir(`${modoDaData}:${somarDias(dataAtual, 1)}`)}>›</button>
      {dataAtual !== hoje && <button type="button" data-testid="ir-para-hoje" className="dw-side-hoje" onClick={() => ir(`${modoDaData}:${hoje}`)}>hoje</button>}
    </div>
    <Item testid="navegar-sumario" ativo={view.startsWith('sumario:')} icone="sumario" sub="Histórico diário" onClick={() => ir(`sumario:${dataAtual}`)}>Sumário</Item>
    <div className="dw-side-rodape">
      <div className="dw-side-status"><span className={`dw-side-ponto ${g.agenda?.servico.ativo ? 'is-ok' : 'is-off'}`} />{g.agenda ? (g.agenda.servico.ativo ? 'Agenda rodando em segundo plano' : 'Agenda parada') : g.erro ? 'Sem leitura da agenda' : 'Lendo a agenda…'}</div>
      {escala && <div className="dw-side-zoom" aria-label="Tamanho da interface">
        <button type="button" data-testid="diminuir-zoom" title="Diminuir zoom (Ctrl+-)" aria-label="Diminuir zoom" onClick={() => void alterarEscalaInterface(-1).then(setEscala)}>−</button>
        <button type="button" data-testid="resetar-zoom" className="dw-side-zoom-valor" title={escala.modo === 'automatico' ? 'Zoom automático pela janela. Ctrl+0 reaplica.' : 'Ajustar o zoom à janela (Ctrl+0)'} onClick={() => void resetarEscalaInterface().then(setEscala)}>{Math.round(escala.zoom * 100)}%{escala.modo === 'automatico' && <small>auto</small>}</button>
        <button type="button" data-testid="aumentar-zoom" title="Aumentar zoom (Ctrl++)" aria-label="Aumentar zoom" onClick={() => void alterarEscalaInterface(1).then(setEscala)}>+</button>
      </div>}
    </div>
  </nav>
}
