// Export functionality: PNG, spritesheet, GIF
class Exporter {
  constructor(layerMgr, timeline) {
    this.layerMgr = layerMgr;
    this.timeline = timeline;
  }

  // Export current frame as PNG
  exportPng(filename = 'sprite.png') {
    const canvas = document.createElement('canvas');
    canvas.width = this.layerMgr.width;
    canvas.height = this.layerMgr.height;
    const ctx = canvas.getContext('2d');
    this.layerMgr.composite(ctx, this.timeline.currentFrame);
    this._download(canvas, filename);
  }

  // Export all frames as horizontal spritesheet
  exportSpritesheet(filename = 'spritesheet.png') {
    const w = this.layerMgr.width;
    const h = this.layerMgr.height;
    const frames = this.timeline.frameCount;
    const canvas = document.createElement('canvas');
    canvas.width = w * frames;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    for (let fi = 0; fi < frames; fi++) {
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      this.layerMgr.composite(tmp.getContext('2d'), fi);
      ctx.drawImage(tmp, fi * w, 0);
    }
    this._download(canvas, filename);
  }

  // Export GIF (simple frame-by-frame using canvas)
  exportGif(filename = 'animation.gif') {
    const w = this.layerMgr.width;
    const h = this.layerMgr.height;
    const frames = this.timeline.frameCount;

    // Collect all frame canvases
    const frameCanvases = [];
    for (let fi = 0; fi < frames; fi++) {
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      this.layerMgr.composite(tmp.getContext('2d'), fi);
      frameCanvases.push({ canvas: tmp, delay: this.timeline.frameDurations[fi] || 100 });
    }

    // Use GIF.js if available, else fallback to spritesheet
    if (typeof GIF !== 'undefined') {
      const gif = new GIF({ workers: 2, quality: 10, width: w, height: h, transparent: 0x00000000 });
      frameCanvases.forEach(({ canvas, delay }) => gif.addFrame(canvas, { delay }));
      gif.on('finished', blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      gif.render();
    } else {
      // Fallback: export spritesheet with message
      alert('GIF export requires gif.js library. Exporting as spritesheet instead.');
      this.exportSpritesheet(filename.replace('.gif', '-spritesheet.png'));
    }
  }

  _download(canvas, filename) {
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  // Import image as new frame data
  importImage(img, layerMgr, timeline) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }
}
