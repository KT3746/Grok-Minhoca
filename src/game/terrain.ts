import { WATER_Y, WORLD_H, WORLD_W } from "./types";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export type MapKind = "hills" | "canyon" | "isles";

export class Terrain {
  w = WORLD_W;
  h = WORLD_H;
  waterY = WATER_Y;
  mask: Uint8Array;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  kind: MapKind = "hills";

  constructor() {
    this.mask = new Uint8Array(this.w * this.h);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("terrain canvas");
    this.ctx = ctx;
  }

  solid(x: number, y: number): boolean {
    const ix = x | 0;
    const iy = y | 0;
    if (iy < 0) return false;
    if (iy >= this.h) return false;
    if (ix < 0 || ix >= this.w) return true;
    return this.mask[iy * this.w + ix] !== 0;
  }

  surfaceY(x: number): number {
    const ix = Math.max(0, Math.min(this.w - 1, x | 0));
    for (let y = 0; y < this.h; y++) {
      if (this.mask[y * this.w + ix]) return y;
    }
    return -1;
  }

  generate(kind: MapKind, seed: number) {
    this.kind = kind;
    this.mask.fill(0);
    const rnd = mulberry32(seed);
    const heights = new Float32Array(this.w);

    if (kind === "hills") {
      const a = rnd() * 6;
      const b = rnd() * 6;
      const c = rnd() * 6;
      for (let x = 0; x < this.w; x++) {
        const n =
          92 * Math.sin(x * 0.0036 + a) +
          44 * Math.sin(x * 0.009 + b) +
          18 * Math.sin(x * 0.021 + c) +
          12 * (hash2(x, seed) - 0.5);
        heights[x] = 360 + n;
      }
    } else if (kind === "canyon") {
      const mid = this.w * (0.42 + rnd() * 0.16);
      const gap = 210 + rnd() * 90;
      const ph = rnd() * 6;
      const ph2 = rnd() * 6;
      for (let x = 0; x < this.w; x++) {
        const d = Math.abs(x - mid);
        const valley = Math.exp((-d * d) / (2 * gap * gap));
        const n = 48 * Math.sin(x * 0.007 + ph) + 16 * Math.sin(x * 0.02 + ph2);
        heights[x] = 340 + n + valley * 200;
      }
    } else {
      const peaks = [0.18 + rnd() * 0.04, 0.5, 0.8 + rnd() * 0.04];
      const widths = [220 + rnd() * 40, 240 + rnd() * 50, 210 + rnd() * 40];
      for (let x = 0; x < this.w; x++) {
        let h = this.waterY + 40;
        for (let i = 0; i < 3; i++) {
          const cx = peaks[i] * this.w;
          const d = x - cx;
          const g = Math.exp((-d * d) / (2 * widths[i] * widths[i]));
          h = Math.min(h, 430 + i * 10 - g * 150 + 12 * Math.sin(x * 0.018 + i));
        }
        heights[x] = h;
      }
    }

    for (let x = 0; x < this.w; x++) {
      if (kind === "isles") {
        if (heights[x] > this.waterY - 28) continue;
        heights[x] = Math.max(240, heights[x]);
      } else {
        heights[x] = Math.max(240, Math.min(this.waterY - 56, heights[x]));
      }
      const gy = heights[x] | 0;
      for (let y = gy; y < this.h; y++) {
        if (y < this.waterY + 28) this.mask[y * this.w + x] = 1;
      }
    }

    const caves = kind === "isles" ? 3 : 6 + ((rnd() * 3) | 0);
    for (let i = 0; i < caves; i++) {
      const cx = (80 + rnd() * (this.w - 160)) | 0;
      const sy = this.surfaceY(cx);
      if (sy < 0) continue;
      const cy = (sy + 70 + rnd() * 80) | 0;
      const rx = 24 + rnd() * 30;
      const ry = 14 + rnd() * 16;
      this.ellipse(cx, cy, rx, ry, 0);
    }

    const nibbles = kind === "isles" ? 8 : 12;
    for (let i = 0; i < nibbles; i++) {
      const cx = (rnd() * this.w) | 0;
      const sy = this.surfaceY(cx);
      if (sy < 0) continue;
      this.ellipse(cx, sy + 6, 8 + rnd() * 12, 5 + rnd() * 7, 0);
    }
  }

  private ellipse(cx: number, cy: number, rx: number, ry: number, fill: 0 | 1) {
    const x0 = Math.max(0, (cx - rx) | 0);
    const x1 = Math.min(this.w - 1, (cx + rx) | 0);
    const y0 = Math.max(0, (cy - ry) | 0);
    const y1 = Math.min(this.h - 1, (cy + ry) | 0);
    const rx2 = rx * rx;
    const ry2 = ry * ry;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if ((dx * dx) / rx2 + (dy * dy) / ry2 <= 1) this.mask[y * this.w + x] = fill;
      }
    }
  }

  paint(dirt: HTMLImageElement | null) {
    const { w, h, ctx, mask } = this;
    ctx.clearRect(0, 0, w, h);
    if (dirt) {
      const pat = ctx.createPattern(dirt, "repeat");
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      ctx.fillStyle = "#5a3d28";
      ctx.fillRect(0, 0, w, h);
    }

    const alpha = ctx.createImageData(w, h);
    const ad = alpha.data;
    for (let i = 0, n = mask.length; i < n; i++) {
      if (mask[i]) ad[i * 4 + 3] = 255;
    }
    const hole = document.createElement("canvas");
    hole.width = w;
    hole.height = h;
    hole.getContext("2d")!.putImageData(alpha, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(hole, 0, 0);
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(72, 46, 26, 0.42)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";

    for (let x = 0; x < w; x++) {
      const sy = this.surfaceY(x);
      if (sy < 0) continue;
      ctx.fillStyle = "rgba(86, 132, 54, 0.92)";
      ctx.fillRect(x, sy, 1, 11);
      ctx.fillStyle = "rgba(52, 78, 34, 0.55)";
      ctx.fillRect(x, sy + 11, 1, 5);
    }
  }

  destroy(cx: number, cy: number, r: number) {
    const ir = Math.ceil(r + 8);
    const x0 = Math.max(0, (cx - ir) | 0);
    const x1 = Math.min(this.w - 1, (cx + ir) | 0);
    const y0 = Math.max(0, (cy - ir) | 0);
    const y1 = Math.min(this.h - 1, (cy + ir) | 0);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const n = (hash2(x, y) - 0.5) * 0.28 * r;
        const dx = x - cx;
        const dy = y - cy;
        const rr = r + n;
        if (dx * dx + dy * dy <= rr * rr) this.mask[y * this.w + x] = 0;
      }
    }
    const img = this.ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    const d = img.data;
    const bw = x1 - x0 + 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!this.mask[y * this.w + x]) {
          const i = ((y - y0) * bw + (x - x0)) * 4;
          d[i + 3] = 0;
        }
      }
    }
    this.ctx.putImageData(img, x0, y0);
  }

  normal(x: number, y: number): { x: number; y: number } {
    const l = this.solid(x - 3, y) ? 1 : 0;
    const r = this.solid(x + 3, y) ? 1 : 0;
    const u = this.solid(x, y - 3) ? 1 : 0;
    const d = this.solid(x, y + 3) ? 1 : 0;
    let nx = l - r;
    let ny = u - d;
    const m = Math.hypot(nx, ny) || 1;
    return { x: nx / m, y: ny / m };
  }

  spawnXs(team: 0 | 1): number[] {
    const left = team === 0;
    const xs: number[] = [];
    if (this.kind === "isles") {
      const bases = left ? [0.14, 0.18, 0.22, 0.26] : [0.74, 0.78, 0.82, 0.86];
      for (const f of bases) xs.push((f * this.w) | 0);
    } else {
      const start = left ? 0.1 : 0.58;
      for (let i = 0; i < 4; i++) xs.push(((start + i * 0.08) * this.w) | 0);
    }
    const placed = xs.map((x) => this.safeX(x));
    for (let i = 0; i < placed.length; i++) {
      let guard = 0;
      while (guard < 16 && placed.some((p, j) => j !== i && Math.abs(p - placed[i]) < 56)) {
        placed[i] = this.safeX(placed[i] + (left ? -28 : 28));
        guard++;
      }
    }
    return placed;
  }

  private safeX(x: number): number {
    let best = x;
    let bestH = 9999;
    let found = false;
    for (let dx = -80; dx <= 80; dx += 6) {
      const nx = Math.max(40, Math.min(this.w - 40, x + dx));
      const y = this.surfaceY(nx);
      if (y < 0 || y > this.waterY - 36) continue;
      const score = Math.abs(dx) + (y > this.waterY - 80 ? 40 : 0);
      if (score < bestH) {
        bestH = score;
        best = nx;
        found = true;
      }
    }
    if (found) return best;
    for (let nx = 40; nx < this.w - 40; nx += 10) {
      const y = this.surfaceY(nx);
      if (y < 0 || y > this.waterY - 36) continue;
      const score = Math.abs(nx - x);
      if (score < bestH) {
        bestH = score;
        best = nx;
      }
    }
    return best;
  }
}
