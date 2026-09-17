import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// Toda a lógica de filesystem mora em electron/lib-md.cjs (fonte única).
const require = createRequire(import.meta.url)
const lib = require('./electron/lib-md.cjs')
const { apiAgentesDev } = require('./electron/lib-api-dev.cjs')
const { criarServicoAgente } = require('./electron/lib-agente-9router.cjs')
const { criarServicoExecutorNativo } = require('./electron/lib-executor-nativo.cjs')
const { criarServicoAnaliseSumario } = require('./electron/lib-analise-sumario.cjs')
const { criarFluxoLucasOL } = require('./electron/lib-fluxo-lucasol.cjs')
const { criarServicoSumario } = require('./electron/lib-sumario-diario.cjs')
const { criarRegistroIntegracoes } = require('./electron/integracoes/registro.cjs')
const { criarLogicaEditorial } = require('./electron/lib-logica-editorial.cjs')
const { criarRedatorPublicacoes } = require('./electron/lib-redator-publicacoes.cjs')
const { criarFilaEditorial } = require('./electron/lib-fila-editorial.cjs')
const { criarJobsMidiasEditoriais } = require('./electron/lib-jobs-midias-editoriais.cjs')
const { criarServicoAutomacoes } = require('./electron/lib-automacoes.cjs')
const { criarServicoCandidaturas } = require('./electron/lib-candidaturas.cjs')
const { criarServicoSkills, criarMiddlewareSkills } = require('./electron/lib-skills.cjs')
const { criarMiddlewareCandidaturas } = require('./electron/candidaturas/operacoes.cjs')
const { criarMiddlewareAutomacoes } = require('./electron/automacoes/http.cjs')
const { dataValida, diaLocal } = require('./electron/sumario/shared.cjs')
let analiseSumario: any = null
const fluxoLucasOL = criarFluxoLucasOL({
  daily: lib,
  obterAnaliseSumario: (dia: string) => (analiseSumario ? analiseSumario.obter(dia) : null),
})
// Fora do Electron não existe safeStorage: o cofre usa uma chave local 0600
// em DAILYWORK_USER_DATA_DIR (padrão ~/.config/DailyWork), a mesma pasta do app.
const userDataDir =
  process.env.DAILYWORK_USER_DATA_DIR ||
  path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.config'), 'DailyWork')
const integracoes = criarRegistroIntegracoes({ userDataDir, dataDir: lib.DATA_DIR, habilitarSessoes: !process.env.DAILYWORK_CAPTURE_PATH })
const agente = criarServicoAgente({ lib, fluxo: fluxoLucasOL, integracoes })
const executorNativo = criarServicoExecutorNativo({
  lib,
  executarComFerramentas: (entrada: unknown) => agente.executarComFerramentas(entrada),
})
const sumario = criarServicoSumario({
  appRoot: path.dirname(fileURLToPath(import.meta.url)),
  fontesExtras: integracoes.fontesSumario(),
})
analiseSumario = criarServicoAnaliseSumario({
  sumario,
  completar: (entrada: unknown) => agente.completar(entrada),
})
const logicaEditorial = criarLogicaEditorial({ dataDir: lib.DATA_DIR })
const redator = criarRedatorPublicacoes({
  completar: (entrada: unknown) => agente.completar(entrada),
  registro: integracoes,
  lib,
  sumario,
  analiseSumario,
  logica: () => logicaEditorial.obter(),
})
const filaEditorial = criarFilaEditorial({ dataDir: lib.DATA_DIR, registro: integracoes })
const automacoes = criarServicoAutomacoes({ dataDir: lib.DATA_DIR, completar: (entrada: unknown) => agente.completar(entrada) })
const candidaturas = criarServicoCandidaturas({ privateDir: process.env.DAILYWORK_CAPTURE_PATH ? path.join(lib.DATA_DIR, ".candidaturas") : undefined, desabilitarExecucao: Boolean(process.env.DAILYWORK_CAPTURE_PATH) })
const skills = criarServicoSkills()
// Visão global do agente: a Fila editorial entra como fonte somente leitura.
agente.definirFontes({ fila: filaEditorial })
const jobsMidiasEditoriais = criarJobsMidiasEditoriais({ fila: filaEditorial, dataDir: lib.DATA_DIR, completar: (entrada: unknown) => agente.completar(entrada), completarComImagens: (entrada: unknown) => agente.completarComImagens(entrada), logica: () => logicaEditorial.obter() })
let producaoEditorial: any = null
try {
  const { criarProducaoEditorial } = require('./electron/lib-producao-editorial.cjs')
  producaoEditorial = criarProducaoEditorial({
    fila: filaEditorial,
    registro: integracoes,
    lib,
    sumario,
    analiseSumario,
    completar: (entrada: unknown) => agente.completar(entrada),
    jobsMidias: jobsMidiasEditoriais,
    logica: () => logicaEditorial.obter(),
  })
} catch (erro: any) {
  if (erro?.code !== 'MODULE_NOT_FOUND' || !String(erro?.message || '').includes('lib-producao-editorial')) throw erro
}

// Envelope padrão: { ok, data?, erro? } — mesmo do IPC (electron/main.cjs).
function ok(res: import('node:http').ServerResponse, data: unknown, status = 200) {
  res.statusCode = status
  res.end(JSON.stringify({ ok: true, data }))
}

function falha(
  res: import('node:http').ServerResponse,
  status: number,
  codigo: string,
  mensagem: string
) {
  res.statusCode = status
  res.end(JSON.stringify({ ok: false, erro: { codigo, mensagem } }))
}

const ID_JOB_MIDIA = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
function exigirIdJobMidia(id: string): string {
  if (!ID_JOB_MIDIA.test(id)) throw Object.assign(new Error('identificador de job inválido.'), { codigo: 'ID_INVALIDO', status: 400 })
  return id
}

function lerCorpo(
  req: import('node:http').IncomingMessage,
  limiteBytes = Number.POSITIVE_INFINITY
): Promise<string> {
  return new Promise((resolve, reject) => {
    let dados = ''
    let bytes = 0
    let excedeu = false
    req.setEncoding('utf8')
    req.on('data', (c) => {
      if (excedeu) return
      bytes += Buffer.byteLength(c)
      if (bytes > limiteBytes) {
        excedeu = true
        reject(Object.assign(new Error('corpo excede o limite permitido'), {
          codigo: 'CORPO_MUITO_GRANDE',
          status: 413,
        }))
        return
      }
      dados += c
    })
    req.on('end', () => resolve(dados))
    req.on('error', reject)
  })
}

async function lerJson(req: import('node:http').IncomingMessage, limiteBytes?: number) {
  const texto = await lerCorpo(req, limiteBytes)
  return texto ? JSON.parse(texto) : null
}

function requisicaoLocal(req: import('node:http').IncomingMessage): boolean {
  const remoto = String(req.socket.remoteAddress || '')
  const socketLocal =
    remoto === '::1' ||
    remoto === '127.0.0.1' ||
    remoto.startsWith('::ffff:127.')
  if (!socketLocal) return false
  const host = String(req.headers.host || '')
  let autoridade = ''
  try {
    const hostUrl = new URL(`http://${host}`)
    const hostname = hostUrl.hostname
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) return false
    autoridade = hostUrl.host
  } catch {
    return false
  }
  const origem = req.headers.origin
  if (!origem) return true
  try {
    const origemUrl = new URL(origem)
    return ['http:', 'https:'].includes(origemUrl.protocol) && origemUrl.host === autoridade
  } catch {
    return false
  }
}

// GET/PUT /api/blocos e GET/POST/PATCH/DELETE /api/blocos/:id
function apiBlocos(): Plugin {
  return {
    name: 'dailywork-api-blocos',
    configureServer(server) {
      server.middlewares.use('/api/blocos', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        const url = new URL(req.url ?? '/', 'http://x')
        const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
        const dia = url.searchParams.get('dia') || undefined
        try {
          if (!id) {
            if (req.method === 'GET') return ok(res, lib.listarBlocos(dia))
            if (req.method === 'PUT') {
              const blocos = await lerJson(req)
              const dry = url.searchParams.get('dry') === '1'
              return ok(res, lib.salvarSnapshot(blocos, { dry, dia }))
            }
            if (req.method === 'POST') {
              const parcial = await lerJson(req)
              return ok(res, lib.criarBloco(parcial, dia), 201)
            }
            return falha(res, 405, 'METODO_NAO_SUPORTADO', `${req.method} em /api/blocos`)
          }
          if (req.method === 'GET') {
            const bloco = lib.obterBloco(id, dia)
            if (!bloco) return falha(res, 404, 'NAO_ENCONTRADO', `bloco não encontrado: ${id}`)
            return ok(res, bloco)
          }
          if (req.method === 'PATCH') {
            const patch = await lerJson(req)
            const bloco = lib.atualizarBloco(id, patch, dia)
            if (!bloco) return falha(res, 404, 'NAO_ENCONTRADO', `bloco não encontrado: ${id}`)
            return ok(res, bloco)
          }
          if (req.method === 'DELETE') {
            const excluido = lib.excluirBloco(id, dia)
            if (!excluido) return falha(res, 404, 'NAO_ENCONTRADO', `bloco não encontrado: ${id}`)
            return ok(res, { excluido: true })
          }
          return falha(res, 405, 'METODO_NAO_SUPORTADO', `${req.method} em /api/blocos/${id}`)
        } catch (e) {
          return falha(res, 500, 'ERRO_INTERNO', String(e))
        }
      })
    },
  }
}

// GET /api/dias: datas que já possuem diretório próprio de blocos.
function apiDias(): Plugin {
  return {
    name: 'dailywork-api-dias',
    configureServer(server) {
      server.middlewares.use('/api/dias', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (req.method === 'GET') return ok(res, lib.listarDias())
        return falha(res, 405, 'METODO_NAO_SUPORTADO', `${req.method} em /api/dias`)
      })
    },
  }
}

// GET /api/sessoes e GET/POST/PUT/DELETE /api/sessoes/:id
function apiSessoes(): Plugin {
  return {
    name: 'dailywork-api-sessoes',
    configureServer(server) {
      server.middlewares.use('/api/sessoes', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        const id = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0])
        try {
          if (!id && req.method === 'GET') return ok(res, lib.listarSessoes())
          if (req.method === 'POST') return ok(res, lib.criarSessao(id), 201)
          if (req.method === 'GET') return ok(res, lib.carregarSessao(id))
          if (req.method === 'PUT') return ok(res, lib.salvarSessao(id, await lerJson(req)))
          if (req.method === 'DELETE') return ok(res, lib.excluirSessao(id))
          return falha(res, 405, 'METODO_NAO_SUPORTADO', `${req.method} em /api/sessoes/${id}`)
        } catch (e) {
          return falha(res, 500, 'ERRO_INTERNO', String(e))
        }
      })
    },
  }
}

// GET /api/foto: assets/eu.(png|jpg|jpeg|webp) como data URL.
function apiFoto(): Plugin {
  return {
    name: 'dailywork-api-foto',
    configureServer(server) {
      server.middlewares.use('/api/foto', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        ok(res, lib.lerFoto())
      })
    },
  }
}

// POST/GET /api/portfolio/midias: persiste imagens reais fora do snapshot
// opaco do tldraw e devolve data URL somente para renderização.
function apiPortfolio(): Plugin {
  return {
    name: 'dailywork-api-portfolio',
    configureServer(server) {
      server.middlewares.use('/api/portfolio/midias', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        const url = new URL(req.url ?? '/', 'http://x')
        try {
          if (req.method === 'GET') {
            return ok(res, lib.lerMidiaPortfolio(url.searchParams.get('caminho')))
          }
          if (req.method === 'POST') return ok(res, lib.salvarMidiaPortfolio(await lerJson(req)), 201)
          return falha(res, 405, 'METODO_NAO_SUPORTADO', `${req.method} em /api/portfolio/midias`)
        } catch (e) {
          return falha(res, 500, 'ERRO_INTERNO', String(e))
        }
      })
    },
  }
}

// O conhecimento não é copiado para data/: estes endpoints operam diretamente
// sobre a fonte canônica LucasKnowledge, com conflito e backup na escrita.
function apiConhecimento(): Plugin {
  return {
    name: 'dailywork-api-conhecimento',
    configureServer(server) {
      server.middlewares.use('/api/conhecimento', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        const url = new URL(req.url ?? '/', 'http://x')
        try {
          if (url.pathname === '/contexto-diario' && req.method === 'GET') {
            return ok(res, lib.contextoPrincipal())
          }
          if (url.pathname === '/nota' && req.method === 'GET') {
            const caminho = url.searchParams.get('caminho')
            const nota = lib.obterNotaConhecimento(caminho)
            if (!nota) return falha(res, 404, 'NAO_ENCONTRADO', `nota não encontrada: ${caminho}`)
            return ok(res, nota)
          }
          if (url.pathname === '/nota' && req.method === 'PUT') {
            const corpo = await lerJson(req)
            return ok(
              res,
              lib.salvarNotaConhecimento(corpo?.caminho, corpo?.conteudo, corpo?.etag)
            )
          }
          if (url.pathname === '/posicoes' && req.method === 'PUT') {
            const corpo = await lerJson(req)
            return ok(res, lib.salvarPosicoesConhecimento(corpo?.posicoes))
          }
          if (url.pathname === '/posicao' && req.method === 'DELETE') {
            const corpo = await lerJson(req)
            return ok(res, lib.removerPosicaoConhecimento(corpo?.caminho))
          }
          if (url.pathname === '/nota' && req.method === 'DELETE') {
            const corpo = await lerJson(req)
            return ok(res, lib.excluirNotaConhecimento(corpo?.caminho))
          }
          if ((url.pathname === '/' || url.pathname === '') && req.method === 'GET') {
            return ok(res, lib.listarConhecimento())
          }
          return falha(res, 405, 'METODO_NAO_SUPORTADO', `${req.method} em /api/conhecimento${url.pathname}`)
        } catch (e) {
          const mensagem = String(e)
          return falha(
            res,
            mensagem.includes('CONFLITO:') ? 409 : 500,
            mensagem.includes('CONFLITO:') ? 'CONFLITO' : 'ERRO_INTERNO',
            mensagem
          )
        }
      })
    },
  }
}

// Agente do dia via Grok CLI (9Router opcional). O renderer nunca recebe a chave nem executa
// tool calls: este middleware valida perfil/data e chama o serviço Node.
function apiAgente(): Plugin {
  return {
    name: 'dailywork-api-agente',
    configureServer(server) {
      server.middlewares.use('/api/agente', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (!requisicaoLocal(req)) {
          return falha(res, 403, 'ORIGEM_NAO_PERMITIDA', 'O agente só aceita chamadas locais.')
        }
        const url = new URL(req.url ?? '/', 'http://x')
        try {
          if (url.pathname === '/config' && req.method === 'GET') {
            return ok(res, await agente.configuracao())
          }
          if (url.pathname === '/config' && req.method === 'POST') {
            if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
              return falha(res, 415, 'FORMATO_INVALIDO', 'Use Content-Type application/json.')
            }
            return ok(res, await agente.salvarConfiguracao(await lerJson(req, 32 * 1024)))
          }
          if (url.pathname === '/provedores' && req.method === 'GET') {
            return ok(res, await agente.sondarProvedores())
          }
          if (url.pathname === '/contexto' && req.method === 'GET') {
            return ok(
              res,
              await agente.inspecionarContexto({
                escopo: url.searchParams.get('escopo') || undefined,
                dia: url.searchParams.get('dia') || undefined,
                usarContextoDuravel: url.searchParams.get('contextoDuravel') === '1',
              })
            )
          }
          if (url.pathname === '/chat' && req.method === 'POST') {
            if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
              return falha(res, 415, 'FORMATO_INVALIDO', 'Use Content-Type application/json.')
            }
            return ok(res, await agente.conversar(await lerJson(req, 6 * 1024 * 1024)))
          }
          if (url.pathname === '/confirmar' && req.method === 'POST') {
            if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
              return falha(res, 415, 'FORMATO_INVALIDO', 'Use Content-Type application/json.')
            }
            return ok(res, await agente.confirmarAcao(await lerJson(req, 32 * 1024)))
          }
          return falha(res, 405, 'METODO_NAO_SUPORTADO', `${req.method} em /api/agente${url.pathname}`)
        } catch (e: any) {
          const status = Number(e?.status) || 500
          const codigo = typeof e?.codigo === 'string' ? e.codigo : 'ERRO_INTERNO'
          const mensagem =
            codigo === 'ERRO_INTERNO'
              ? 'O agente encontrou uma falha interna.'
              : String(e?.message || 'Falha ao executar o agente.')
          return falha(res, status, codigo, mensagem)
        }
      })
    },
  }
}

// Conexões externas: GET /api/integracoes, GET /api/integracoes/:id/{status,perfil,sinais}
// e POST /api/integracoes/:id/{configurar,desconectar,autorizar,preparar-publicacao,rascunhar},
// POST /api/integracoes/{confirmar-publicacao,cancelar-publicacao}. Credenciais nunca saem do Node.
function apiIntegracoes(): Plugin {
  return {
    name: 'dailywork-api-integracoes',
    configureServer(server) {
      server.middlewares.use('/api/integracoes', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (!requisicaoLocal(req)) {
          return falha(res, 403, 'ORIGEM_NAO_PERMITIDA', 'As conexões só aceitam chamadas locais.')
        }
        const url = new URL(req.url ?? '/', 'http://x')
        const partes = url.pathname.split('/').filter(Boolean)
        const json = async (limite = 256 * 1024) => {
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
            throw Object.assign(new Error('Use Content-Type application/json.'), { status: 415, codigo: 'FORMATO_INVALIDO' })
          }
          return lerJson(req, limite)
        }
        try {
          if (partes.length === 0 && req.method === 'GET') return ok(res, await integracoes.listar())
          if (partes[0] === 'sessao-visual') {
            const acao = partes[1] || 'estado'
            if (req.method === 'GET' && ['estado','jobs','job'].includes(acao)) return ok(res, await integracoes.sessaoVisual(acao, { conta: url.searchParams.get('conta'), jobId: url.searchParams.get('jobId') }))
            if (req.method === 'POST' && ['verificar','vincular','importar','perfil','cancelar'].includes(acao)) return ok(res, await integracoes.sessaoVisual(acao, await json(8 * 1024)))
            return falha(res, 405, 'METODO_NAO_SUPORTADO', 'Operação de sessão não permitida.')
          }
          if (partes[0] === 'confirmar-publicacao' && req.method === 'POST') {
            return ok(res, await integracoes.confirmarPublicacao(await json(8 * 1024)), 201)
          }
          if (partes[0] === 'cancelar-publicacao' && req.method === 'POST') {
            return ok(res, integracoes.cancelarPublicacao(await json(8 * 1024)))
          }
          const [id, acao] = partes
          if (id && req.method === 'GET') {
            if (!acao || acao === 'status') return ok(res, await integracoes.status(id))
            if (acao === 'perfil') return ok(res, await integracoes.perfil(id))
            if (acao === 'sinais') {
              const dia = url.searchParams.get('dia') || diaLocal()
              if (!dataValida(dia)) return falha(res, 400, 'DIA_INVALIDO', 'Informe dia=AAAA-MM-DD.')
              return ok(res, await integracoes.sinais(id, dia, { forcar: url.searchParams.get('forcar') === '1' }))
            }
          }
          if (id && req.method === 'POST') {
            if (acao === 'configurar') return ok(res, await integracoes.configurar(id, await json(64 * 1024)))
            if (acao === 'desconectar') return ok(res, await integracoes.desconectar(id))
            if (acao === 'autorizar') return ok(res, await integracoes.autorizar(id), 202)
            if (acao === 'preparar-publicacao') return ok(res, await integracoes.prepararPublicacao(id, await json()), 201)
            if (acao === 'rascunhar') return ok(res, await redator.rascunhar({ ...(await json(64 * 1024)), conta: id }))
          }
          return falha(res, 405, 'METODO_NAO_SUPORTADO', `${req.method} em /api/integracoes${url.pathname}`)
        } catch (e: any) {
          return falha(
            res,
            Number(e?.status) || 500,
            typeof e?.codigo === 'string' ? e.codigo : 'ERRO_INTEGRACAO',
            String(e?.message || 'Falha na conexão externa.')
          )
        }
      })
    },
  }
}

function apiEditorial(): Plugin {
  return {
    name: 'dailywork-api-editorial',
    configureServer(server) {
      // Recorrências pertencem à Agenda do desktop. Abrir o servidor de
      // desenvolvimento não pode iniciar produção ou publicação em paralelo.
      server.middlewares.use('/api/editorial', async (req, res) => {
        if (!requisicaoLocal(req)) return falha(res, 403, 'ORIGEM_NAO_PERMITIDA', 'A fila editorial só aceita chamadas locais.')
        const url = new URL(req.url ?? '/', 'http://x')
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        const json = async (limite = 1024 * 1024) => {
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
            throw Object.assign(new Error('Use Content-Type application/json.'), { status: 415, codigo: 'FORMATO_INVALIDO' })
          }
          return lerJson(req, limite)
        }
        try {
          const partes = url.pathname.split('/').filter(Boolean).map((parte) => decodeURIComponent(parte))
          if (partes[0] === 'capacidades' && partes.length === 1 && req.method === 'GET') {
            const conexoes = await integracoes.listar({ comStatus: false })
            return ok(res, conexoes.map((conexao: any) => {
              const { status: _status, ...metadados } = conexao
              return metadados
            }))
          }
          if (partes[0] === 'midia' && partes[1] === 'config' && partes.length === 2) {
            if (req.method === 'GET') return ok(res, jobsMidiasEditoriais.configuracao())
            if (req.method === 'POST') return ok(res, jobsMidiasEditoriais.configurar(await json(1024)))
          }
          if (partes[0] === 'midia' && partes[1] === 'jobs' && partes.length === 2) {
            if (req.method === 'GET') return ok(res, jobsMidiasEditoriais.listar({ status: url.searchParams.get('status') || undefined }))
            if (req.method === 'POST') return ok(res, await jobsMidiasEditoriais.iniciar(await json(64 * 1024)), 202)
          }
          if (partes[0] === 'midia' && partes[1] === 'jobs' && partes[2] === 'retomar' && partes.length === 3 && req.method === 'POST') {
            if (process.env.DAILYWORK_CAPTURE_PATH) return ok(res, { retomados: [] })
            return ok(res, jobsMidiasEditoriais.retomarPendentes())
          }
          if (partes[0] === 'midia' && partes[1] === 'jobs' && partes[2] && partes.length === 3 && req.method === 'GET') {
            const job = jobsMidiasEditoriais.obter(exigirIdJobMidia(partes[2]))
            if (!job) return falha(res, 404, 'NAO_ENCONTRADO', 'job de mídia não encontrado.')
            return ok(res, job)
          }
          if (partes[0] === 'midia' && partes[1] === 'jobs' && partes[2] && partes[3] === 'cancelar' && partes.length === 4 && req.method === 'POST') {
            return ok(res, jobsMidiasEditoriais.cancelar(exigirIdJobMidia(partes[2])))
          }
          if (partes[0] === 'itens' && partes.length === 1) {
            if (req.method === 'GET') return ok(res, await filaEditorial.listar({ estado: url.searchParams.get('estado') || undefined, conta: url.searchParams.get('conta') || undefined, idioma: url.searchParams.get('idioma') || undefined, pautaId: url.searchParams.get('pautaId') || undefined }))
            if (req.method === 'POST') return ok(res, await filaEditorial.criar(await json()), 201)
            if (req.method === 'DELETE') return ok(res, await filaEditorial.excluirMuitos(await json(128 * 1024)))
          }
          if (partes[0] === 'itens' && partes[1] && partes.length === 2) {
            if (req.method === 'GET') {
              const item = await filaEditorial.obter(partes[1])
              if (!item) return falha(res, 404, 'NAO_ENCONTRADO', 'item não encontrado.')
              return ok(res, item)
            }
            if (req.method === 'PATCH') return ok(res, await filaEditorial.atualizar(partes[1], await json()))
          }
          if (partes[0] === 'itens' && partes[1] && partes[2] === 'capturar-comprovante' && partes.length === 3 && req.method === 'POST') {
            return ok(res, await filaEditorial.capturarComprovante(partes[1]))
          }
          if (partes[0] === 'itens' && partes[1] && partes[2] && partes.length === 3 && req.method === 'POST') {
            const entrada = await json(64 * 1024)
            if (partes[2] === 'espelhar') {
              if (!producaoEditorial) return falha(res, 503, 'PRODUCAO_INDISPONIVEL', 'produção editorial indisponível.')
              return ok(res, await producaoEditorial.espelhar(partes[1], entrada), 201)
            }
            const metodo: Record<string, string> = { publicar: 'publicar', agendar: 'agendar', recusar: 'recusar', reabrir: 'reabrir' }
            const acao = metodo[partes[2]]
            if (!acao) return falha(res, 405, 'METODO_NAO_SUPORTADO', 'ação editorial desconhecida.')
            // HTTP de desenvolvimento é canal de agente: publicar e agendar passam pelo portão da fila.
            return ok(res, await filaEditorial[acao](partes[1], ['publicar', 'agendar'].includes(acao) ? { ...entrada, canal: 'api' } : entrada))
          }
          if (partes[0] === 'publicacao' && partes.length === 1 && req.method === 'GET') return ok(res, filaEditorial.politicaPublicacao())
          if (partes[0] === 'publicacao' && partes.length === 1 && req.method === 'POST') return falha(res, 403, 'SOMENTE_DESKTOP', 'A política de publicação só muda na interface do DailyWork.')
          if (partes[0] === 'itens' && partes[1] && partes[2] === 'prontidao' && partes.length === 3 && req.method === 'GET') return ok(res, await filaEditorial.verificar(partes[1]))
          if (partes[0] === 'historico' && partes.length === 1 && req.method === 'GET') {
            return ok(res, await filaEditorial.historico({
              conta: url.searchParams.get('conta') || undefined,
              desde: url.searchParams.get('desde') || undefined,
              ate: url.searchParams.get('ate') || undefined,
            }))
          }
          if (partes[0] === 'itens' && partes[1] && partes[2] === 'comprovante' && partes.length === 3 && req.method === 'GET') {
            const media = await filaEditorial.lerComprovante(partes[1])
            return ok(res, `data:${media.mime};base64,${media.dados.toString('base64')}`)
          }
          if (partes[0] === 'estado' && req.method === 'GET') return ok(res, producaoEditorial ? producaoEditorial.estado() : { producao: { status: 'ociosa' }, config: null })
          if (partes[0] === 'gerar' && req.method === 'POST') {
            if (!producaoEditorial) return falha(res, 503, 'PRODUCAO_INDISPONIVEL', 'produção editorial indisponível.')
            return ok(res, producaoEditorial.iniciar(await json(64 * 1024)), 202)
          }
          if (partes[0] === 'cancelar-producao' && req.method === 'POST') {
            if (!producaoEditorial) return falha(res, 503, 'PRODUCAO_INDISPONIVEL', 'produção editorial indisponível.')
            return ok(res, producaoEditorial.cancelar())
          }
          if (partes[0] === 'config' && req.method === 'POST') {
            if (!producaoEditorial) return falha(res, 503, 'PRODUCAO_INDISPONIVEL', 'produção editorial indisponível.')
            return ok(res, producaoEditorial.configurar(await json(32 * 1024)))
          }
          if (partes[0] === 'logica' && partes.length === 1 && req.method === 'GET') return ok(res, logicaEditorial.obter())
          if (partes[0] === 'logica' && partes.length === 1 && req.method === 'POST') return ok(res, logicaEditorial.salvar(await json(64 * 1024)))
          if (partes[0] === 'logica' && partes[1] === 'restaurar' && partes.length === 2 && req.method === 'POST') return ok(res, logicaEditorial.restaurar())
          if (partes[0] === 'midias' && partes[1] && partes[2] && partes.length === 3 && req.method === 'GET') {
            const media = await filaEditorial.lerMidia(partes[1], partes[2])
            res.setHeader('Content-Type', media.mime)
            res.setHeader('Content-Length', String(media.dados.length))
            res.end(media.dados)
            return
          }
          return falha(res, 405, 'METODO_NAO_SUPORTADO', `${req.method} em /api/editorial${url.pathname}`)
        } catch (erro: any) {
          return falha(res, Number(erro?.status) || 500, typeof erro?.codigo === 'string' ? erro.codigo : 'ERRO_EDITORIAL', String(erro?.message || 'Falha na fila editorial.'))
        }
      })
    },
  }
}

function apiExecutorNativo(): Plugin {
  return {
    name: 'dailywork-api-executor-nativo',
    configureServer(server) {
      server.middlewares.use('/api/executor', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (!requisicaoLocal(req)) {
          return falha(res, 403, 'ORIGEM_NAO_PERMITIDA', 'O executor só aceita chamadas locais.')
        }
        const url = new URL(req.url ?? '/', 'http://x')
        try {
          if (url.pathname === '/estado' && req.method === 'GET') {
            return ok(res, executorNativo.estado(url.searchParams.get('dia') || undefined))
          }
          if (url.pathname === '/iniciar' && req.method === 'POST') {
            return ok(res, executorNativo.iniciar(await lerJson(req, 32 * 1024)), 202)
          }
          if (url.pathname === '/cancelar' && req.method === 'POST') {
            return ok(res, executorNativo.cancelar(await lerJson(req, 8 * 1024)))
          }
          return falha(res, 405, 'METODO_NAO_SUPORTADO', `${req.method} em /api/executor${url.pathname}`)
        } catch (e: any) {
          return falha(
            res,
            Number(e?.status) || 500,
            typeof e?.codigo === 'string' ? e.codigo : 'ERRO_EXECUCAO',
            String(e?.message || 'Falha ao executar a frente.')
          )
        }
      })
    },
  }
}

// O browser de desenvolvimento usa o mesmo serviço canônico do Electron.
// A projeção devolvida à UI contém apenas metadados e previews; o corpus
// completo continua no arquivo privado em data/sumarios/.
function apiSumario(): Plugin {
  const validarDiaDaEntrada = (valor: unknown) => {
    if (!dataValida(valor)) {
      throw Object.assign(new Error('Use uma data válida no formato AAAA-MM-DD.'), {
        codigo: 'DATA_INVALIDA',
        status: 400,
      })
    }
    return String(valor)
  }
  return {
    name: 'dailywork-api-sumario',
    configureServer(server) {
      const atualizar = () => {
        const dia = diaLocal()
        void sumario.coletar(dia)
          .then(() => server.ws.send('dailywork:sumario-atualizado', { dia }))
          .catch((erro: unknown) => {
            console.error('[DailyWork] falha ao atualizar Sumário Diário:', erro)
          })
      }
      const inicio = setTimeout(atualizar, 15_000)
      const intervalo = setInterval(atualizar, 15 * 60_000)
      server.httpServer?.once('close', () => {
        clearTimeout(inicio)
        clearInterval(intervalo)
      })
      server.middlewares.use('/api/sumario', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (!requisicaoLocal(req)) {
          return falha(res, 403, 'ORIGEM_NAO_PERMITIDA', 'O Sumário só aceita chamadas locais.')
        }
        const url = new URL(req.url ?? '/', 'http://x')
        try {
          if (url.pathname === '/' && req.method === 'GET') {
            return ok(res, sumario.obter(validarDiaDaEntrada(url.searchParams.get('dia'))))
          }
          if (url.pathname === '/inputs' && req.method === 'GET') {
            return ok(res, sumario.obterInputs(validarDiaDaEntrada(url.searchParams.get('dia'))))
          }
          if (url.pathname === '/coletar' && req.method === 'POST') {
            if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
              return falha(res, 415, 'FORMATO_INVALIDO', 'Use Content-Type application/json.')
            }
            const entrada = await lerJson(req, 16 * 1024)
            const dia = validarDiaDaEntrada(entrada?.dia)
            const resultado = await sumario.coletar(dia)
            server.ws.send('dailywork:sumario-atualizado', { dia })
            return ok(res, resultado)
          }
          if (url.pathname === '/analise' && req.method === 'GET') {
            return ok(res, analiseSumario.obter(validarDiaDaEntrada(url.searchParams.get('dia'))))
          }
          if (url.pathname === '/analisar' && req.method === 'POST') {
            if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
              return falha(res, 415, 'FORMATO_INVALIDO', 'Use Content-Type application/json.')
            }
            const entrada = await lerJson(req, 16 * 1024)
            const dia = validarDiaDaEntrada(entrada?.dia)
            const resultado = await analiseSumario.analisar(dia, {
              perfilId: entrada?.perfilId,
              onProgress: (progresso: unknown) => {
                server.ws.send('dailywork:sumario-analise-progresso', {
                  dia,
                  progresso,
                })
              },
            })
            server.ws.send('dailywork:sumario-analise-atualizada', { dia })
            return ok(res, resultado)
          }
          if (url.pathname === '/interagir' && req.method === 'POST') {
            if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
              return falha(res, 415, 'FORMATO_INVALIDO', 'Use Content-Type application/json.')
            }
            const entrada = await lerJson(req, 16 * 1024)
            const resultado = await analiseSumario.interagir(validarDiaDaEntrada(entrada?.dia), entrada)
            return ok(res, resultado)
          }
          return falha(res, 405, 'METODO_NAO_SUPORTADO', `${req.method} em /api/sumario${url.pathname}`)
        } catch (e: any) {
          const status = Number(e?.status) || 500
          const codigo = typeof e?.codigo === 'string' ? e.codigo : 'ERRO_INTERNO'
          return falha(
            res,
            status,
            codigo,
            codigo === 'ERRO_INTERNO'
              ? 'Não foi possível concluir esta ação. Tente novamente.'
              : String(e?.message || 'Não foi possível concluir esta ação.')
          )
        }
      })
    },
  }
}

// Contexto seletivo LucasOL -> DailyWork. Preparar nunca grava; confirmar
// exige o packId revisado e falha se qualquer fonte tiver mudado.
function apiFluxoLucasOL(): Plugin {
  return {
    name: 'dailywork-api-fluxo-lucasol',
    configureServer(server) {
      server.middlewares.use('/api/fluxo', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (!requisicaoLocal(req)) {
          return falha(res, 403, 'ORIGEM_NAO_PERMITIDA', 'O fluxo só aceita chamadas locais.')
        }
        const url = new URL(req.url ?? '/', 'http://x')
        try {
          if (url.pathname === '/preparar-dia' && req.method === 'GET') {
            return ok(res, fluxoLucasOL.prepararDia({
              dia: url.searchParams.get('dia'),
              projetoId: url.searchParams.get('projeto') || undefined,
            }))
          }
          if (url.pathname === '/confirmar-propostas' && req.method === 'POST') {
            if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
              return falha(res, 415, 'FORMATO_INVALIDO', 'Use Content-Type application/json.')
            }
            return ok(res, fluxoLucasOL.confirmarPropostas(await lerJson(req, 64 * 1024)))
          }
          if (url.pathname === '/revisar-fechamento' && req.method === 'GET') {
            return ok(res, fluxoLucasOL.revisarFechamento({ dia: url.searchParams.get('dia') }))
          }
          if (url.pathname === '/confirmar-fechamento' && req.method === 'POST') {
            if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
              return falha(res, 415, 'FORMATO_INVALIDO', 'Use Content-Type application/json.')
            }
            return ok(res, fluxoLucasOL.confirmarFechamento(await lerJson(req, 64 * 1024)))
          }
          if (url.pathname === '/revisar-semana' && req.method === 'GET') {
            return ok(res, fluxoLucasOL.revisarSemana({ ate: url.searchParams.get('ate') }))
          }
          if (url.pathname === '/rascunhar-dia' && req.method === 'POST') {
            if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
              return falha(res, 415, 'FORMATO_INVALIDO', 'Use Content-Type application/json.')
            }
            return ok(res, await agente.rascunharDia(await lerJson(req, 64 * 1024)))
          }
          return falha(res, 405, 'METODO_NAO_SUPORTADO', `${req.method} em /api/fluxo${url.pathname}`)
        } catch (e: any) {
          const mensagem = String(e?.message || e)
          const codigo = e?.codigo || (mensagem.includes('CONFLITO:') ? 'CONFLITO' : 'ERRO_INTERNO')
          const status = Number(e?.status) || (codigo === 'CONFLITO' ? 409 : 500)
          return falha(res, status, codigo, mensagem)
        }
      })
    },
  }
}

function caminhoDentro(arquivo: string, diretorio: string) {
  const relativo = path.relative(path.resolve(diretorio), path.resolve(arquivo))
  return relativo !== '..' && !relativo.startsWith(`..${path.sep}`) && !path.isAbsolute(relativo)
}

// Watch em data/: mudança externa (agente) -> evento websocket pro cliente
// recarregar o canvas (espelha o fs.watch do electron/main.cjs).
function watchBlocos(): Plugin {
  return {
    name: 'dailywork-watch-blocos',
    configureServer(server) {
      server.watcher.add(`${lib.DATA_DIR}/**/*.md`)
      let timer: ReturnType<typeof setTimeout> | null = null
      const avisar = (arquivo: string) => {
        if (!caminhoDentro(arquivo, lib.DATA_DIR)) return
        if (!lib.foiEscritaExterna()) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => server.ws.send('dailywork:blocos-externos', {}), 400)
      }
      server.watcher.on('add', avisar)
      server.watcher.on('change', avisar)
      server.watcher.on('unlink', avisar)
    },
  }
}

function watchConhecimento(): Plugin {
  const conhecimentoPosicoes =
    lib.CONHECIMENTO_POSICOES ||
    path.join(
      lib.CONHECIMENTO_DIR,
      '.obsidian',
      'plugins',
      'lucas-hierarchy-graph',
      'data.json'
    )
  return {
    name: 'dailywork-watch-conhecimento',
    configureServer(server) {
      server.watcher.add(`${lib.CONHECIMENTO_DIR}/**/*.md`)
      server.watcher.add(conhecimentoPosicoes)
      let timer: ReturnType<typeof setTimeout> | null = null
      const avisar = (arquivo: string) => {
        if (typeof arquivo !== 'string' || !arquivo) return
        const resolvido = path.resolve(arquivo)
        const ehNota = arquivo.toLowerCase().endsWith('.md')
        const ehLayout = resolvido === path.resolve(conhecimentoPosicoes)
        if (!caminhoDentro(arquivo, lib.CONHECIMENTO_DIR) || (!ehNota && !ehLayout)) {
          return
        }
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => server.ws.send('dailywork:conhecimento-externo', {}), 400)
      }
      server.watcher.on('add', avisar)
      server.watcher.on('change', avisar)
      server.watcher.on('unlink', avisar)
    },
  }
}

// O HTTP de desenvolvimento usa os mesmos serviços do IPC e da API v1.
function apiAutomacoes(): Plugin {
  return {
    name: 'dailywork-api-automacoes',
    configureServer(server) {
      server.middlewares.use('/api/automacoes', criarMiddlewareAutomacoes(automacoes))
      server.middlewares.use('/api/candidaturas', criarMiddlewareCandidaturas(candidaturas))
    },
  }
}

function apiSkills(): Plugin {
  return {
    name: 'dailywork-api-skills',
    configureServer(server) {
      server.middlewares.use('/api/skills', criarMiddlewareSkills(skills))
    },
  }
}

export default defineConfig({
  // base relativa: obrigatório pro build abrir via file:// no Electron
  base: './',
  plugins: [
    react(),
    apiAgentesDev({ lib, fluxoLucasOL, agente, executorNativo, sumario, analiseSumario,
      integracoes, redator, filaEditorial, producaoEditorial, jobsMidiasEditoriais, automacoes, candidaturas,
      exigirIdJobMidia, userDataDir, modoCaptura: Boolean(process.env.DAILYWORK_CAPTURE_PATH) }),
    apiBlocos(),
    apiDias(),
    apiSessoes(),
    apiFoto(),
    apiPortfolio(),
    apiConhecimento(),
    apiFluxoLucasOL(),
    apiAgente(),
    apiExecutorNativo(),
    apiIntegracoes(),
    apiEditorial(),
    apiSumario(),
    apiAutomacoes(),
    apiSkills(),
    watchBlocos(),
    watchConhecimento(),
  ],
})
