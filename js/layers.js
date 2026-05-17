// Layer management
class LayerManager {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.layers = [];
    this.activeIdx = 0;
    this.frameCount = 1;
    this.listEl = document.getElementById('layers-list');
    this._idCounter = 0;

    this._bind();
    this.addLayer('Background');
  }

  _mkId() { return ++this._idCounter; }

  resize(w, h) {
    this.width = w; this.height = h;
    this.layers.forEach(l => {
      l.frames = l.frames.map(f => {
        const newId = new ImageData(w, h);
        // Copy old pixels (top-left anchored)
        for (let y = 0; y < Math.min(h, f.height); y++) {
          for (let x = 0; x < Math.min(w, f.width); x++) {
            const si = (y*f.width+x)*4, di = (y*w+x)*4;
            newId.data[di]=f.data[si]; newId.data[di+1]=f.data[si+1];
            newId.data[di+2]=f.data[si+2]; newId.data[di+3]=f.data[si+3];
          }
        }
        return newId;
      });
    });
    this.render();
  }

  addLayer(name) {
    name = name || `Layer ${this.layers.length + 1}`;
    const layer = {
      id: this._mkId(),
      name,
      visible: true,
      opacity: 100,
      locked: false,
      frames: Array.from({length: this.frameCount}, () => new ImageData(this.width, this.height))
    };
    this.layers.unshift(layer);
    this.activeIdx = 0;
    this.renderUI();
    return layer;
  }

  addFrame() {
    this.frameCount++;
    this.layers.forEach(l => {
      l.frames.push(new ImageData(this.width, this.height));
    });
  }

  dupFrame(frameIdx) {
    this.frameCount++;
    this.layers.forEach(l => {
      const clone = cloneImageData(l.frames[frameIdx]);
      l.frames.splice(frameIdx+1, 0, clone);
    });
  }

  delFrame(frameIdx) {
    if (this.frameCount <= 1) return;
    this.frameCount--;
    this.layers.forEach(l => l.frames.splice(frameIdx, 1));
  }

  dupLayer() {
    const src = this.layers[this.activeIdx];
    const dup = {
      id: this._mkId(),
      name: src.name + ' copy',
      visible: src.visible,
      opacity: src.opacity,
      locked: src.locked,
      frames: src.frames.map(f => cloneImageData(f))
    };
    this.layers.splice(this.activeIdx, 0, dup);
    this.renderUI();
  }

  delLayer() {
    if (this.layers.length <= 1) return;
    this.layers.splice(this.activeIdx, 1);
    this.activeIdx = Math.min(this.activeIdx, this.layers.length-1);
    this.renderUI();
  }

  mergeDown() {
    const topIdx = this.activeIdx;
    const botIdx = topIdx + 1;
    if (botIdx >= this.layers.length) return;
    const top = this.layers[topIdx];
    const bot = this.layers[botIdx];
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.width; tempCanvas.height = this.height;
    const ctx = tempCanvas.getContext('2d');
    // For each frame, composite top onto bottom
    for (let fi = 0; fi < this.frameCount; fi++) {
      ctx.clearRect(0,0,this.width,this.height);
      ctx.putImageData(bot.frames[fi], 0, 0);
      ctx.globalAlpha = top.opacity / 100;
      const tmpC = document.createElement('canvas');
      tmpC.width = this.width; tmpC.height = this.height;
      tmpC.getContext('2d').putImageData(top.frames[fi], 0, 0);
      ctx.drawImage(tmpC, 0, 0);
      ctx.globalAlpha = 1;
      bot.frames[fi] = ctx.getImageData(0, 0, this.width, this.height);
    }
    this.layers.splice(topIdx, 1);
    this.activeIdx = Math.max(0, topIdx - 1);
    this.renderUI();
  }

  // Get active layer's current frame ImageData
  getActiveFrame(frameIdx) {
    return this.layers[this.activeIdx]?.frames[frameIdx];
  }

  setActiveFrame(frameIdx, imageData) {
    if (this.layers[this.activeIdx]) {
      this.layers[this.activeIdx].frames[frameIdx] = imageData;
    }
  }

  // Composite all visible layers for a frame onto a canvas context
  composite(ctx, frameIdx) {
    ctx.clearRect(0, 0, this.width, this.height);
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i];
      if (!l.visible) continue;
      const tmp = document.createElement('canvas');
      tmp.width = this.width; tmp.height = this.height;
      tmp.getContext('2d').putImageData(l.frames[frameIdx], 0, 0);
      ctx.globalAlpha = l.opacity / 100;
      ctx.drawImage(tmp, 0, 0);
    }
    ctx.globalAlpha = 1;
  }

  renderUI() {
    this.listEl.innerHTML = '';
    this.layers.forEach((l, i) => {
      const item = document.createElement('div');
      item.className = 'layer-item' + (i === this.activeIdx ? ' active' : '');
      item.draggable = true;

      const thumb = document.createElement('canvas');
      thumb.className = 'layer-thumb';
      thumb.width = this.width; thumb.height = this.height;

      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = l.name;
      name.addEventListener('dblclick', e => {
        e.stopPropagation();
        const newName = prompt('Layer name:', l.name);
        if (newName) { l.name = newName; this.renderUI(); }
      });

      const vis = document.createElement('span');
      vis.className = 'layer-vis';
      vis.textContent = l.visible ? '👁' : '🚫';
      vis.addEventListener('click', e => {
        e.stopPropagation(); l.visible = !l.visible; this.renderUI();
        if (this._onChanged) this._onChanged();
      });

      item.appendChild(thumb);
      item.appendChild(name);
      item.appendChild(vis);

      item.addEventListener('click', () => {
        this.activeIdx = i;
        this.renderUI();
      });

      // Drag-to-reorder
      item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', i); });
      item.addEventListener('dragover', e => { e.preventDefault(); item.classList.add('drag-target'); });
      item.addEventListener('dragleave', () => item.classList.remove('drag-target'));
      item.addEventListener('drop', e => {
        e.preventDefault(); item.classList.remove('drag-target');
        const fromIdx = +e.dataTransfer.getData('text/plain');
        const [moved] = this.layers.splice(fromIdx, 1);
        this.layers.splice(i, 0, moved);
        this.activeIdx = i;
        this.renderUI(); if (this._onChanged) this._onChanged();
      });

      this.listEl.appendChild(item);
    });
  }

  // Update layer thumbnails for a specific frame
  updateThumbs(frameIdx) {
    const thumbs = this.listEl.querySelectorAll('.layer-thumb');
    this.layers.forEach((l, i) => {
      const thumb = thumbs[i];
      if (!thumb) return;
      const ctx = thumb.getContext('2d');
      ctx.clearRect(0, 0, thumb.width, thumb.height);
      ctx.putImageData(l.frames[frameIdx], 0, 0);
    });
  }

  _bind() {
    document.getElementById('add-layer').addEventListener('click', () => {
      this.addLayer(); if (this._onChanged) this._onChanged();
    });
    document.getElementById('dup-layer').addEventListener('click', () => {
      this.dupLayer(); if (this._onChanged) this._onChanged();
    });
    document.getElementById('del-layer').addEventListener('click', () => {
      this.delLayer(); if (this._onChanged) this._onChanged();
    });
    document.getElementById('merge-down').addEventListener('click', () => {
      this.mergeDown(); if (this._onChanged) this._onChanged();
    });
  }
}
