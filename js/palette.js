// Color palette presets and manager
const PALETTES = {
  default: [
    '#000000','#FFFFFF','#FF0000','#00FF00','#0000FF','#FFFF00','#FF00FF','#00FFFF',
    '#FF8800','#8800FF','#00FF88','#FF0088','#0088FF','#88FF00','#888888','#444444',
    '#FF4444','#44FF44','#4444FF','#FFAA44','#AA44FF','#44FFAA','#FFAAAA','#AAFFAA',
    '#AAAAFF','#FFFF88','#FF88FF','#88FFFF','#CCCCCC','#999999','#666666','#222222',
  ],
  gameboy: [
    '#0f380f','#306230','#8bac0f','#9bbc0f','#ffffff','#000000','#1a2c1a','#4a6a2a',
  ],
  nes: [
    '#7C7C7C','#0000FC','#0000BC','#4428BC','#940084','#A80020','#A81000','#881400',
    '#503000','#007800','#006800','#005800','#004058','#000000','#BCBCBC','#0078F8',
    '#0058F8','#6844FC','#D800CC','#E40058','#F83800','#E45C10','#AC7C00','#00B800',
    '#00A800','#00A844','#008888','#000000','#F8F8F8','#3CBCFC','#6888FC','#9878F8',
    '#F878F8','#F85898','#F87858','#FCA044','#F8B800','#B8F818','#58D854','#58F898',
    '#00E8D8','#787878','#000000','#FCFCFC','#A4E4FC','#B8B8F8','#D8B8F8','#F8B8F8',
    '#F8A4C0','#F0D0B0','#FCE0A8','#F8D878','#D8F878','#B8F8B8','#B8F8D8','#00FCFC',
    '#F8D8F8','#000000',
  ],
  cga: [
    '#000000','#0000AA','#00AA00','#00AAAA','#AA0000','#AA00AA','#AA5500','#AAAAAA',
    '#555555','#5555FF','#55FF55','#55FFFF','#FF5555','#FF55FF','#FFFF55','#FFFFFF',
  ],
  pico8: [
    '#000000','#1D2B53','#7E2553','#008751','#AB5236','#5F574F','#C2C3C7','#FFF1E8',
    '#FF004D','#FFA300','#FFEC27','#00E436','#29ADFF','#83769C','#FF77A8','#FFCCAA',
  ],
  aap64: [
    '#060608','#141013','#3b1725','#73172d','#b4202a','#df3e23','#fa6a0a','#f9a31b',
    '#ffd541','#fffc40','#d6f264','#9cdb43','#59c135','#14a02e','#1a7a3c','#24523b',
    '#122020','#143464','#285cc4','#249fde','#20d6c7','#a6fcdb','#ffffff','#fef3c0',
    '#fad6b8','#f5a097','#e86a73','#bc4a9b','#793a80','#403353','#242234','#221c1a',
    '#322b28','#71413b','#bb7547','#dba463','#f4d29c','#dae0ea','#b3b9d1','#8b93af',
    '#6d758d','#4a5462','#333941','#422433','#5b3138','#8e5252','#ba756a','#e9b5a3',
    '#e3e6ff','#b9bffb','#849be4','#588dbe','#477d85','#23674e','#328464','#5daf8d',
    '#92dcba','#cdf7e2','#e4d2aa','#c7b08b','#a08662','#796755','#5a4e44','#423934',
  ],
};

class PaletteManager {
  constructor(colorMgr) {
    this.colorMgr = colorMgr;
    this.colors = [...PALETTES.default];
    this.grid = document.getElementById('palette-grid');
    this.presetSelect = document.getElementById('palette-preset');

    document.getElementById('add-palette-color').addEventListener('click', () => {
      const [r,g,b,a] = this.colorMgr.fgRgba;
      const hex = '#' + rgbaToHex(r,g,b,a);
      if (!this.colors.includes(hex)) { this.colors.push(hex); this._render(); }
    });

    this.presetSelect.addEventListener('change', () => {
      this.colors = [...(PALETTES[this.presetSelect.value] || PALETTES.default)];
      this._render();
    });

    this._render();
  }

  _render() {
    this.grid.innerHTML = '';
    this.colors.forEach(hex => {
      const sw = document.createElement('div');
      sw.className = 'palette-swatch';
      sw.style.background = hex;
      sw.title = hex;
      sw.addEventListener('click', e => {
        if (e.button === 2) return;
        const [r,g,b,a] = hexToRgba(hex);
        this.colorMgr.setFromRgb(r,g,b,a);
      });
      sw.addEventListener('contextmenu', e => {
        e.preventDefault();
        const [r,g,b,a] = hexToRgba(hex);
        this.colorMgr.selectBg();
        this.colorMgr.setFromRgb(r,g,b,a);
        this.colorMgr.selectFg();
      });
      this.grid.appendChild(sw);
    });
  }
}
