/* =====================================================================
   io.js — formatos de arquivo (.rot, grafo .txt, solução)
   Leituras tolerantes a ',' ou '.' como separador decimal (o original
   usava float.Parse com a cultura do Windows).
   ===================================================================== */
(function (global) {
  'use strict';

  const CRLF = '\r\n';

  function linhas(texto) {
    return String(texto).replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  }

  /* número tolerante: aceita "30", "30.5", "30,5" */
  function parseNum(s) {
    if (s === null || s === undefined) return null;
    const t = String(s).trim();
    if (t === '') return null;
    const n = t.replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(n)) return null;
    const v = parseFloat(n);
    return isFinite(v) ? v : null;
  }

  /* =====================================================================
     .rot  —  rótulos
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
       x1 / y1 / x2 / y2 / selecionado   (por ponto)
       EOF
     ===================================================================== */
  function parseRot(texto) {
    const L = linhas(texto);
    const g = (i) => (L[i] !== undefined ? L[i].trim() : null);

    const cab = {
      largura_folha: parseNum(g(1)),
      altura_folha: parseNum(g(3)),
      largura_rotulo: parseNum(g(5)),
      altura_rotulo: parseNum(g(7)),
      tam_fonte: parseNum(g(9))
    };
    if (cab.largura_folha === null || cab.altura_folha === null) {
      throw new Error('Arquivo .rot inválido: cabeçalho não reconhecido.');
    }

    const pontos = [];
    let i = 10;
    while (i < L.length) {
      const marca = (L[i] || '').trim();
      if (marca.toUpperCase() === 'EOF') break;
      if (marca === '') { i++; continue; }

      const v = [];
      while (v.length < 5 && i < L.length) {
        const s = (L[i] || '').trim();
        i++;
        if (s.toUpperCase() === 'EOF') break;
        const n = parseNum(s);
        if (n === null) continue;      // pula marcadores "#0", "#1"...
        v.push(n);
      }
      if (v.length < 5) break;
      pontos.push({ x1: v[0], y1: v[1], x2: v[2], y2: v[3], sel: Math.round(v[4]) });
    }

    return {
      largura_folha: Math.round(cab.largura_folha),
      altura_folha: Math.round(cab.altura_folha),
      largura_rotulo: cab.largura_rotulo,
      altura_rotulo: cab.altura_rotulo,
      tam_fonte: Math.round(cab.tam_fonte || 8),
      pontos: pontos
    };
  }

  function fmtNum(v) {
    return (Number.isInteger(v) ? String(v) : String(v));
  }

  function serializeRot(s) {
    const o = [];
    o.push('#LARGURA DA FOLHA', fmtNum(s.largura_folha));
    o.push('#ALTURA DA FOLHA', fmtNum(s.altura_folha));
    o.push('#LARGURA DO ROTULO', fmtNum(s.largura_rotulo));
    o.push('#ALTURA DO ROTULO', fmtNum(s.altura_rotulo));
    o.push('#TAMANHO FONTE', fmtNum(s.tam_fonte));
    for (let i = 0; i < s.pontos.length; i++) {
      const p = s.pontos[i];
      o.push('#' + i);
      o.push(fmtNum(p.x));
      o.push(fmtNum(p.y));
      o.push(fmtNum(p.x + p.width));
      o.push(fmtNum(p.y + p.height));
      o.push(String(p.selecionado));
    }
    o.push('EOF');
    return o.join(CRLF);
  }

  /* =====================================================================
     Solução — sequência idêntica ao "Carregar Solução" original:
        linha 0  (ignorada)
        linha 1  → número de conflitos
        linha 2  (ignorada)
        linha 3  → número de rótulos em conflito
        linha 4  (ignorada)
        linhas 5.. → um vértice por ponto
     ===================================================================== */
  function parseSolucao(texto, numPontos) {
    const L = linhas(texto).map((s) => s.trim());
    let idx = 0, numConflitos = null, numRotConflitos = null;

    if (L.length >= 5) {
      const a = parseNum(L[1]), b = parseNum(L[3]);
      if (a !== null && b !== null) {
        numConflitos = a; numRotConflitos = b; idx = 5;
      }
    }

    const valores = [];
    for (; idx < L.length; idx++) {
      const n = parseNum(L[idx]);
      if (n !== null) valores.push(Math.round(n));
    }

    if (numConflitos === null) {
      // formato alternativo: todos os números em sequência
      if (valores.length < 2) throw new Error('Arquivo de solução não reconhecido.');
      numConflitos = valores.shift();
      numRotConflitos = valores.shift();
    }

    if (valores.length < numPontos) {
      const e = new Error('DIFERENTE');
      e.code = 'QTD';
      e.encontrados = valores.length;
      throw e;
    }

    const selecoes = [];
    let foraFaixa = 0;
    for (let i = 0; i < numPontos; i++) {
      const sel = (valores[i] - i * 4) - 1;
      if (sel < 0 || sel > 3) { foraFaixa++; selecoes.push(Math.min(3, Math.max(0, sel))); }
      else selecoes.push(sel);
    }

    return {
      numConflitos: numConflitos,
      numRotConflitos: numRotConflitos,
      selecoes: selecoes,
      extras: valores.length - numPontos,
      foraFaixa: foraFaixa
    };
  }

  /* =====================================================================
     Grafo (.txt) — 1ª linha é cabeçalho (ignorada); depois "v n1 n2 ..."
     ===================================================================== */
  function parseGrafo(texto) {
    const L = linhas(texto);
    const arestas = [];
    let vertices = 0;

    // 1ª linha não vazia é o cabeçalho: " <vértices> <arestas> 0"
    let arestasHeader = null, verticesHeader = null;
    for (let i = 0; i < L.length; i++) {
      const t = L[i].trim();
      if (!t) continue;
      const partes = t.split(/\s+/);
      if (partes.length >= 2) {
        const a = parseNum(partes[0]), b = parseNum(partes[1]);
        if (a !== null && b !== null) { verticesHeader = Math.round(a); arestasHeader = Math.round(b); }
      }
      break;
    }

    for (let i = 1; i < L.length; i++) {
      const partes = L[i].trim().split(/\s+/).filter((s) => s !== '');
      if (!partes.length) continue;
      const v = parseNum(partes[0]);
      if (v === null) continue;
      vertices = Math.max(vertices, Math.round(v));
      for (let j = 1; j < partes.length; j++) {
        const w = parseNum(partes[j]);
        if (w === null) continue;
        arestas.push([Math.round(v), Math.round(w)]);
      }
    }
    return { vertices: vertices, arestas: arestas, arestasHeader: arestasHeader, verticesHeader: verticesHeader };
  }

  /* Serializa a solução no mesmo layout lido por parseSolucao:
       linha 0  → rótulo (ignorada na leitura)
       linha 1  → número de conflitos
       linha 2  → rótulo (ignorada)
       linha 3  → número de rótulos em conflito
       linha 4  → rótulo (ignorada)
       linhas 5+ → um vértice (1-based: i*4 + quadrante + 1) por ponto   */
  function serializeSolucao(sol) {
    const out = [];
    out.push('Solucao Gulosa');
    out.push(String(sol.numConflitos));
    out.push('Rotulos em conflito:');
    out.push(String(sol.numRotConflitos));
    out.push('Vertices escolhidos:');
    for (let i = 0; i < sol.selecoes.length; i++) {
      out.push(String(i * 4 + sol.selecoes[i] + 1));
    }
    return out.join(CRLF);
  }

  global.GDCIO = { parseRot, serializeRot, parseSolucao, parseGrafo, serializeSolucao, grafoParaTexto: null, parseNum, linhas };
  global.GDCIO.grafoParaTexto = global.GDC ? global.GDC.grafoParaTexto : null;
})(typeof window !== 'undefined' ? window : globalThis);
