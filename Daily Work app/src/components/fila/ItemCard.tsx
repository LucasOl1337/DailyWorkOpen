import { useEffect, useState } from 'react'
import {
  agendarEditorial,
  atualizarEditorial,
  capturarComprovanteEditorial,
  espelharEditorial,
  listarEditorial,
  publicarEditorial,
  recusarEditorial,
  reabrirEditorial,
  type ContaEditorial,
  type IdiomaEditorial,
  type ItemEditorial,
  type JobMidiaEditorial,
} from '../../lib/editorial'
import { operarSessaoVisual } from '../../lib/api'
import { descreverProveniencia } from '../../lib/proveniencia'
import { CONTAS, ESTADOS, IDIOMAS, erroTexto, exclusaoBloqueadaNaFila, formatarDataHora, formatarQuando, formatoPublicavelDoItem, labelCampo, nomesConta, paraISO, proximaHoraLocal, rotuloIdioma, valorCampo, type AcessoConta, type CapacidadesMidia } from './comum'
import { MediaPreview } from './MediaPreview'
import { RevisaoEditorial } from './RevisaoEditorial'
import { MediaJobControls } from './MediaJobControls'
import { ComprovantePreview } from './ComprovantePreview'

export function ItemCard({
  item,
  versoesDaPauta,
  onPautaClick,
  busy,
  onAction,
  onError,
  onEspelhado,
  jobs,
  capacidades,
  capacidadesCarregadas,
  autorizarGasto,
  onMediaChanged,
  acesso,
  onConectar,
  onNavegar,
  onFechar,
  somenteLeitura = false,
  onAtualizado,
  onApagar,
  confirmandoApagar = false,
}: {
  item: ItemEditorial
  versoesDaPauta: ItemEditorial[]
  onPautaClick: (pautaId: string) => void
  busy: boolean
  onAction: (id: string, acao: 'publicar' | 'recusar' | 'reabrir' | 'agendar' | 'editar', callback?: () => Promise<ItemEditorial>) => void
  onError: (mensagem: string) => void
  onEspelhado: (mensagem: string) => void
  jobs: JobMidiaEditorial[]
  capacidades: CapacidadesMidia
  capacidadesCarregadas: boolean
  autorizarGasto: boolean
  onMediaChanged: () => void
  acesso: AcessoConta
  onConectar?: (conta: ContaEditorial) => void
  onNavegar?: (view: string) => void
  onFechar: () => void
  somenteLeitura?: boolean
  onAtualizado?: (item: ItemEditorial) => void
  onApagar?: () => void
  confirmandoApagar?: boolean
}) {
  const [fontesAbertas, setFontesAbertas] = useState(false)
  const [recusaAberta, setRecusaAberta] = useState(false)
  const [motivoRecusa, setMotivoRecusa] = useState('')
  const [agenda, setAgenda] = useState('')
  const [editando, setEditando] = useState(false)
  const [espelhoAberto, setEspelhoAberto] = useState(false)
  const [espelhoConta, setEspelhoConta] = useState<ContaEditorial>(item.conta)
  const [espelhoIdioma, setEspelhoIdioma] = useState<IdiomaEditorial>(item.idioma === 'pt-BR' ? 'en' : 'pt-BR')
  const [espelhando, setEspelhando] = useState(false)
  const [capturando, setCapturando] = useState(false)
  const [titulo, setTitulo] = useState(item.titulo)
  const [texto, setTexto] = useState(item.texto)
  const [campos, setCampos] = useState<Record<string, string>>(() => Object.fromEntries(Object.keys(item.campos || {}).map((chave) => [chave, valorCampo(item, chave)])))
  const isPendente = item.estado === 'pendente'
  const formatoPublicavel = formatoPublicavelDoItem(item, capacidades, capacidadesCarregadas)
  const contaAcessivel = acesso ? acesso.configurada : true
  const podePublicar = formatoPublicavel && isPendente && contaAcessivel
  const podeRecusar = isPendente || item.estado === 'agendado'
  const erro = typeof item.erro === 'string' ? item.erro : item.erro?.mensagem
  const camposExibidos = Array.from(new Set([...Object.keys(item.campos || {}), ...(item.conta === 'github' ? ['repository'] : []), ...(item.conta === 'reddit' ? ['subreddit', 'title'] : [])]))
  const jobAtivo = jobs.some((job) => job.itemId === item.id && (job.status === 'planned' || job.status === 'producing'))
  const midiaPronta = item.midias.length > 0
  const combinacoesDaPauta = new Set(versoesDaPauta.filter((versao) => versao.estado !== 'recusado').map((versao) => `${versao.conta}:${versao.idioma}`))
  const prova = descreverProveniencia(item)
  const partesExtras = prova.partes.filter((parte) => !['fonte', 'sumario'].includes(parte.tipo))

  useEffect(() => {
    setTitulo(item.titulo)
    setTexto(item.texto)
    setCampos(Object.fromEntries(Object.keys(item.campos || {}).map((chave) => [chave, valorCampo(item, chave)])))
  }, [item.id, item.revisao])

  function abrirEdicao() {
    setEditando(true)
    setAgenda('')
  }

  function validarCampos(): string | null {
    if (!texto.trim()) return 'O texto da publicação não pode ficar vazio.'
    if (item.conta === 'github' && !(campos.repository || campos.repositorio || campos.repo || valorCampo(item, 'repository')).trim()) return 'GitHub pede o repositório da publicação.'
    if (item.conta === 'reddit' && !(campos.subreddit || valorCampo(item, 'subreddit')).trim()) return 'Reddit pede o subreddit da publicação.'
    if (item.conta === 'reddit' && !(campos.title || titulo.trim())) return 'Reddit pede um título para a publicação.'
    return null
  }

  function salvarEdicao() {
    const validacao = validarCampos()
    if (validacao) {
      onError(validacao)
      return
    }
    const camposEntrada = Object.fromEntries(Object.entries(campos).filter(([, valor]) => valor.trim() !== ''))
    onAction(item.id, 'editar', async () => atualizarEditorial(item.id, { revisao: item.revisao, titulo: titulo.trim(), texto, campos: camposEntrada }))
    setEditando(false)
  }

  function confirmarAgendamento() {
    if (!agenda) {
      onError('Escolha uma data e hora local para agendar.')
      return
    }
    onAction(item.id, 'agendar', async () => agendarEditorial(item.id, item.revisao, paraISO(agenda), acesso?.perfilUrl))
    setAgenda('')
  }

  async function capturarComprovante() {
    if (capturando) return
    setCapturando(true)
    try {
      const atual = await capturarComprovanteEditorial(item.id)
      onAtualizado?.(atual)
    } catch (falha) {
      onError(erroTexto(falha).mensagem)
    } finally {
      setCapturando(false)
    }
  }

  async function confirmarEspelho() {
    if (espelhando) return
    if (espelhoConta === item.conta && espelhoIdioma === item.idioma) {
      onError('Escolha outra conta ou outro idioma para espelhar esta peça.')
      return
    }
    setEspelhando(true)
    try {
      const criado = await espelharEditorial(item.id, { conta: espelhoConta, idioma: espelhoIdioma })
      setEspelhoAberto(false)
      onEspelhado(`Versão ${nomesConta[criado.conta] || criado.conta} · ${criado.idioma} criada e já na fila.`)
    } catch (falha) {
      onError(erroTexto(falha).mensagem)
    } finally {
      setEspelhando(false)
    }
  }

  return (
    <article className={`fila-card fila-card--${item.estado} is-open`} data-pauta-id={item.pautaId} data-testid="fila-modal-card">
      <header className="fila-card-header">
        <div className="fila-card-identidade">
          <span className="fila-conta">{nomesConta[item.conta] || item.conta}</span>
          <span className="fila-meta-pill">{rotuloIdioma(item.idioma)}</span>
          <span className="fila-meta-pill">{item.formato}</span>
          <button className="fila-pauta" type="button" onClick={() => onPautaClick(item.pautaId)}>{versoesDaPauta.length > 1 ? `${versoesDaPauta.length} versões desta pauta` : 'Pauta relacionada'}</button>
        </div>
        <div className="fila-card-sinais">
          {midiaPronta
            ? <span className="fila-sinal fila-sinal--ok" title="Mídia anexada à revisão atual">mídia ✓</span>
            : jobAtivo
              ? <span className="fila-sinal fila-sinal--info" title="A mídia está sendo preparada e revisada">mídia em produção…</span>
              : <span className="fila-sinal" title="Sem mídia anexada; consulte a direção visual e as opções de mídia">sem mídia</span>}
          {acesso === undefined
            ? <span className="fila-sinal" title="Lendo o acesso da conta…">conta …</span>
            : acesso.configurada
              ? <span className={`fila-sinal ${acesso.online ? 'fila-sinal--ok' : ''}`} title={acesso.login ? `Credencial configurada: ${acesso.login}` : 'Credencial configurada'}>{acesso.online ? `conta ✓${acesso.login ? ` ${acesso.login}` : ''}` : 'conta configurada'}</span>
              : <span className="fila-sinal fila-sinal--alerta" title="Sem credencial de API neste computador; conecte a conta para publicar">sem acesso</span>}
          <span className={`fila-estado fila-estado--${item.estado}`}>{ESTADOS.find((estado) => estado.id === item.estado)?.nome || item.estado}</span>
          <button className="fila-fechar" type="button" data-testid="fila-fechar" aria-label="Fechar revisão" onClick={onFechar}>Fechar ✕</button>
        </div>
      </header>

      <h3>{item.titulo || 'Sem título'}</h3>

      {editando ? (
        <div className="fila-editor">
          <label>Título<input value={titulo} onChange={(evento) => setTitulo(evento.target.value)} /></label>
          <label>Texto<textarea value={texto} onChange={(evento) => setTexto(evento.target.value)} rows={8} /></label>
          {camposExibidos.length > 0 && <div className="fila-editor-fields"><strong>Campos da conta</strong>{camposExibidos.map((chave) => <label key={chave}>{labelCampo(chave)}<input value={campos[chave] || ''} onChange={(evento) => setCampos((atuais) => ({ ...atuais, [chave]: evento.target.value }))} placeholder={chave === 'repository' ? 'org/repositório' : chave === 'subreddit' ? 'nome-do-subreddit' : undefined} /></label>)}</div>}
          <div className="fila-action-row"><button className="fila-button fila-button--quiet" type="button" onClick={() => setEditando(false)}>Cancelar edição</button><button className="fila-button fila-button--accent" type="button" disabled={busy} onClick={salvarEdicao}>Salvar edição</button></div>
          {item.estado === 'agendado' && <p className="fila-helper">Salvar a edição revoga o agendamento e devolve o item para revisão.</p>}
        </div>
      ) : (
        <>
          <p className="fila-card-text">{item.texto}</p>
          {item.midias?.length > 0 && <div className="fila-midias">{item.midias.map((midia) => <MediaPreview item={item} midia={midia} key={midia.id} />)}</div>}
          <section className="fila-proveniencia" data-testid="fila-proveniencia" aria-label="Quando e com base em quê esta peça foi produzida">
            {prova.quandoCompleto && <p className="fila-proveniencia-quando">Produzido em <time dateTime={item.criadoEm}>{prova.quandoCompleto}</time></p>}
            <p className="fila-proveniencia-base">{prova.base}</p>
            {prova.sumarioDia && (onNavegar
              ? <button type="button" className="fila-proveniencia-sumario" onClick={() => onNavegar(`sumario:${prova.sumarioDia}`)}>Abrir {prova.sumario}</button>
              : <p className="fila-proveniencia-sumario-texto">Com base no {prova.sumario}</p>)}
            {partesExtras.length > 0 && <ul className="fila-proveniencia-partes">{partesExtras.map((parte, indice) => <li key={`${parte.tipo}-${indice}`}>{parte.rotulo}</li>)}</ul>}
          </section>
          {item.fontes?.length > 0 && <details className="fila-fontes" open={fontesAbertas} onToggle={(evento) => setFontesAbertas((evento.currentTarget as HTMLDetailsElement).open)}><summary>Fontes e evidências ({item.fontes.length})</summary><ul>{item.fontes.map((fonte, indice) => <li key={`${fonte.rotulo}-${indice}`}>{fonte.url ? <a href={fonte.url} target="_blank" rel="noreferrer">{fonte.rotulo}</a> : fonte.rotulo}</li>)}</ul></details>}
          {item.agendadoPara && <p className="fila-helper">Agendado para {formatarQuando(item.agendadoPara)}</p>}
          {!formatoPublicavel && ['pendente', 'erro'].includes(item.estado) && <p className="fila-card-warning">{item.midias.length > 0 && !capacidadesCarregadas ? 'Verificando se esta conta aceita o upload da mídia…' : `Publicação e agendamento estão bloqueados: esta conta não confirmou suporte a ${item.formato === 'video' ? 'vídeo' : 'imagem'} nesta fila.`}</p>}
          {isPendente && !contaAcessivel && <p className="fila-card-warning">Esta conta ainda não tem credencial de API neste computador. Conecte-a para habilitar a publicação direta da fila.</p>}
          {erro && <p className="fila-card-error"><strong>{item.erro && typeof item.erro !== 'string' && item.erro.codigo ? `${item.erro.codigo}: ` : ''}</strong>{erro}</p>}
          {item.estado === 'incerto' && <p className="fila-card-warning">O resultado remoto é incerto. Consulte o recibo e a conta antes de decidir uma nova ação; não houve reenvio automático.</p>}
          {item.recibo && <p className="fila-recibo">Recibo: {item.recibo.url ? <a href={item.recibo.url} target="_blank" rel="noreferrer">{item.recibo.id || item.recibo.url}</a> : item.recibo.id || 'registrado sem URL'}</p>}
          {item.recibo?.comprovante && <section className="fila-comprovante-bloco" aria-label="Comprovante da publicação"><p className="fila-eyebrow">Comprovante</p><ComprovantePreview id={item.id} /></section>}
          <RevisaoEditorial item={item} />
          {!somenteLeitura && <MediaJobControls item={item} jobs={jobs} capacidades={capacidades} capacidadesCarregadas={capacidadesCarregadas} autorizarGasto={autorizarGasto} onChanged={onMediaChanged} onError={onError} />}
          {!somenteLeitura && item.estado !== 'publicando' && <details className="fila-espelho" open={espelhoAberto} onToggle={(evento) => setEspelhoAberto((evento.currentTarget as HTMLDetailsElement).open)}>
            <summary data-testid="fila-espelhar-abrir">Espelhar em outra rede ou idioma</summary>
            <div className="fila-espelho-body">
              <div className="fila-cobertura" aria-label="Versões existentes desta pauta">
                {CONTAS.flatMap((conta) => IDIOMAS.map((idioma) => {
                  const existe = combinacoesDaPauta.has(`${conta.id}:${idioma.id}`)
                  const ehEsta = conta.id === item.conta && idioma.id === item.idioma
                  return <span key={`${conta.id}:${idioma.id}`} className={`fila-cobertura-chip ${existe ? 'fila-cobertura-chip--existe' : ''} ${ehEsta ? 'fila-cobertura-chip--atual' : ''}`}>{conta.nome} · {rotuloIdioma(idioma.id)}{existe ? ' ✓' : ''}</span>
                }))}
              </div>
              <div className="fila-espelho-form">
                <label>Rede<select data-testid="fila-espelhar-conta" value={espelhoConta} onChange={(evento) => setEspelhoConta(evento.target.value as ContaEditorial)}>{CONTAS.map((conta) => <option key={conta.id} value={conta.id}>{conta.nome}</option>)}</select></label>
                <label>Idioma<select data-testid="fila-espelhar-idioma" value={espelhoIdioma} onChange={(evento) => setEspelhoIdioma(evento.target.value as IdiomaEditorial)}>{IDIOMAS.map((idioma) => <option key={idioma.id} value={idioma.id}>{idioma.nome}</option>)}</select></label>
                <button className="fila-button fila-button--accent" type="button" data-testid="fila-espelhar-confirmar" disabled={espelhando || combinacoesDaPauta.has(`${espelhoConta}:${espelhoIdioma}`)} onClick={() => void confirmarEspelho()}>{espelhando ? 'Gerando…' : 'Gerar versão adaptada'}</button>
              </div>
              <p className="fila-helper">O agente reescreve a peça na voz da rede e do idioma escolhidos — não é uma tradução literal. A versão nova entra como pendente e recebe a mesma mídia automática.</p>
            </div>
          </details>}
          <footer className="fila-card-actions">
            {item.estado === 'publicado' && item.recibo?.url && !item.recibo?.comprovante && <button className="fila-button fila-button--accent" type="button" disabled={capturando} onClick={() => void capturarComprovante()}>{capturando ? 'Capturando…' : 'Capturar comprovante'}</button>}
            {!somenteLeitura && acesso?.visual && <p className="fila-card-warning">Envio pela sessão de {acesso.login} na bancada, após sua aprovação. Prazo: dez minutos; agendamentos têm quinze minutos de tolerância.</p>}
            {!somenteLeitura && item.estado === 'aguardando_executor' && <p className="fila-helper" role="status">{item.publicacao?.estado === 'aguardando_humano' ? 'Aguardando login ou devolução da bancada.' : item.publicacao?.estado === 'envio_iniciado' ? 'Verificando o resultado no LinkedIn…' : 'Publicação aprovada, aguardando o executor.'}</p>}
            {!somenteLeitura && item.estado === 'aguardando_executor' && item.publicacao?.jobId && item.publicacao.estado !== 'envio_iniciado' && <button type="button" className="fila-button fila-button--quiet" disabled={busy} onClick={() => onAction(item.id, 'reabrir', async () => { await operarSessaoVisual('cancelar', { jobId: item.publicacao?.jobId }); const atuais = await listarEditorial(); return atuais.find(atual => atual.id === item.id) || item })}>Cancelar envio</button>}
            {!somenteLeitura && isPendente && item.prontidao && item.prontidao.bloqueios.length > 0 && <div className="fila-card-warning" data-testid="fila-bloqueios"><strong>Portão de publicação: {item.prontidao.modo === 'automatico' ? 'um agente não publicaria esta peça' : 'publicação automática desligada'}</strong><ul>{item.prontidao.bloqueios.map((b) => <li key={b.codigo}>{b.mensagem}</li>)}</ul></div>}
            {!somenteLeitura && podePublicar && <button className="fila-button fila-button--accent" type="button" data-testid="fila-publicar" disabled={busy} onClick={() => onAction(item.id, 'publicar', async () => publicarEditorial(item.id, item.revisao, acesso?.perfilUrl))}>Publicar agora</button>}
            {!somenteLeitura && isPendente && formatoPublicavel && !contaAcessivel && <button className="fila-button fila-button--accent" type="button" data-testid={`fila-conectar-${item.conta}`} onClick={() => onConectar?.(item.conta)}>Conectar {nomesConta[item.conta] || item.conta} para publicar</button>}
            {!somenteLeitura && isPendente && formatoPublicavel && <button className="fila-button" type="button" disabled={busy} onClick={() => { setAgenda(proximaHoraLocal()); setEditando(false) }}>Agendar</button>}
            {!somenteLeitura && agenda && <div className="fila-agenda"><label>Data e hora local<input type="datetime-local" value={agenda} min={proximaHoraLocal()} onChange={(evento) => setAgenda(evento.target.value)} /></label><small>{acesso?.visual ? 'O envio exige o DailyWork e a bancada disponíveis, com até quinze minutos de tolerância após o horário aprovado.' : 'O envio acontece com o DailyWork em execução; horários vencidos são processados quando ele volta.'}{!contaAcessivel ? ' A conta ainda não tem credencial: conecte-a antes do horário.' : ''}</small><button className="fila-button fila-button--accent" type="button" disabled={busy} onClick={confirmarAgendamento}>Confirmar</button><button className="fila-button fila-button--quiet" type="button" onClick={() => setAgenda('')}>Cancelar</button></div>}
            {!somenteLeitura && recusaAberta && podeRecusar && <div className="fila-recusa-form"><label>O que precisa melhorar? (opcional)<textarea data-testid="fila-motivo-recusa" value={motivoRecusa} maxLength={1000} onChange={e => setMotivoRecusa(e.target.value)} placeholder="Ex.: abertura genérica; quero ver uma situação real de uso." rows={2} /></label><p className="fila-helper">O editor usará esse feedback nas próximas pautas. Suas edições de texto também ficam registradas.</p><button className="fila-button fila-button--danger" type="button" disabled={busy} onClick={() => onAction(item.id, 'recusar', async () => recusarEditorial(item.id, item.revisao, motivoRecusa))}>Confirmar recusa</button></div>}
            {!somenteLeitura && podeRecusar && <button className="fila-button fila-button--danger" type="button" disabled={busy} onClick={() => setRecusaAberta(aberta => !aberta)}>Recusar</button>}
            {!somenteLeitura && onApagar && <button className="fila-button fila-button--danger" type="button" data-testid={`fila-apagar-${item.id}`} disabled={busy || exclusaoBloqueadaNaFila(item)} title={exclusaoBloqueadaNaFila(item) ? 'Cancele o envio antes de apagar esta versão.' : confirmandoApagar ? 'Confirma: esta versão sai da fila e vai para o arquivo.' : 'Tira esta versão da fila. Dá para recuperar no arquivo.'} onClick={onApagar}>{busy && confirmandoApagar ? 'Apagando…' : confirmandoApagar ? 'Confirmar exclusão' : 'Apagar da fila'}</button>}
            {!somenteLeitura && (item.estado === 'pendente' || item.estado === 'agendado') && <button className="fila-button fila-button--quiet" type="button" disabled={busy} onClick={abrirEdicao}>Editar</button>}
            {!somenteLeitura && ['erro', 'incerto'].includes(item.estado) && <button className="fila-button fila-button--accent" type="button" disabled={busy} onClick={() => onAction(item.id, 'reabrir', async () => reabrirEditorial(item.id, item.revisao))}>Revisar e reabrir</button>}
            {!somenteLeitura && item.estado === 'recusado' && <button className="fila-button fila-button--accent" type="button" disabled={busy} onClick={() => onAction(item.id, 'reabrir', async () => reabrirEditorial(item.id, item.revisao))}>Reabrir recusado</button>}
            {(busy || capturando) && <span className="fila-action-progress" role="status">{capturando ? 'Capturando…' : 'Enviando…'}</span>}
          </footer>
        </>
      )}
      <p className="fila-card-updated">{prova.quando ? `Produzido ${prova.quando}` : ''}{prova.quando && item.atualizadoEm !== item.criadoEm ? ' · ' : ''}{item.atualizadoEm !== item.criadoEm ? `Atualizado ${formatarDataHora(item.atualizadoEm)}` : ''}{(prova.quando || item.atualizadoEm !== item.criadoEm) ? ' · ' : ''}revisão {item.revisao}</p>
    </article>
  )
}
