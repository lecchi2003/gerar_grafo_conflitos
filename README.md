# Gerador de Grafo de Conflitos — Versão Web

Reimplementação fiel do aplicativo WinForms **Gerador de Grafo de Conflitos**
(C#/.NET 3.5) como aplicação web estática, com visual estilo *game/HUD*,
painéis de controle e navegação com **zoom, scroll, pan e minimapa**.

## Como executar

Não há build nem dependências. Basta abrir o arquivo:

```
web/index.html
```

duplo clique no Explorer (funciona via `file://`) ou sirva a pasta com qualquer
servidor estático:

```powershell
python -m http.server 8080     # http://localhost:8080/web/
```

Link direto com a demonstração carregada:

```
web/index.html#exemplo
```

## Estrutura

```
web/
├── index.html        markup (HUD, painéis, modais, menu de contexto)
├── css/styles.css    tema game/HUD + layout responsivo
└── js/
    ├── model.js      réplica de Pontos.cs (Rotulo/Ponto) + grafo de conflitos
    ├── io.js         formatos .rot / grafo .txt / solução
    ├── exemplos.js   conjunto de demonstração (12 pontos, 48 vértices, 38 conflitos)
    └── app.js        aplicação: ferramentas, zoom/scroll, arquivos, HUD, log
```

## Funcionalidades (todas as do original)

| Desktop | Web |
|---|---|
| Novo ponto (arrastar) | ✔ ferramenta **Novo ponto** (`N`) |
| Mover / Excluir | ✔ **Mover** (`M`, com modal de confirmação — marque **“Não mostrar mais.”** no modal ou o **✓ no botão Mover** para não perguntar) / **Resize** (`R`, arrasta pelo canto) / **Excluir** (`Del`) |
| Gerar Grafo de Conflitos | ✔ desenha **em tela** (não salva); **Salvar grafo** exporta o `.txt` |
| Desenhar Grafo | ✔ carrega `.txt`, desenha arestas em vermelho |
| Carregar Solução | ✔ aplica seleções e entra no modo **Solução** |
| Solução Gulosa | ✔ **Solução gulosa** gera uma solução viável na tela (HUD mostra os conflitos restantes) |
| Salvar Solução | ✔ **Salvar solução** exporta `.txt` no formato aceito por Carregar solução |
| Visualizar / Solução Colorido | ✔ modos `Tudo` (`1`), `Solução` (`2`), `Colorido` (`3`) |
| Configurações | ✔ folha, rótulo, fonte, vértice, linha + atualizar existentes |
| Rótulos Aleatórios | ✔ quantidade + "adicionar ao já existente" |
| Abrir/Salvar `.rot` | ✔ `Ctrl+O` / `Ctrl+S` + arrastar-e-soltar |
| Menu de contexto | ✔ botão direito na área de visão |
| Créditos / Ajuda | ✔ modal de Ajuda (`F1`) |

### Melhorias sobre o original

- **Zoom** `Ctrl+roda` (no cursor), slider, botões, `F` ajustar à janela, `0` = 100%
- **Scroll** com a roda / `Shift`+roda; **pan** com botão do meio, `Espaço`+arrastar ou ferramenta **Navegar**
- **Minimap** clicável para saltar de região
- **Mapa de fundo**: carregue uma imagem (botão **Mapa**, menu de contexto ou arrastar)
  e escolha a **disposição** em *Configurações* — Cobrir, Ajustar, Estender,
  Centralizada ou Ladrilhar (como no plano de fundo do Windows), com opacidade ajustável
- **Desfazer/Refazer** (`Ctrl+Z` / `Ctrl+Y`), **grade**, **exportar PNG**
- Leituras em tempo real (Pontos, Rótulos, Conflitos, Zoom, coordenadas), log de eventos e toasts
- Arrastar-e-soltar de arquivos, decimal tolerante (`,` ou `.`), deduplicação de arestas

## Formatos de arquivo

### `.rot` — rótulos

```
#LARGURA DA FOLHA
800
#ALTURA DA FOLHA
600
#LARGURA DO ROTULO
50
#ALTURA DO ROTULO
30
#TAMANHO FONTE
8
#0
100
100
150
130
0
...
EOF
```

### `.txt` — grafo de conflitos

```
 48 38 0
1 5 6
2 6
...
```

Primeira linha: `<vértices> <arestas> 0`. Depois, por vértice: `v vizinho1 vizinho2 ...`
(a adjacência é listada nos dois sentidos).

### Solução

```
<linha ignorada>
<número de conflitos>
<linha ignorada>
<número de rótulos em conflito>
<linha ignorada>
<vértice do ponto 1>
<vértice do ponto 2>
...
```

## Verificação

Suíte de testes (Node) cobrindo round-trip `.rot`, geração do grafo (48 vértices /
38 conflitos no exemplo), leitura de arestas, solução e geometria das quadrantes:
**33/33 PASS**; checagem de estrutura HTML/IDs/ícones: **OK**.

## Créditos

Original: Gildásio Lecchi Cravo — orientação Glaydston Mattos Ribeiro e
Luiz Antonio Nogueira Lorena (UNIARACRUZ / INPE). Textos completos no modal *Ajuda*.
