// Clamp a value between min and max
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Convert HSV (0-360, 0-100, 0-100) to RGB (0-255 each)
function hsvToRgb(h, s, v) {
  s /= 100; v /= 100;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

// Convert RGB (0-255) to HSV (0-360, 0-100, 0-100)
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let h = 0, s = max === 0 ? 0 : d / max, v = max;
  if (d !== 0) {
    if (max === r)      h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(v * 100)];
}

// Hex string (without #) to [r,g,b,a]
function hexToRgba(hex) {
  const h = hex.replace('#', '');
  if (h.length === 6) return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 255];
  if (h.length === 8) return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), parseInt(h.slice(6,8),16)];
  return [0, 0, 0, 255];
}

// [r,g,b,a] to hex string (no #)
function rgbaToHex(r, g, b, a) {
  const hex = v => v.toString(16).padStart(2,'0').toUpperCase();
  if (a === 255 || a === undefined) return hex(r)+hex(g)+hex(b);
  return hex(r)+hex(g)+hex(b)+hex(a);
}

// CSS rgba string from [r,g,b,a]
function rgba(r, g, b, a=255) { return `rgba(${r},${g},${b},${a/255})`; }

// Bresenham line: returns array of [x,y] pixel coords
function bresenhamLine(x0, y0, x1, y1) {
  const pts = [];
  let dx = Math.abs(x1-x0), dy = -Math.abs(y1-y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx+dy;
  while (true) {
    pts.push([x0,y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2*err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

// Flood fill on ImageData
function floodFill(imageData, startX, startY, fillColor) {
  const { data, width, height } = imageData;
  const idx = (x, y) => (y * width + x) * 4;
  const si = idx(startX, startY);
  const target = [data[si], data[si+1], data[si+2], data[si+3]];
  const [fr, fg, fb, fa] = fillColor;
  if (target[0]===fr && target[1]===fg && target[2]===fb && target[3]===fa) return;
  const stack = [[startX, startY]];
  const visited = new Uint8Array(width * height);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const i = y*width+x;
    if (visited[i]) continue;
    const pi = i*4;
    if (data[pi]!==target[0]||data[pi+1]!==target[1]||data[pi+2]!==target[2]||data[pi+3]!==target[3]) continue;
    visited[i] = 1;
    data[pi]=fr; data[pi+1]=fg; data[pi+2]=fb; data[pi+3]=fa;
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
  }
}

// Get pointer position relative to element, adjusted for zoom
function getPointerPos(e, element, zoom) {
  const rect = element.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: Math.floor((clientX - rect.left) / zoom),
    y: Math.floor((clientY - rect.top) / zoom)
  };
}

// Deep copy ImageData
function cloneImageData(id) {
  const c = new ImageData(id.width, id.height);
  c.data.set(id.data);
  return c;
}

// Draw checkerboard pattern on canvas context
function drawCheckerboard(ctx, w, h, size=8) {
  ctx.clearRect(0,0,w,h);
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      ctx.fillStyle = ((x/size + y/size) % 2 === 0) ? '#444' : '#333';
      ctx.fillRect(x, y, size, size);
    }
  }
}

// Midpoint circle algorithm for ellipse
function ellipsePixels(cx, cy, rx, ry) {
  const pts = new Set();
  const put = (x, y) => { pts.add(`${cx+x},${cy+y}`); pts.add(`${cx-x},${cy+y}`); pts.add(`${cx+x},${cy-y}`); pts.add(`${cx-x},${cy-y}`); };
  let x = 0, y = ry;
  let d1 = ry*ry - rx*rx*ry + 0.25*rx*rx;
  let dx = 2*ry*ry*x, dy = 2*rx*rx*y;
  while (dx < dy) {
    put(x, y);
    if (d1 < 0) { x++; dx += 2*ry*ry; d1 += dx + ry*ry; }
    else { x++; y--; dx += 2*ry*ry; dy -= 2*rx*rx; d1 += dx - dy + ry*ry; }
  }
  let d2 = ry*ry*(x+0.5)*(x+0.5) + rx*rx*(y-1)*(y-1) - rx*rx*ry*ry;
  while (y >= 0) {
    put(x, y);
    if (d2 > 0) { y--; dy -= 2*rx*rx; d2 += rx*rx - dy; }
    else { y--; x++; dx += 2*ry*ry; dy -= 2*rx*rx; d2 += dx - dy + rx*rx; }
  }
  return [...pts].map(s => s.split(',').map(Number));
}

// Rectangle pixels (outline)
function rectOutlinePixels(x0, y0, x1, y1) {
  const pts = [];
  const minX = Math.min(x0,x1), maxX = Math.max(x0,x1);
  const minY = Math.min(y0,y1), maxY = Math.max(y0,y1);
  for (let x = minX; x <= maxX; x++) { pts.push([x,minY]); pts.push([x,maxY]); }
  for (let y = minY+1; y < maxY; y++) { pts.push([minX,y]); pts.push([maxX,y]); }
  return pts;
}

// Rounded rectangle outline pixels
function roundedRectPixels(x0, y0, x1, y1, r) {
  const minX = Math.min(x0,x1), maxX = Math.max(x0,x1);
  const minY = Math.min(y0,y1), maxY = Math.max(y0,y1);
  r = Math.max(0, Math.min(r, Math.floor(Math.min(maxX - minX, maxY - minY) / 2)));
  if (r === 0) return rectOutlinePixels(x0, y0, x1, y1);

  const seen = new Set();
  const add = (x, y) => { const k = x + ',' + y; if (!seen.has(k)) { seen.add(k); } };

  // Straight edges
  for (let x = minX + r; x <= maxX - r; x++) { add(x, minY); add(x, maxY); }
  for (let y = minY + r; y <= maxY - r; y++) { add(minX, y); add(maxX, y); }

  // Quarter-circle corners via midpoint circle algorithm
  function quarterArc(cx, cy, sx, sy) {
    let x = 0, y = r, d = 1 - r;
    while (x <= y) {
      add(cx + sx * x, cy + sy * y);
      add(cx + sx * y, cy + sy * x);
      if (d < 0) { d += 2 * x + 3; }
      else       { d += 2 * (x - y) + 5; y--; }
      x++;
    }
  }
  quarterArc(minX + r, minY + r, -1, -1); // top-left
  quarterArc(maxX - r, minY + r, +1, -1); // top-right
  quarterArc(maxX - r, maxY - r, +1, +1); // bottom-right
  quarterArc(minX + r, maxY - r, -1, +1); // bottom-left

  return [...seen].map(s => s.split(',').map(Number));
}
