// Canvas rendering engine: zoom, pan, grid, compositing
class CanvasEngine {
  constructor(layerMgr, timeline) {
    this.layerMgr = layerMgr;
    this.timeline = timeline;
    this.zoom = 8;
    this.panX = 0; this.panY = 0;
    this.showGrid = true;
    this._panning = false;
    this._panStart = null;
    this._onPaint = null;
    this._marchOffset = 0;
    this._marchRAF = null;

    this.area = document.getElementById('canvas-area');
    this.container = document.getElementById('canvas-container');
    this.checker = document.getElementById('canvas-checkerboard');
    this.layersCanvas = document.getElementById('canvas-layers');
    this.overlayCanvas = document.getElementById('canvas-overlay');
    this.gridCanvas = document.getElementById('canvas-grid');

    this._fitZoom();
    this._initCanvases();
    this._bind();
    this.render();
  }

  get W() { return this.layerMgr.width; }
  get H() { return this.layerMgr.height; }

  _fitZoom() {
    const areaW = this.area.clientWidth - 40;
    const areaH = this.area.clientHeight - 40;
    const zx = Math.floor(areaW / this.W);
    const zy = Math.floor(areaH / this.H);
    this.zoom = Math.max(1, Math.min(zx, zy, 32));
  }

  _initCanvases() {
    const w = this.W, h = this.H, z = this.zoom;
    const pw = w * z, ph = h * z;

    // Pixel-art canvases: sprite resolution, CSS-scaled with nearest-neighbour
    [this.checker, this.layersCanvas].forEach(c => {
      c.width = w; c.height = h;
      c.style.width = pw + 'px'; c.style.height = ph + 'px';
    });

    // Vector overlay canvases: screen resolution, no nearest-neighbour scaling
    [this.overlayCanvas, this.gridCanvas].forEach(c => {
      c.width = pw; c.height = ph;
      c.style.width = pw + 'px'; c.style.height = ph + 'px';
    });

    this.container.style.width = pw + 'px';
    this.container.style.height = ph + 'px';
    this.container.style.position = 'relative';
    this._drawChecker();
    this._drawGrid();
    this._updateTransform();
  }

  reinit(w, h) {
    this.layerMgr.width = w;
    this.layerMgr.height = h;
    this._fitZoom();
    this._initCanvases();
    this.render();
  }

  _updateTransform() {
    this.container.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
  }

  _drawChecker() {
    const ctx = this.checker.getContext('2d');
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        ctx.fillStyle = ((x + y) % 2 === 0) ? '#666' : '#555';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  _drawGrid() {
    const ctx = this.gridCanvas.getContext('2d');
    const pw = this.W * this.zoom, ph = this.H * this.zoom;
    ctx.clearRect(0, 0, pw, ph);
    if (!this.showGrid || this.zoom < 4) return;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= this.W; x++) {
      const sx = x * this.zoom + 0.5;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, ph); ctx.stroke();
    }
    for (let y = 0; y <= this.H; y++) {
      const sy = y * this.zoom + 0.5;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(pw, sy); ctx.stroke();
    }
  }

  setZoom(z) {
    this.zoom = clamp(z, 1, 64);
    const pw = this.W * this.zoom, ph = this.H * this.zoom;

    [this.checker, this.layersCanvas].forEach(c => {
      c.style.width = pw + 'px'; c.style.height = ph + 'px';
    });
    // Overlay/grid need their pixel dimensions updated too
    [this.overlayCanvas, this.gridCanvas].forEach(c => {
      c.width = pw; c.height = ph;
      c.style.width = pw + 'px'; c.style.height = ph + 'px';
    });

    this.container.style.width = pw + 'px';
    this.container.style.height = ph + 'px';
    this._drawGrid();
    this.render();
    document.getElementById('zoom-indicator').textContent = this.zoom + 'x';
  }

  _drawOnionFrame(ctx, frameIdx, tintColor, alpha) {
    const tmp = document.createElement('canvas');
    tmp.width = this.W; tmp.height = this.H;
    const tc = tmp.getContext('2d');
    this.layerMgr.composite(tc, frameIdx);
    // Tint non-transparent pixels with the specified color
    tc.globalCompositeOperation = 'source-atop';
    tc.fillStyle = tintColor;
    tc.fillRect(0, 0, this.W, this.H);
    tc.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.drawImage(tmp, 0, 0);
    ctx.globalAlpha = 1;
  }

  render() {
    const ctx = this.layersCanvas.getContext('2d');
    const fi = this.timeline.currentFrame;
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.timeline.onionSkin) {
      const depth = this.timeline.onionDepth || 1;
      const fc = this.layerMgr.frameCount;
      // Previous frames: blue tint, fading with distance
      for (let d = Math.min(depth, fi); d >= 1; d--) {
        const alpha = 0.3 / d;
        this._drawOnionFrame(ctx, fi - d, 'rgba(80,140,255,0.6)', alpha);
      }
      // Next frames: orange tint, fading with distance
      for (let d = 1; d <= depth && fi + d < fc; d++) {
        const alpha = 0.3 / d;
        this._drawOnionFrame(ctx, fi + d, 'rgba(255,140,60,0.6)', alpha);
      }
    }
    this.layerMgr.composite(ctx, fi);
    this.renderOverlay();
  }

  // ── Overlay (drawn in screen pixels) ──────────────────────────────────────
  renderOverlay() {
    const ctx = this.overlayCanvas.getContext('2d');
    const z = this.zoom;
    const pw = this.W * z, ph = this.H * z;
    ctx.clearRect(0, 0, pw, ph);

    const te = this._toolEngine;

    // Selection rectangle — marching ants
    if (te && te.selection) {
      const { x, y, w, h } = te.selection;
      const sx = x * z, sy = y * z, sw = w * z, sh = h * z;
      const off = this._marchOffset;

      ctx.lineWidth = 1.5;
      // White layer
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -off;
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
      // Black layer offset by half a dash cycle
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineDashOffset = -off + 5;
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    // Lasso path
    if (te && te._lassoPath.length > 1) {
      ctx.beginPath();
      te._lassoPath.forEach(([px, py], i) => {
        i === 0 ? ctx.moveTo((px + 0.5) * z, (py + 0.5) * z)
                : ctx.lineTo((px + 0.5) * z, (py + 0.5) * z);
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -this._marchOffset;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
  }

  renderCursor(x, y, brushSize) {
    const ctx = this.overlayCanvas.getContext('2d');
    const z = this.zoom;
    ctx.clearRect(0, 0, this.W * z, this.H * z);
    this.renderOverlay();
    if (brushSize > 1) {
      const half = Math.floor(brushSize / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc((x + 0.5) * z, (y + 0.5) * z, half * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc((x + 0.5) * z, (y + 0.5) * z, half * z, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Start/stop marching ants animation
  startMarch() {
    if (this._marchRAF) return;
    const tick = () => {
      this._marchOffset = (this._marchOffset + 0.4) % 10;
      this.renderOverlay();
      this._marchRAF = requestAnimationFrame(tick);
    };
    this._marchRAF = requestAnimationFrame(tick);
  }

  stopMarch() {
    if (this._marchRAF) { cancelAnimationFrame(this._marchRAF); this._marchRAF = null; }
    this._marchOffset = 0;
  }

  renderThumbs() {
    this.layerMgr.updateThumbs(this.timeline.currentFrame);
    this.timeline.render();
  }

  getPixelPos(e) {
    const rect = this.layersCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clamp(Math.floor((clientX - rect.left) / this.zoom), 0, this.W - 1),
      y: clamp(Math.floor((clientY - rect.top) / this.zoom), 0, this.H - 1)
    };
  }

  _bind() {
    const area = this.area;

    area.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      this.setZoom(this.zoom + delta * Math.max(1, Math.floor(this.zoom / 4)));
    }, { passive: false });

    area.addEventListener('mousedown', e => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this._panning = true;
        this._panStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
        area.style.cursor = 'grab';
      }
    });
    window.addEventListener('mousemove', e => {
      if (this._panning) {
        this.panX = e.clientX - this._panStart.x;
        this.panY = e.clientY - this._panStart.y;
        this._updateTransform();
      }
    });
    window.addEventListener('mouseup', e => {
      if (this._panning && (e.button === 1 || e.button === 0)) {
        this._panning = false;
        area.style.cursor = '';
      }
    });

    const zi = document.createElement('div');
    zi.id = 'zoom-indicator';
    zi.textContent = this.zoom + 'x';
    area.appendChild(zi);
  }

  fitToWindow() {
    this._fitZoom();
    this.panX = 0; this.panY = 0;
    this.setZoom(this.zoom);
    this._updateTransform();
  }
}
