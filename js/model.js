/* =====================================================================
   model.js — núcleo de dados
   Réplica fiel de Pontos.cs (Rotulo / Ponto) + geração do grafo de
   conflitos de frmPrincipal.cs
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------------- paleta ---------------- */
  function randomCor() {
    // equivalent moderno de Color.FromArgb(rand%250, rand%250, rand%250)
    const h = Math.floor(Math.random() * 360);
    const s = 58 + Math.floor(Math.random() * 30);
    const l = 56 + Math.floor(Math.random() * 20);
    return 'hsl(' + h + ' ' + s + '% ' + l + '%)';
  }

  function corHSLtoRGB(hsl) {
    const m = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/.exec(hsl);
    if (!m) return '#888';
    return [parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100];
  }

  /* ---------------- Rotulo ---------------- */
  class Rotulo {
    constructor(x, y, w, h) {
      this.x = x; this.y = y;
      this.width = w; this.height = h;
    }
    /* Pertence: comparação estrita, idêntica ao C# */
    pertence(px, py) {
      return px > this.x && px < this.x + this.width &&
             py > this.y && py < this.y + this.height;
    }
    /* Interseccao: 8 pontos amostrais do retângulo r dentro deste */
    interseccao(r) {
      const ex = r.x + r.width, ey = r.y + r.height;
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      return this.pertence(r.x, r.y) || this.pertence(ex, r.y) ||
             this.pertence(r.x, ey) || this.pertence(ex, ey) ||
             this.pertence(r.x, cy) || this.pertence(cx, r.y) ||
             this.pertence(ex, cy) || this.pertence(cx, ey);
    }
  }

  /* ---------------- Ponto ----------------
     Layout dos 4 rótulos (idêntico ao construtor do C#):
       [0] superior direito   [1] superior esquerdo
       [2] inferior esquerdo  [3] inferior direito
     Vértice global do rótulo i do ponto id = id*4 + i + 1            */
  class Ponto {
    constructor(id, x1, y1, x2, y2, selecionado) {
      this.id = id;
      this.x = x1;
      this.y = y1;
      this.width = Math.abs(x2 - x1);
      this.height = Math.abs(y2 - y1);
      this.selecionado = (selecionado === undefined || selecionado === null) ? 0 : selecionado;
      this.cor = randomCor();
      this.fontSize = 8;
      this._construir();
    }

    _construir() {
      const w = this.width / 2, h = this.height / 2;
      const x = this.x, y = this.y;
      this.rotulos = [
        new Rotulo(x + w, y,     w, h), // 0 superior direito
        new Rotulo(x,     y,     w, h), // 1 superior esquerdo
        new Rotulo(x,     y + h, w, h), // 2 inferior esquerdo
        new Rotulo(x + w, y + h, w, h)  // 3 inferior direito
      ];
    }

    /* setters recalculam a geometria das quadrantes */
    setWidth(v) {
      this.width = v;
      const w = v / 2, r = this.rotulos;
      r[0].x = this.x + w; r[0].width = w;
      r[1].x = this.x;     r[1].width = w;
      r[2].x = this.x;     r[2].width = w;
      r[3].x = this.x + w; r[3].width = w;
    }

    setHeight(v) {
      this.height = v;
      const h = v / 2, r = this.rotulos;
      r[0].y = this.y;     r[0].height = h;
      r[1].y = this.y;     r[1].height = h;
      r[2].y = this.y + h; r[2].height = h;
      r[3].y = this.y + h; r[3].height = h;
    }

    moveTo(nx, ny) {
      const dx = nx - this.x, dy = ny - this.y;
      this.x = nx; this.y = ny;
      for (const r of this.rotulos) { r.x += dx; r.y += dy; }
    }

    getRotulo(i) { return this.rotulos[i]; }

    /* Ponto de ancoragem do vértice (canto externo do ponto) */
    ancora(vert) {
      const r = this.rotulos[vert];
      switch (vert) {
        case 0: return [r.x + r.width, r.y];
        case 1: return [r.x, r.y];
        case 2: return [r.x, r.y + r.height];
        default: return [r.x + r.width, r.y + r.height];
      }
    }

    /* bounding box — idêntico a Ponto.Pertence */
    pertence(px, py) {
      return px >= this.x && py >= this.y &&
             px <= this.x + this.width && py <= this.y + this.height;
    }

    existeConflito(idxRot, rot) {
      return this.rotulos[idxRot].interseccao(rot);
    }

    /* --------- desenho --------- */
    desenharRotulo(ctx, i, op) {
      const r = this.rotulos[i];
      const rotuloId = (this.id < 0) ? '' : String(this.id * 4 + i + 1);

      if (op.preencher) {
        ctx.fillStyle = op.cor;
        ctx.fillRect(r.x, r.y, r.width, r.height);
      }
      ctx.lineWidth = op.larguraBorda || 1;
      ctx.strokeStyle = op.borda || '#000';
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width - 1, r.height - 1);

      if (rotuloId) {
        ctx.fillStyle = '#000';
        ctx.font = this.fontSize + 'px "Segoe UI", Roboto, Arial, sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillText(rotuloId, r.x + 1, r.y + 1);
      }
    }

    /* Mostrar tudo: as 4 quadrantes, preenchendo a selecionada */
    desenhar(ctx, op) {
      for (let i = 0; i < 4; i++) {
        this.desenharRotulo(ctx, i, {
          preencher: this.selecionado === i,
          cor: this.cor,
          borda: '#000',
          larguraBorda: op.larguraBorda || 1
        });
      }
    }

    /* Visualizar solução: apenas a selecionada */
    desenharSelecionada(ctx, op) {
      this.desenharRotulo(ctx, this.selecionado, {
        preencher: !!op.preencher,
        cor: this.cor,
        borda: '#000',
        larguraBorda: op.larguraBorda || 1
      });
    }

    /* DesenharGrafo: retângulo + 2 diagonais + 4 vértices (pontos) */
    desenharGrafo(ctx, raio) {
      const r = this.rotulos;
      const p0 = r[0], p1 = r[1], p2 = r[2], p3 = r[3];

      const cantos = [
        [p0.x + p0.width - raio / 2, p0.y - raio / 2],
        [p1.x - raio / 2,             p1.y - raio / 2],
        [p2.x - raio / 2,             p2.y + p2.height - raio / 2],
        [p3.x + p3.width - raio / 2,  p3.y + p3.height - raio / 2]
      ];
      ctx.fillStyle = '#000';
      for (const [cx, cy] of cantos) ctx.fillRect(cx, cy, raio, raio);

      ctx.beginPath();
      // arestas do contorno
      ctx.moveTo(p0.x + p0.width, p0.y); ctx.lineTo(p1.x, p1.y);
      ctx.moveTo(p1.x, p1.y);            ctx.lineTo(p2.x, p2.y + p2.height);
      ctx.moveTo(p2.x, p2.y + p2.height);ctx.lineTo(p3.x + p3.width, p3.y + p3.height);
      ctx.moveTo(p3.x + p3.width, p3.y + p3.height); ctx.lineTo(p0.x + p0.width, p0.y);
      // diagonais
      ctx.moveTo(p1.x, p1.y);            ctx.lineTo(p3.x + p3.width, p3.y + p3.height);
      ctx.moveTo(p0.x + p0.width, p0.y); ctx.lineTo(p2.x, p2.y + p2.height);
      ctx.stroke();
    }
  }

  /* ---------------- Grafo de conflitos ----------------
     Réplica do laço duplo de frmPrincipal ("Gerar Grafo de Conflitos").
     Devolve matriz de adjacência 4N × 4N e o nº de conflitos (arestas). */
  function gerarGrafoConflitos(pontos) {
    const N = pontos.length;
    const n = N * 4;
    const adj = new Array(n);
    for (let i = 0; i < n; i++) adj[i] = new Uint8Array(n);

    let conflitos = 0; // conta direcionado (por isso divide no final)

    for (let i = 0; i < N; i++) {
      const p1 = pontos[i];
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const p2 = pontos[j];
        for (let k = 0; k < 4; k++) {
          for (let l = 0; l < 4; l++) {
            if (p1.existeConflito(k, p2.getRotulo(l))) {
              const a = i * 4 + k, b = j * 4 + l;
              if (adj[a][b] === 0) { adj[a][b] = 1; conflitos++; }
              if (adj[b][a] === 0) { adj[b][a] = 1; conflitos++; }
            }
          }
        }
      }
    }
    return { n: n, adj: adj, conflitos: conflitos / 2, pontos: N };
  }

  /* Serialização no formato exato do aplicativo desktop:
       linha 1 : " <n> <conflitos> 0"
       demais  : "i j1 j2 ..."  (vértices 1-based)                       */
  function grafoParaTexto(res) {
    const CRLF = '\r\n';
    const out = [];
    out.push(' ' + res.n + ' ' + res.conflitos + ' 0');
    for (let i = 0; i < res.n; i++) {
      let linha = String(i + 1);
      const row = res.adj[i];
      for (let j = 0; j < res.n; j++) {
        if (i !== j && row[j] === 1) linha += ' ' + (j + 1);
      }
      out.push(linha);
    }
    return out.join(CRLF);
  }

  /* converte a lista de arestas (ids globais) para segmentos na folha.
     O formato lista a adjacência de cada vértice, portanto cada aresta
     aparece duas vezes (i→j e j→i): deduplicamos como não-dirigida.   */
  function arestasParaSegmentos(arestas, pontos) {
    const segs = [];
    const vistas = new Set();
    let invalidas = 0;
    for (const [a, b] of arestas) {
      if (a === b) { invalidas++; continue; }
      const key = a < b ? a + ':' + b : b + ':' + a;
      if (vistas.has(key)) continue;
      vistas.add(key);

      const pa = Math.floor((a - 1) / 4), va = (a - 1) - pa * 4;
      const pb = Math.floor((b - 1) / 4), vb = (b - 1) - pb * 4;
      const A = pontos[pa], B = pontos[pb];
      if (!A || !B || va < 0 || va > 3 || vb < 0 || vb > 3) { invalidas++; continue; }
      const p1 = A.ancora(va), p2 = B.ancora(vb);
      segs.push([p1[0], p1[1], p2[0], p2[1]]);
    }
    return { segs: segs, invalidas: invalidas };
  }

  /* extrai a lista de arestas (1-based, não-dirigidas) a partir da matriz */
  function adjParaArestas(res) {
    const out = [];
    for (let i = 0; i < res.n; i++) {
      for (let j = i + 1; j < res.n; j++) {
        if (res.adj[i][j]) out.push([i + 1, j + 1]);
      }
    }
    return out;
  }

  /* ---------------- Solução gulosa ----------------
     Escolhe 1 das 4 quadrantes de cada ponto minimizando os conflitos:
       1) gera o grafo de conflitos (mesma definição do C#)
       2) a cada passo, escolhe o vértice (ponto ainda não escolhido ×
          quadrante) com MENOS conflitos contra os vértices já escolhidos;
          empates: menor grau total, depois menor id de vértice
       3) refinamento local: enquanto existir um ponto cujo quadrante
          escolhido possa ser trocado reduzindo o nº de conflitos, troca   */
  function solucaoGulosa(pontos) {
    const N = pontos.length;
    const res = gerarGrafoConflitos(pontos);
    const n = res.n;
    const adj = res.adj;

    // lista de adjacência (para incrementos O(grau))
    const viz = new Array(n);
    for (let i = 0; i < n; i++) {
      const arr = [];
      for (let j = 0; j < n; j++) if (adj[i][j]) arr.push(j);
      viz[i] = arr;
    }
    const grau = viz.map((a) => a.length);
    const confl = new Int32Array(n);   // conflitos contra os já escolhidos

    const sel = new Array(N).fill(-1); // quadrante escolhido por ponto
    for (let iter = 0; iter < N; iter++) {
      let best = null;
      for (let i = 0; i < N; i++) {
        if (sel[i] !== -1) continue;
        for (let k = 0; k < 4; k++) {
          const v = i * 4 + k, c = confl[v];
          if (!best || c < best.c ||
              (c === best.c && grau[v] < best.grau) ||
              (c === best.c && grau[v] === best.grau && v < best.v)) {
            best = { i, k, v, c, grau: grau[v] };
          }
        }
      }
      sel[best.i] = best.k;
      for (const u of viz[best.v]) confl[u]++;
    }

    // refinamento local: troca de quadrante que reduz conflitos
    let trocou = true;
    while (trocou) {
      trocou = false;
      for (let i = 0; i < N; i++) {
        const atual = i * 4 + sel[i];
        for (let k = 0; k < 4; k++) {
          if (k === sel[i]) continue;
          const v = i * 4 + k;
          if (confl[v] < confl[atual]) {
            for (const u of viz[atual]) confl[u]--;
            sel[i] = k;
            for (const u of viz[v]) confl[u]++;
            trocou = true;
            break;
          }
        }
      }
    }

    // métricas sobre o conjunto escolhido
    const escolhido = [];
    for (let i = 0; i < N; i++) escolhido.push(i * 4 + sel[i]);
    let numConflitos = 0;
    const emConflito = new Set();
    for (let a = 0; a < escolhido.length; a++) {
      for (let b = a + 1; b < escolhido.length; b++) {
        if (adj[escolhido[a]][escolhido[b]]) {
          numConflitos++;
          emConflito.add(escolhido[a]);
          emConflito.add(escolhido[b]);
        }
      }
    }

    return {
      selecoes: sel,                    // quadrante (0..3) por ponto
      numConflitos: numConflitos,       // conflitos restantes na solução
      numRotConflitos: emConflito.size, // rótulos escolhidos que conflitam
      vertices: n
    };
  }

  global.GDC = {
    Rotulo, Ponto, randomCor, corHSLtoRGB,
    gerarGrafoConflitos, grafoParaTexto, arestasParaSegmentos, adjParaArestas,
    solucaoGulosa
  };
})(typeof window !== 'undefined' ? window : globalThis);
