import { useEffect, useRef, useState, type FormEvent } from 'react'
import { criarBloco } from '../lib/api'

interface ProjetoOpcao {
  id: string
  name: string
}

interface NovaFrenteProps {
  dia: string
  projetos?: ProjetoOpcao[]
  onCriada: () => void | Promise<void>
}

export function NovaFrente({ dia, projetos = [], onCriada }: NovaFrenteProps) {
  const [titulo, setTitulo] = useState('')
  const [aberto, setAberto] = useState(false)
  const [objetivo, setObjetivo] = useState('')
  const [tipo, setTipo] = useState<'tarefa' | 'projeto'>('tarefa')
  const [projeto, setProjeto] = useState('')
  const [repositorio, setRepositorio] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        setAberto(false)
        setTitulo('')
        setObjetivo('')
        setErro('')
        inputRef.current?.blur()
        return
      }
      if (evento.key !== 'n' && evento.key !== 'N') return
      const alvo = evento.target
      if (alvo instanceof HTMLElement) {
        const tag = alvo.tagName
        if (alvo.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      }
      evento.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  async function criar(evento?: FormEvent) {
    evento?.preventDefault()
    const nome = titulo.trim()
    if (!nome || salvando) return
    setSalvando(true)
    setErro('')
    try {
      await criarBloco(
        {
          tipo,
          titulo: nome.slice(0, 80),
          status: 'pendente',
          papel: 'front',
          origem: 'human',
          ...(projeto ? { projeto } : {}),
          ...(repositorio.trim() ? { repositorio: repositorio.trim() } : {}),
          corpo: objetivo.trim()
            ? `Objetivo: ${objetivo.trim()}\n\nPRONTO = avanço concreto registrado neste dia.`
            : '',
        },
        dia
      )
      setTitulo('')
      setObjetivo('')
      setAberto(false)
      await onCriada()
    } catch (e) {
      setErro(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form className="nova-frente" data-testid="nova-frente" onSubmit={(evento) => void criar(evento)}>
      <div className="nova-frente-linha">
        <input
          ref={inputRef}
          value={titulo}
          maxLength={80}
          placeholder="Nova frente — Enter para criar"
          aria-label="Título da nova frente"
          disabled={salvando}
          onChange={(evento) => setTitulo(evento.target.value)}
        />
        <button type="submit" disabled={salvando || !titulo.trim()}>
          {salvando ? 'Criando…' : 'Adicionar'}
        </button>
        <button
          type="button"
          className="nova-frente-detalhes"
          aria-expanded={aberto}
          onClick={() => setAberto((valor) => !valor)}
        >
          {aberto ? 'Menos' : 'Mais detalhes'}
        </button>
      </div>
      {aberto && (
        <div className="nova-frente-extra">
          <label>
            Objetivo
            <textarea
              rows={2}
              value={objetivo}
              disabled={salvando}
              onChange={(evento) => setObjetivo(evento.target.value.slice(0, 800))}
            />
          </label>
          <div className="nova-frente-campos">
            <label>
              Tipo
              <select value={tipo} disabled={salvando} onChange={(evento) => setTipo(evento.target.value as 'tarefa' | 'projeto')}>
                <option value="tarefa">Tarefa</option>
                <option value="projeto">Projeto</option>
              </select>
            </label>
            <label>
              Projeto
              <input
                list="nova-frente-projetos"
                value={projeto}
                disabled={salvando}
                onChange={(evento) => setProjeto(evento.target.value)}
              />
              <datalist id="nova-frente-projetos">
                {projetos.map((item) => (
                  <option value={item.id} key={item.id}>{item.name}</option>
                ))}
              </datalist>
            </label>
            <label>
              Repositório
              <input
                value={repositorio}
                disabled={salvando}
                placeholder="/caminho/do/repo"
                onChange={(evento) => setRepositorio(evento.target.value)}
              />
            </label>
          </div>
        </div>
      )}
      {erro && <p className="nova-frente-erro" role="alert">{erro}</p>}
    </form>
  )
}
