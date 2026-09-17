import { useEffect, useMemo, useState } from 'react'
import {
  obterLogicaEditorial,
  restaurarLogicaEditorial,
  salvarLogicaEditorial,
  type LogicaEditorial,
  type PassoRoteiroEditorial,
} from '../lib/editorial'
import './logica-editorial.css'

type AbaPreview = 'redacao' | 'pauta' | 'revisao' | 'imagem'

const ABAS: Array<{ id: AbaPreview; rotulo: string }> = [
  { id: 'redacao', rotulo: 'Redação' },
  { id: 'pauta', rotulo: 'Pauta' },
  { id: 'revisao', rotulo: 'Revisão' },
  { id: 'imagem', rotulo: 'Imagem' },
]

function cloneLogica(valor: LogicaEditorial): LogicaEditorial {
  return JSON.parse(JSON.stringify(valor))
}

function previewLocal(logica: LogicaEditorial) {
  const numerar = logica.roteiro.map((passo, indice) => `${indice + 1}. ${passo.rotulo} — ${passo.instrucao}`).join('\n')
  const notas = logica.notas.trim() ? `\nNotas extras do editor humano:\n${logica.notas.trim()}\n` : ''
  const cobertura = logica.roteiro.map((passo) => `- ${passo.id}: ${passo.proposito}`).join('\n')
  return {
    redacao: `ROTEIRO DO POST (começo, meio e fim, falado de forma natural; sem subtítulos nem nomes dos passos no texto):\n${numerar}\n\nVOZ: ${logica.voz.tom}\n${logica.voz.naturalidade}\nEvite: ${logica.voz.evitar}\nTransforme a pauta nessa progressão, não num inventário de funcionalidades.${notas}`,
    pauta: `A pauta precisa sustentar uma história completa, mesmo quando o texto final for curto. Siga este roteiro, sem rotular os parágrafos com esses nomes:\n${numerar}${notas}`,
    revisao: `Avalie a progressão da história segundo o roteiro vigente. Cada papel precisa aparecer no texto, sem exigir subtítulos:\n${cobertura}\nVoz esperada: ${logica.voz.tom} ${logica.voz.naturalidade}${notas}`,
    imagem: `Direção visual ligada ao roteiro do post:\n- Função: ${logica.imagem.funcao}\n- Cena: ${logica.imagem.cena}\n- Evite: ${logica.imagem.evitar}${notas}`,
  }
}

function erroTexto(erro: unknown): string {
  return erro instanceof Error ? erro.message : 'Não foi possível concluir esta ação.'
}

export function LogicaEditorial() {
  const [original, setOriginal] = useState<LogicaEditorial | null>(null)
  const [rascunho, setRascunho] = useState<LogicaEditorial | null>(null)
  const [carregado, setCarregado] = useState(false)
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [aba, setAba] = useState<AbaPreview>('redacao')
  const [passoAberto, setPassoAberto] = useState('tema')

  async function carregar() {
    setOcupado('carregar')
    setErro('')
    try {
      const valor = await obterLogicaEditorial()
      setOriginal(cloneLogica(valor))
      setRascunho(cloneLogica(valor))
      setCarregado(true)
    } catch (falha) {
      setErro(erroTexto(falha))
    } finally {
      setOcupado('')
    }
  }

  useEffect(() => { void carregar() }, [])

  const sujo = useMemo(() => {
    if (!original || !rascunho) return false
    return JSON.stringify({
      roteiro: original.roteiro,
      voz: original.voz,
      imagem: original.imagem,
      notas: original.notas,
    }) !== JSON.stringify({
      roteiro: rascunho.roteiro,
      voz: rascunho.voz,
      imagem: rascunho.imagem,
      notas: rascunho.notas,
    })
  }, [original, rascunho])

  function atualizarPasso(id: string, campo: keyof PassoRoteiroEditorial, valor: string) {
    setRascunho((atual) => {
      if (!atual) return atual
      return { ...atual, roteiro: atual.roteiro.map((passo) => passo.id === id ? { ...passo, [campo]: valor } : passo) }
    })
  }

  async function salvar() {
    if (!rascunho || ocupado) return
    setOcupado('salvar')
    setErro('')
    setAviso('')
    try {
      const salvo = await salvarLogicaEditorial({
        roteiro: rascunho.roteiro,
        voz: rascunho.voz,
        imagem: rascunho.imagem,
        notas: rascunho.notas,
      })
      setOriginal(cloneLogica(salvo))
      setRascunho(cloneLogica(salvo))
      setAviso('Lógica salva. Os próximos posts e imagens já usam este roteiro.')
    } catch (falha) {
      setErro(erroTexto(falha))
    } finally {
      setOcupado('')
    }
  }

  async function restaurar() {
    if (ocupado) return
    setOcupado('restaurar')
    setErro('')
    setAviso('')
    try {
      const padrao = await restaurarLogicaEditorial()
      setOriginal(cloneLogica(padrao))
      setRascunho(cloneLogica(padrao))
      setAviso('Roteiro padrão restaurado: tema, problema, resolução e conclusão.')
    } catch (falha) {
      setErro(erroTexto(falha))
    } finally {
      setOcupado('')
    }
  }

  const preview = rascunho ? previewLocal(rascunho) : null
  const textoPreview = preview?.[aba] || ''

  return (
    <main className="logica-page" data-testid="logica-editorial" data-dailywork-ready={carregado ? 'true' : 'false'}>
      <div className="logica-inner">
        <header className="logica-header">
          <div>
            <p className="logica-eyebrow">Fila editorial</p>
            <h1>Lógica dos posts</h1>
            <p className="logica-lede">
              O mesmo lugar para editar o roteiro da redação, da revisão e da imagem. Um post precisa de começo, meio e fim, falado de forma natural: anunciar o tema, mostrar o problema, contar a resolução e fechar a ideia.
            </p>
          </div>
          <div className="logica-acoes">
            <button type="button" className="logica-botao" disabled={Boolean(ocupado) || !carregado} onClick={() => void restaurar()}>
              {ocupado === 'restaurar' ? 'Restaurando…' : 'Restaurar padrão'}
            </button>
            <button type="button" className="logica-botao logica-botao--primario" disabled={!sujo || Boolean(ocupado) || !carregado} onClick={() => void salvar()} data-testid="logica-salvar">
              {ocupado === 'salvar' ? 'Salvando…' : 'Salvar lógica'}
            </button>
          </div>
        </header>

        {erro && <p className="logica-erro" role="alert">{erro}</p>}
        {aviso && <p className="logica-aviso" role="status">{aviso}</p>}

        {!carregado && !erro && <p className="logica-vazio">Carregando a lógica vigente…</p>}

        {rascunho && <div className="logica-grade">
          <div className="logica-coluna">
            <section className="logica-secao">
              <header className="logica-secao-heading">
                <div>
                  <h2>Roteiro</h2>
                  <p>Quatro passos fixos. Edite o que cada um deve fazer; o texto final não usa esses nomes como subtítulo.</p>
                </div>
                <span className="logica-chip">{rascunho.padrao ? 'Padrão' : 'Personalizado'}</span>
              </header>
              <ol className="logica-passos">
                {rascunho.roteiro.map((passo, indice) => (
                  <li key={passo.id} className={`logica-passo ${passoAberto === passo.id ? 'is-open' : ''}`}>
                    <button type="button" className="logica-passo-cab" onClick={() => setPassoAberto(passo.id)} aria-expanded={passoAberto === passo.id}>
                      <span className="logica-passo-num">{String(indice + 1).padStart(2, '0')}</span>
                      <span>
                        <strong>{passo.rotulo}</strong>
                        <small>{passo.proposito}</small>
                      </span>
                    </button>
                    {passoAberto === passo.id && <div className="logica-passo-corpo">
                      <label>Nome do passo
                        <input value={passo.rotulo} maxLength={40} onChange={(evento) => atualizarPasso(passo.id, 'rotulo', evento.target.value)} />
                      </label>
                      <label>O que este passo precisa cumprir
                        <input value={passo.proposito} maxLength={240} onChange={(evento) => atualizarPasso(passo.id, 'proposito', evento.target.value)} />
                      </label>
                      <label>Instrução para o modelo
                        <textarea rows={5} value={passo.instrucao} onChange={(evento) => atualizarPasso(passo.id, 'instrucao', evento.target.value)} />
                      </label>
                    </div>}
                  </li>
                ))}
              </ol>
            </section>

            <section className="logica-secao">
              <header className="logica-secao-heading">
                <div>
                  <h2>Voz</h2>
                  <p>Como o post deve soar depois que o roteiro está no lugar.</p>
                </div>
              </header>
              <div className="logica-campos">
                <label>Tom
                  <textarea rows={3} value={rascunho.voz.tom} onChange={(evento) => setRascunho({ ...rascunho, voz: { ...rascunho.voz, tom: evento.target.value } })} />
                </label>
                <label>Naturalidade
                  <textarea rows={3} value={rascunho.voz.naturalidade} onChange={(evento) => setRascunho({ ...rascunho, voz: { ...rascunho.voz, naturalidade: evento.target.value } })} />
                </label>
                <label>O que evitar
                  <textarea rows={3} value={rascunho.voz.evitar} onChange={(evento) => setRascunho({ ...rascunho, voz: { ...rascunho.voz, evitar: evento.target.value } })} />
                </label>
              </div>
            </section>

            <section className="logica-secao">
              <header className="logica-secao-heading">
                <div>
                  <h2>Imagem</h2>
                  <p>A cena precisa ilustrar o mesmo arco do texto, de preferência a resolução concreta.</p>
                </div>
              </header>
              <div className="logica-campos">
                <label>Função da imagem
                  <textarea rows={3} value={rascunho.imagem.funcao} onChange={(evento) => setRascunho({ ...rascunho, imagem: { ...rascunho.imagem, funcao: evento.target.value } })} />
                </label>
                <label>Cena
                  <textarea rows={3} value={rascunho.imagem.cena} onChange={(evento) => setRascunho({ ...rascunho, imagem: { ...rascunho.imagem, cena: evento.target.value } })} />
                </label>
                <label>O que evitar
                  <textarea rows={3} value={rascunho.imagem.evitar} onChange={(evento) => setRascunho({ ...rascunho, imagem: { ...rascunho.imagem, evitar: evento.target.value } })} />
                </label>
              </div>
            </section>

            <section className="logica-secao">
              <header className="logica-secao-heading">
                <div>
                  <h2>Notas extras</h2>
                  <p>Entram no prompt compilado. Use para ajustes pontuais, sem reescrever o roteiro.</p>
                </div>
              </header>
              <label className="logica-notas">Notas
                <textarea rows={4} value={rascunho.notas} onChange={(evento) => setRascunho({ ...rascunho, notas: evento.target.value })} placeholder="Opcional. Ex.: em inglês, abrir pelo detalhe mais específico." />
              </label>
            </section>
          </div>

          <aside className="logica-preview">
            <header className="logica-secao-heading">
              <div>
                <h2>Prompt compilado</h2>
                <p>O que o redator, o editor e a geração de imagem passam a seguir.</p>
              </div>
            </header>
            <div className="logica-preview-abas" role="tablist">
              {ABAS.map((item) => (
                <button key={item.id} type="button" role="tab" aria-selected={aba === item.id} className={aba === item.id ? 'is-active' : ''} onClick={() => setAba(item.id)}>
                  {item.rotulo}
                </button>
              ))}
            </div>
            <pre className="logica-preview-texto" data-testid="logica-preview">{textoPreview}</pre>
            <p className="logica-preview-meta">
              {sujo ? 'Há alterações não salvas. Este preview já mostra o rascunho; a produção só muda depois de salvar.' : rascunho.atualizadoEm ? `Salvo em ${new Date(rascunho.atualizadoEm).toLocaleString('pt-BR')}` : 'Usando o roteiro padrão.'}
            </p>
          </aside>
        </div>}
      </div>
    </main>
  )
}
