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
      document.querySelectorAll('.dropdown').forEach(d => d.style.display = 'none');
      setTimeout(() => document.querySelectorAll('.dropdown').forEach(d => d.style.display = ''), 100);
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
    hideModals();
  });

  // Window resize handler
  window.addEventListener('resize', () => {
    canvasEng._resizeRenderer && canvasEng._resizeRenderer();
  });

})();
