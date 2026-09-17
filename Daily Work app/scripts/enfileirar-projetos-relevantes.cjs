#!/usr/bin/env node
// Recusa o que não é a lista configurada e enfileira posts com still real.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const http = require('node:http')
const { execFileSync } = require('node:child_process')

const RAIZ = path.resolve(__dirname, '..')
const DATA = path.join(RAIZ, 'data')
const ITENS = path.join(DATA, 'editorial', 'itens')
const STILLS = path.join(DATA, 'editorial', 'midias', 'stills-relevantes-20260909')
const REFS = path.join(DATA, 'editorial', 'midias', 'refs')
const MANTER = new Set(['dailywork'])
const ENTRAR = ['ramdog', 'sussurro', 'sonora', 'sfr', 'nexsales']
const RECUSAR = new Set(['simpl-ai', 'nexarq', 'lojasync', 'the-last-arrow', 'videogen'])

const FONTES_ARQ = {
  ramdog: path.join(os.homedir(), 'Projects', 'RamDog', 'docs', 'media', 'lista.png'),
  sussurro: path.join(os.homedir(), 'Projects', 'sussurro', 'docs', 'media', 'tab-aovivo.png'),
  sonora: path.join(os.homedir(), 'Projects', 'sonora', 'preview.png'),
  sfr: '/tmp/stills-relevantes/sfr.png',
  nexsales: '/tmp/stills-relevantes/nexsales.jpg',
}

const PECAS = {
  ramdog: {
    pautaId: 'pauta-ramdog-origem-20260909',
    fontes: [
      { rotulo: 'RamDog no GitHub', url: 'https://github.com/example/RamDog' },
      { rotulo: 'Site e guia', url: 'https://example.github.io/RamDog/' },
    ],
    titulos: {
      'pt-BR': 'O gerenciador de tarefas não sabe quem lançou o processo',
      en: 'Task Manager does not know who launched the process',
    },
    textos: {
      linkedin: {
        'pt-BR': 'O Gerenciador de Tarefas não mostra a cadeia de origem. O htop não organiza janela no Hyprland e não sabe o que é um agente.\n\nEu construí o RamDog por isso. Em Rust, para Windows, Linux e macOS — no Linux o alvo de primeira classe é o Omarchy. A coluna Origem aponta o ancestral vivo; categorias separam IA, Dev e Navegador; o kill fecha a árvore; Hyprland, UWSM e Quickshell ficam com lock.\n\nNa v0.9.1 o sampler parou de vazar descritores em /proc, a lista deixou de mentir depois de horas e famílias versionadas de Claude ou Codex viram uma linha só.\n\nA prova está no binário local e no site: lista, árvore e categorias com a GPU desta máquina no recorte.',
        en: 'Task Manager does not show the launch chain. htop does not organize Hyprland windows and has no idea what an agent is.\n\nThat is why I built RamDog. Rust, for Windows, Linux and macOS — on Linux the first-class target is Omarchy. Origin points at the living ancestor; categories split AI, Dev and Browser; kill can take the whole tree; Hyprland, UWSM and Quickshell stay locked.\n\nIn v0.9.1 the sampler stopped leaking /proc descriptors, the list stopped lying after a long session, and versioned Claude or Codex families collapse to one row.\n\nThe proof is the local binary and the public site: list, tree and categories with this machine’s GPU in the frame.',
      },
      x: {
        'pt-BR': 'htop não sabe o que é um agente. O RamDog mostra origem, agrupa Claude/Codex numa linha e trava Hyprland. v0.9.1: sampler sem vazar /proc. Rust, feito pro Omarchy. example.github.io/RamDog',
        en: 'htop does not know what an agent is. RamDog shows origin, folds Claude/Codex into one row, and locks Hyprland. v0.9.1: sampler no longer leaks /proc. Rust, built for Omarchy. example.github.io/RamDog',
      },
    },
  },
  sussurro: {
    pautaId: 'pauta-sussurro-local-20260909',
    fontes: [
      { rotulo: 'Sussurro no GitHub', url: 'https://github.com/example/sussurro' },
      { rotulo: 'Site', url: 'https://example.github.io/sussurro/' },
    ],
    titulos: {
      'pt-BR': 'O áudio do ditado não sai deste computador',
      en: 'Dictation audio never leaves this machine',
    },
    textos: {
      linkedin: {
        'pt-BR': 'Eu queria ditado que não entregasse o microfone para a nuvem.\n\nO Sussurro faz o caminho inteiro aqui: microfone → Silero VAD → faster-whisper large-v3 em CUDA. O texto é digitado ou colado onde o cursor está. Nenhum áudio sai da máquina.\n\nNo Omarchy a aba própria fala com o headset MCHOSE X9. A release v0.3.0 e o ajuste de hoje estabilizaram ativação e entrega — a frase termina e o texto já está no campo.\n\nA still é a aba Ao vivo deste PC, com large-v3 · CUDA no canto.',
        en: 'I wanted dictation that does not hand the microphone to the cloud.\n\nSussurro keeps the whole path here: microphone → Silero VAD → faster-whisper large-v3 on CUDA. Text is typed or pasted at the cursor. No audio leaves the machine.\n\nOn Omarchy a dedicated tab talks to the MCHOSE X9 headset. v0.3.0 and today’s fix made start and delivery stable — when the sentence ends, the text is already in the field.\n\nThe still is the Live tab on this PC, with large-v3 · CUDA in the corner.',
      },
      x: {
        'pt-BR': 'Ditado local: microfone → Silero VAD → whisper large-v3 na CUDA. O áudio não sai do PC. No Omarchy o MCHOSE X9 dispara o trecho. v0.3.0. example.github.io/sussurro',
        en: 'Local dictation: mic → Silero VAD → whisper large-v3 on CUDA. Audio never leaves the PC. On Omarchy the MCHOSE X9 starts the clip. v0.3.0. example.github.io/sussurro',
      },
    },
  },
  sonora: {
    pautaId: 'pauta-sonora-mixer-20260909',
    fontes: [{ rotulo: 'Sonora no Omarchy desta máquina' }],
    titulos: {
      'pt-BR': 'Um mixer que enxerga o HDMI que a NVIDIA esconde',
      en: 'A mixer that still sees the HDMI NVIDIA hides',
    },
    textos: {
      linkedin: {
        'pt-BR': 'No Omarchy eu precisava de um mixer que não fingisse que o HDMI sumiu só porque a NVIDIA publica um perfil de cada vez.\n\nO Sonora coloca dispositivos e apps na mesma lista: volume, mudo, destino e medidor. HDMI sem perfil publicado continua visível, com o nome do monitor; Ativar troca o perfil e vira saída padrão. Microfone conectado sem entrada publicada aparece do mesmo jeito.\n\nA paleta é a do Sussurro de propósito. Fechar a janela deixa o processo vivo para reaplicar regras; Encerrar é que sai. Medidores de reprodução são pico real, −60 a 0 dBFS — não barra inventada.\n\nA still é a janela deste PC: MCHOSE X9, FIFINE e Chromium no mesmo recorte.',
        en: 'On Omarchy I needed a mixer that does not pretend HDMI vanished just because NVIDIA publishes one profile at a time.\n\nSonora puts devices and apps in one list: volume, mute, destination, meter. HDMI without a published profile stays visible with the monitor name; Activate switches the profile and makes it default. A connected mic without a published source shows up the same way.\n\nThe palette matches Sussurro on purpose. Closing the window keeps the process alive to reapply rules; Quit is what exits. Playback meters are real peaks, −60 to 0 dBFS — not a fake bar.\n\nThe still is this machine: MCHOSE X9, FIFINE and Chromium in one frame.',
      },
      x: {
        'pt-BR': 'Sonora: mixer PipeWire pro Omarchy. HDMI sem perfil NVIDIA continua na lista; Ativar troca e vira padrão. Apps e hardware na mesma janela. Pico real, sem barra fake.',
        en: 'Sonora: PipeWire mixer for Omarchy. HDMI without an NVIDIA profile stays in the list; Activate switches it and makes it default. Apps and hardware in one window. Real peaks, no fake meter.',
      },
    },
  },
  sfr: {
    pautaId: 'pauta-sfr-offline-20260909',
    fontes: [{ rotulo: 'SFR Resgate no catálogo público', url: 'https://site.example' }],
    titulos: {
      'pt-BR': 'A ficha de resgate tem que sobreviver sem rede',
      en: 'The rescue record has to survive without a network',
    },
    textos: {
      linkedin: {
        'pt-BR': 'No campo, a ficha não pode depender de barra de sinal.\n\nNo SFR Resgate eu trabalhei o caminho crítico no Android: acionado → saí da base → cheguei no local → roteiro clínico. GPS ausente não bloqueia o atendimento. A ocorrência local do ensaio 1.2.11 sobreviveu a fechar e reabrir o app nativo no emulador Android 11.\n\nNa web, o painel da operação mostra sync e fila. Os números da demo são sintéticos; o que importa é o contrato: offline, reenvio sem duplicar, PDF auditável.\n\nIsso é produto de equipe na NexUnio. A still é a tela nativa Nova ocorrência — USB 01, SP-100 km 187, Iniciar atendimento.',
        en: 'In the field the record cannot depend on a signal bar.\n\nOn SFR Resgate I worked the critical Android path: dispatched → left base → on scene → clinical route. Missing GPS does not block care. The 1.2.11 local occurrence survived closing and reopening the native app on an Android 11 emulator.\n\nOn the web, the ops panel shows sync and queue. Demo numbers are synthetic; the contract is the point: offline, resend without duplicates, auditable PDF.\n\nThis is team product work at NexUnio. The still is the native New occurrence screen — unit USB 01, SP-100 km 187, Start care.',
      },
      x: {
        'pt-BR': 'SFR Resgate: a ficha no Android segue sem GPS e sem rede. Acionado → base → local → roteiro. Ensaio 1.2.11 sobreviveu a fechar o app. Campo primeiro, sync depois.',
        en: 'SFR Resgate: the Android record keeps going without GPS or a network. Dispatched → base → scene → route. 1.2.11 survived a full app close. Field first, sync later.',
      },
    },
  },
  nexsales: {
    pautaId: 'pauta-nexsales-agentes-20260909',
    fontes: [{ rotulo: 'NexSales no catálogo público', url: 'https://site.example' }],
    titulos: {
      'pt-BR': 'Cada cliente precisa de um agente, não de um prompt compartilhado',
      en: 'Each client needs an agent, not a shared prompt',
    },
    textos: {
      linkedin: {
        'pt-BR': 'Atendente de WhatsApp sem isolamento vira o mesmo texto em todo cliente.\n\nNo NexSales o trabalho — em equipe, na NexUnio — é contexto por cliente, avaliação da resposta e passagem para humano. O núcleo não pode misturar regra de clínica com regra de loja.\n\nO dashboard de um cliente em produção, capturado com autorização, junta no mesmo recorte o que a IA fechou, o que transferiu e o funil. Tempo e dinheiro economizados no painel são estimativa do produto; não trato isso como caixa auditada.\n\nA still é essa visão geral. O aprendizado que levo: roteamento e handoff importam mais do que um modelo único “bom em conversa”.',
        en: 'A WhatsApp desk with no isolation becomes the same copy for every client.\n\nOn NexSales the work — as a team, at NexUnio — is per-client context, response evaluation and a handoff to a human. The core cannot mix one clinic’s rules with another shop’s.\n\nA production client dashboard, captured with authorization, puts AI completions, transfers and the funnel in one frame. Time and money saved on that panel are product estimates; I do not treat them as audited cash.\n\nThe still is that overview. The lesson I keep: routing and handoff matter more than one model that is “good at chat”.',
      },
      x: {
        'pt-BR': 'NexSales: agente de WhatsApp com contexto por cliente e handoff humano. Sem misturar regra de um cliente no outro. Dashboard real, números de economia = estimativa do produto.',
        en: 'NexSales: WhatsApp agents with per-client context and a human handoff. Client rules stay isolated. Real dashboard; savings figures are product estimates.',
      },
    },
  },
}

function api(metodo, rota, corpo) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '::1', port: 5173, family: 6, path: rota, method: metodo,
      headers: { 'content-type': 'application/json' },
    }, (res) => {
      let bruto = ''
      res.on('data', (c) => { bruto += c })
      res.on('end', () => {
        let json
        try { json = JSON.parse(bruto) } catch { return reject(new Error(`${rota} ${res.statusCode}: ${bruto.slice(0, 300)}`)) }
        if (!json.ok) return reject(new Error(`${rota}: ${json.erro?.codigo} ${json.erro?.mensagem}`))
        resolve(json.data)
      })
    })
    req.on('error', reject)
    if (corpo) req.write(JSON.stringify(corpo))
    req.end()
  })
}

function sha256(arquivo) {
  return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex')
}

function garantirSfrNexsales() {
  if (!fs.existsSync(FONTES_ARQ.sfr) || !fs.existsSync(FONTES_ARQ.nexsales)) {
    const kit = path.join(RAIZ, 'assets/portfolio/curriculo-lucas-oliveira-v3/lucas-oliveira-application-kit-v3.zip')
    execFileSync('python3', ['-c', `
import zipfile, shutil, os
os.makedirs('/tmp/stills-relevantes', exist_ok=True)
z=zipfile.ZipFile(${JSON.stringify(kit)})
z.extract('screenshots/sfr-native-incident.png', '/tmp/kit-v3')
z.extract('screenshots/nexsales-santamarina-dashboard.jpg', '/tmp/kit-v3')
shutil.copy('/tmp/kit-v3/screenshots/sfr-native-incident.png', '/tmp/stills-relevantes/sfr.png')
shutil.copy('/tmp/kit-v3/screenshots/nexsales-santamarina-dashboard.jpg', '/tmp/stills-relevantes/nexsales.jpg')
`])
  }
}

function midia(projeto) {
  const origem = FONTES_ARQ[projeto]
  if (!fs.existsSync(origem)) throw new Error(`still ausente: ${projeto} ${origem}`)
  fs.mkdirSync(STILLS, { recursive: true })
  fs.mkdirSync(REFS, { recursive: true })
  const ext = path.extname(origem)
  const dest = path.join(STILLS, `${projeto}${ext}`)
  fs.copyFileSync(origem, dest)
  fs.copyFileSync(origem, path.join(REFS, `${projeto}-fonte${ext}`))
  return {
    id: `still-${projeto}-20260909`,
    tipo: 'imagem',
    arquivo: `midias/stills-relevantes-20260909/${projeto}${ext}`,
    mime: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png',
    sha256: sha256(dest),
    tamanho: fs.statSync(dest).size,
  }
}

function lerItens() {
  return fs.readdirSync(ITENS).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(ITENS, n), 'utf8')))
}

async function main() {
  garantirSfrNexsales()
  const recusados = []
  for (const item of lerItens()) {
    const projeto = String(item.origem?.projeto || '')
    const lixo = RECUSAR.has(projeto) || String(item.titulo || '').startsWith('Selected Work')
    if (lixo && item.estado === 'pendente') {
      await api('POST', `/api/editorial/itens/${item.id}/recusar`, { revisao: item.revisao })
      recusados.push(item.id)
    }
  }

  const existentes = new Set(lerItens().filter((i) => i.estado !== 'recusado').map((i) => `${i.pautaId}:${i.conta}:${i.idioma}`))
  const criados = []
  for (const projeto of ENTRAR) {
    const peca = PECAS[projeto]
    const anexo = midia(projeto)
    for (const conta of ['linkedin', 'x']) {
      for (const idioma of ['pt-BR', 'en']) {
        const chave = `${peca.pautaId}:${conta}:${idioma}`
        if (existentes.has(chave)) continue
        const texto = peca.textos[conta][idioma]
        if (conta === 'x' && [...texto].length > 280) throw new Error(`X estouro ${projeto} ${idioma}: ${[...texto].length}`)
        await api('POST', '/api/editorial/itens', {
          pautaId: peca.pautaId,
          conta,
          idioma,
          formato: 'imagem',
          titulo: peca.titulos[idioma],
          texto,
          campos: { texto },
          midias: [anexo],
          fontes: peca.fontes,
          origem: { tipo: 'acervo', projeto },
        })
        criados.push(chave)
      }
    }
  }

  const pendentes = lerItens().filter((i) => i.estado === 'pendente')
  const porProjeto = {}
  for (const item of pendentes) {
    const p = item.origem?.projeto || '?'
    porProjeto[p] = (porProjeto[p] || 0) + 1
  }
  process.stdout.write(JSON.stringify({ recusados: recusados.length, criados, pendentes: porProjeto }, null, 2) + '\n')
}

main().catch((erro) => { console.error(erro); process.exit(1) })
