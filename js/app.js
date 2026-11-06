/* =====================================================================
   app.js — aplicação principal
   Reproduz todas as funcionalidades do Gerador de Grafo de Conflitos
   (WinForms) numa interface web com zoom, scroll, pan e minimapa.
   ===================================================================== */
(function () {
  'use strict';

  const G = window.GDC, IO = window.GDCIO, EX = window.EXEMPLOS;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const body = document.body;
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const viewport = $('viewport');
  const stage = $('stage');
  const PAD = 56;                       // padding do .stage

  /* ===================== ESTADO ===================== */
  const S = {
    largura_folha: 800, altura_folha: 600,
    largura_rotulo: 50, altura_rotulo: 30,
    tam_fonte: 8, raio: 8, largura_linha: 2,
    numero_de_aleatorios: 100,
    pontos: [],
    modo: 'normal',          // normal | solucao | colorido | grafo
    ferramenta: null,        // novo | mover | excluir | pan | null
    zoom: 1,
    grade: true,
    arestas: null,           // [[idA,idB], ...]
    segs: null,              // [[x1,y1,x2,y2], ...]
    ultimoConflito: null,
    mapa: null,              // {img, nome, w, h} — imagem de fundo
    mapaOpacidade: 1,
    mapaModo: 'cobrir',      // cobrir | ajustar | estender | central | ladrilho
    textoGrafo: null,        // último .txt gerado/carregado (para salvar)
    hover: -1
  };

  let preview = null;        // {x1,y1,cx,cy} — arrasto do "novo ponto"
  let drag = null;           // estado do arrasto corrente
  let spaceDown = false;

  /* ===================== UI: toasts / log / confirm ===================== */
  function toast(msg, tipo, ms) {
    const el = document.createElement('div');
    el.className = 'toast ' + (tipo || '');
    el.textContent = msg;
    $('toasts').appendChild(el);
    const t = ms || (tipo === 'err' ? 6500 : 4200);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    }, t);
  }

  function log(msg, tipo) {
    const box = $('logList');
    const ev = document.createElement('div');
    ev.className = 'ev ' + (tipo || '');
    const h = new Date();
    const hh = String(h.getHours()).padStart(2, '0');
    const mm = String(h.getMinutes()).padStart(2, '0');
    const ss = String(h.getSeconds()).padStart(2, '0');
    ev.innerHTML = '<time>' + hh + ':' + mm + ':' + ss + '</time><i class="dot"></i><span></span>';
    ev.querySelector('span').textContent = msg;
    box.prepend(ev);
    while (box.children.length > 60) box.lastChild.remove();
  }

  let confirmCb = null;
  function confirmar(msg, titulo) {
    return new Promise((resolve) => {
      $('cfMsg').textContent = msg;
      $('cfTitle').textContent = titulo || 'Confirmar';
      confirmCb = resolve;
      openModal('modalConfirm');
    });
  }
  $('cfOk').addEventListener('click', () => {
    const cb = confirmCb;
    confirmCb = null;          // resolve ANTES de fechar: senão o closeModal()
    closeModal();              // resolveria como false e cancelaria a ação
    if (cb) cb(true);
  });

  /* ---------------- modais ---------------- */
  function openModal(id) {
    $('overlay').hidden = false;
    ['modalConfig', 'modalAleatorios', 'modalAjuda', 'modalConfirm']
      .forEach((m) => { $(m).hidden = (m !== id); });
  }
  function closeModal() {
    $('overlay').hidden = true;
    if (confirmCb) { confirmCb(false); confirmCb = null; }
  }
  $('overlay').addEventListener('click', (e) => {
    if (e.target === $('overlay') || e.target.closest('[data-close]')) closeModal();
  });

  /* ===================== HISTÓRICO ===================== */
  function serializeState() {
    return JSON.stringify({
      L: S.largura_folha, A: S.altura_folha,
      lr: S.largura_rotulo, ar: S.altura_rotulo,
      f: S.tam_fonte, r: S.raio, ll: S.largura_linha,
      p: S.pontos.map((p) => ({
        x: p.x, y: p.y, w: p.width, h: p.height,
        s: p.selecionado, c: p.cor
      }))
    });
  }
  function restoreState(json) {
    const d = JSON.parse(json);
    S.largura_folha = d.L; S.altura_folha = d.A;
    S.largura_rotulo = d.lr; S.altura_rotulo = d.ar;
    S.tam_fonte = d.f; S.raio = d.r; S.largura_linha = d.ll;
    S.pontos = d.p.map((q, i) => {
      const p = new G.Ponto(i, q.x, q.y, q.x + q.w, q.y + q.h, q.s);
      p.cor = q.c; p.fontSize = S.tam_fonte;
      return p;
    });
    S.arestas = null; S.segs = null; S.textoGrafo = null;
    if (S.modo === 'grafo') S.modo = 'normal';
    applyCanvasSize();
    updateHUD();
  }

  const undoStack = [], redoStack = [];
  function commit(before) {
    undoStack.push(before);
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
    refreshHistory();
  }
  function pushHistory() { commit(serializeState()); }
  function undo() {
    if (!undoStack.length) { toast('Nada a desfazer.', 'warn'); return; }
    redoStack.push(serializeState());
    restoreState(undoStack.pop());
    refreshHistory(); log('Desfazer acionado.', 'ok');
  }
  function redo() {
    if (!redoStack.length) { toast('Nada a refazer.', 'warn'); return; }
    undoStack.push(serializeState());
    restoreState(redoStack.pop());
    refreshHistory(); log('Refazer acionado.', 'ok');
  }
  function refreshHistory() {
    $('btnUndo').disabled = !undoStack.length;
    $('btnRedo').disabled = !redoStack.length;
  }

  /* ===================== DESENHO ===================== */
  function drawGrade(c, W, H) {
    c.save();
    c.lineWidth = 1;
    c.strokeStyle = '#eef2f7';
    c.beginPath();
    for (let x = 50; x < W; x += 50) { c.moveTo(x + .5, 0); c.lineTo(x + .5, H); }
    for (let y = 50; y < H; y += 50) { c.moveTo(0, y + .5); c.lineTo(W, y + .5); }
    c.stroke();
    c.strokeStyle = '#e2e8f0';
    c.beginPath();
    for (let x = 200; x < W; x += 200) { c.moveTo(x + .5, 0); c.lineTo(x + .5, H); }
    for (let y = 200; y < H; y += 200) { c.moveTo(0, y + .5); c.lineTo(W, y + .5); }
    c.stroke();
    c.restore();
  }

  function drawPreview(c) {
    const p = preview; if (!p) return;
    const w = Math.abs(p.cx - p.x1);
    if (w < S.altura_rotulo) return;
    const x = Math.min(p.x1, p.cx);
    const y = p.cy < p.y1 ? p.y1 - S.altura_rotulo : p.y1;
    const tmp = new G.Ponto(-1, x, y, x + w, y + S.altura_rotulo, 0);
    tmp.fontSize = S.tam_fonte;
    tmp.cor = '#dcdcdc';
    c.save();
    c.setLineDash([5, 4]);
    c.strokeStyle = '#909090';
    for (let i = 0; i < 4; i++) tmp.desenharRotulo(c, i, {
      preencher: i === 0, cor: '#dcdcdc', borda: '#909090', larguraBorda: 1
    });
    c.restore();
  }

  function drawGrafo(c) {
    c.save();
    c.setLineDash([1.5, 3]);
    c.strokeStyle = '#000';
    c.lineWidth = 1;
    for (const p of S.pontos) { p.fontSize = S.tam_fonte; p.desenharGrafo(c, S.raio); }
    c.restore();

    if (S.segs && S.segs.length) {
      c.save();
      c.setLineDash([]);
      c.strokeStyle = '#e01b1b';
      c.lineWidth = S.largura_linha;
      c.beginPath();
      for (const s of S.segs) { c.moveTo(s[0], s[1]); c.lineTo(s[2], s[3]); }
      c.stroke();
      c.restore();
    }
  }

  function drawPontos(c) {
    for (const p of S.pontos) {
      p.fontSize = S.tam_fonte;
      if (S.modo === 'solucao') p.desenharSelecionada(c, { preencher: false, larguraBorda: 1 });
      else if (S.modo === 'colorido') p.desenharSelecionada(c, { preencher: true, larguraBorda: 1 });
      else p.desenhar(c, { larguraBorda: 1 });
    }
  }

  function drawHover(c) {
    const p = S.pontos[S.hover]; if (!p) return;
    c.save();
    c.strokeStyle = 'rgba(46,230,255,.95)';
    c.lineWidth = 1.5;
    c.strokeRect(p.x - 3, p.y - 3, p.width + 6, p.height + 6);
    c.strokeStyle = 'rgba(46,230,255,.35)';
    c.lineWidth = 1;
    c.strokeRect(p.x - 6, p.y - 6, p.width + 12, p.height + 12);

    // no modo Mover: alças nos 4 cantos + cruz no ponto de agarro
    if (S.ferramenta === 'mover') {
      const hs = 5;
      c.fillStyle = '#2ee6ff';
      const cantos = [[p.x, p.y], [p.x + p.width, p.y], [p.x, p.y + p.height], [p.x + p.width, p.y + p.height]];
      for (const [cx, cy] of cantos) c.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      c.strokeStyle = 'rgba(46,230,255,.8)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(p.x - 9, p.y - 3); c.lineTo(p.x - 9, p.y + 3);
      c.moveTo(p.x - 12, p.y);     c.lineTo(p.x - 6, p.y);
      c.stroke();
    }
    c.restore();
  }

  /* ---------- mapa de fundo (imagem sob os rótulos) ----------
     Disposição equivalente às opções de plano de fundo do Windows:
       cobrir   → cobre a folha cortando o excesso (proporção preservada)
       ajustar  → encaixa a folha inteira na imagem (sem cortar)
       estender → estica até preencher (pode distorcer)
       central  → tamanho real, centrada (folha aparece ao redor)
       ladrilho → repete a imagem em mosaico                            */
  const MODOS_MAPA = {
    cobrir: 'Cobrir',
    ajustar: 'Ajustar',
    estender: 'Estender',
    central: 'Centralizada',
    ladrilho: 'Ladrilhar'
  };

  function drawMapa(c, W, H) {
    const m = S.mapa;
    if (!m || !m.img) return;
    const iw = m.img.naturalWidth || m.w, ih = m.img.naturalHeight || m.h;
    if (!iw || !ih) return;
    const modo = S.mapaModo;
    c.save();
    c.globalAlpha = S.mapaOpacidade;
    try {
      if (modo === 'estender') {
        c.drawImage(m.img, 0, 0, W, H);
      } else if (modo === 'central') {
        c.drawImage(m.img, (W - iw) / 2, (H - ih) / 2);
      } else if (modo === 'ladrilho') {
        const p = c.createPattern(m.img, 'repeat');
        if (p) { c.fillStyle = p; c.fillRect(0, 0, W, H); }
      } else {
        const sc = (modo === 'ajustar') ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
        const dw = iw * sc, dh = ih * sc;
        c.drawImage(m.img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
    } catch (e) { /* imagem ainda não decodificada */ }
    c.restore();
  }

  /* pinta numa ctx já em coordenadas da folha */
  function paint(c, o) {
    o = o || {};
    const W = S.largura_folha, H = S.altura_folha;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, W, H);
    if (S.mapa) drawMapa(c, W, H);
    if (o.grade) drawGrade(c, W, H);
    if (S.modo === 'grafo') drawGrafo(c); else drawPontos(c);
    if (o.preview) drawPreview(c);
    if (o.hover) drawHover(c);
  }

  function render() {
    /* o canvas é redimensionado em unidades_da_folha × zoom × devicePixelRatio;
       o contexto precisa da MESMA escala, senão o desenho fica no tamanho
       original enquanto só a "caixa" cresce (zoom aparente errado).        */
    const d = window.devicePixelRatio || 1;
    const k = S.zoom * d;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    paint(ctx, { grade: S.grade, preview: !!preview, hover: true });
    drawMinimap();
  }

  /* ---------- canvas em alta resolução (zoom nítido) ---------- */
  function applyCanvasSize() {
    const z = S.zoom, d = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(S.largura_folha * z * d));
    canvas.height = Math.max(1, Math.round(S.altura_folha * z * d));
    canvas.style.width = (S.largura_folha * z) + 'px';
    canvas.style.height = (S.altura_folha * z) + 'px';
    render();
  }

  /* ===================== MINIMAPA ===================== */
  const mm = $('minimap'), mctx = mm.getContext('2d');
  let mmGeo = null;

  function drawMinimap() {
    const W = mm.width, H = mm.height, pad = 7;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = '#060b13';
    mctx.fillRect(0, 0, W, H);

    const sc = Math.min((W - 2 * pad) / S.largura_folha, (H - 2 * pad) / S.altura_folha);
    const ox = (W - S.largura_folha * sc) / 2, oy = (H - S.altura_folha * sc) / 2;
    mmGeo = { ox, oy, sc };

    mctx.fillStyle = '#0d1626';
    mctx.fillRect(ox, oy, S.largura_folha * sc, S.altura_folha * sc);

    // miniatura do mapa de fundo
    if (S.mapa && S.mapa.img) {
      const iw = S.mapa.img.naturalWidth || S.mapa.w;
      const ih = S.mapa.img.naturalHeight || S.mapa.h;
      if (iw && ih) {
        const sw = S.largura_folha * sc, sh = S.altura_folha * sc;
        const k = Math.max(sw / iw, sh / ih);
        mctx.save();
        mctx.beginPath();
        mctx.rect(ox, oy, sw, sh);
        mctx.clip();
        mctx.globalAlpha = Math.max(.35, S.mapaOpacidade * .85);
        try { mctx.drawImage(S.mapa.img, ox + (sw - iw * k) / 2, oy + (sh - ih * k) / 2, iw * k, ih * k); }
        catch (e) {}
        mctx.restore();
      }
    }

    mctx.strokeStyle = '#2c4468';
    mctx.lineWidth = 1;
    mctx.strokeRect(ox + .5, oy + .5, S.largura_folha * sc - 1, S.altura_folha * sc - 1);

    if (S.modo === 'grafo' && S.segs) {
      mctx.strokeStyle = 'rgba(224,27,27,.9)';
      mctx.lineWidth = 1;
      mctx.beginPath();
      for (const s of S.segs) {
        mctx.moveTo(ox + s[0] * sc, oy + s[1] * sc);
        mctx.lineTo(ox + s[2] * sc, oy + s[3] * sc);
      }
      mctx.stroke();
    }

    mctx.fillStyle = 'rgba(46,230,255,.9)';
    for (const p of S.pontos) {
      mctx.fillRect(ox + p.x * sc, oy + p.y * sc,
        Math.max(2, p.width * sc), Math.max(2, p.height * sc));
    }

    // retângulo da área visível
    const vx = (viewport.scrollLeft - PAD) / S.zoom;
    const vy = (viewport.scrollTop - PAD) / S.zoom;
    const vw = viewport.clientWidth / S.zoom;
    const vh = viewport.clientHeight / S.zoom;
    mctx.strokeStyle = '#ffb23e';
    mctx.lineWidth = 1.5;
    mctx.strokeRect(ox + vx * sc, oy + vy * sc, vw * sc, vh * sc);
  }

  $('minimapBox').addEventListener('pointerdown', (e) => {
    if (!mmGeo) return;
    e.stopPropagation();
    const r = mm.getBoundingClientRect();
    const mx = (e.clientX - r.left) * (mm.width / r.width);
    const my = (e.clientY - r.top) * (mm.height / r.height);
    centrarEm((mx - mmGeo.ox) / mmGeo.sc, (my - mmGeo.oy) / mmGeo.sc);
  });

  function centrarEm(fx, fy) {
    viewport.scrollLeft = clamp(PAD + fx * S.zoom - viewport.clientWidth / 2, 0, 1e6);
    viewport.scrollTop = clamp(PAD + fy * S.zoom - viewport.clientHeight / 2, 0, 1e6);
    drawMinimap();
  }

  /* ===================== ZOOM & SCROLL ===================== */
  function setZoom(z, anchor) {
    const nz = clamp(z, 0.1, 6);
    if (Math.abs(nz - S.zoom) < 1e-6) return;
    if (anchor) {
      const r = viewport.getBoundingClientRect();
      const px = anchor.x - r.left, py = anchor.y - r.top;
      const fx = (viewport.scrollLeft + px - PAD) / (S.largura_folha * S.zoom);
      const fy = (viewport.scrollTop + py - PAD) / (S.altura_folha * S.zoom);
      S.zoom = nz;
      applyCanvasSize();
      viewport.scrollLeft = Math.max(0, PAD + fx * S.largura_folha * nz - px);
      viewport.scrollTop = Math.max(0, PAD + fy * S.altura_folha * nz - py);
    } else {
      const cx = viewport.scrollLeft + viewport.clientWidth / 2;
      const cy = viewport.scrollTop + viewport.clientHeight / 2;
      const fx = (cx - PAD) / (S.largura_folha * S.zoom);
      const fy = (cy - PAD) / (S.altura_folha * S.zoom);
      S.zoom = nz;
      applyCanvasSize();
      viewport.scrollLeft = Math.max(0, PAD + fx * S.largura_folha * nz - viewport.clientWidth / 2);
      viewport.scrollTop = Math.max(0, PAD + fy * S.altura_folha * nz - viewport.clientHeight / 2);
    }
    $('zoomRange').value = Math.round(S.zoom * 100);
    updateHUD();
    drawMinimap();
  }

  function fit() {
    const aw = viewport.clientWidth - 2 * PAD;
    const ah = viewport.clientHeight - 2 * PAD;
    const z = Math.min(aw / S.largura_folha, ah / S.altura_folha, 4);
    S.zoom = clamp(z, 0.1, 6);
    applyCanvasSize();
    $('zoomRange').value = Math.round(S.zoom * 100);
    viewport.scrollLeft = Math.max(0, (stage.offsetWidth - viewport.clientWidth) / 2);
    viewport.scrollTop = Math.max(0, (stage.offsetHeight - viewport.clientHeight) / 2);
    updateHUD(); drawMinimap();
    log('Zoom ajustado à janela (' + Math.round(S.zoom * 100) + '%).');
  }

  viewport.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(S.zoom * (e.deltaY < 0 ? 1.13 : 1 / 1.13), { x: e.clientX, y: e.clientY });
    }
  }, { passive: false });

  viewport.addEventListener('scroll', () => drawMinimap(), { passive: true });

  /* ===================== INTERAÇÃO COM O CANVAS ===================== */
  function evtPt(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (S.largura_folha / r.width),
      y: (e.clientY - r.top) * (S.altura_folha / r.height)
    };
  }
  /* Teste de acerto com tolerância (em unidades da folha).
     `tol` vem em pixels de tela divididos pelo zoom, para que um clique
     "quase" na borda do ponto ainda selecione o ponto. */
  function hitTest(x, y, tol) {
    tol = tol || 0;
    for (let i = S.pontos.length - 1; i >= 0; i--) {
      const p = S.pontos[i];
      if (x >= p.x - tol && x <= p.x + p.width + tol &&
          y >= p.y - tol && y <= p.y + p.height + tol) return i;
    }
    return -1;
  }
  /* tolerâncias padrão: 10 px de tela para selecionar, 5 px para hover */
  function tolSelecao() { return 10 / S.zoom; }
  function tolHover() { return 5 / S.zoom; }

  function onDown(e) {
    hideCtx();
    if (e.target.closest('.minimap')) return;

    // navegação (botão do meio / ferramenta navegar / espaço + arrastar)
    if (e.button === 1 || (e.button === 0 && (S.ferramenta === 'pan' || spaceDown))) {
      e.preventDefault();
      drag = { type: 'pan', sx: e.clientX, sy: e.clientY, sl: viewport.scrollLeft, st: viewport.scrollTop };
      body.classList.add('panning');
      return;
    }
    if (e.button !== 0 || e.target !== canvas) return;

    const pt = evtPt(e);

    if (S.ferramenta === 'novo') {
      preview = { x1: pt.x, y1: pt.y, cx: pt.x, cy: pt.y };
      drag = { type: 'novo' };
      render();
      return;
    }
    if (S.ferramenta === 'excluir') {
      const i = hitTest(pt.x, pt.y, tolSelecao());
      if (i >= 0) {
        pushHistory();
        const id = S.pontos[i].id;
        S.pontos.splice(i, 1);
        S.pontos.forEach((p, k) => { p.id = k; });
        recomputeSegments();
        render(); updateHUD();
        toast('Ponto ' + (id + 1) + ' removido.', 'ok');
        log('Ponto removido (#' + (id + 1) + ').', 'warn');
      }
      return;
    }
    if (S.ferramenta === 'mover') {
      const i = hitTest(pt.x, pt.y, tolSelecao());
      if (i >= 0) {
        const p = S.pontos[i];
        drag = {
          type: 'mover', i, before: serializeState(),
          dx: p.x - pt.x, dy: p.y - pt.y, moved: false,
          orig: { x: p.x, y: p.y }
        };
      }
      return;
    }
    // sem ferramenta: apenas atualiza o "hover"
  }

  function onMove(e) {
    // arrasto
    if (drag) {
      if (drag.type === 'pan') {
        viewport.scrollLeft = drag.sl - (e.clientX - drag.sx);
        viewport.scrollTop = drag.st - (e.clientY - drag.sy);
        return;
      }
      if (drag.type === 'novo') {
        const pt = evtPt(e);
        preview.cx = pt.x; preview.cy = pt.y;
        const w = Math.abs(pt.x - preview.x1);
        if (w >= S.altura_rotulo) {
          const x = Math.min(preview.x1, pt.x);
          const y = pt.y < preview.y1 ? preview.y1 - S.altura_rotulo : preview.y1;
          $('sbHint').textContent = 'Rótulo: (' + Math.round(x) + ', ' + Math.round(y) +
            '); (' + Math.round(x + w) + ', ' + Math.round(y + S.altura_rotulo) + ')';
        }
        render();
        return;
      }
      if (drag.type === 'mover') {
        const pt = evtPt(e);
        const p = S.pontos[drag.i];
        const nx = clamp(pt.x + drag.dx, 0, S.largura_folha - p.width);
        const ny = clamp(pt.y + drag.dy, 0, S.altura_folha - p.height);
        if (nx !== p.x || ny !== p.y) { p.moveTo(nx, ny); drag.moved = true; recomputeSegments(); render(); }
        return;
      }
    }

    // leituras
    const r = viewport.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const ch = $('crosshair');
    if (inside) {
      ch.hidden = false;
      ch.style.setProperty('--cx', (e.clientX - r.left) + 'px');
      ch.style.setProperty('--cy', (e.clientY - r.top) + 'px');
    } else ch.hidden = true;

    if (e.target === canvas) {
      const pt = evtPt(e);
      const X = Math.round(pt.x), Y = Math.round(pt.y);
      $('sbCoords').textContent = 'Coordenadas: ' + X + ', ' + Y;
      $('vpCoords').textContent = 'X ' + String(X).padStart(4, '0') + ' · Y ' + String(Y).padStart(4, '0');
      const i = hitTest(pt.x, pt.y, S.ferramenta ? tolSelecao() : tolHover());
      if (i !== S.hover) { S.hover = i; render(); }
    } else if (S.hover !== -1) { S.hover = -1; render(); }
  }

  function onUp(e) {
    if (!drag) return;
    if (drag.type === 'pan') { body.classList.remove('panning'); drag = null; return; }

    if (drag.type === 'novo') {
      const p = preview;
      preview = null;
      drag = null;
      if (p) {
        const w = Math.abs(p.cx - p.x1);
        if (w >= S.altura_rotulo) {
          pushHistory();
          const x = Math.min(p.x1, p.cx);
          const y = p.cy < p.y1 ? p.y1 - S.altura_rotulo : p.y1;
          const pt = new G.Ponto(S.pontos.length, x, y, x + w, y + S.altura_rotulo, 0);
          pt.fontSize = S.tam_fonte;
          S.pontos.push(pt);
          log('Rótulo criado em (' + Math.round(x) + ', ' + Math.round(y) + ').', 'ok');
        }
      }
      render(); updateHUD();
      setHint();
      return;
    }

    if (drag.type === 'mover') {
      const d = drag;
      drag = null;
      if (d.moved) {
        const p = S.pontos[d.i];
        const de = '(' + Math.round(d.orig.x) + ', ' + Math.round(d.orig.y) + ')';
        const para = '(' + Math.round(p.x) + ', ' + Math.round(p.y) + ')';
        confirmar('Mover o ponto #' + (d.i + 1) + ' ?\n\nDe: ' + de + '\nPara: ' + para +
                  '\n\nConfirma o deslocamento?', 'Confirmar movimento')
          .then((ok) => {
            if (ok) {
              commit(d.before);
              toast('Ponto #' + (d.i + 1) + ' movido para ' + para + '.', 'ok');
              log('Ponto #' + (d.i + 1) + ' movido ' + de + ' → ' + para + '.', 'ok');
            } else {
              restoreState(d.before);
              toast('Movimento cancelado — ponto restaurado.', 'warn');
              log('Movimento do ponto #' + (d.i + 1) + ' cancelado.', 'warn');
            }
            render(); updateHUD();
          });
      } else {
        render();
      }
      return;
    }
    drag = null;
  }

  viewport.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  function recomputeSegments() {
    if (!S.arestas) { S.segs = null; return; }
    const r = G.arestasParaSegmentos(S.arestas, S.pontos);
    S.segs = r.segs;
  }

  /* ===================== FERRAMENTAS & MODOS ===================== */
  function setHint() {
    const h = {
      novo: 'Arraste na folha para criar um rótulo (largura mínima = altura do rótulo)',
      mover: 'Arraste um rótulo para reposicioná-lo dentro da folha',
      excluir: 'Clique no ponto que deseja remover',
      pan: 'Arraste para deslocar a visão · Ctrl+roda = zoom'
    }[S.ferramenta];
    $('sbHint').textContent = h || 'Ctrl + roda = zoom · roda = rolar · botão direito = menu rápido';
  }

  function setTool(name) {
    S.ferramenta = (S.ferramenta === name) ? null : name;
    ['tool-novo', 'tool-mover', 'tool-excluir', 'tool-pan'].forEach((c) => body.classList.remove(c));
    if (S.ferramenta) body.classList.add('tool-' + S.ferramenta);
    document.querySelectorAll('[data-toggle]').forEach((b) => {
      b.classList.toggle('on', b.dataset.action === S.ferramenta);
    });
    if (S.ferramenta !== 'novo') { preview = null; render(); }
    setHint();
    updateHUD();
  }

  const MODOS = { normal: 'MOSTRAR TUDO', solucao: 'VISUALIZAR SOLUÇÃO', colorido: 'SOLUÇÃO COLORIDO', grafo: 'DESENHAR GRAFO' };
  const MODOS_PT = { normal: 'Mostrar tudo', solucao: 'Visualizar Solução', colorido: 'Visualizar Solução - Colorido', grafo: 'Desenhar Grafo' };

  function setMode(m) {
    if (m === 'solucao') {
      if (!S.pontos.length) {
        toast('Primeiro você deve Montar/Carregar os Rótulo, em seguida carregar a Solução\ne só depois visualizar!', 'warn', 7000);
        return;
      }
    }
    if (m === 'colorido') {
      if (!S.pontos.length) {
        toast('Crie um novo conjunto de Rótulos ou Carregue de um Arquivo!', 'warn');
        return;
      }
      S.pontos.forEach((p) => { p.cor = G.randomCor(); });
    }
    S.modo = m;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    render(); updateHUD();
    log('Modo: ' + MODOS_PT[m] + '.', 'ok');
  }

  /* ===================== ARQUIVO ===================== */
  function pedirArquivo(accept, cb) {
    const fi = $('fileInput');
    fi.accept = accept;
    fi.value = '';
    fi.onchange = () => {
      const f = fi.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => cb(String(r.result), f.name);
      r.onerror = () => toast('Falha ao ler o arquivo.', 'err');
      r.readAsText(f);
    };
    fi.click();
  }

  function baixar(nome, texto) {
    const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function abrirRot(texto, nome) {
    let d;
    try { d = IO.parseRot(texto); }
    catch (err) { toast(err.message, 'err', 7000); log('Falha ao abrir ' + nome + ': ' + err.message, 'err'); return; }

    pushHistory();
    S.largura_folha = d.largura_folha;
    S.altura_folha = d.altura_folha;
    S.largura_rotulo = d.largura_rotulo;
    S.altura_rotulo = d.altura_rotulo;
    S.tam_fonte = d.tam_fonte || 8;
    S.pontos = d.pontos.map((q, i) => {
      const p = new G.Ponto(i, q.x1, q.y1, q.x2, q.y2, q.sel);
      p.fontSize = S.tam_fonte;
      p.cor = G.randomCor();
      return p;
    });
    S.arestas = null; S.segs = null; S.ultimoConflito = null; S.textoGrafo = null;
    if (S.modo === 'grafo') setMode('normal'); else render();
    applyCanvasSize(); updateHUD();
    toast('Arquivo carregado!\nClique em visualizar!', 'ok', 5000);
    log(nome + ' carregado — ' + S.pontos.length + ' pontos.', 'ok');
  }

  function salvarRot() {
    if (!S.pontos.length) { toast('Não há rótulos a serem salvos!', 'warn'); return; }
    const texto = IO.serializeRot({
      largura_folha: S.largura_folha, altura_folha: S.altura_folha,
      largura_rotulo: S.largura_rotulo, altura_rotulo: S.altura_rotulo,
      tam_fonte: S.tam_fonte, pontos: S.pontos
    });
    baixar('rotulos.rot', texto);
    toast('Sucesso!', 'ok');
    log('Arquivo .rot salvo (' + S.pontos.length + ' pontos).', 'ok');
  }

  function gerarConflitos() {
    if (!S.pontos.length) { toast('Não há rótulos para que gerar o Grafo de Conflitos!', 'warn'); return; }
    const t0 = performance.now();
    const res = G.gerarGrafoConflitos(S.pontos);
    const ms = Math.round(performance.now() - t0);

    // 1) gera EM TELA: arestas + modo "Desenhar Grafo"
    S.ultimoConflito = res.conflitos;
    S.textoGrafo = G.grafoParaTexto(res);
    S.arestas = G.adjParaArestas(res);
    recomputeSegments();
    S.modo = 'grafo';
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', false));
    render(); updateHUD();

    toast('Grafo de Conflitos gerado em tela!\n' + res.n + ' vértices · ' + res.conflitos +
          ' conflitos · ' + ms + ' ms', 'ok', 5500);
    log('Grafo gerado em tela: ' + res.n + ' vértices · ' + res.conflitos + ' conflitos · ' + ms + ' ms', 'ok');
    toast('Use "Salvar grafo" para exportar o arquivo .txt.', 'warn', 5500);
  }

  function salvarGrafo() {
    if (!S.textoGrafo) {
      toast('Nenhum grafo gerado ou carregado ainda!\nUse "Gerar conflitos" ou "Desenhar grafo".', 'warn', 5500);
      return;
    }
    baixar('grafo_conflitos.txt', S.textoGrafo);
    toast('Arquivo do grafo salvo!', 'ok');
    log('Arquivo .txt do grafo salvo.', 'ok');
  }

  function calcularConflitos() {
    if (!S.pontos.length) { toast('Não há rótulos para calcular conflitos!', 'warn'); return; }
    const t0 = performance.now();
    const res = G.gerarGrafoConflitos(S.pontos);
    S.ultimoConflito = res.conflitos;
    updateHUD();
    toast('Conflitos: ' + res.conflitos + '\nVértices: ' + res.n +
          '\nDensidade: ' + (res.n > 1 ? (100 * res.conflitos / (res.n * (res.n - 1) / 2)).toFixed(1) : '0') + '%',
          'ok', 6000);
    log('Cálculo: ' + res.conflitos + ' conflitos em ' + res.n + ' vértices (' +
        Math.round(performance.now() - t0) + ' ms).', 'ok');
  }

  function desenharGrafo(texto, nome) {
    if (!S.pontos.length) { toast('Carregue uma instância antes de executar esse comando!', 'err'); return; }
    let g;
    try { g = IO.parseGrafo(texto); }
    catch (err) { toast('Arquivo de grafo inválido.', 'err'); return; }
    const r = G.arestasParaSegmentos(g.arestas, S.pontos);
    S.arestas = g.arestas;
    S.segs = r.segs;
    S.textoGrafo = texto;
    S.ultimoConflito = (g.arestasHeader !== null && g.arestasHeader !== undefined)
      ? g.arestasHeader : r.segs.length;
    S.modo = 'grafo';
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', false));
    render(); updateHUD();
    toast('Grafo desenhado: ' + r.segs.length + ' arestas' +
          (r.invalidas ? ' (' + r.invalidas + ' ignoradas)' : '') + '.', 'ok');
    log(nome + ': ' + r.segs.length + ' arestas desenhadas.', 'ok');
  }

  function carregarSolucao(texto, nome) {
    if (!S.pontos.length) { toast('Carregue os Rótulos que gerou esse Grafo Primero!', 'err'); return; }
    let sol;
    try { sol = IO.parseSolucao(texto, S.pontos.length); }
    catch (err) {
      if (err.code === 'QTD') toast('O número de pontos rotulados na solução é diferente do número de pontos na tela!', 'err', 6500);
      else toast('Solução inválida: ' + err.message, 'err', 6500);
      log('Falha ao carregar solução.', 'err');
      return;
    }
    pushHistory();
    sol.selecoes.forEach((s, i) => { S.pontos[i].selecionado = s; });
    S.modo = 'solucao';
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'solucao'));
    render(); updateHUD();
    toast('Arquivo Carregado com sucesso!\nNúmero de Conflitos: ' + sol.numConflitos +
          '.\nNúmero de Rótulos em Conflito: ' + sol.numRotConflitos + '.', 'ok', 7000);
    log(nome + ' aplicado — ' + sol.numConflitos + ' conflitos.', 'ok');
    if (sol.foraFaixa) toast(sol.foraFaixa + ' valor(es) fora da faixa 1..4 foram ajustados.', 'warn', 6000);
  }

  /* ===================== GERAÇÃO ALEATÓRIA ===================== */
  function gerarAleatorios(qtd, adicionar) {
    if (!adicionar) S.pontos = [];
    const maxX = Math.floor(S.largura_folha - S.largura_rotulo) - 1;
    const maxY = Math.floor(S.altura_folha - S.altura_rotulo) - 1;
    if (maxX <= 0 || maxY <= 0) {
      toast('Folha pequena demais para o tamanho do rótulo configurado.', 'err');
      return;
    }
    for (let i = 0; i < qtd; i++) {
      const x = Math.floor(Math.random() * (maxX + 1));
      const y = Math.floor(Math.random() * (maxY + 1));
      const p = new G.Ponto(S.pontos.length, x, y, x + S.largura_rotulo, y + S.altura_rotulo, 0);
      p.fontSize = S.tam_fonte;
      p.cor = G.randomCor();
      S.pontos.push(p);
    }
    S.arestas = null; S.segs = null; S.ultimoConflito = null; S.textoGrafo = null;
    render(); updateHUD();
    toast(qtd + ' rótulo(s) gerado(s) — total: ' + S.pontos.length + '.', 'ok');
    log('Gerados ' + qtd + ' rótulos aleatórios' + (adicionar ? ' (acrescidos).' : ' (novo conjunto).'), 'ok');
  }

  /* ===================== EXPORTAR PNG ===================== */
  function exportPNG() {
    const off = document.createElement('canvas');
    off.width = S.largura_folha; off.height = S.altura_folha;
    const c = off.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, off.width, off.height);
    paint(c, { grade: false });
    const a = document.createElement('a');
    a.download = 'gerador_grafo_conflitos.png';
    a.href = off.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
    toast('Imagem PNG exportada!', 'ok');
    log('PNG exportado (' + S.largura_folha + '×' + S.altura_folha + ').', 'ok');
  }

  /* ===================== MAPA DE FUNDO ===================== */
  function carregarMapa(file) {
    if (!file) return;
    if (file.type && !/^image\//.test(file.type)) {
      toast('O mapa precisa ser uma imagem (PNG, JPG, WEBP, GIF...).', 'err');
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        S.mapa = { img: img, nome: file.name, w: img.naturalWidth, h: img.naturalHeight };
        render(); updateHUD();
        toast('Mapa carregado!\n' + file.name + ' — ' + img.naturalWidth + '×' + img.naturalHeight + ' px', 'ok', 5000);
        log('Mapa de fundo carregado: ' + file.name + ' (' + img.naturalWidth + '×' + img.naturalHeight + ').', 'ok');
      };
      img.onerror = () => toast('Não foi possível decodificar a imagem.', 'err');
      img.src = String(r.result);
    };
    r.onerror = () => toast('Falha ao ler a imagem.', 'err');
    r.readAsDataURL(file);
  }

  function removerMapa() {
    if (!S.mapa) { toast('Nenhum mapa de fundo carregado.', 'warn'); return; }
    const nome = S.mapa.nome;
    S.mapa = null;
    S.mapaOpacidade = 1;
    $('mapOpacity').value = 100;
    render(); updateHUD();
    toast('Mapa de fundo removido.', 'ok');
    log('Mapa removido: ' + nome + '.', 'warn');
  }

  function pedirMapa() {
    const mi = $('mapInput');
    mi.value = '';
    mi.click();
  }
  $('mapInput').addEventListener('change', () => {
    const f = $('mapInput').files && $('mapInput').files[0];
    if (f) carregarMapa(f);
  });
  $('mapOpacity').addEventListener('input', (e) => {
    S.mapaOpacidade = parseInt(e.target.value, 10) / 100;
    render();
  });
  $('btnMapaRemover').addEventListener('click', removerMapa);

  /* ===================== AÇÕES ===================== */
  const ACTIONS = {
    novo: () => setTool('novo'),
    mover: () => setTool('mover'),
    excluir: () => setTool('excluir'),
    pan: () => setTool('pan'),

    novoMapa() {
      if (!S.pontos.length && !S.arestas) { toast('A folha já está vazia.', 'warn'); return; }
      confirmar('Limpar todos os pontos da folha?', 'Novo mapa').then((ok) => {
        if (!ok) return;
        pushHistory();
        S.pontos = []; S.arestas = null; S.segs = null; S.ultimoConflito = null; S.textoGrafo = null;
        if (S.modo === 'grafo') setMode('normal');
        render(); updateHUD();
        toast('Novo mapa criado.', 'ok');
        log('Folha limpa.', 'warn');
      });
    },
    abrir: () => pedirArquivo('.rot', abrirRot),
    salvar: salvarRot,
    exemplo() {
      confirmar('Substituir o conteúdo atual pelo conjunto de exemplo?', 'Carregar exemplo').then((ok) => {
        if (!ok) return;
        abrirRot(EX.rot, 'exemplo.rot');
        setTimeout(() => desenharGrafo(EX.grafo, 'exemplo de grafo'), 60);
      });
    },

    gerarConflitos,
    salvarGrafo,
    statsConflitos: calcularConflitos,
    desenharGrafo: () => pedirArquivo('.txt', desenharGrafo),
    carregarSolucao: () => pedirArquivo('.txt,.sol,.solucao', carregarSolucao),

    mostrarTudo: () => setMode('normal'),
    visualizarSolucao: () => setMode('solucao'),
    visualizarColorido: () => setMode('colorido'),

    config: abrirConfig,
    aleatorios: abrirAleatorios,
    mapa: pedirMapa,
    mapaRemover: removerMapa,
    ajuda: () => openModal('modalAjuda'),
    export: exportPNG
  };

  /* Duplo clique rápido na mesma ferramenta (novo/mover/excluir/navegar):
     o 2º clique é ignorado — a ferramenta fica no estado do 1º clique,
     evitando que um duplo clique ligue e desligue na sequência.          */
  let lastToggle = { name: null, t: 0 };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const nome = el.dataset.action;
    if (el.dataset.toggle) {
      const agora = Date.now();
      if (lastToggle.name === nome && agora - lastToggle.t < 450) {
        lastToggle.t = agora;
        hideCtx();
        return;
      }
      lastToggle = { name: nome, t: agora };
    }
    const fn = ACTIONS[nome];
    if (fn) { e.preventDefault(); fn(el); }
    hideCtx();
  });

  /* ===================== CONFIGURAÇÕES ===================== */
  function abrirConfig() {
    $('cfgLargRot').value = S.largura_rotulo;
    $('cfgAltRot').value = S.altura_rotulo;
    $('cfgLargFolha').value = S.largura_folha;
    $('cfgAltFolha').value = S.altura_folha;
    $('cfgFonte').value = S.tam_fonte;
    $('cfgRaio').value = S.raio;
    $('cfgLinha').value = S.largura_linha;
    $('cfgMapaModo').value = S.mapaModo;
    $('cfgMapaOpacidade').value = Math.round(S.mapaOpacidade * 100);
    $('cfgMapaOpacVal').textContent = Math.round(S.mapaOpacidade * 100) + '%';
    $('cfgUpdLarg').checked = false;
    $('cfgUpdAlt').checked = false;
    openModal('modalConfig');
  }

  $('cfgMapaOpacidade').addEventListener('input', (e) => {
    $('cfgMapaOpacVal').textContent = e.target.value + '%';
  });

  $('cfgPadrao').addEventListener('click', () => {
    $('cfgAltFolha').value = 600;
    $('cfgAltRot').value = 30;
    $('cfgLargFolha').value = 800;
    $('cfgLargRot').value = 50;
    $('cfgMapaModo').value = 'cobrir';
    $('cfgMapaOpacidade').value = 100;
    $('cfgMapaOpacVal').textContent = '100%';
  });

  $('cfgOk').addEventListener('click', () => {
    const num = (id, def, min, max) => {
      let v = parseFloat($(id).value);
      if (!isFinite(v)) v = def;
      return clamp(v, min, max);
    };
    const lr = num('cfgLargRot', S.largura_rotulo, 1, 2048);
    const ar = num('cfgAltRot', S.altura_rotulo, 1, 2048);
    const lf = num('cfgLargFolha', S.largura_folha, 100, 2048);
    const af = num('cfgAltFolha', S.altura_folha, 100, 2048);
    const fo = Math.round(num('cfgFonte', S.tam_fonte, 1, 72));
    const ra = Math.round(num('cfgRaio', S.raio, 1, 40));
    const li = Math.round(num('cfgLinha', S.largura_linha, 1, 20));

    pushHistory();
    S.largura_rotulo = lr; S.altura_rotulo = ar;
    const updL = $('cfgUpdLarg').checked, updA = $('cfgUpdAlt').checked;
    if (updL || updA) {
      S.pontos.forEach((p) => {
        if (updL) p.setWidth(lr);
        if (updA) p.setHeight(ar);
      });
    }
    S.largura_folha = lf; S.altura_folha = af;
    S.tam_fonte = fo; S.raio = ra; S.largura_linha = li;
    S.mapaModo = $('cfgMapaModo').value;
    const novoAlpha = clamp(parseInt($('cfgMapaOpacidade').value, 10) / 100, 0.1, 1);
    if (novoAlpha !== S.mapaOpacidade) {
      S.mapaOpacidade = novoAlpha;
      $('mapOpacity').value = Math.round(novoAlpha * 100);
    }
    S.pontos.forEach((p) => { p.fontSize = fo; });
    recomputeSegments();
    closeModal();
    applyCanvasSize(); render(); updateHUD();
    toast('Configurações aplicadas.', 'ok');
    log('Configurações atualizadas.', 'ok');
  });

  /* ===================== RÓTULOS ALEATÓRIOS ===================== */
  function abrirAleatorios() {
    $('aleQtd').value = S.numero_de_aleatorios;
    $('aleAdicionar').checked = true;
    openModal('modalAleatorios');
  }
  $('aleOk').addEventListener('click', () => {
    let q = Math.round(parseFloat($('aleQtd').value));
    if (!isFinite(q) || q < 1) q = 1;
    q = clamp(q, 1, 100000);
    S.numero_de_aleatorios = q;
    const add = $('aleAdicionar').checked;
    closeModal();
    const before = serializeState();
    gerarAleatorios(q, add);
    commit(before);
  });

  /* ===================== ATUALIZAR HUD ===================== */
  function updateHUD() {
    const n = S.pontos.length;
    const temMapa = !!S.mapa;
    body.classList.toggle('has-data', n > 0 || temMapa);

    $('hudPontos').textContent = String(n).padStart(3, '0');
    $('hudRotulos').textContent = String(n * 4).padStart(4, '0');
    $('hudConflitos').textContent = S.ultimoConflito === null ? '—' : String(S.ultimoConflito);
    $('hudZoom').textContent = Math.round(S.zoom * 100) + '%';

    $('stPontos').textContent = n;
    $('stRotulos').textContent = n * 4;
    $('stConflitos').textContent = S.ultimoConflito === null ? '—' : S.ultimoConflito;
    $('stFolha').textContent = S.largura_folha + ' × ' + S.altura_folha;
    $('stRotulo').textContent = S.largura_rotulo + ' × ' + S.altura_rotulo;
    $('stFonte').textContent = S.tam_fonte + ' px';
    $('stRaio').textContent = S.raio + ' px';
    $('stLinha').textContent = S.largura_linha + ' px';
    $('stModo').textContent = MODOS_PT[S.modo];
    $('stFerramenta').textContent = { novo: 'Novo ponto', mover: 'Mover', excluir: 'Excluir', pan: 'Navegar' }[S.ferramenta] || 'Nenhuma';
    $('stZoom').textContent = Math.round(S.zoom * 100) + '%';
    $('stMapa').textContent = temMapa ? (S.mapa.w + ' × ' + S.mapa.h) : '—';
    $('stMapa').title = temMapa ? S.mapa.nome : '';
    $('stMapaModo').textContent = temMapa
      ? (MODOS_MAPA[S.mapaModo] || S.mapaModo) + ' · ' + Math.round(S.mapaOpacidade * 100) + '%'
      : '—';
    $('stGrafo').textContent = S.textoGrafo ? (S.segs ? S.segs.length + ' arestas' : 'gerado') : '—';
    $('stGrafo').title = S.textoGrafo ? 'Use "Salvar grafo" para exportar o .txt' : '';

    const eraHidden = $('mapBar').hidden;
    $('mapBar').hidden = !temMapa;
    if (temMapa) $('mapBar').title = 'Mapa: ' + S.mapa.nome + ' — α ' + Math.round(S.mapaOpacidade * 100) + '%';
    if (eraHidden !== $('mapBar').hidden) {
      /* força repaint da barra: sem isso o 1º botão (.seg) pode ser
         pintado vazio ao exibir a barra do mapa (artefato de composição) */
      const st = document.querySelector('.strip');
      st.style.opacity = '0.999'; void st.offsetHeight; st.style.opacity = '';
    }
    $('ctxMapaRemover').hidden = !temMapa;
    $('btnMapa').classList.toggle('on', temMapa);
    const vpM = $('vpMapa');
    vpM.hidden = !temMapa;
    if (temMapa) {
      $('vpMapaNome').textContent = 'MAPA: ' + S.mapa.nome;
      vpM.title = S.mapa.nome + ' — α ' + Math.round(S.mapaOpacidade * 100) + '%';
    }

    $('vpMode').textContent = MODOS[S.modo];
    $('vpTool').textContent = 'FERRAMENTA: ' + (S.ferramenta ? S.ferramenta.toUpperCase() : 'NENHUMA');
    $('vpSheet').textContent = S.largura_folha + ' × ' + S.altura_folha + ' px';
    $('sbModo').textContent = 'MODO: ' + MODOS[S.modo];

    $('barPontos').style.width = Math.min(100, n / 500 * 100) + '%';
    $('barRotulos').style.width = Math.min(100, n * 4 / 2000 * 100) + '%';
    const maxC = n > 1 ? (n * 4) * (n * 4 - 1) / 2 : 1;
    $('barConflitos').style.width =
      (S.ultimoConflito === null ? 0 : Math.min(100, Math.sqrt(S.ultimoConflito / maxC) * 100)) + '%';

    $('btnUndo').disabled = !undoStack.length;
    $('btnRedo').disabled = !redoStack.length;
  }

  /* ===================== MENU DE CONTEXTO ===================== */
  const ctxEl = $('ctxMenu');
  function showCtx(x, y) {
    ctxEl.hidden = false;
    const r = ctxEl.getBoundingClientRect();
    ctxEl.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
    ctxEl.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  }
  function hideCtx() { ctxEl.hidden = true; }
  viewport.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtx(e.clientX, e.clientY); });
  window.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctxMenu')) hideCtx(); }, true);
  window.addEventListener('blur', hideCtx);

  /* ===================== ARRASTAR E SOLTAR ===================== */
  let dragDepth = 0;
  viewport.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('dropHint').hidden = false; });
  viewport.addEventListener('dragover', (e) => { e.preventDefault(); });
  viewport.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropHint').hidden = true; } });
  viewport.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('dropHint').hidden = true;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (f.type && /^image\//.test(f.type)) { carregarMapa(f); return; }
    const r = new FileReader();
    r.onload = () => {
      const nome = f.name.toLowerCase();
      const txt = String(r.result);
      if (nome.endsWith('.rot')) abrirRot(txt, f.name);
      else if (nome.endsWith('.txt') || nome.endsWith('.sol') || nome.endsWith('.solucao')) {
        if (txt.indexOf('\n') > 0 && /^\s*\d+\s+\d+\s+0\s*$/m.test(txt)) desenharGrafo(txt, f.name);
        else carregarSolucao(txt, f.name);
      }
      else if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(nome)) carregarMapa(f);
      else toast('Formato não reconhecido: ' + f.name, 'err');
    };
    r.readAsText(f);
  });

  /* ===================== TECLADO ===================== */
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

    if (e.key === 'Escape') {
      if (!$('overlay').hidden) { closeModal(); return; }
      hideCtx();
      if (preview) { preview = null; render(); }
      if (S.ferramenta) setTool(S.ferramenta);
      return;
    }
    if (typing) return;

    if (e.key === ' ' && !spaceDown) {
      spaceDown = true;
      e.preventDefault();
      viewport.style.cursor = 'grab';
      return;
    }

    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === 's') { e.preventDefault(); salvarRot(); }
      else if (k === 'o') { e.preventDefault(); ACTIONS.abrir(); }
      else if (k === 'z') { e.preventDefault(); undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === '=' || k === '+') { e.preventDefault(); setZoom(S.zoom * 1.15); }
      else if (k === '-') { e.preventDefault(); setZoom(S.zoom / 1.15); }
      else if (k === '0') { e.preventDefault(); setZoom(1); }
      return;
    }

    switch (k) {
      case 'n': setTool('novo'); break;
      case 'm': setTool('mover'); break;
      case 'x': setTool('excluir'); break;
      case 'delete': case 'backspace': setTool('excluir'); break;
      case 'f': fit(); break;
      case '0': setZoom(1); break;
      case '=': case '+': setZoom(S.zoom * 1.15); break;
      case '-': setZoom(S.zoom / 1.15); break;
      case '1': setMode('normal'); break;
      case '2': setMode('solucao'); break;
      case '3': setMode('colorido'); break;
      case 'g': $('btnGrid').click(); break;
      case 'f1': e.preventDefault(); openModal('modalAjuda'); break;
      default: break;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; viewport.style.cursor = ''; }
  });

  /* ===================== CONTROLES DE ZOOM ===================== */
  $('btnZoomIn').addEventListener('click', () => setZoom(S.zoom * 1.2));
  $('btnZoomOut').addEventListener('click', () => setZoom(S.zoom / 1.2));
  $('btnZoom100').addEventListener('click', () => setZoom(1));
  $('btnFit').addEventListener('click', fit);
  $('zoomRange').addEventListener('input', (e) => setZoom(parseInt(e.target.value, 10) / 100));

  $('btnGrid').addEventListener('click', function () {
    S.grade = !S.grade;
    this.classList.toggle('on', S.grade);
    this.dataset.on = S.grade ? '1' : '';
    render();
    log('Grade ' + (S.grade ? 'ativada' : 'desativada') + '.');
  });

  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  $('btnExport').addEventListener('click', exportPNG);
  $('btnAjudaHeader').addEventListener('click', () => openModal('modalAjuda'));
  $('btnToggleSide').addEventListener('click', () => body.classList.toggle('side-open'));

  window.addEventListener('resize', () => { applyCanvasSize(); drawMinimap(); });

  /* ===================== INICIALIZAÇÃO ===================== */
  function init() {
    $('zoomRange').value = 100;
    setHint();
    applyCanvasSize();
    updateHUD();
    refreshHistory();
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'normal'));
    $('btnGrid').classList.add('on');
    render();
    drawMinimap();

    log('Sistema inicializado — folha 800×600.', 'ok');
    log('Dica: Ctrl + roda dá zoom; a roda comum rola a folha.');

    setTimeout(() => body.classList.remove('boot'), 900);
    setTimeout(() => fit(), 120);

    // link direto: index.html#exemplo carrega a demonstração
    if (location.hash === '#exemplo') {
      setTimeout(() => {
        abrirRot(EX.rot, 'exemplo.rot');
        setTimeout(() => desenharGrafo(EX.grafo, 'exemplo.grafo'), 100);
      }, 300);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
