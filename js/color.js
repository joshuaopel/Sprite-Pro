// Color manager: HSV state, color wheel, sliders, hex input
class ColorManager {
  constructor() {
    this.fg = { h: 0, s: 0, v: 100, a: 255 };   // white foreground
    this.bg = { h: 0, s: 0, v: 0, a: 255 };     // black background
    this.active = 'fg';

    this.wheelCanvas = document.getElementById('color-wheel');
    this.wheelCtx = this.wheelCanvas.getContext('2d');
    this.hueSlider = document.getElementById('hue-slider');
    this.satSlider = document.getElementById('sat-slider');
    this.valSlider = document.getElementById('val-slider');
    this.alphaSlider = document.getElementById('alpha-slider');
    this.hexInput = document.getElementById('hex-input');
    this.colorPreview = document.getElementById('color-preview');
    this.fgSwatch = document.getElementById('fg-color');
    this.bgSwatch = document.getElementById('bg-color');

    this._drawWheel();
    this._bind();
    this._updateUI();
  }

  _color() { return this.active === 'fg' ? this.fg : this.bg; }

  get fgRgba() {
    const [r,g,b] = hsvToRgb(this.fg.h, this.fg.s, this.fg.v);
    return [r, g, b, this.fg.a];
  }
  get bgRgba() {
    const [r,g,b] = hsvToRgb(this.bg.h, this.bg.s, this.bg.v);
    return [r, g, b, this.bg.a];
  }

  setFromRgb(r, g, b, a = 255) {
    const [h, s, v] = rgbToHsv(r, g, b);
    const c = this._color();
    c.h = h; c.s = s; c.v = v; c.a = a;
    this._updateUI();
  }

  setHSV(h, s, v) {
    const c = this._color();
    c.h = clamp(h,0,360); c.s = clamp(s,0,100); c.v = clamp(v,0,100);
    this._updateUI();
  }

  swap() {
    [this.fg, this.bg] = [this.bg, this.fg];
    this._updateUI();
  }

  selectFg() { this.active = 'fg'; this._updateUI(); }
  selectBg() { this.active = 'bg'; this._updateUI(); }

  _updateUI() {
    const c = this._color();
    this.hueSlider.value = c.h;
    this.satSlider.value = c.s;
    this.valSlider.value = c.v;
    this.alphaSlider.value = c.a;

    const [r,g,b] = hsvToRgb(c.h, c.s, c.v);
    this.hexInput.value = rgbaToHex(r, g, b, c.a);
    const css = rgba(r,g,b,c.a);
    this.colorPreview.style.background = css;

    // Update swatches
    const [fr,fg,fb] = hsvToRgb(this.fg.h, this.fg.s, this.fg.v);
    const [br,bg2,bb] = hsvToRgb(this.bg.h, this.bg.s, this.bg.v);
    this.fgSwatch.style.background = rgba(fr,fg,fb,this.fg.a);
    this.bgSwatch.style.background = rgba(br,bg2,bb,this.bg.a);

    // Update hue slider gradient
    this._updateSliderGradients(c);

    this._drawWheelCursor(c);
  }

  _updateSliderGradients(c) {
    const stops = Array.from({length:7}, (_,i) => `hsl(${i*60},100%,50%)`).join(',');
    this.hueSlider.style.background = `linear-gradient(to right, ${stops})`;

    const [r0,g0,b0] = hsvToRgb(c.h, 0, c.v);
    const [r1,g1,b1] = hsvToRgb(c.h, 100, c.v);
    this.satSlider.style.background = `linear-gradient(to right, rgb(${r0},${g0},${b0}), rgb(${r1},${g1},${b1}))`;

    const [r2,g2,b2] = hsvToRgb(c.h, c.s, 100);
    this.valSlider.style.background = `linear-gradient(to right, #000, rgb(${r2},${g2},${b2}))`;

    const [ar,ag,ab] = hsvToRgb(c.h, c.s, c.v);
    this.alphaSlider.style.background = `linear-gradient(to right, rgba(${ar},${ag},${ab},0), rgb(${ar},${ag},${ab}))`;
  }

  _drawWheel() {
    const ctx = this.wheelCtx;
    const w = this.wheelCanvas.width, h = this.wheelCanvas.height;
    const cx = w/2, cy = h/2, r = Math.min(cx,cy) - 4;

    // Draw hue/sat ring
    for (let angle = 0; angle < 360; angle++) {
      const startAngle = (angle - 1) * Math.PI / 180;
      const endAngle = (angle + 1) * Math.PI / 180;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const [rr,rg,rb] = hsvToRgb(angle, 100, 100);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(1, `rgb(${rr},${rg},${rb})`);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, startAngle, endAngle);
      ctx.fillStyle = grad;
      ctx.fill();
    }
    // Darken overlay
    const darkGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    darkGrad.addColorStop(0, 'rgba(0,0,0,0)');
    darkGrad.addColorStop(1, 'rgba(0,0,0,0.0)');
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fillStyle = darkGrad; ctx.fill();
  }

  _drawWheelCursor(c) {
    const ctx = this.wheelCtx;
    const w = this.wheelCanvas.width, h = this.wheelCanvas.height;
    const cx = w/2, cy = h/2, r = Math.min(cx,cy) - 4;
    this._drawWheel();

    const angle = c.h * Math.PI / 180;
    const dist = (c.s / 100) * r;
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI*2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
  }

  _bind() {
    // Hue/Sat/Val/Alpha sliders
    this.hueSlider.addEventListener('input', () => {
      this._color().h = +this.hueSlider.value; this._updateUI();
    });
    this.satSlider.addEventListener('input', () => {
      this._color().s = +this.satSlider.value; this._updateUI();
    });
    this.valSlider.addEventListener('input', () => {
      this._color().v = +this.valSlider.value; this._updateUI();
    });
    this.alphaSlider.addEventListener('input', () => {
      this._color().a = +this.alphaSlider.value; this._updateUI();
    });

    // Hex input
    this.hexInput.addEventListener('input', () => {
      const h = this.hexInput.value.replace('#','');
      if (h.length === 6 || h.length === 8) {
        const [r,g,b,a] = hexToRgba(h);
        this.setFromRgb(r, g, b, h.length === 8 ? a : 255);
      }
    });

    // Swatch clicks
    this.fgSwatch.addEventListener('click', () => this.selectFg());
    this.bgSwatch.addEventListener('click', () => this.selectBg());
    document.getElementById('swap-colors').addEventListener('click', () => this.swap());

    // Color wheel interaction
    const onWheel = (e) => {
      const rect = this.wheelCanvas.getBoundingClientRect();
      const cx = this.wheelCanvas.width/2, cy = this.wheelCanvas.height/2;
      const r = Math.min(cx,cy) - 4;
      const x = (e.clientX - rect.left) * (this.wheelCanvas.width / rect.width) - cx;
      const y = (e.clientY - rect.top) * (this.wheelCanvas.height / rect.height) - cy;
      const dist = Math.min(Math.sqrt(x*x+y*y), r);
      const angle = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
      this.setHSV(angle, (dist/r)*100, this._color().v);
    };
    let wheelDown = false;
    this.wheelCanvas.addEventListener('mousedown', e => { wheelDown = true; onWheel(e); });
    window.addEventListener('mousemove', e => { if (wheelDown) onWheel(e); });
    window.addEventListener('mouseup', () => { wheelDown = false; });
  }
}
