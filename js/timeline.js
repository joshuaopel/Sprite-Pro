// Animation timeline / frame manager
class Timeline {
  constructor(layerMgr) {
    this.layerMgr = layerMgr;
    this.currentFrame = 0;
    this.fps = 12;
    this.loop = true;
    this.playing = false;
    this.onionSkin = false;
    this.frameDurations = [100]; // ms per frame
    this._rafId = null;
    this._lastTime = 0;
    this._elapsed = 0;

    this.track = document.getElementById('frames-track');
    this.playBtn = document.getElementById('tl-play');

    this._bind();
    this.render();
  }

  get frameCount() { return this.layerMgr.frameCount; }

  addFrame() {
    this.layerMgr.addFrame();
    this.frameDurations.push(Math.round(1000/this.fps));
    this.currentFrame = this.frameCount - 1;
    this.render(); this._onChange();
  }

  dupFrame() {
    const fi = this.currentFrame;
    this.layerMgr.dupFrame(fi);
    this.frameDurations.splice(fi+1, 0, this.frameDurations[fi]);
    this.currentFrame = fi+1;
    this.render(); this._onChange();
  }

  delFrame() {
    if (this.frameCount <= 1) return;
    const fi = this.currentFrame;
    this.layerMgr.delFrame(fi);
    this.frameDurations.splice(fi, 1);
    this.currentFrame = Math.min(fi, this.frameCount-1);
    this.render(); this._onChange();
  }

  goTo(fi) {
    this.currentFrame = clamp(fi, 0, this.frameCount-1);
    this._onChange();
    this.render();
  }

  play() {
    this.playing = true;
    this.playBtn.textContent = '⏸';
    this._lastTime = performance.now();
    this._elapsed = 0;
    this._tick();
  }

  pause() {
    this.playing = false;
    this.playBtn.textContent = '▶';
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  _tick() {
    const now = performance.now();
    this._elapsed += now - this._lastTime;
    this._lastTime = now;
    const dur = this.frameDurations[this.currentFrame] || Math.round(1000/this.fps);
    if (this._elapsed >= dur) {
      this._elapsed -= dur;
      let next = this.currentFrame + 1;
      if (next >= this.frameCount) {
        if (this.loop) next = 0;
        else { this.pause(); return; }
      }
      this.currentFrame = next;
      this._onChange();
      this.render();
    }
    this._rafId = requestAnimationFrame(() => this._tick());
  }

  _onChange() {
    if (this._onFrameChange) this._onFrameChange(this.currentFrame);
  }

  render() {
    this.track.innerHTML = '';
    for (let i = 0; i < this.frameCount; i++) {
      const thumb = document.createElement('div');
      thumb.className = 'frame-thumb' + (i === this.currentFrame ? ' active' : '');

      const canvas = document.createElement('canvas');
      canvas.width = this.layerMgr.width;
      canvas.height = this.layerMgr.height;
      const ctx = canvas.getContext('2d');
      this.layerMgr.composite(ctx, i);
      thumb.appendChild(canvas);

      const dur = document.createElement('span');
      dur.className = 'frame-dur';
      dur.textContent = (this.frameDurations[i] || Math.round(1000/this.fps)) + 'ms';
      dur.addEventListener('click', e => {
        e.stopPropagation();
        const v = prompt('Frame duration (ms):', this.frameDurations[i]);
        if (v !== null) { this.frameDurations[i] = clamp(+v, 1, 60000); this.render(); }
      });
      thumb.appendChild(dur);

      thumb.addEventListener('click', () => this.goTo(i));

      // Context menu for frame options
      thumb.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.goTo(i);
      });

      this.track.appendChild(thumb);
    }
  }

  _bind() {
    document.getElementById('tl-play').addEventListener('click', () => {
      this.playing ? this.pause() : this.play();
    });
    document.getElementById('tl-first').addEventListener('click', () => this.goTo(0));
    document.getElementById('tl-prev').addEventListener('click', () => this.goTo(this.currentFrame-1));
    document.getElementById('tl-next').addEventListener('click', () => this.goTo(this.currentFrame+1));
    document.getElementById('tl-last').addEventListener('click', () => this.goTo(this.frameCount-1));

    document.getElementById('tl-add-frame').addEventListener('click', () => this.addFrame());
    document.getElementById('tl-dup-frame').addEventListener('click', () => this.dupFrame());
    document.getElementById('tl-del-frame').addEventListener('click', () => this.delFrame());

    document.getElementById('tl-fps').addEventListener('input', e => {
      this.fps = clamp(+e.target.value, 1, 60);
    });
    document.getElementById('tl-loop').addEventListener('change', e => {
      this.loop = e.target.checked;
    });
    document.getElementById('tl-onion').addEventListener('change', e => {
      this.onionSkin = e.target.checked;
      this._onChange();
    });
  }
}
