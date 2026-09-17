import { useState } from 'react'
import {
  criarEditorial,
  gerarEditorial,
  iniciarMidiaJob,
  publicarEditorial,
  type ContaEditorial,
  type EstadoFilaEditorial,
  type IdiomaEditorial,
} from '../../lib/editorial'
import { CONTAS, IDIOMAS, LIMITE_TEXTO, acessoDaConta, erroTexto, hojeLocalISO, nomesConta, type AcessoConta } from './comum'
import type { Conexao } from '../../lib/api'

export type ModoCompositor = 'escrever' | 'pedir' | null

export function Compositor({
  modo,
  conexoes,
  estado,
  onFechar,
  onCriado,
  onPedido,
  onError,
}: {
  modo: Exclude<ModoCompositor, null>
  conexoes: Partial<Record<ContaEditorial, Conexao>>
  estado: EstadoFilaEditorial | null
  onFechar: () => void
  onCriado: (id: string, publicado: boolean) => void
  onPedido: () => void
  onError: (mensagem: string) => void
}) {
  return modo === 'escrever'
    ? <EscreverPost conexoes={conexoes} onFechar={onFechar} onCriado={onCriado} onError={onError} />
    : <PedirPost estado={estado} onFechar={onFechar} onPedido={onPedido} onError={onError} />
}

function EscreverPost({
  conexoes,
  onFechar,
  onCriado,
  onError,
}: {
  conexoes: Partial<Record<ContaEditorial, Conexao>>
  onFechar: () => void
  onCriado: (id: string, publicado: boolean) => void
  onError: (mensagem: string) => void
}) {
  const [conta, setConta] = useState<ContaEditorial>('x')
  const [idioma, setIdioma] = useState<IdiomaEditorial>('pt-BR')
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [imagem, setImagem] = useState<{ nome: string; base64: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const limite = LIMITE_TEXTO[conta]
  const restante = limite - [...texto].length
  const acesso: AcessoConta = acessoDaConta(conexoes, conta)

  async function lerImagem(arquivo: File | undefined) {
    if (!arquivo) return
    if (arquivo.size > 4 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(arquivo.type)) {
      onError('Escolha uma imagem PNG ou JPEG com até 4 MB.')
      return
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.readAsDataURL(arquivo)
    })
    setImagem({ nome: arquivo.name, base64 })
  }

  async function salvar(publicar: boolean) {
    const corpo = texto.trim()
    if (!corpo) { onError('Escreva o texto da publicação.'); return }
    if ([...corpo].length > limite) { onError(`O texto passa do limite de ${limite} caracteres desta rede.`); return }
    setBusy(true)
    try {
      const criado = await criarEditorial({
        pautaId: `manual-${Date.now().toString(36)}`,
        conta,
        idioma,
        formato: 'texto',
        titulo: titulo.trim() || corpo.slice(0, 80),
        texto: corpo,
        origem: { tipo: 'manual' },
        campos: {},
        fontes: [],
        midias: [],
      })
      if (imagem) {
        await iniciarMidiaJob({ itemId: criado.id, revisao: criado.revisao, tipo: 'imagem', imagemBase64: imagem.base64 })
        onCriado(criado.id, false)
        return
      }
      if (publicar) {
        const publicado = await publicarEditorial(criado.id, criado.revisao, acesso?.perfilUrl)
        onCriado(publicado.id, publicado.estado === 'publicado' || publicado.estado === 'aguardando_executor')
        return
      }
      onCriado(criado.id, false)
    } catch (erro) {
      onError(erroTexto(erro).mensagem)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="fila-compositor" data-testid="fila-compositor-escrever">
      <header className="fila-compositor-heading">
        <div>
          <p className="fila-eyebrow">Post direto</p>
          <h2>Escrever agora</h2>
        </div>
        <button className="fila-button fila-button--quiet" type="button" onClick={onFechar}>Fechar</button>
      </header>
      <div className="fila-compositor-form">
        <label>Rede<select value={conta} onChange={(evento) => setConta(evento.target.value as ContaEditorial)}>{CONTAS.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
        <label>Idioma<select value={idioma} onChange={(evento) => setIdioma(evento.target.value as IdiomaEditorial)}>{IDIOMAS.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
        <label className="fila-compositor-titulo">Título opcional<input value={titulo} onChange={(evento) => setTitulo(evento.target.value)} placeholder="Se vazio, usa o começo do texto" /></label>
        <label className="fila-compositor-texto">Texto<textarea rows={6} value={texto} onChange={(evento) => setTexto(evento.target.value)} placeholder={`O que você quer publicar no ${nomesConta[conta]}`} /></label>
        <p className={`fila-contador ${restante < 0 ? 'is-over' : ''}`}>{restante} caracteres restantes · {nomesConta[conta]}</p>
        <label className="fila-importar-imagem">Imagem opcional
          <span className="fila-importar-botao">{imagem ? imagem.nome : 'Anexar PNG ou JPEG'}</span>
          <input type="file" accept="image/png,image/jpeg" onChange={(evento) => { void lerImagem(evento.target.files?.[0]); evento.target.value = '' }} />
          {imagem && <button className="fila-button fila-button--quiet" type="button" onClick={() => setImagem(null)}>Remover imagem</button>}
        </label>
      </div>
      <div className="fila-action-row">
        <button className="fila-button" type="button" disabled={busy} onClick={() => void salvar(false)}>{busy ? 'Salvando…' : 'Salvar na fila'}</button>
        <button className="fila-button fila-button--accent" type="button" disabled={busy || Boolean(imagem)} title={imagem ? 'Com imagem, a peça entra na fila para revisão visual antes do envio' : undefined} onClick={() => void salvar(true)}>{busy ? 'Publicando…' : 'Publicar agora'}</button>
      </div>
      {imagem && <p className="fila-helper">A imagem passa pela revisão visual. A peça entra na fila; publique depois que a mídia estiver pronta.</p>}
    </section>
  )
}

function PedirPost({
  estado,
  onFechar,
  onPedido,
  onError,
}: {
  estado: EstadoFilaEditorial | null
  onFechar: () => void
  onPedido: () => void
  onError: (mensagem: string) => void
}) {
  const [tema, setTema] = useState('')
  const [contexto, setContexto] = useState('')
  const [projeto, setProjeto] = useState('')
  const [contas, setContas] = useState<ContaEditorial[]>(['x'])
  const [idiomas, setIdiomas] = useState<IdiomaEditorial[]>(['pt-BR'])
  const [busy, setBusy] = useState(false)
  const executando = estado?.producao.status === 'executando'
  const projetos = estado?.projetos || []

  async function pedir() {
    if (!tema.trim()) { onError('Diga o assunto do post.'); return }
    if (!contas.length || !idiomas.length) { onError('Escolha pelo menos uma rede e um idioma.'); return }
    setBusy(true)
    try {
      await gerarEditorial({
        dia: hojeLocalISO(),
        quantidade: 1,
        contas,
        idiomas,
        pedido: { tema: tema.trim(), contexto: contexto.trim() || undefined, projeto: projeto || undefined },
      })
      onPedido()
    } catch (erro) {
      onError(erroTexto(erro).mensagem)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="fila-compositor" data-testid="fila-compositor-pedir">
      <header className="fila-compositor-heading">
        <div>
          <p className="fila-eyebrow">Pedido ao redator</p>
          <h2>Pedir um post sobre…</h2>
        </div>
        <button className="fila-button fila-button--quiet" type="button" onClick={onFechar}>Fechar</button>
      </header>
      <div className="fila-compositor-form">
        <label className="fila-compositor-titulo">Assunto<input value={tema} onChange={(evento) => setTema(evento.target.value)} placeholder="Ex.: a nova fila do DailyWork" /></label>
        <label className="fila-compositor-texto">Contexto opcional<textarea rows={3} value={contexto} onChange={(evento) => setContexto(evento.target.value)} placeholder="O que precisa aparecer, o recorte, o tom" /></label>
        {projetos.length > 0 && <label>Projeto<select value={projeto} onChange={(evento) => setProjeto(evento.target.value)}><option value="">Nenhum</option>{projetos.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>}
        <div className="fila-fieldset"><span>Redes</span><div className="fila-checks">{CONTAS.map((conta) => <label key={conta.id}><input type="checkbox" checked={contas.includes(conta.id)} onChange={() => setContas((atuais) => atuais.includes(conta.id) ? atuais.filter((id) => id !== conta.id) : [...atuais, conta.id])} />{conta.nome}</label>)}</div></div>
        <div className="fila-fieldset"><span>Idiomas</span><div className="fila-checks">{IDIOMAS.map((idioma) => <label key={idioma.id}><input type="checkbox" checked={idiomas.includes(idioma.id)} onChange={() => setIdiomas((atuais) => atuais.includes(idioma.id) ? atuais.filter((id) => id !== idioma.id) : [...atuais, idioma.id])} />{idioma.nome}</label>)}</div></div>
      </div>
      <div className="fila-action-row">
        <button className="fila-button fila-button--accent" type="button" disabled={busy || executando} onClick={() => void pedir()}>{busy || executando ? 'Produzindo…' : 'Pedir ao redator'}</button>
      </div>
      {(busy || executando) && <p className="fila-helper" role="status">{estado?.producao.etapa || 'O editor está montando a peça.'}</p>}
    </section>
  )
}
