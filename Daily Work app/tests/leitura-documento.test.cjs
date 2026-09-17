const { test } = require('node:test')
const assert = require('node:assert/strict')

async function renderizar(texto) {
  const [{ default: React }, { renderToStaticMarkup }, { default: Markdown }, { default: gfm }, { leituraPorAssunto }] = await Promise.all([
    import('react'), import('react-dom/server'), import('react-markdown'), import('remark-gfm'), import('../src/lib/leitura-documento.ts'),
  ])
  return renderToStaticMarkup(React.createElement(Markdown, { remarkPlugins: [gfm, leituraPorAssunto] }, texto))
}

test('leitura por assunto preserva links entre seções, tabelas, código e notas', async () => {
  const html = await renderizar(`# Documento

Introdução curta.

## Primeiro assunto

Consulte [a referência][fonte] e esta nota[^1].

### Subtítulo mantido

- Ação um
- Ação dois

\`\`\`md
## Isto é código, não outro assunto
\`\`\`

## Segundo assunto

| Fonte | Valor |
| --- | --- |
| Real | 42 |

[fonte]: https://example.com/evidencia
[^1]: Evidência preservada.
`)
  assert.equal((html.match(/<details/g) || []).length, 3)
  assert.equal((html.match(/<summary/g) || []).length, 3)
  assert.match(html, /<h1>Documento<\/h1>/)
  assert.match(html, /<h3>Subtítulo mantido<\/h3>/)
  assert.match(html, /href="https:\/\/example.com\/evidencia"/)
  assert.match(html, /<table>/)
  assert.match(html, /<td>42<\/td>/)
  assert.match(html, /<pre><code class="language-md">## Isto é código/)
  assert.match(html, /Evidência preservada/)
  assert.doesNotMatch(html, /<details[^>]*\sopen/)
})

test('texto longo sem títulos continua inteiro em uma seção acessível', async () => {
  const conteudo = `${'Uma informação completa. '.repeat(100)}Última informação.`
  const html = await renderizar(conteudo)
  assert.match(html, /<summary><strong>Sobre este documento<\/strong>/)
  assert.match(html, /Última informação\./)
  assert.equal((html.match(/Uma informação completa\./g) || []).length, 100)
  assert.doesNotMatch(await renderizar('Uma nota curta.'), /<details/)
})

test('agendamento exibe o horário de São Paulo e preserva formatos desconhecidos', async () => {
  const { horarioCampanha } = await import('../src/lib/leitura-documento.ts')
  assert.equal(horarioCampanha('Fri 2026-09-11 09:30:00 -03', '2026-09-11'), 'Hoje, às 09:30')
  assert.equal(horarioCampanha('2026-09-12T00:30:00Z', '2026-09-11'), 'Hoje, às 21:30')
  assert.equal(horarioCampanha('Sat 2026-09-12 09:30:00 -03', '2026-09-11'), '12/09, às 09:30')
  assert.equal(horarioCampanha(undefined), 'Horário indisponível')
  assert.equal(horarioCampanha('a confirmar'), 'a confirmar')
})
