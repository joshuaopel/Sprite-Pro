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
      case 'brush':
        this._plotBrush(layer, x, y, useColor);
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
      case 'pencil':
      case 'brush': {
        const pts = bresenhamLine(this._prevX, this._prevY, x, y);
        pts.forEach(([px, py]) => this._plotBrush(layer, px, py, useColor));
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

  _plotBrush(imageData, cx, cy, color) {
    const sz = this.brushSize;
    const half = Math.floor(sz / 2);
    if (sz === 1) {
      this._plotPixel(imageData, cx, cy, color);
      return;
    }
    // Circle brush
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        if (dx*dx+dy*dy <= half*half) {
          this._plotPixel(imageData, cx+dx, cy+dy, color);
        }
      }
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
