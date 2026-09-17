import {ultimasOcorrencias} from '../lib/agenda'
import { abrirAgenda, resolverPendencia } from '../lib/destinos'
import { useEstadoGlobal, type Modulo, type Tom } from '../lib/estado-global'
import { Bloco, Botao, Chip, Faixa, Feed, Pagina } from './ui/ui'
import { hojeLocal } from '../lib/data-local'
import './hoje.css'

const ROTULO: Record<Modulo, string> = { candidaturas: 'Candidaturas', campanhas: 'Campanhas', fila: 'Fila', sistema: 'Agenda' }
function navegar(view: string) { window.dispatchEvent(new CustomEvent('app:navegar', { detail: { view } })) }
const hora = (v: number | string) => new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const diaLocal = (v: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(v))

function Cartao({ titulo, estado, linhas, acao, abrir }: { titulo: string; estado: { tone: Tom; texto: string }; linhas: [string, string][]; acao?: { texto: string; onClick: () => void }; abrir: () => void }) {
  return <Bloco titulo={titulo} aside={<Chip tone={estado.tone}>{estado.texto}</Chip>}>
    <dl className="hoje-linhas">{linhas.map(([a, b], i) => <div key={i}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
    <div className="hoje-cartao-acoes">{acao && <Botao kind="primary" onClick={acao.onClick}>{acao.texto}</Botao>}<Botao kind="ghost" onClick={abrir}>Abrir</Botao></div>
  </Bloco>
}

// Porta de entrada: responde "o que precisa de mim?" antes de abrir qualquer módulo.
export function Hoje() {
  const g = useEstadoGlobal()
  const humanas = g.pendencias.filter(p => !p.automatica)
  const hoje = hojeLocal()
  const cand = g.candidaturas
  const missao = cand?.missoes.find(m => ['iniciando', 'executando'].includes(m.estado)) || cand?.missoes[0]
  const confirmadasHoje = (cand?.candidaturas || []).filter(c => c.confirmacao && diaLocal(c.confirmacao.em) === hoje).length
  const metaCand = missao?.agenda?.limiteDiario || cand?.preferencias.meta || 0
  const rotinaCand = g.agenda?.rotinas.find(r => r.modulo === 'candidaturas')
  const campanhaOcs = (g.agenda?.ocorrencias || []).filter(o => o.modulo.startsWith('campanha:'))
  const campanhaRotinas = (g.agenda?.rotinas || []).filter(r => r.modulo.startsWith('campanha:'))
  const campanhaBloq = ultimasOcorrencias(campanhaOcs).find(o => o.estado === 'bloqueada'), campanhaRodando = campanhaOcs.find(o => o.estado === 'executando')
  const proximaCampanha = campanhaRotinas.map(r => r.proxima).filter((v): v is number => Boolean(v)).sort()[0]
  const editorialOcs = (g.agenda?.ocorrencias || []).filter(o => o.modulo === 'editorial')
  const editorialBloq = ultimasOcorrencias(editorialOcs).find(o => o.estado === 'bloqueada')
  const prontas = g.fila.filter(i => i.estado === 'pendente' && i.prontidao?.pronta).length
  const publicadasHoje = g.fila.filter(i => i.estado === 'publicado' && diaLocal(i.recibo?.publishedAt || i.atualizadoEm) === hoje).length
  const proximaPublicacao = editorialOcs.filter(o => o.tipo === 'publicacao' && o.estado === 'agendada' && o.prevista > Date.now()).sort((a, b) => a.prevista - b.prevista)[0]
  const perguntas = cand?.pendencias?.perguntas.filter(p => p.respondivel).length || 0

  const estadoCand = !missao ? { tone: 'neutro' as Tom, texto: 'sem missão' } : ['iniciando', 'executando'].includes(missao.estado) ? { tone: 'ativo' as Tom, texto: `rodando · ${confirmadasHoje}/${metaCand}` } : missao.atencao && !missao.atencao.automatica ? { tone: 'atencao' as Tom, texto: 'precisa de você' } : missao.atencao?.automatica ? { tone: 'info' as Tom, texto: 'retomando sozinha' } : { tone: 'neutro' as Tom, texto: missao.estado }
  const estadoCamp = campanhaBloq ? { tone: 'atencao' as Tom, texto: 'precisa de você' } : campanhaRodando ? { tone: 'ativo' as Tom, texto: 'rodando' } : { tone: 'neutro' as Tom, texto: proximaCampanha ? `próximo ${hora(proximaCampanha)}` : 'sem agendamento' }
  const estadoFila = editorialBloq ? { tone: 'atencao' as Tom, texto: 'precisa de você' } : prontas ? { tone: 'ok' as Tom, texto: `${prontas} prontas` } : { tone: 'neutro' as Tom, texto: 'nada pendente' }

  return <Pagina titulo={`Hoje · ${new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date()).replace(/\./g, '')}`} acoes={<Botao onClick={() => void g.atualizar()}>Atualizar</Botao>}>
    {humanas.length
      ? <Faixa tone="atencao" acoes={<Botao kind="primary" onClick={() => resolverPendencia(humanas[0])}>Resolver a primeira</Botao>}><strong>{humanas.length === 1 ? '1 coisa precisa' : `${humanas.length} coisas precisam`} de você:</strong> {humanas.map(p => `${ROTULO[p.modulo]}: ${p.titulo}`).join(' · ')}.</Faixa>
      : g.carregado ? <Faixa tone="ok">Nada depende de você agora. Os três módulos estão rodando ou aguardando o horário.</Faixa> : <Faixa tone="info">Lendo o estado dos módulos…</Faixa>}
    {g.erro && <Faixa tone="erro" detalhe={g.erro}>Uma das leituras falhou; os números abaixo podem estar incompletos.</Faixa>}
    <div className="hoje-cartoes">
      <Cartao titulo="Candidaturas" estado={estadoCand} abrir={() => navegar('candidaturas')}
        linhas={[[missao ? `Busca: ${missao.criterios.termos}` : 'Nenhuma missão hoje', missao ? hora(missao.criadaEm) : ''], ['Comprovadas hoje', `${confirmadasHoje} de ${metaCand}`], [perguntas ? `${perguntas} pergunta${perguntas > 1 ? 's' : ''} sem fonte` : 'Sem perguntas pendentes', perguntas ? `${new Set(cand?.pendencias?.perguntas.flatMap(p => p.candidaturas.map(c => c.id))).size} vagas` : ''], ['Próxima rodada', rotinaCand?.proxima ? hora(rotinaCand.proxima) : missao && ['iniciando', 'executando'].includes(missao.estado) ? `até ${hora(missao.limite)}` : 'sem agendamento']]}
        acao={perguntas ? { texto: 'Responder perguntas', onClick: () => { const p = humanas.find(p => p.id === 'cand:perguntas'); if (p) resolverPendencia(p) } } : missao && !['iniciando', 'executando', 'concluida', 'encerrada'].includes(missao.estado) ? { texto: 'Ver impedimento', onClick: () => { const p = humanas.find(p => p.id === 'cand:missao'); if (p) resolverPendencia(p); else navegar('candidaturas') } } : undefined} />
      <Cartao titulo="Campanhas" estado={estadoCamp} abrir={() => navegar('automacoes')}
        linhas={[[campanhaBloq ? campanhaBloq.nome + ' parou' : campanhaRodando ? campanhaRodando.nome : 'Sem ciclo rodando', campanhaBloq ? hora(campanhaBloq.atualizadaEm) : ''], ['Contatos hoje', `${campanhaRotinas.reduce((n, r) => n + (r.uso?.realizado || 0), 0)} de ${campanhaRotinas.reduce((n, r) => n + (r.metaDiaria || 0), 0)}`], ['Próximo ciclo', proximaCampanha ? hora(proximaCampanha) : 'sem agendamento'], ['Empresas ativas', String(new Set(campanhaRotinas.map(r => r.modulo)).size)]]}
        acao={campanhaBloq ? { texto: 'Ver impedimento', onClick: () => { const p = humanas.find(p => p.modulo === 'campanhas'); if (p) resolverPendencia(p) } } : undefined} />
      <Cartao titulo="Fila" estado={estadoFila} abrir={() => navegar('fila')}
        linhas={[[editorialBloq ? editorialBloq.nome + ' falhou' : 'Produção em dia', editorialBloq ? hora(editorialBloq.atualizadaEm) : ''], ['Prontas para publicar', String(prontas)], ['Próxima publicação', proximaPublicacao ? hora(proximaPublicacao.prevista) : 'sem horário'], ['Publicadas hoje', String(publicadasHoje)]]}
        acao={prontas ? { texto: prontas === 1 ? 'Revisar peça' : `Revisar ${prontas} peças`, onClick: () => { const p = humanas.find(p => p.id === 'fila:prontas'); if (p) resolverPendencia(p) } } : editorialBloq ? { texto: 'Ver impedimento', onClick: () => { const p = humanas.find(p => p.modulo === 'fila'); if (p) resolverPendencia(p) } } : undefined} />
    </div>
    <div className="dw-grade hoje-grade">
      <Bloco titulo="Dia · todos os módulos" scroll aside={<Botao kind="ghost" onClick={abrirAgenda}>Rotinas e horários</Botao>}>
        <Feed itens={g.eventos.map(e => ({ em: e.em, rotulo: ROTULO[e.modulo], titulo: e.titulo, sub: e.sub, tone: e.tone }))} vazio={g.carregado ? 'Nenhuma atividade registrada hoje.' : 'Carregando…'} />
      </Bloco>
      <div className="dw-coluna">
        <Bloco titulo="Máquina">
          <ul className="hoje-maquina">
            <li><span>Agenda em segundo plano</span><em className={g.agenda?.servico.ativo ? 'is-ok' : 'is-off'}>{g.agenda ? (g.agenda.servico.ativo ? `ativa · ${g.agenda.servico.ultimaVerificacao ? hora(g.agenda.servico.ultimaVerificacao) : ''}` : 'parada') : 'sem leitura'}</em></li>
            <li><span>Executor de candidaturas</span><em className={missao?.supervisor && ['executando', 'aguardando_conexao', 'aguardando_controle'].includes(missao.supervisor.estado) ? 'is-ok' : 'is-neutro'}>{missao?.supervisor ? `${missao.supervisor.modelo || 'modelo'} · ${missao.supervisor.estado === 'aguardando_conexao' ? 'aguardando Chromium' : missao.supervisor.estado === 'aguardando_controle' ? 'aguardando devolução' : missao.supervisor.estado}` : 'parado'}</em></li>
            <li><span>LinkedIn Easy Apply</span><em className={missao?.supervisor?.fontesEsgotadas?.linkedinEasyApply ? 'is-off' : 'is-ok'}>{missao?.supervisor?.fontesEsgotadas?.linkedinEasyApply ? 'esgotado hoje' : 'disponível'}</em></li>
            <li><span>Rotinas ativas</span><em className="is-neutro">{(g.agenda?.rotinas || []).filter(r => r.ativa && !r.pausada).length} de {(g.agenda?.rotinas || []).length}</em></li>
          </ul>
        </Bloco>
        <Bloco titulo="Precisa de você" aside={humanas.length ? <Chip tone="atencao">{humanas.length}</Chip> : <Chip tone="ok">nada</Chip>}>
          {humanas.length ? <ul className="dw-pendencias">{humanas.map(p => <li key={p.id}><div><strong>{p.titulo}</strong><small>{ROTULO[p.modulo]} · {p.acao}</small></div><Botao kind="ghost" onClick={() => resolverPendencia(p)}>Ir</Botao></li>)}</ul> : <p className="dw-vazio">Tudo o que está parado é automático ou já foi tratado.</p>}
        </Bloco>
      </div>
    </div>
  </Pagina>
}
