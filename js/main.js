// Main application orchestrator
(function() {
  'use strict';

  // Default sprite size
  let spriteW = 32, spriteH = 32;

  // Initialize all systems
  const history = new History(80);
  const layerMgr = new LayerManager(spriteW, spriteH);
  const timeline = new Timeline(layerMgr);
  const colorMgr = new ColorManager();
  const paletteM = new PaletteManager(colorMgr);
  const canvasEng = new CanvasEngine(layerMgr, timeline);
  const toolEng = new ToolEngine(colorMgr, layerMgr, timeline, canvasEng);
  const exporter = new Exporter(layerMgr, timeline);
  const model3D = typeof Model3DRenderer !== 'undefined' ? new Model3DRenderer() : null;

  // Wire up cross-references
  canvasEng._toolEngine = toolEng;
  canvasEng._onPaint = () => {
    history.push(layerMgr.layers);
    canvasEng.renderThumbs();
  };
  layerMgr._onChanged = () => {
    canvasEng.render();
    canvasEng.renderThumbs();
  };
  timeline._onFrameChange = (fi) => {
    canvasEng.render();
    canvasEng.renderThumbs();
    layerMgr.updateThumbs(fi);
  };

  // Wire import button in 3D renderer
  if (model3D) {
    document.getElementById('import-to-editor-btn').addEventListener('click', () => {
      model3D.importToEditor(layerMgr, timeline, canvasEng);
    });
  }

  // Push initial history state
  history.push(layerMgr.layers);
  layerMgr.renderUI();
  canvasEng.render();
  // Re-fit after layout is complete
  requestAnimationFrame(() => { canvasEng.fitToWindow(); canvasEng.render(); });

  // ===== CANVAS INPUT HANDLING =====
  const area = document.getElementById('canvas-area');
  let pointerDown = false;
  let pointerButton = 0;

  function onDown(e) {
    if (e.button === 1 || e.altKey) return; // pan handled by canvas engine
    pointerDown = true;
    pointerButton = e.button || 0;
    const pos = canvasEng.getPixelPos(e);
    toolEng.onDown(pos.x, pos.y, pointerButton);
    e.preventDefault();
  }

  function onMove(e) {
    const pos = canvasEng.getPixelPos(e);
    toolEng.onMove(pos.x, pos.y, pointerButton);
    e.preventDefault();
  }

  function onUp(e) {
    if (!pointerDown) return;
    pointerDown = false;
    const pos = canvasEng.getPixelPos(e);
    toolEng.onUp(pos.x, pos.y);
  }

  // Left and right click drawing; middle mouse and alt handled by CanvasEngine
  area.addEventListener('mousedown', e => {
    if (e.button === 0 || e.button === 2) onDown(e);
  });
  area.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  area.addEventListener('contextmenu', e => e.preventDefault());

  // Touch support
  area.addEventListener('touchstart', e => {
    e.preventDefault();
    pointerDown = true; pointerButton = 0;
    const pos = canvasEng.getPixelPos(e);
    toolEng.onDown(pos.x, pos.y, 0);
  }, { passive: false });
  area.addEventListener('touchmove', e => {
    e.preventDefault();
    const pos = canvasEng.getPixelPos(e);
    toolEng.onMove(pos.x, pos.y, 0);
  }, { passive: false });
  area.addEventListener('touchend', () => {
    pointerDown = false;
    toolEng.onUp(0, 0);
  });

  // ===== KEYBOARD SHORTCUTS =====
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'z') { e.preventDefault(); applyUndo(); return; }
    if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); applyRedo(); return; }
    if (ctrl && e.key === 's') { e.preventDefault(); exporter.exportPng(); return; }
    if (ctrl && e.key === 'c') { e.preventDefault(); copySelection(); return; }
    if (ctrl && e.key === 'x') { e.preventDefault(); copySelection(); deleteSelection(); return; }
    if (ctrl && e.key === 'v') { return; } // handled by the paste event below
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (toolEng.selection) { e.preventDefault(); deleteSelection(); return; }
    }
    if (e.key === 'Escape') { clearSelection(); return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); timeline.goTo(timeline.currentFrame - 1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); timeline.goTo(timeline.currentFrame + 1); return; }

    switch (e.key.toLowerCase()) {
      case 'p': activateTool('pencil'); break;
      case 'b': activateTool('brush'); break;
      case 'e': activateTool('eraser'); break;
      case 'f': activateTool('fill'); break;
      case 'i': activateTool('eyedropper'); break;
      case 'm': activateTool('select-rect'); break;
      case 'l': activateTool('select-lasso'); break;
      case 'v': activateTool('move'); break;
      case 'n': activateTool('line'); break;
      case 'r': activateTool('rect-shape'); break;
      case 'o': activateTool('ellipse'); break;
      case 'g': toggleGrid(); break;
      case 'x': colorMgr.swap(); break;
      case '+': case '=': canvasEng.setZoom(canvasEng.zoom + 1); break;
      case '-': canvasEng.setZoom(canvasEng.zoom - 1); break;
      case '0': canvasEng.fitToWindow(); break;
    }
  });

  function activateTool(tool) {
    const btn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
    if (btn) btn.click();
  }

  function toggleGrid() {
    canvasEng.showGrid = !canvasEng.showGrid;
    canvasEng._drawGrid();
  }

  function applyUndo() {
    const state = history.undo();
    if (!state) return;
    layerMgr.layers = state.map(l => ({
      id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, locked: false,
      frames: l.frames
    }));
    layerMgr.activeIdx = Math.min(layerMgr.activeIdx, layerMgr.layers.length-1);
    layerMgr.renderUI();
    canvasEng.render();
    canvasEng.renderThumbs();
  }

  function applyRedo() {
    const state = history.redo();
    if (!state) return;
    layerMgr.layers = state.map(l => ({
      id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, locked: false,
      frames: l.frames
    }));
    layerMgr.activeIdx = Math.min(layerMgr.activeIdx, layerMgr.layers.length-1);
    layerMgr.renderUI();
    canvasEng.render();
    canvasEng.renderThumbs();
  }

  // ===== SELECTION ACTIONS =====
  let _clipboard = null; // { imageData, w, h }

  function clearSelection() {
    toolEng.selection = null;
    toolEng._lassoPath = [];
    canvasEng.stopMarch();
    canvasEng.render();
  }

  function deleteSelection() {
    if (!toolEng.selection) return;
    const fi = timeline.currentFrame;
    const layer = layerMgr.getActiveFrame(fi);
    const { x, y, w, h } = toolEng.selection;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= layerMgr.width || py >= layerMgr.height) continue;
        const i = (py * layerMgr.width + px) * 4;
        layer.data[i] = layer.data[i+1] = layer.data[i+2] = layer.data[i+3] = 0;
      }
    }
    history.push(layerMgr.layers);
    canvasEng.render();
    canvasEng.renderThumbs();
  }

  function copySelection() {
    if (!toolEng.selection) return;
    const fi = timeline.currentFrame;
    const layer = layerMgr.getActiveFrame(fi);
    const { x, y, w, h } = toolEng.selection;
    const copy = new ImageData(w, h);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= layerMgr.width || py >= layerMgr.height) continue;
        const si = (py * layerMgr.width + px) * 4;
        const di = (dy * w + dx) * 4;
        copy.data[di]   = layer.data[si];
        copy.data[di+1] = layer.data[si+1];
        copy.data[di+2] = layer.data[si+2];
        copy.data[di+3] = layer.data[si+3];
      }
    }
    _clipboard = { imageData: copy, w, h };
  }

  function pasteSelection() {
    if (!_clipboard) return;
    const fi = timeline.currentFrame;
    const layer = layerMgr.getActiveFrame(fi);
    const { imageData, w, h } = _clipboard;
    // Paste at top-left of current selection, or (0,0)
    const ox = toolEng.selection ? toolEng.selection.x : 0;
    const oy = toolEng.selection ? toolEng.selection.y : 0;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const px = ox + dx, py = oy + dy;
        if (px < 0 || py < 0 || px >= layerMgr.width || py >= layerMgr.height) continue;
        const si = (dy * w + dx) * 4;
        const di = (py * layerMgr.width + px) * 4;
        layer.data[di]   = imageData.data[si];
        layer.data[di+1] = imageData.data[si+1];
        layer.data[di+2] = imageData.data[si+2];
        layer.data[di+3] = imageData.data[si+3];
      }
    }
    history.push(layerMgr.layers);
    canvasEng.render();
    canvasEng.renderThumbs();
  }

  // ===== SYSTEM CLIPBOARD PASTE =====
  document.addEventListener('paste', async e => {
    // Don't intercept paste inside text inputs
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          try {
            const bitmap = await createImageBitmap(blob);
            _pasteImageBitmap(bitmap);
          } catch (err) {
            console.error('Clipboard image decode failed', err);
          }
          return;
        }
      }
    }
    // No image in OS clipboard — fall back to internal app clipboard
    pasteSelection();
  });

  function _pasteImageBitmap(bitmap) {
    const cw = layerMgr.width;
    const ch = layerMgr.height;

    // Scale to fit canvas, preserving aspect ratio, centered
    const scale = Math.min(cw / bitmap.width, ch / bitmap.height);
    const dw = Math.round(bitmap.width  * scale);
    const dh = Math.round(bitmap.height * scale);
    const ox = Math.floor((cw - dw) / 2);
    const oy = Math.floor((ch - dh) / 2);

    const tmp = document.createElement('canvas');
    tmp.width = cw; tmp.height = ch;
    const ctx = tmp.getContext('2d');
    ctx.imageSmoothingEnabled = false; // nearest-neighbour for pixel art
    ctx.drawImage(bitmap, ox, oy, dw, dh);
    const pasted = ctx.getImageData(0, 0, cw, ch);

    const fi = timeline.currentFrame;
    const layer = layerMgr.getActiveFrame(fi);
    // Alpha-composite pasted image over current layer pixels
    for (let i = 0; i < pasted.data.length; i += 4) {
      const sa = pasted.data[i+3] / 255;
      if (sa === 0) continue;
      const da = layer.data[i+3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa < 0.001) { layer.data[i+3] = 0; continue; }
      layer.data[i]   = Math.round((pasted.data[i]   * sa + layer.data[i]   * da * (1 - sa)) / oa);
      layer.data[i+1] = Math.round((pasted.data[i+1] * sa + layer.data[i+1] * da * (1 - sa)) / oa);
      layer.data[i+2] = Math.round((pasted.data[i+2] * sa + layer.data[i+2] * da * (1 - sa)) / oa);
      layer.data[i+3] = Math.round(oa * 255);
    }
    layerMgr.setActiveFrame(fi, layer);
    history.push(layerMgr.layers);
    canvasEng.render();
    canvasEng.renderThumbs();
  }

  // ===== DROPDOWN MENUS (click-driven, works on touch) =====
  function closeAllMenus() {
    document.querySelectorAll('.menu-group.open').forEach(g => g.classList.remove('open'));
  }
  document.querySelectorAll('.menu-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const group = btn.closest('.menu-group');
      const wasOpen = group.classList.contains('open');
      closeAllMenus();
      if (!wasOpen) group.classList.add('open');
    });
  });
  document.addEventListener('click', () => closeAllMenus());
  document.addEventListener('touchstart', () => closeAllMenus(), { passive: true });

  // ===== CANVAS SIZE WIDGET =====
  function syncSizeInputs() {
    document.getElementById('quick-width').value = layerMgr.width;
    document.getElementById('quick-height').value = layerMgr.height;
  }
  function applyQuickResize() {
    const w = clamp(+document.getElementById('quick-width').value, 1, 4096);
    const h = clamp(+document.getElementById('quick-height').value, 1, 4096);
    layerMgr.resize(w, h);
    canvasEng.reinit(w, h);
    history.push(layerMgr.layers);
    canvasEng.render();
    syncSizeInputs();
  }
  document.getElementById('quick-resize').addEventListener('click', applyQuickResize);
  document.getElementById('quick-width').addEventListener('keydown', e => { if (e.key === 'Enter') applyQuickResize(); });
  document.getElementById('quick-height').addEventListener('keydown', e => { if (e.key === 'Enter') applyQuickResize(); });

  // ===== PANEL TABS =====
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(`panel-${tab.dataset.panel}`);
      if (panel) panel.classList.add('active');
    });
  });

  // ===== MAIN TABS (Editor / 3D) =====
  document.getElementById('tab-editor').addEventListener('click', () => {
    document.getElementById('tab-editor').classList.add('active');
    document.getElementById('tab-model').classList.remove('active');
    document.getElementById('editor-view').classList.add('active');
    document.getElementById('model-view').classList.remove('active');
    document.getElementById('timeline').style.display = '';
    // Re-fit and redraw after the view becomes visible
    requestAnimationFrame(() => { canvasEng.fitToWindow(); canvasEng.render(); });
  });
  document.getElementById('tab-model').addEventListener('click', () => {
    document.getElementById('tab-editor').classList.remove('active');
    document.getElementById('tab-model').classList.add('active');
    document.getElementById('editor-view').classList.remove('active');
    document.getElementById('model-view').classList.add('active');
    document.getElementById('timeline').style.display = 'none';
    if (model3D) model3D._resizeRenderer();
  });

  // ===== MENU ACTIONS =====
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      switch (action) {
        case 'new': showNewModal(); break;
        case 'open': document.getElementById('open-file-input').click(); break;
        case 'save-png': exporter.exportPng('sprite.png'); break;
        case 'save-spritesheet': exporter.exportSpritesheet('spritesheet.png'); break;
        case 'save-gif': exporter.exportGif('animation.gif'); break;
        case 'undo': applyUndo(); break;
        case 'redo': applyRedo(); break;
        case 'clear-layer': clearActiveLayer(); break;
        case 'flatten': flattenImage(); break;
        case 'toggle-grid': toggleGrid(); break;
        case 'zoom-fit': canvasEng.fitToWindow(); break;
        case 'zoom-100': canvasEng.setZoom(1); break;
        case 'resize-canvas': showResizeModal(); break;
        case 'flip-h': flipCanvas('h'); break;
        case 'flip-v': flipCanvas('v'); break;
        case 'rotate-90': rotateCanvas(); break;
      }
      closeAllMenus();
    });
  });

  // ===== OPEN FILE =====
  document.getElementById('open-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      layerMgr.resize(w, h);
      canvasEng.reinit(w, h);
      const imageData = exporter.importImage(img);
      layerMgr.layers[0].frames[0] = imageData;
      history.push(layerMgr.layers);
      layerMgr.renderUI();
      canvasEng.render();
      canvasEng.renderThumbs();
      syncSizeInputs();
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  });

  // ===== EDIT ACTIONS =====
  function clearActiveLayer() {
    const fi = timeline.currentFrame;
    const layer = layerMgr.getActiveFrame(fi);
    if (layer) layer.data.fill(0);
    history.push(layerMgr.layers);
    canvasEng.render();
    canvasEng.renderThumbs();
  }

  function flattenImage() {
    const flatCanvas = document.createElement('canvas');
    flatCanvas.width = layerMgr.width; flatCanvas.height = layerMgr.height;
    const ctx = flatCanvas.getContext('2d');
    const frames = [];
    for (let fi = 0; fi < timeline.frameCount; fi++) {
      ctx.clearRect(0, 0, layerMgr.width, layerMgr.height);
      layerMgr.composite(ctx, fi);
      frames.push(ctx.getImageData(0, 0, layerMgr.width, layerMgr.height));
    }
    layerMgr.layers = [{ id: layerMgr._mkId(), name: 'Merged', visible: true, opacity: 100, locked: false, frames }];
    layerMgr.activeIdx = 0;
    history.push(layerMgr.layers);
    layerMgr.renderUI();
    canvasEng.render();
  }

  function flipCanvas(dir) {
    const fi = timeline.currentFrame;
    layerMgr.layers.forEach(l => {
      const src = l.frames[fi];
      const dst = new ImageData(src.width, src.height);
      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          const tx = dir === 'h' ? src.width-1-x : x;
          const ty = dir === 'v' ? src.height-1-y : y;
          const si = (y*src.width+x)*4, di = (ty*src.width+tx)*4;
          dst.data[di]=src.data[si]; dst.data[di+1]=src.data[si+1];
          dst.data[di+2]=src.data[si+2]; dst.data[di+3]=src.data[si+3];
        }
      }
      l.frames[fi] = dst;
    });
    history.push(layerMgr.layers);
    canvasEng.render();
    canvasEng.renderThumbs();
  }

  function rotateCanvas() {
    const fi = timeline.currentFrame;
    const w = layerMgr.width, h = layerMgr.height;
    layerMgr.layers.forEach(l => {
      const src = l.frames[fi];
      const dst = new ImageData(h, w);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const si = (y*w+x)*4;
          const tx = h-1-y, ty = x;
          const di = (ty*h+tx)*4;
          dst.data[di]=src.data[si]; dst.data[di+1]=src.data[si+1];
          dst.data[di+2]=src.data[si+2]; dst.data[di+3]=src.data[si+3];
        }
      }
      l.frames[fi] = dst;
    });
    layerMgr.resize(h, w);
    canvasEng.reinit(h, w);
    history.push(layerMgr.layers);
    canvasEng.render();
    canvasEng.renderThumbs();
    syncSizeInputs();
  }

  // ===== MODALS =====
  function showNewModal() {
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('modal-new').classList.remove('hidden');
  }

  function showResizeModal() {
    document.getElementById('resize-width').value = layerMgr.width;
    document.getElementById('resize-height').value = layerMgr.height;
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('modal-resize').classList.remove('hidden');
  }

  function hideModals() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  }

  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) hideModals();
  });

  // New sprite modal
  document.getElementById('modal-new-cancel').addEventListener('click', hideModals);
  document.getElementById('modal-new-ok').addEventListener('click', () => {
    const w = clamp(+document.getElementById('new-width').value, 1, 4096);
    const h = clamp(+document.getElementById('new-height').value, 1, 4096);
    const bg = document.getElementById('new-bg').value;

    layerMgr.layers = [];
    layerMgr.activeIdx = 0;
    layerMgr.frameCount = 1;
    timeline.currentFrame = 0;
    timeline.frameDurations = [100];

    layerMgr.width = w; layerMgr.height = h;
    layerMgr.addLayer('Background');

    if (bg !== 'transparent') {
      const imageData = layerMgr.layers[0].frames[0];
      const color = bg === 'white' ? [255,255,255,255] : [0,0,0,255];
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i]=color[0]; imageData.data[i+1]=color[1];
        imageData.data[i+2]=color[2]; imageData.data[i+3]=color[3];
      }
    }

    canvasEng.reinit(w, h);
    history.push(layerMgr.layers);
    layerMgr.renderUI();
    canvasEng.render();
    timeline.render();
    syncSizeInputs();
    hideModals();
  });

  // New sprite preset buttons
  document.querySelectorAll('.preset-sizes button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('new-width').value = btn.dataset.w;
      document.getElementById('new-height').value = btn.dataset.h;
    });
  });

  // Resize modal
  document.getElementById('modal-resize-cancel').addEventListener('click', hideModals);
  document.getElementById('modal-resize-ok').addEventListener('click', () => {
    const w = clamp(+document.getElementById('resize-width').value, 1, 4096);
    const h = clamp(+document.getElementById('resize-height').value, 1, 4096);
    layerMgr.resize(w, h);
    canvasEng.reinit(w, h);
    history.push(layerMgr.layers);
    canvasEng.render();
    syncSizeInputs();
    hideModals();
  });

  // Window resize handler
  window.addEventListener('resize', () => {
    canvasEng._resizeRenderer && canvasEng._resizeRenderer();
  });

})();
