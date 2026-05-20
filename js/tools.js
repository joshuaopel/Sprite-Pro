// All drawing tools
class ToolEngine {
  constructor(colorMgr, layerMgr, timeline, canvasEngine) {
    this.colorMgr = colorMgr;
    this.layerMgr = layerMgr;
    this.timeline = timeline;
    this.canvas = canvasEngine;
    this.currentTool = 'pencil';
    this.brushSize = 1;

    this._drawing = false;
    this._startX = 0; this._startY = 0;
    this._prevX = null; this._prevY = null;
    this._previewImageData = null; // Saved state before shape preview
    this.selection = null; // {x,y,w,h}
    this._selectionStart = null;
    this._moveOrigin = null;
    this._moveCopy = null;
    this._lassoPath = [];

    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTool = btn.dataset.tool;
        document.getElementById('canvas-area').dataset.tool = this.currentTool;
        const isSelect = this.currentTool === 'select-rect' || this.currentTool === 'select-lasso';
        if (!isSelect) { this.selection = null; this.canvas.stopMarch(); }
        this._lassoPath = [];
        // Show/hide context panels
        document.getElementById('corner-radius-section').style.display =
          this.currentTool === 'rect-shape' ? '' : 'none';
        document.getElementById('selection-actions').style.display =
          isSelect ? '' : 'none';
        this.canvas.render();
      });
    });

    const brushSz = document.getElementById('brush-size');
    const brushVal = document.getElementById('brush-size-val');
    brushSz.addEventListener('input', () => {
      this.brushSize = +brushSz.value;
      brushVal.textContent = this.brushSize;
    });

    const radSz = document.getElementById('corner-radius');
    const radVal = document.getElementById('corner-radius-val');
    radSz.addEventListener('input', () => { radVal.textContent = radSz.value; });

    document.getElementById('sel-deselect').addEventListener('click', () => {
      this.selection = null;
      this.canvas.stopMarch();
      this.canvas.render();
    });

    document.getElementById('canvas-area').dataset.tool = this.currentTool;
  }

  // Main entry: pointer down
  onDown(x, y, button) {
    this._drawing = true;
    this._startX = x; this._startY = y;
    this._prevX = x; this._prevY = y;

    const useColor = button === 2 ? this.colorMgr.bgRgba : this.colorMgr.fgRgba;
    const fi = this.timeline.currentFrame;
    const layer = this.layerMgr.getActiveFrame(fi);

    switch (this.currentTool) {
      case 'pencil':
        this._plotBrush(layer, x, y, useColor, false);
        this.layerMgr.setActiveFrame(fi, layer);
        this.canvas.render();
        break;
      case 'brush':
        this._plotBrush(layer, x, y, useColor, true);
        this.layerMgr.setActiveFrame(fi, layer);
        this.canvas.render();
        break;
      case 'painterly':
        this._plotPainterly(layer, x, y, useColor);
        this.layerMgr.setActiveFrame(fi, layer);
        this.canvas.render();
        break;
      case 'eraser':
        this._erase(layer, x, y);
        this.canvas.render();
        break;
      case 'fill':
        floodFill(layer, x, y, useColor);
        this.canvas.render();
        this._onPaint();
        break;
      case 'eyedropper':
        this._pickColor(layer, x, y);
        this._drawing = false;
        break;
      case 'line':
      case 'rect-shape':
      case 'ellipse':
        this._previewImageData = cloneImageData(layer);
        break;
      case 'select-rect':
        this._selectionStart = { x, y };
        this.selection = null;
        this.canvas.render();
        break;
      case 'select-lasso':
        this._lassoPath = [[x,y]];
        break;
      case 'move':
        this._startMove(x, y, fi);
        break;
    }
  }

  // Main entry: pointer move
  onMove(x, y, button) {
    if (!this._drawing) {
      this.canvas.renderCursor(x, y, this.brushSize);
      return;
    }
    const fi = this.timeline.currentFrame;
    const layer = this.layerMgr.getActiveFrame(fi);
    const useColor = button === 2 ? this.colorMgr.bgRgba : this.colorMgr.fgRgba;

    switch (this.currentTool) {
      case 'pencil': {
        const pts = bresenhamLine(this._prevX, this._prevY, x, y);
        pts.forEach(([px, py]) => this._plotBrush(layer, px, py, useColor, false));
        this.canvas.render();
        break;
      }
      case 'brush': {
        const pts = bresenhamLine(this._prevX, this._prevY, x, y);
        pts.forEach(([px, py]) => this._plotBrush(layer, px, py, useColor, true));
        this.canvas.render();
        break;
      }
      case 'painterly': {
        const pts = bresenhamLine(this._prevX, this._prevY, x, y);
        pts.forEach(([px, py]) => this._plotPainterly(layer, px, py, useColor));
        this.canvas.render();
        break;
      }
      case 'eraser': {
        const pts = bresenhamLine(this._prevX, this._prevY, x, y);
        pts.forEach(([px, py]) => this._erase(layer, px, py));
        this.canvas.render();
        break;
      }
      case 'line': {
        const preview = cloneImageData(this._previewImageData);
        const pts = bresenhamLine(this._startX, this._startY, x, y);
        pts.forEach(([px, py]) => this._plotBrush(preview, px, py, useColor));
        this.layerMgr.setActiveFrame(fi, preview);
        this.canvas.render();
        break;
      }
      case 'rect-shape': {
        const preview = cloneImageData(this._previewImageData);
        const r = +(document.getElementById('corner-radius').value || 0);
        const pts = r > 0
          ? roundedRectPixels(this._startX, this._startY, x, y, r)
          : rectOutlinePixels(this._startX, this._startY, x, y);
        pts.forEach(([px, py]) => this._plotPixel(preview, px, py, useColor));
        this.layerMgr.setActiveFrame(fi, preview);
        this.canvas.render();
        break;
      }
      case 'ellipse': {
        const preview = cloneImageData(this._previewImageData);
        const cx = Math.round((this._startX+x)/2), cy = Math.round((this._startY+y)/2);
        const rx = Math.abs(x-this._startX)/2, ry = Math.abs(y-this._startY)/2;
        const pts = ellipsePixels(cx, cy, rx, ry);
        pts.forEach(([px, py]) => this._plotPixel(preview, px, py, useColor));
        this.layerMgr.setActiveFrame(fi, preview);
        this.canvas.render();
        break;
      }
      case 'select-rect':
        this.selection = {
          x: Math.min(this._selectionStart.x, x),
          y: Math.min(this._selectionStart.y, y),
          w: Math.abs(x - this._selectionStart.x) + 1,
          h: Math.abs(y - this._selectionStart.y) + 1
        };
        this.canvas.render();
        break;
      case 'select-lasso':
        this._lassoPath.push([x,y]);
        this.canvas.render();
        break;
      case 'move':
        this._doMove(x, y, fi);
        this.canvas.render();
        break;
    }

    this._prevX = x; this._prevY = y;
  }

  // Main entry: pointer up
  onUp(x, y) {
    if (!this._drawing) return;
    this._drawing = false;
    const fi = this.timeline.currentFrame;

    switch (this.currentTool) {
      case 'pencil':
      case 'brush':
      case 'painterly':
      case 'eraser':
        this._onPaint();
        break;
      case 'line':
      case 'rect-shape':
      case 'ellipse':
        this._previewImageData = null;
        this._onPaint();
        break;
      case 'select-rect':
        if (this.selection) this.canvas.startMarch();
        break;
      case 'select-lasso':
        if (this._lassoPath.length > 2) {
          this._lassoPath.push(this._lassoPath[0]);
          this.canvas.render();
          this.canvas.startMarch();
        }
        break;
      case 'move':
        this._moveCopy = null;
        this._moveOrigin = null;
        this._onPaint();
        break;
    }
    this._prevX = null; this._prevY = null;
    this.canvas.renderThumbs();
  }

  _plotPixel(imageData, x, y, color) {
    const { data, width, height } = imageData;
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    // Alpha compositing
    const [r,g,b,a] = color;
    const alpha = a / 255;
    const bg_a = data[i+3] / 255;
    const out_a = alpha + bg_a * (1 - alpha);
    if (out_a < 0.001) { data[i+3]=0; return; }
    data[i]   = Math.round((r*alpha + data[i]  *bg_a*(1-alpha))/out_a);
    data[i+1] = Math.round((g*alpha + data[i+1]*bg_a*(1-alpha))/out_a);
    data[i+2] = Math.round((b*alpha + data[i+2]*bg_a*(1-alpha))/out_a);
    data[i+3] = Math.round(out_a*255);
  }

  _plotBrush(imageData, cx, cy, color, feather = false) {
    const sz = this.brushSize;
    const half = Math.floor(sz / 2);
    if (sz === 1) {
      this._plotPixel(imageData, cx, cy, color);
      return;
    }
    const r2 = half * half;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const d2 = dx*dx + dy*dy;
        if (d2 > r2) continue;
        if (feather && half > 1) {
          // Smooth cosine falloff from center to edge
          const t = Math.sqrt(d2) / half;
          const a = Math.round(color[3] * (0.5 + 0.5 * Math.cos(t * Math.PI)));
          this._plotPixel(imageData, cx+dx, cy+dy, [color[0], color[1], color[2], a]);
        } else {
          this._plotPixel(imageData, cx+dx, cy+dy, color);
        }
      }
    }
  }

  // Painterly brush: scatters bristle-like dabs with subtle color/opacity variation
  _plotPainterly(imageData, cx, cy, color) {
    const sz = this.brushSize;
    const half = Math.max(Math.floor(sz / 2), 1);
    const [r, g, b, a] = color;
    // Number of dabs scales with brush area
    const dabs = Math.max(4, Math.round(half * half * 1.5));
    for (let i = 0; i < dabs; i++) {
      // Random position within a slightly elongated ellipse (bristle spread)
      const angle = Math.random() * Math.PI * 2;
      const dist  = Math.random() * half;
      const px = Math.round(cx + dist * Math.cos(angle));
      const py = Math.round(cy + dist * Math.sin(angle) * 0.7);
      // Slight hue-shift via RGB channel jitter (±10%)
      const jitter = () => Math.round((Math.random() - 0.5) * 25);
      const cr = Math.min(255, Math.max(0, r + jitter()));
      const cg = Math.min(255, Math.max(0, g + jitter()));
      const cb = Math.min(255, Math.max(0, b + jitter()));
      // Opacity varies per dab (40–100% of stroke alpha)
      const ca = Math.round(a * (0.4 + Math.random() * 0.6));
      this._plotPixel(imageData, px, py, [cr, cg, cb, ca]);
    }
  }

  _erase(imageData, cx, cy) {
    const { data, width, height } = imageData;
    const sz = this.brushSize;
    const half = Math.floor(sz / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        if (sz > 1 && dx*dx+dy*dy > half*half) continue;
        const x = cx+dx, y = cy+dy;
        if (x<0||y<0||x>=width||y>=height) continue;
        const i = (y*width+x)*4;
        data[i]=data[i+1]=data[i+2]=data[i+3]=0;
      }
    }
  }

  _pickColor(imageData, x, y) {
    const { data, width, height } = imageData;
    if (x<0||y<0||x>=width||y>=height) return;
    const i = (y*width+x)*4;
    this.colorMgr.setFromRgb(data[i], data[i+1], data[i+2], data[i+3]);
  }

  _startMove(x, y, fi) {
    const layer = this.layerMgr.getActiveFrame(fi);
    this._moveCopy = cloneImageData(layer);
    this._moveOrigin = { x, y };
    if (this.selection) {
      // Only move selection content
    }
  }

  _doMove(x, y, fi) {
    if (!this._moveCopy || !this._moveOrigin) return;
    const dx = x - this._moveOrigin.x, dy = y - this._moveOrigin.y;
    const src = this._moveCopy;
    const { width, height } = src;
    const dst = new ImageData(width, height);
    for (let sy = 0; sy < height; sy++) {
      for (let sx = 0; sx < width; sx++) {
        const tx = sx+dx, ty = sy+dy;
        if (tx<0||ty<0||tx>=width||ty>=height) continue;
        const si = (sy*width+sx)*4, di = (ty*width+tx)*4;
        dst.data[di]=src.data[si]; dst.data[di+1]=src.data[si+1];
        dst.data[di+2]=src.data[si+2]; dst.data[di+3]=src.data[si+3];
      }
    }
    this.layerMgr.setActiveFrame(fi, dst);
  }

  _onPaint() {
    if (this.canvas._onPaint) this.canvas._onPaint();
  }
}
