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
    const w = this.W, h = this.H;
    const z = this.zoom;
    const pw = w*z, ph = h*z;
    [this.checker, this.layersCanvas, this.overlayCanvas, this.gridCanvas].forEach(c => {
      c.width = w; c.height = h;
      c.style.width = pw+'px'; c.style.height = ph+'px';
    });
    this.container.style.width = pw+'px';
    this.container.style.height = ph+'px';
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
    const w = this.W, h = this.H;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        ctx.fillStyle = ((x+y)%2===0) ? '#666' : '#555';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  _drawGrid() {
    const ctx = this.gridCanvas.getContext('2d');
    ctx.clearRect(0,0,this.W,this.H);
    if (!this.showGrid || this.zoom < 4) return;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1/this.zoom;
    // Draw at pixel boundaries
    for (let x = 0; x <= this.W; x++) {
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,this.H); ctx.stroke();
    }
    for (let y = 0; y <= this.H; y++) {
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(this.W,y); ctx.stroke();
    }
  }

  setZoom(z) {
    this.zoom = clamp(z, 1, 64);
    const pw = this.W*this.zoom, ph = this.H*this.zoom;
    [this.checker, this.layersCanvas, this.overlayCanvas, this.gridCanvas].forEach(c => {
      c.style.width = pw+'px'; c.style.height = ph+'px';
    });
    this.container.style.width = pw+'px';
    this.container.style.height = ph+'px';
    this._drawGrid();
    this.render();
    document.getElementById('zoom-indicator').textContent = this.zoom+'x';
  }

  render() {
    const ctx = this.layersCanvas.getContext('2d');
    const fi = this.timeline.currentFrame;
    // Onion skin (previous frame, translucent)
    if (this.timeline.onionSkin && fi > 0) {
      ctx.clearRect(0,0,this.W,this.H);
      const prev = fi - 1;
      this.layerMgr.layers.forEach(l => {
        if (!l.visible) return;
        const tmp = document.createElement('canvas');
        tmp.width = this.W; tmp.height = this.H;
        tmp.getContext('2d').putImageData(l.frames[prev],0,0);
        ctx.globalAlpha = 0.25;
        ctx.drawImage(tmp,0,0);
      });
      ctx.globalAlpha = 1;
    }
    this.layerMgr.composite(ctx, fi);
    this.renderOverlay();
  }

  renderOverlay() {
    const ctx = this.overlayCanvas.getContext('2d');
    ctx.clearRect(0,0,this.W,this.H);
    // Draw selection rectangle
    if (this._toolEngine && this._toolEngine.selection) {
      const { x, y, w, h } = this._toolEngine.selection;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1/this.zoom;
      ctx.setLineDash([2/this.zoom, 2/this.zoom]);
      ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.setLineDash([2/this.zoom, 2/this.zoom]);
      ctx.lineDashOffset = 2/this.zoom;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    // Draw lasso path
    if (this._toolEngine && this._toolEngine._lassoPath.length > 1) {
      ctx.beginPath();
      this._toolEngine._lassoPath.forEach(([px,py],i) => i===0?ctx.moveTo(px+0.5,py+0.5):ctx.lineTo(px+0.5,py+0.5));
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1/this.zoom;
      ctx.setLineDash([2/this.zoom,2/this.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  renderCursor(x, y, brushSize) {
    const ctx = this.overlayCanvas.getContext('2d');
    ctx.clearRect(0,0,this.W,this.H);
    this.renderOverlay();
    if (brushSize > 1) {
      const half = Math.floor(brushSize/2);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1/this.zoom;
      ctx.beginPath();
      ctx.arc(x+0.5, y+0.5, half, 0, Math.PI*2);
      ctx.stroke();
    }
  }

  renderThumbs() {
    this.layerMgr.updateThumbs(this.timeline.currentFrame);
    this.timeline.render();
  }

  // Get canvas-pixel coords from event
  getPixelPos(e) {
    const rect = this.layersCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clamp(Math.floor((clientX - rect.left) / this.zoom), 0, this.W-1),
      y: clamp(Math.floor((clientY - rect.top) / this.zoom), 0, this.H-1)
    };
  }

  _bind() {
    const area = this.area;

    // Mouse wheel: zoom
    area.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      this.setZoom(this.zoom + delta * Math.max(1, Math.floor(this.zoom/4)));
    }, { passive: false });

    // Pan with Space+drag or middle mouse
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

    // Zoom indicator
    const zi = document.createElement('div');
    zi.id = 'zoom-indicator';
    zi.textContent = this.zoom+'x';
    area.appendChild(zi);
  }

  fitToWindow() {
    this._fitZoom();
    this.panX = 0; this.panY = 0;
    this.setZoom(this.zoom);
    this._updateTransform();
  }
}
