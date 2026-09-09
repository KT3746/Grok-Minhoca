import { Sfx } from "./audio";
import { Terrain, type MapKind } from "./terrain";
import {
  GRAVITY,
  JUMP_VY,
  MAX_CLIMB,
  NAMES_A,
  NAMES_B,
  STEP,
  TURN_SECS,
  WALK_SPEED,
  WATER_Y,
  WORLD_H,
  WORLD_W,
  WORM_DRAW,
  WORM_R,
  emptyAmmo,
  weaponDef,
  type Ammo,
  type Boom,
  type Difficulty,
  type Mode,
  type Particle,
  type Phase,
  type PlaneRun,
  type Screen,
  type Shot,
  type Team,
  type UiSnap,
  type WeaponId,
  type Worm,
} from "./types";

const MAPS: MapKind[] = ["hills", "canyon", "isles"];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(src));
    im.src = src;
  });
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

const PREFS_KEY = "minhoca-prefs-v1";

function readPrefs(): { muted: boolean; difficulty: Difficulty } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { muted: false, difficulty: "recruit" };
    const p = JSON.parse(raw) as { muted?: boolean; difficulty?: string };
    return {
      muted: !!p.muted,
      difficulty: p.difficulty === "vet" ? "vet" : "recruit",
    };
  } catch {
    return { muted: false, difficulty: "recruit" };
  }
}

function writePrefs(muted: boolean, difficulty: Difficulty) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ muted, difficulty }));
  } catch {
    /* ignore quota */
  }
}

type SheetSet = { idle: HTMLImageElement | null; walk: HTMLImageElement | null; aim: HTMLImageElement | null; hurt: HTMLImageElement | null };

export class MinhocaGame {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  onUi: (ui: UiSnap) => void;

  private destroyed = false;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private freeze = 0;
  private time = 0;

  terrain = new Terrain();
  sfx = new Sfx();
  worms: Worm[] = [];
  shots: Shot[] = [];
  planes: PlaneRun[] = [];
  particles: Particle[] = [];
  booms: Boom[] = [];

  screen: Screen = "menu";
  phase: Phase = "turn";
  mode: Mode = "cpu";
  difficulty: Difficulty = "recruit";
  loading = false;
  loadMsg = "Carregando...";
  muted = false;
  touch = false;
  reduceMotion = false;
  hudFire = false;
  ready = false;
  pointerHeld = false;
  pointerAimT = 0;
  settleMax = 0;
  flyT = 0;
  jumpBuf = 0;
  coyote = 0;
  splashAt = 0;
  pendingBooms: { x: number; y: number; r: number; dmg: number }[] = [];
  inputLock = 0;

  team: Team = 0;
  turnIndex = [0, 0] as [number, number];
  timer = TURN_SECS;
  wind = 0;
  weapon: WeaponId = "bazooka";
  loadout: [WeaponId, WeaponId] = ["bazooka", "bazooka"];
  ammo: [Ammo, Ammo] = [emptyAmmo(), emptyAmmo()];
  banner = "";
  bannerT = 0;
  winner: Team | null = null;
  power = 0;
  introT = 0;
  settleT = 0;

  keys = new Set<string>();
  forcedKeys: Set<string> | null = null;
  walkPad = 0;
  jumpQueued = false;
  fireHeld = false;
  pointerWorld: { x: number; y: number } | null = null;
  strikeX: number | null = null;

  camX = 0;
  camY = 0;
  camTX = 0;
  camTY = 0;
  zoom = 1.15;
  trauma = 0;
  cssW = 800;
  cssH = 600;
  dpr = 1;

  imgs: Record<string, HTMLImageElement | null> = {};
  sheets: [SheetSet, SheetSet] = [
    { idle: null, walk: null, aim: null, hurt: null },
    { idle: null, walk: null, aim: null, hurt: null },
  ];

  ai = { on: false, stage: "wait" as "wait" | "walk" | "aim" | "charge", t: 0, dir: 0, aim: 0.5, pow: 0.7 };

  private uiClock = 0;
  private lastUi = "";
  private loadPromise: Promise<void> | null = null;

  constructor(canvas: HTMLCanvasElement, onUi: (ui: UiSnap) => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d");
    this.ctx = ctx;
    this.onUi = onUi;
    this.touch = window.matchMedia("(pointer: coarse)").matches;
    this.hudFire = this.touch;
    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.zoom = this.touch ? 1.12 : 0.92;
    const prefs = readPrefs();
    this.muted = prefs.muted;
    this.difficulty = prefs.difficulty;
    this.sfx.setMuted(this.muted);
    this.loading = false;
  }

  async start() {
    this.bind();
    this.resize();
    this.loading = false;
    this.previewMap();
    this.emit(true);
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.destroyed) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.installProbe();
    this.loadPromise = this.load()
      .catch(() => {
        /* fallbacks inside draw */
      })
      .then(() => {
        this.ready = true;
        if (!this.destroyed && this.screen === "menu") this.previewMap();
        this.emit(true);
      });
    await this.loadPromise;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVis);
    this.canvas.removeEventListener("pointerdown", this.onPtrDown);
    this.canvas.removeEventListener("pointermove", this.onPtrMove);
    this.canvas.removeEventListener("pointerup", this.onPtrUp);
    this.canvas.removeEventListener("pointercancel", this.onPtrUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    if (window.__controlsTest) delete window.__controlsTest;
  }

  private async load() {
    const files = [
      "worm-a-idle.png",
      "worm-a-walk.png",
      "worm-a-aim.png",
      "worm-a-hurt.png",
      "worm-b-idle.png",
      "worm-b-walk.png",
      "worm-b-aim.png",
      "worm-b-hurt.png",
      "explosion.png",
      "rocket.png",
      "grenade.png",
      "dynamite.png",
      "plane.png",
      "bazooka.png",
      "sky.jpg",
      "dirt.jpg",
    ];
    await Promise.all(
      files.map(async (f) => {
        try {
          this.imgs[f] = await loadImage(`${import.meta.env.BASE_URL}game/${f}`);
        } catch {
          this.imgs[f] = null;
        }
      }),
    );
    this.sheets[0] = {
      idle: this.imgs["worm-a-idle.png"],
      walk: this.imgs["worm-a-walk.png"],
      aim: this.imgs["worm-a-aim.png"],
      hurt: this.imgs["worm-a-hurt.png"],
    };
    this.sheets[1] = {
      idle: this.imgs["worm-b-idle.png"],
      walk: this.imgs["worm-b-walk.png"],
      aim: this.imgs["worm-b-aim.png"],
      hurt: this.imgs["worm-b-hurt.png"],
    };
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise<void>((resolve) => setTimeout(resolve, 1200)),
      ]);
    } catch {
      /* ignore */
    }
  }

  private previewMap() {
    const kind = MAPS[(Math.random() * MAPS.length) | 0];
    this.terrain.generate(kind, (Math.random() * 1e9) | 0);
    this.terrain.paint(this.imgs["dirt.jpg"]);
    this.camTX = WORLD_W * 0.3;
    this.camTY = 120;
    this.camX = this.camTX;
    this.camY = this.camTY;
  }

  async play(mode: Mode) {
    if (this.loading) return;
    this.sfx.unlock();
    this.sfx.click();
    this.mode = mode;
    this.screen = "play";
    this.loading = true;
    this.loadMsg = "Preparando o combate...";
    this.phase = "intro";
    this.worms = [];
    this.shots = [];
    this.planes = [];
    this.zoom = this.touch ? 1.12 : 0.92;
    this.emit(true);
    if (this.loadPromise) await this.loadPromise;
    if (this.destroyed) return;
    const kind = MAPS[(Math.random() * MAPS.length) | 0];
    this.terrain.generate(kind, (Math.random() * 1e9) | 0);
    this.terrain.paint(this.imgs["dirt.jpg"]);
    this.worms = [];
    this.shots = [];
    this.planes = [];
    this.particles = [];
    this.booms = [];
    this.pendingBooms = [];
    this.ammo = [emptyAmmo(), emptyAmmo()];
    this.weapon = "bazooka";
    this.loadout = ["bazooka", "bazooka"];
    this.winner = null;
    this.turnIndex = [0, 3];
    this.walkPad = 0;
    this.jumpQueued = false;
    this.fireHeld = false;
    this.pointerHeld = false;
    this.power = 0;
    this.acc = 0;
    this.trauma = 0;
    this.freeze = 0;
    this.keys.clear();
    let id = 0;
    for (const team of [0, 1] as Team[]) {
      const xs = this.terrain.spawnXs(team);
      const names = team === 0 ? NAMES_A : NAMES_B;
      for (let i = 0; i < 4; i++) {
        const x = xs[i];
        const sy = this.terrain.surfaceY(x);
        const y = sy > 0 ? sy - 1 : WATER_Y - 80;
        this.worms.push({
          id: id++,
          team,
          name: names[i],
          x,
          y,
          vx: 0,
          vy: 0,
          hp: 100,
          face: team === 0 ? 1 : -1,
          aim: 0.55,
          anim: "idle",
          animT: Math.random(),
          hurtT: 0,
          flashT: 0,
          drownT: 0,
          walkAcc: 0,
          grounded: true,
          dead: false,
        });
      }
    }
    this.team = 0;
    this.loading = false;
    this.beginTurn(true);
    const w = this.active();
    if (w) {
      this.camX = w.x - this.viewW() / 2;
      this.camY = w.y - this.viewH() * 0.6;
    }
  }

  private beginTurn(first = false) {
    this.shots = [];
    this.planes = [];
    this.phase = "intro";
    this.introT = first ? 1.35 : 1.05;
    this.timer = TURN_SECS;
    this.power = 0;
    this.fireHeld = false;
    this.pointerHeld = false;
    this.jumpQueued = false;
    this.jumpBuf = 0;
    this.walkPad = 0;
    this.strikeX = null;
    this.settleMax = 0;
    this.flyT = 0;
    this.pendingBooms = [];
    this.inputLock = first ? 0.45 : 0.18;
    this.wind = (Math.random() * 2 - 1) * (this.difficulty === "vet" ? 1 : 0.72);
    const w = this.active();
    if (w) {
      this.banner = `${w.name}  ·  Equipe ${w.team === 0 ? "Oliva" : "Rubro"}`;
      this.bannerT = this.introT;
      this.lookAt(w.x, w.y);
      this.weapon = this.loadout[this.team];
      if (this.ammo[this.team][this.weapon] === 0) {
        this.weapon = this.ammo[this.team].bazooka !== 0 ? "bazooka" : "punch";
        this.loadout[this.team] = this.weapon;
      }
    }
    this.ai.on = this.mode === "cpu" && this.team === 1;
    this.ai.stage = "wait";
    this.ai.t = 0.45 + Math.random() * 0.35;
    this.emit(true);
  }

  private nextTurn() {
    if (this.checkWin()) return;
    this.team = (this.team === 0 ? 1 : 0) as Team;
    const living = this.worms.filter((w) => !w.dead && w.team === this.team);
    if (living.length === 0) {
      this.team = (this.team === 0 ? 1 : 0) as Team;
    }
    const teamLiving = this.worms.filter((w) => !w.dead && w.team === this.team);
    if (teamLiving.length === 0) {
      this.checkWin();
      return;
    }
    let guard = 0;
    do {
      this.turnIndex[this.team] = (this.turnIndex[this.team] + 1) % 4;
      guard++;
    } while (this.worms.find((w) => w.team === this.team && w.id % 4 === this.turnIndex[this.team] && !w.dead) === undefined && guard < 8);
    this.beginTurn();
  }

  private checkWin(): boolean {
    if (this.screen === "win" || this.phase === "over") return true;
    const a = this.worms.some((w) => !w.dead && w.team === 0);
    const b = this.worms.some((w) => !w.dead && w.team === 1);
    if (a && b) return false;
    this.phase = "over";
    this.winner = a && !b ? 0 : b && !a ? 1 : null;
    this.screen = "win";
    this.shots = [];
    this.planes = [];
    this.banner = this.winner === 0 ? "Equipe Oliva vence" : this.winner === 1 ? "Equipe Rubro vence" : "Empate";
    this.sfx.win();
    this.emit(true);
    return true;
  }

  private toSettle(t = 0.4) {
    if (this.phase === "over" || this.screen === "win") return;
    this.phase = "settle";
    this.settleT = t;
    this.settleMax = 0;
    this.fireHeld = false;
    this.power = 0;
    this.emit(true);
  }

  active(): Worm | undefined {
    const idx = this.turnIndex[this.team];
    return this.worms.find((w) => w.team === this.team && w.id % 4 === idx && !w.dead) ?? this.worms.find((w) => w.team === this.team && !w.dead);
  }

  private held(): Set<string> {
    return this.forcedKeys ?? this.keys;
  }

  private tick(dt: number) {
    this.time += dt;
    if (this.screen === "menu") {
      this.camTX += 18 * dt;
      if (this.camTX > WORLD_W - this.viewW() - 20) this.camTX = 40;
      this.camX = lerp(this.camX, this.camTX, 1 - Math.exp(-1.2 * dt));
      this.camY = lerp(this.camY, 80, 1 - Math.exp(-1.2 * dt));
      this.draw();
      return;
    }
    if (this.screen === "pause" || this.screen === "help") {
      this.draw();
      return;
    }
    if (this.screen === "win") {
      this.stepFx(dt);
      this.updateCam(dt);
      this.draw();
      return;
    }
    if (this.loading) {
      this.draw();
      return;
    }

    if (this.freeze > 0) {
      this.freeze -= dt;
      this.stepFx(dt);
      this.updateCam(dt);
      this.draw();
      return;
    }

    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.physics(STEP);
      this.acc -= STEP;
      steps++;
    }

    this.stepFx(dt);
    this.updateCam(dt);
    this.draw();

    this.uiClock += dt;
    if (this.uiClock > 0.12) {
      this.uiClock = 0;
      this.emit(false);
    }
  }

  private physics(dt: number) {
    if (this.inputLock > 0) this.inputLock = Math.max(0, this.inputLock - dt);
    if (this.phase === "intro") {
      this.introT -= dt;
      this.bannerT -= dt;
      this.stepWorms(dt, false);
      this.stepShots(dt);
      this.afterSim();
      if (this.introT <= 0) {
        this.phase = "turn";
        this.fireHeld = false;
        this.pointerHeld = false;
        this.power = 0;
        this.inputLock = Math.max(this.inputLock, 0.2);
        this.emit(true);
      }
      return;
    }

    if (this.phase === "turn" || this.phase === "charge") {
      const prevT = this.timer;
      this.timer -= dt;
      if (this.timer <= 6 && this.timer > 0 && Math.ceil(this.timer) < Math.ceil(prevT)) this.sfx.tick();
      if (this.timer <= 0) {
        if (this.phase === "charge") {
          const cur = this.active();
          if (cur) this.doFire(cur, this.power);
          if (this.phase === "charge") this.toSettle(0.3);
          return;
        }
        this.sfx.tick();
        this.toSettle(0.4);
        return;
      }
      const w = this.active();
      if (!w) {
        this.nextTurn();
        return;
      }
      if (this.ai.on) this.stepAi(dt, w);
      else this.control(dt, w);
      this.stepWorms(dt, true);
      this.stepShots(dt);
      this.afterSim();
      return;
    }

    if (this.phase === "fly") {
      this.stepWorms(dt, false);
      this.stepShots(dt);
      this.stepPlanes(dt);
      this.afterSim();
      this.flyT += dt;
      if (this.airborneClear() || this.flyT > 8) {
        this.toSettle(0.35);
      }
      return;
    }

    if (this.phase === "settle") {
      this.stepWorms(dt, false);
      this.stepShots(dt);
      this.stepPlanes(dt);
      this.afterSim();
      this.settleMax += dt;
      const moving = this.worms.some((w) => {
        if (w.dead) return false;
        if (w.y - 4 > WATER_Y) return false;
        return !w.grounded || Math.abs(w.vy) > 24 || Math.abs(w.vx) > 24;
      });
      if ((!moving && this.airborneClear()) || this.settleMax > 3.6) {
        this.settleT -= dt;
        if (this.settleT <= 0) this.nextTurn();
      } else this.settleT = 0.28;
    }
  }

  private airborneClear() {
    if (this.shots.length > 0) return false;
    for (const p of this.planes) {
      if (p.dropped < p.dropXs.length) return false;
    }
    return true;
  }

  private afterSim() {
    this.flushBooms();
    this.separateWorms();
  }

  private control(dt: number, w: Worm) {
    if (w.hurtT > 0) return;
    const keys = this.held();
    const left = keys.has("KeyA") || keys.has("ArrowLeft") || this.walkPad < 0;
    const right = keys.has("KeyD") || keys.has("ArrowRight") || this.walkPad > 0;
    const up = keys.has("KeyW") || keys.has("ArrowUp");
    const down = keys.has("KeyS") || keys.has("ArrowDown");

    this.pointerAimT = Math.max(0, this.pointerAimT - dt);
    const keyAim = up || down;
    const usePointer = !keyAim && !!this.pointerWorld && (this.touch || this.pointerHeld || this.pointerAimT > 0);
    if (usePointer && this.pointerWorld && (this.phase === "turn" || this.phase === "charge")) {
      const dx = this.pointerWorld.x - w.x;
      const dy = this.pointerWorld.y - (w.y - WORM_R);
      w.face = dx >= 0 ? 1 : -1;
      w.aim = clamp(Math.atan2(-dy, Math.abs(dx) + 0.01), -0.2, 1.35);
      if (this.weapon === "strike") this.strikeX = this.pointerWorld.x;
    }

    if (up) w.aim = clamp(w.aim + 1.6 * dt, -0.2, 1.35);
    if (down) w.aim = clamp(w.aim - 1.6 * dt, -0.2, 1.35);

    if (this.phase === "charge") {
      this.power = clamp(this.power + dt * 0.85, 0.18, 1);
      w.anim = "aim";
      const holding = this.fireHeld || keys.has("Space") || this.pointerHeld;
      if (!holding) this.releaseFire();
      return;
    }

    this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    if (w.grounded) this.coyote = 0.1;
    else this.coyote = Math.max(0, this.coyote - dt);
    if (this.jumpQueued && this.jumpBuf > 0 && (w.grounded || this.coyote > 0)) {
      this.jumpQueued = false;
      this.jumpBuf = 0;
      this.coyote = 0;
      w.vy = JUMP_VY;
      w.grounded = false;
      w.anim = "idle";
      this.sfx.jump();
    }
    if (this.jumpBuf <= 0) this.jumpQueued = false;

    let dir = 0;
    if (left) dir -= 1;
    if (right) dir += 1;
    if (dir && w.grounded) {
      w.face = dir as 1 | -1;
      this.walk(w, dir, dt);
      w.anim = "walk";
    } else if (w.grounded) {
      w.walkAcc = 0;
      w.anim = this.weapon === "bazooka" || this.weapon === "grenade" || this.weapon === "shotgun" ? "aim" : "idle";
    }

    if ((this.fireHeld || keys.has("Space")) && this.phase === "turn" && this.inputLock <= 0) this.pressFire();
  }

  private stepAi(dt: number, w: Worm) {
    this.ai.t -= dt;
    const enemy = this.nearestEnemy(w);
    if (!enemy) return;
    if (this.ai.stage === "wait") {
      w.anim = "idle";
      if (this.ai.t <= 0) {
        this.planAi(w, enemy);
      }
      return;
    }
    if (this.ai.stage === "walk") {
      if (this.ai.dir && w.grounded && this.aiSafe(w, this.ai.dir)) {
        w.face = this.ai.dir as 1 | -1;
        this.walk(w, this.ai.dir, dt);
        w.anim = "walk";
      }
      if (this.ai.t <= 0) {
        this.ai.stage = "aim";
        this.ai.t = 0.45;
        w.anim = "aim";
      }
      return;
    }
    if (this.ai.stage === "aim") {
      w.aim = lerp(w.aim, this.ai.aim, 1 - Math.exp(-8 * dt));
      w.face = enemy.x >= w.x ? 1 : -1;
      w.anim = "aim";
      if (this.ai.t <= 0) {
        if (weaponDef(this.weapon).charges) {
          this.phase = "charge";
          this.power = 0.2;
          this.ai.stage = "charge";
        } else {
          this.doFire(w, this.ai.pow);
        }
      }
      return;
    }
    if (this.ai.stage === "charge") {
      this.power = clamp(this.power + dt * 0.9, 0.18, 1);
      if (this.power >= this.ai.pow) this.doFire(w, this.power);
    }
  }

  private planAi(w: Worm, enemy: Worm) {
    const dx = enemy.x - w.x;
    const dist = Math.abs(dx);
    if (dist < 42 && Math.abs(enemy.y - w.y) < 36) {
      this.weapon = "punch";
      w.face = dx >= 0 ? 1 : -1;
      this.doFire(w, 1);
      return;
    }
    const pack = this.ammo[w.team];
    if (pack.strike > 0 && dist > 220 && Math.random() < 0.22) {
      this.weapon = "strike";
      this.strikeX = enemy.x;
      this.doFire(w, 1);
      return;
    }
    if (pack.dynamite > 0 && dist < 70 && Math.random() < 0.2) {
      this.weapon = "dynamite";
      this.doFire(w, 1);
      return;
    }
    this.weapon = pack.grenade > 0 && Math.random() < 0.35 ? "grenade" : "bazooka";
    const sol = this.solve(w, enemy);
    this.ai.aim = sol.aim;
    this.ai.pow = sol.power;
    const noise = this.difficulty === "recruit" ? 0.22 : 0.07;
    this.ai.aim += (Math.random() - 0.5) * noise;
    this.ai.pow = clamp(this.ai.pow + (Math.random() - 0.5) * noise, 0.28, 1);
    this.ai.dir = dist > 90 ? (dx > 0 ? 1 : -1) : 0;
    this.ai.stage = this.ai.dir ? "walk" : "aim";
    this.ai.t = this.ai.dir ? 0.55 + Math.random() * 0.5 : 0.35;
  }

  private solve(w: Worm, target: Worm): { aim: number; power: number } {
    let best = { err: 1e9, aim: 0.6, power: 0.75 };
    const wind = this.wind;
    for (const power of [0.45, 0.6, 0.78, 0.95]) {
      for (let aim = 0.15; aim <= 1.2; aim += 0.07) {
        const err = this.simRocket(w, target, aim, power, wind);
        if (err < best.err) best = { err, aim, power };
      }
    }
    return best;
  }

  private simRocket(w: Worm, target: Worm, aim: number, power: number, wind: number) {
    const face: 1 | -1 = target.x >= w.x ? 1 : -1;
    const ang = face === 1 ? -aim : Math.PI + aim;
    const sp = 200 + 560 * power;
    let x = w.x + face * 14;
    let y = w.y - 16;
    let vx = Math.cos(ang) * sp;
    let vy = Math.sin(ang) * sp;
    let closest = 1e9;
    for (let i = 0; i < 200; i++) {
      vx += wind * 92 * STEP;
      vy += GRAVITY * STEP;
      x += vx * STEP;
      y += vy * STEP;
      const err = Math.hypot(x - target.x, y - (target.y - 8));
      if (err < closest) closest = err;
      if (this.terrain.solid(x, y) || y > WATER_Y) {
        return Math.hypot(x - target.x, y - (target.y - 8));
      }
    }
    return closest;
  }

  private nearestEnemy(w: Worm): Worm | undefined {
    let best: Worm | undefined;
    let d = 1e9;
    for (const o of this.worms) {
      if (o.dead || o.team === w.team) continue;
      const dd = Math.hypot(o.x - w.x, o.y - w.y);
      if (dd < d) {
        d = dd;
        best = o;
      }
    }
    return best;
  }

  private aiSafe(w: Worm, dir: number) {
    const nx = w.x + dir * 18;
    const sy = this.terrain.surfaceY(nx);
    if (sy < 0) return false;
    return sy < WATER_Y - 40 && sy > w.y - 50 && sy < w.y + 70;
  }

  pressFire() {
    if (this.screen !== "play" || this.loading) return;
    const w = this.active();
    if (!w || this.phase !== "turn") return;
    if (this.inputLock > 0) return;
    if (this.ai.on) return;
    const def = weaponDef(this.weapon);
    if (this.ammo[this.team][this.weapon] === 0) return;
    if (def.charges) {
      this.phase = "charge";
      this.power = 0.18;
      this.fireHeld = true;
      this.sfx.charge();
      w.anim = "aim";
    } else {
      this.doFire(w, 1);
    }
  }

  releaseFire() {
    this.fireHeld = false;
    if (this.screen !== "play") return;
    const w = this.active();
    if (!w || this.phase !== "charge") return;
    this.doFire(w, this.power);
  }

  skipTurn() {
    if (this.screen !== "play" || this.loading || this.phase !== "turn" || this.ai.on) return;
    this.sfx.click();
    this.toSettle(0.2);
  }

  jump() {
    this.jumpQueued = true;
    this.jumpBuf = 0.18;
  }

  setWeapon(id: WeaponId) {
    if (this.ai.on || this.loading) return;
    if (this.phase !== "turn" && this.phase !== "intro") return;
    if (this.ammo[this.team][id] === 0) return;
    this.weapon = id;
    this.loadout[this.team] = id;
    this.sfx.click();
    this.emit(true);
  }

  private doFire(w: Worm, power: number) {
    if (this.screen !== "play") return;
    if (this.phase !== "turn" && this.phase !== "charge") return;
    const ammo = this.ammo[this.team][this.weapon];
    if (ammo === 0) return;
    if (ammo > 0) this.ammo[this.team][this.weapon]--;
    const ang = this.fireAngle(w);
    const muzzleX = w.x + w.face * 14;
    const muzzleY = w.y - 16;
    w.anim = "aim";

    switch (this.weapon) {
      case "bazooka": {
        const sp = 200 + 560 * power;
        this.shots.push({
          kind: "rocket",
          x: muzzleX,
          y: muzzleY,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          fuse: 0,
          bounce: 0,
          windF: 1,
          blast: 48,
          dmg: 52,
          rot: ang,
          owner: w.id,
        });
        this.sfx.whoosh();
        this.phase = "fly";
        this.flyT = 0;
        break;
      }
      case "grenade": {
        const sp = 160 + 480 * power;
        this.shots.push({
          kind: "grenade",
          x: muzzleX,
          y: muzzleY,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          fuse: 2.65,
          bounce: 0.52,
          windF: 0.55,
          blast: 56,
          dmg: 58,
          rot: 0,
          owner: w.id,
        });
        this.sfx.whoosh();
        this.phase = "fly";
        this.flyT = 0;
        break;
      }
      case "dynamite": {
        this.shots.push({
          kind: "tnt",
          x: w.x + w.face * 10,
          y: w.y - 8,
          vx: 0,
          vy: 0,
          fuse: 4.4,
          bounce: 0.1,
          windF: 0,
          blast: 76,
          dmg: 78,
          rot: 0,
          owner: w.id,
        });
        this.sfx.tick();
        this.phase = "fly";
        this.flyT = 0;
        break;
      }
      case "shotgun": {
        this.sfx.whoosh();
        for (let i = 0; i < 2; i++) {
          const a = ang + (i === 0 ? -0.045 : 0.045);
          this.hitscan(w, a, 26, 16);
        }
        this.toSettle(0.55);
        break;
      }
      case "punch": {
        this.melee(w);
        this.toSettle(0.5);
        break;
      }
      case "strike": {
        const tx = this.strikeX ?? this.pointerWorld?.x ?? w.x + w.face * 180;
        this.launchPlane(tx);
        this.phase = "fly";
        this.flyT = 0;
        break;
      }
    }
    this.power = 0;
    this.fireHeld = false;
    this.emit(true);
  }

  private fireAngle(w: Worm) {
    return w.face === 1 ? -w.aim : Math.PI + w.aim;
  }

  private hitscan(w: Worm, ang: number, dmg: number, crater: number) {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let x = w.x + w.face * 8;
    let y = w.y - 16;
    for (let s = 0; s < 540; s += 4) {
      x += dx * 4;
      y += dy * 4;
      for (const o of this.worms) {
        if (o.dead || o.id === w.id) continue;
        if (Math.hypot(x - o.x, y - (o.y - WORM_R)) < WORM_R + 3) {
          this.hurt(o, dmg, dx * 220, dy * 180 - 80);
          this.spark(x, y);
          this.terrain.destroy(x, y, crater * 0.6);
          this.particles.push({ x, y, vx: 0, vy: 0, life: 0.12, max: 0.12, size: 8, kind: "tracer" });
          return;
        }
      }
      if (this.terrain.solid(x, y)) {
        this.terrain.destroy(x, y, crater);
        this.burstDirt(x, y, 8);
        this.spark(x, y);
        return;
      }
    }
    this.particles.push({
      x: w.x,
      y: w.y - 16,
      vx: dx * 400,
      vy: dy * 400,
      life: 0.12,
      max: 0.12,
      size: 3,
      kind: "tracer",
    });
  }

  private melee(w: Worm) {
    const tx = w.x + w.face * 26;
    const ty = w.y - 10;
    let hit = false;
    for (const o of this.worms) {
      if (o.dead || o.id === w.id) continue;
      if (Math.hypot(o.x - tx, o.y - ty) < 28) {
        this.hurt(o, 32, w.face * 360, -220);
        hit = true;
      }
    }
    this.spark(tx, ty);
    if (hit) {
      this.sfx.hurt();
      this.trauma = Math.min(1, this.trauma + 0.25);
    } else this.sfx.click();
  }

  private launchPlane(tx: number) {
    const fromLeft = Math.random() < 0.5;
    const drops = [tx - 46, tx - 18, tx + 8, tx + 34, tx + 58];
    if (!fromLeft) drops.reverse();
    this.planes.push({
      x: fromLeft ? -80 : WORLD_W + 80,
      y: 70,
      vx: fromLeft ? 340 : -340,
      dropXs: drops,
      dropped: 0,
    });
    this.sfx.whoosh();
  }

  private walk(w: Worm, dir: number, dt: number) {
    w.walkAcc += WALK_SPEED * dt;
    const steps = w.walkAcc | 0;
    w.walkAcc -= steps;
    for (let i = 0; i < steps; i++) this.tryStep(w, dir);
  }

  private tryStep(w: Worm, dir: number) {
    const nx = w.x + dir;
    if (nx < 18 || nx > WORLD_W - 18) return false;
    const ox = w.x;
    const oy = w.y;
    w.x = nx;
    let climb = 0;
    while (this.bodyHits(w.x, w.y) && climb < MAX_CLIMB) {
      w.y -= 1;
      climb++;
    }
    if (this.bodyHits(w.x, w.y) || this.occupied(w, w.x, w.y)) {
      w.x = ox;
      w.y = oy;
      return false;
    }
    let drop = 0;
    while (!this.feetGround(w.x, w.y) && drop < MAX_CLIMB && !this.bodyHits(w.x, w.y + 1)) {
      w.y += 1;
      drop++;
    }
    return true;
  }

  private feetGround(x: number, y: number) {
    return this.terrain.solid(x, y + 1) || this.terrain.solid(x - 3, y + 1) || this.terrain.solid(x + 3, y + 1);
  }

  private bodyHits(x: number, y: number) {
    const cx = x;
    const cy = y - WORM_R;
    const pts: [number, number][] = [
      [0, -8],
      [0, 5],
      [-6, -1],
      [6, -1],
      [-4, -6],
      [4, -6],
    ];
    for (const [ox, oy] of pts) {
      if (this.terrain.solid(cx + ox, cy + oy)) return true;
    }
    return false;
  }

  private occupied(self: Worm, x: number, y: number) {
    for (const o of this.worms) {
      if (o.dead || o.id === self.id) continue;
      if (Math.abs(o.x - x) < 14 && Math.abs(o.y - y) < 18) return true;
    }
    return false;
  }

  private unstick(w: Worm) {
    let guard = 0;
    while (this.bodyHits(w.x, w.y) && guard < 48) {
      w.y -= 1;
      guard++;
    }
    if (this.bodyHits(w.x, w.y)) {
      const sy = this.terrain.surfaceY(w.x);
      if (sy > 0) w.y = sy - 1;
    }
  }

  private stepWorms(dt: number, canControl: boolean) {
    for (const w of this.worms) {
      if (w.dead) {
        if (!w.grounded && w.y < WATER_Y + 50) {
          w.vy += GRAVITY * dt;
          w.vy = Math.min(w.vy, 980);
          w.y += w.vy * dt;
          if (this.feetGround(w.x, w.y)) {
            w.grounded = true;
            w.vy = 0;
            this.unstick(w);
          }
        }
        continue;
      }
      w.animT += dt;
      if (w.hurtT > 0) {
        w.hurtT -= dt;
        w.anim = "hurt";
      }
      if (w.flashT > 0) w.flashT -= dt;
      const wasAir = !w.grounded;
      const on = this.feetGround(w.x, w.y);
      if (on && w.vy >= 0) {
        if (wasAir && w.vy > 180) this.burstDirt(w.x, w.y, w.vy > 420 ? 10 : 5);
        if (wasAir && w.vy > 520) {
          const dmg = Math.min(45, ((w.vy - 520) / 14) | 0);
          if (dmg > 0) this.hurt(w, dmg, 0, 0);
        }
        w.grounded = true;
        w.vy = 0;
        w.vx *= 0.4;
        this.unstick(w);
      } else {
        w.grounded = false;
        w.vy += GRAVITY * dt;
        w.vy = Math.min(w.vy, 980);
        const steps = 4;
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
          w.x += w.vx * h;
          if (w.x < 18 || w.x > WORLD_W - 18 || this.bodyHits(w.x, w.y)) {
            w.x -= w.vx * h;
            w.vx *= -0.2;
          }
          w.y += w.vy * h;
          if (w.vy < 0 && this.bodyHits(w.x, w.y)) {
            w.y -= w.vy * h;
            w.vy *= 0.2;
          }
          if (w.vy > 0 && this.feetGround(w.x, w.y)) {
            this.unstick(w);
            break;
          }
        }
      }

      if (w.y - 4 > WATER_Y) {
        w.drownT += dt;
        w.vy = Math.min(w.vy, 48);
        w.vx *= 0.9;
        if (Math.random() < 0.07) this.splash(w.x, WATER_Y);
        while (w.drownT >= 0.24) {
          w.drownT -= 0.24;
          this.hurt(w, 10, 0, 0, true);
        }
      } else {
        w.drownT = 0;
      }
      if (w.hp <= 0 && !w.dead) this.kill(w);
      if (canControl && w !== this.active() && w.grounded) {
        if (w.anim !== "hurt") w.anim = "idle";
      }
    }
  }

  private stepShots(dt: number) {
    const keep: Shot[] = [];
    for (const s of this.shots) {
      if (s.fuse > 0) {
        s.fuse -= dt;
        if (s.kind === "tnt" && s.fuse < 3 && ((s.fuse * 8) | 0) !== (((s.fuse + dt) * 8) | 0)) this.sfx.tick();
      }
      const subs = 6;
      const h = dt / subs;
      let dead = false;
      for (let i = 0; i < subs; i++) {
        s.vx += this.wind * 92 * s.windF * h;
        if (s.kind !== "tnt" || !this.terrain.solid(s.x, s.y + 6)) s.vy += GRAVITY * h;
        if (s.kind === "tnt" && this.terrain.solid(s.x, s.y + 5)) {
          s.vx *= 0.78;
          if (Math.abs(s.vx) < 12) s.vx = 0;
          s.vy = Math.min(s.vy, 20);
        }
        s.x += s.vx * h;
        s.y += s.vy * h;
        if (s.kind === "grenade") s.rot += h * 8;
        if (s.x < 0 || s.x > WORLD_W || s.y > WORLD_H + 40) {
          const ey = Math.min(s.y, WATER_Y);
          if (s.y > WATER_Y) this.splash(s.x, WATER_Y);
          this.explode(s.x, ey, s.blast * (s.y > WATER_Y ? 0.65 : 1), s.dmg * (s.y > WATER_Y ? 0.55 : 1));
          dead = true;
          break;
        }
        if (s.y > WATER_Y + 12) {
          if (s.kind === "tnt" || s.kind === "grenade") {
            s.vy = Math.min(s.vy, 36);
            s.vx *= 0.9;
            if (s.y > WATER_Y + 28) s.y = WATER_Y + 28;
          } else {
            this.splash(s.x, WATER_Y);
            this.explode(s.x, WATER_Y, s.blast * 0.65, s.dmg * 0.55);
            dead = true;
            break;
          }
        }
        const hit = this.terrain.solid(s.x, s.y);
        if (hit) {
          if (s.bounce > 0) {
            s.x -= s.vx * h;
            s.y -= s.vy * h;
            const n = this.terrain.normal(s.x, s.y);
            const dot = s.vx * n.x + s.vy * n.y;
            s.vx = (s.vx - 2 * dot * n.x) * s.bounce;
            s.vy = (s.vy - 2 * dot * n.y) * s.bounce;
            s.x += n.x * 3;
            s.y += n.y * 3;
            if (Math.hypot(s.vx, s.vy) < 40) {
              s.vx = 0;
              s.vy = 0;
            }
          } else {
            this.explode(s.x, s.y, s.blast, s.dmg);
            dead = true;
            break;
          }
        }
        for (const w of this.worms) {
          if (w.dead || w.id === s.owner) continue;
          if (Math.hypot(s.x - w.x, s.y - (w.y - WORM_R)) < WORM_R + 4) {
            if (s.bounce > 0) {
              const nx = s.x - w.x;
              const ny = s.y - (w.y - WORM_R);
              const m = Math.hypot(nx, ny) || 1;
              s.x += (nx / m) * 6;
              s.y += (ny / m) * 6;
              s.vx += (nx / m) * 90;
              s.vy += (ny / m) * 70 - 30;
              break;
            }
            this.explode(s.x, s.y, s.blast, s.dmg);
            dead = true;
            break;
          }
        }
        if (dead) break;
      }
      if (!dead && s.fuse <= 0 && s.kind !== "rocket" && s.kind !== "bomb") {
        this.explode(s.x, s.y, s.blast, s.dmg);
        dead = true;
      }
      if (!dead) keep.push(s);
    }
    this.shots = keep;
  }

  private stepPlanes(dt: number) {
    const keep: PlaneRun[] = [];
    for (const p of this.planes) {
      p.x += p.vx * dt;
      const goingRight = p.vx > 0;
      while (p.dropped < p.dropXs.length) {
        const tx = p.dropXs[p.dropped];
        if ((goingRight && p.x >= tx) || (!goingRight && p.x <= tx)) {
          this.shots.push({
            kind: "bomb",
            x: p.x,
            y: p.y + 12,
            vx: p.vx * 0.15,
            vy: 40,
            fuse: 0,
            bounce: 0,
            windF: 0.3,
            blast: 42,
            dmg: 40,
            rot: 0.2,
            owner: -1,
          });
          p.dropped++;
        } else break;
      }
      if ((goingRight && p.x < WORLD_W + 120) || (!goingRight && p.x > -120)) keep.push(p);
    }
    this.planes = keep;
  }

  private flushBooms() {
    let guard = 0;
    while (this.pendingBooms.length && guard++ < 24) {
      const b = this.pendingBooms.shift()!;
      this.explode(b.x, b.y, b.r, b.dmg);
    }
  }

  private separateWorms() {
    for (let i = 0; i < this.worms.length; i++) {
      const a = this.worms[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.worms.length; j++) {
        const b = this.worms[j];
        if (b.dead) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= 16 || d < 0.01) continue;
        const push = (16 - d) * 0.45;
        const nx = dx / d;
        a.x -= nx * push;
        b.x += nx * push;
        a.x = clamp(a.x, 18, WORLD_W - 18);
        b.x = clamp(b.x, 18, WORLD_W - 18);
        if (a.grounded) this.unstick(a);
        if (b.grounded) this.unstick(b);
      }
    }
  }

  private explode(x: number, y: number, r: number, dmg: number) {
    this.terrain.destroy(x, y, r);
    this.booms.push({ x, y, t: 0, r });
    this.burstDirt(x, y, 16 + (r / 6) | 0);
    this.sfx.boom(r > 60);
    this.trauma = Math.min(1, this.trauma + (r > 60 ? 0.85 : 0.55));
    if (!this.reduceMotion) this.freeze = r > 60 ? 0.07 : 0.04;
    for (const w of this.worms) {
      if (w.dead) continue;
      const dx = w.x - x;
      const dy = w.y - WORM_R - y;
      const dist = Math.hypot(dx, dy);
      const reach = r + 18;
      if (dist < reach) {
        const fall = 1 - dist / reach;
        const d = Math.max(6, (dmg * fall) | 0);
        const k = 280 + 420 * fall;
        const nx = dist < 1 ? 0 : dx / dist;
        const ny = dist < 1 ? -1 : dy / dist;
        this.hurt(w, d, nx * k, ny * k - 120 * fall);
      }
    }
    if (y > WATER_Y - 10) this.splash(x, WATER_Y);
  }

  private hurt(w: Worm, dmg: number, kvx: number, kvy: number, silent = false) {
    if (w.dead) return;
    const d = Math.max(1, dmg | 0);
    w.hp = Math.max(0, w.hp - d);
    if (kvx !== 0 || kvy !== 0) {
      w.vx += kvx;
      w.vy += kvy;
      w.grounded = false;
    }
    w.hurtT = 0.35;
    w.flashT = 0.14;
    w.animT = 0;
    w.anim = "hurt";
    if (!silent) this.sfx.hurt();
    this.particles.push({
      x: w.x,
      y: w.y - 28,
      vx: 0,
      vy: -40,
      life: 0.8,
      max: 0.8,
      size: 12,
      kind: "num",
      text: `-${d}`,
      color: "#ece6d8",
    });
    if (w.hp <= 0) this.kill(w);
  }

  private kill(w: Worm) {
    if (w.dead) return;
    const wasActive = this.active()?.id === w.id;
    w.dead = true;
    w.hp = 0;
    w.anim = "dead";
    if (w.y - 4 > WATER_Y) this.splash(w.x, WATER_Y);
    else this.pendingBooms.push({ x: w.x, y: w.y - 8, r: 22, dmg: 12 });
    this.banner = `${w.name} caiu`;
    this.bannerT = 1.1;
    if (this.checkWin()) return;
    if (wasActive && (this.phase === "turn" || this.phase === "charge" || this.phase === "intro")) {
      this.toSettle(0.5);
    }
  }

  private burstDirt(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 280;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 80,
        life: 0.4 + Math.random() * 0.5,
        max: 1,
        size: 2 + Math.random() * 4,
        kind: Math.random() < 0.35 ? "smoke" : "dirt",
      });
    }
  }

  private spark(x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * 180,
        vy: Math.sin(a) * 180,
        life: 0.18,
        max: 0.18,
        size: 2,
        kind: "spark",
      });
    }
  }

  private splash(x: number, y: number) {
    if (this.time - this.splashAt > 0.09) {
      this.sfx.splash();
      this.splashAt = this.time;
    }
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 140,
        vy: -80 - Math.random() * 120,
        life: 0.45,
        max: 0.45,
        size: 3,
        kind: "splash",
      });
    }
  }

  private stepFx(dt: number) {
    this.bannerT -= dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += (p.kind === "smoke" ? -20 : GRAVITY * 0.45) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0).slice(-180);
    for (const b of this.booms) b.t += dt;
    this.booms = this.booms.filter((b) => b.t < 0.42);
  }

  private viewW() {
    return this.cssW / this.zoom;
  }
  private viewH() {
    return this.cssH / this.zoom;
  }

  private lookAt(x: number, y: number) {
    this.camTX = x - this.viewW() / 2;
    this.camTY = y - this.viewH() * 0.64;
  }

  private updateCam(dt: number) {
    if (this.phase === "fly") {
      const s = this.shots.length ? this.shots[this.shots.length - 1] : null;
      const p = this.planes[0];
      if (s) this.lookAt(s.x, s.y);
      else if (p) this.lookAt(p.x, p.y + 80);
    } else {
      const w = this.active();
      if (w) {
        const ang = this.fireAngle(w);
        const lead = this.phase === "turn" || this.phase === "charge" ? 36 : 0;
        this.lookAt(w.x + Math.cos(ang) * lead, w.y + Math.sin(ang) * lead * 0.4);
      }
    }
    const k = 1 - Math.exp(-5.5 * dt);
    this.camX += (this.camTX - this.camX) * k;
    this.camY += (this.camTY - this.camY) * k;
    const maxX = Math.max(0, WORLD_W - this.viewW());
    const maxY = Math.max(0, WORLD_H - this.viewH() + 40);
    this.camX = clamp(this.camX, 0, maxX);
    this.camY = clamp(this.camY, -20, maxY);
  }

  private draw() {
    const { ctx, canvas, dpr } = this;
    const cssW = this.cssW;
    const cssH = this.cssH;
    if (canvas.width !== ((cssW * dpr) | 0) || canvas.height !== ((cssH * dpr) | 0)) {
      canvas.width = (cssW * dpr) | 0;
      canvas.height = (cssH * dpr) | 0;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const sky = this.imgs["sky.jpg"];
    if (sky) ctx.drawImage(sky, 0, 0, cssW, cssH);
    else {
      ctx.fillStyle = "#1a2430";
      ctx.fillRect(0, 0, cssW, cssH);
    }

    const shake = this.reduceMotion ? 0 : this.trauma * this.trauma;
    const sx = shake ? (Math.random() * 2 - 1) * 14 * shake : 0;
    const sy = shake ? (Math.random() * 2 - 1) * 10 * shake : 0;
    const z = this.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (-this.camX * z + sx), dpr * (-this.camY * z + sy));

    ctx.drawImage(this.terrain.canvas, 0, 0);

    this.drawWater();
    this.drawShots();
    this.drawPlanes();
    this.drawWorms();
    this.drawBooms();
    this.drawWaterOverlay();
    this.drawParticles();
    if (this.screen === "play" && (this.phase === "turn" || this.phase === "charge")) this.drawAim();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.bannerT > 0 && this.screen === "play") this.drawBanner();
    if (this.phase === "charge") this.drawPowerHud();
  }

  private drawWater() {
    const ctx = this.ctx;
    const t = this.time;
    ctx.fillStyle = "rgba(18, 42, 52, 0.92)";
    ctx.fillRect(0, WATER_Y + 6, WORLD_W, WORLD_H - WATER_Y);
    ctx.beginPath();
    ctx.moveTo(0, WATER_Y);
    for (let x = 0; x <= WORLD_W; x += 10) {
      const y = WATER_Y + Math.sin(x * 0.02 + t * 2.1) * 3.2 + Math.sin(x * 0.051 + t * 3.4) * 1.8;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(WORLD_W, WORLD_H);
    ctx.lineTo(0, WORLD_H);
    ctx.closePath();
    ctx.fillStyle = "rgba(46, 118, 132, 0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(210, 236, 232, 0.35)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let x = 0; x <= WORLD_W; x += 10) {
      const y = WATER_Y + Math.sin(x * 0.02 + t * 2.1) * 3.2;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private drawWaterOverlay() {
    const ctx = this.ctx;
    const t = this.time;
    ctx.fillStyle = "rgba(36, 98, 112, 0.38)";
    ctx.fillRect(0, WATER_Y + 2, WORLD_W, WORLD_H - WATER_Y);
    ctx.beginPath();
    for (let x = 0; x <= WORLD_W; x += 10) {
      const y = WATER_Y + Math.sin(x * 0.02 + t * 2.1) * 3.2 + Math.sin(x * 0.051 + t * 3.4) * 1.4;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(210, 236, 232, 0.28)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  private drawWorms() {
    const ctx = this.ctx;
    const ordered = [...this.worms].sort((a, b) => a.y - b.y);
    for (const w of ordered) {
      if (w.dead) {
        if (!w.grounded && w.y < WATER_Y - 4) {
          const sheet = this.sheets[w.team].hurt ?? this.sheets[w.team].idle;
          const dw = WORM_DRAW;
          const dh = WORM_DRAW;
          const dx = w.x - dw / 2;
          const dy = w.y - dh + 4;
          ctx.save();
          ctx.globalAlpha = 0.85;
          if (sheet) blit(ctx, sheet, 3, dx, dy, dw, dh, w.face === -1);
          else {
            ctx.fillStyle = w.team === 0 ? "#6b7c4a" : "#9a3b3b";
            ctx.beginPath();
            ctx.ellipse(w.x, w.y - 10, 10, 14, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        } else {
          this.drawGrave(w);
        }
        continue;
      }
      const sheet = this.sheets[w.team][w.anim === "walk" ? "walk" : w.anim === "aim" ? "aim" : w.anim === "hurt" ? "hurt" : "idle"];
      const frame =
        w.anim === "hurt"
          ? Math.min(3, ((0.35 - Math.max(0, w.hurtT)) * 10) | 0)
          : (w.animT * (w.anim === "walk" ? 8 : 4)) % 4 | 0;
      const dw = WORM_DRAW;
      const dh = WORM_DRAW;
      const dx = w.x - dw / 2;
      const dy = w.y - dh + 4;
      if (sheet) blit(ctx, sheet, frame, dx, dy, dw, dh, w.face === -1);
      else {
        ctx.fillStyle = w.team === 0 ? "#6b7c4a" : "#9a3b3b";
        ctx.beginPath();
        ctx.ellipse(w.x, w.y - 10, 10, 14, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (w.flashT > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.7, w.flashT * 6);
        ctx.fillStyle = "#ece6d8";
        ctx.beginPath();
        ctx.ellipse(w.x, w.y - 12, 12, 16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if ((this.weapon === "bazooka" || this.weapon === "shotgun") && w === this.active() && (this.phase === "turn" || this.phase === "charge")) {
        const gun = this.imgs["bazooka.png"];
        const ang = this.fireAngle(w);
        ctx.save();
        ctx.translate(w.x + w.face * 6, w.y - 16);
        ctx.rotate(ang);
        if (gun) ctx.drawImage(gun, 0, -10, 34, 20);
        else {
          ctx.fillStyle = "#6b7c4a";
          ctx.fillRect(0, -3, 22, 6);
        }
        ctx.restore();
      }
      const teamCol = w.team === 0 ? "#8b9a6a" : "#c45c5c";
      ctx.font = "600 11px Outfit, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(11,13,16,0.55)";
      ctx.fillText(w.name, w.x + 1, w.y - dh + 1);
      ctx.fillStyle = "#ece6d8";
      ctx.fillText(w.name, w.x, w.y - dh);
      ctx.fillStyle = "rgba(11,13,16,0.7)";
      ctx.fillRect(w.x - 16, w.y - dh - 8, 32, 4);
      ctx.fillStyle = teamCol;
      ctx.fillRect(w.x - 16, w.y - dh - 8, 32 * (w.hp / 100), 4);
      if (w === this.active() && this.screen === "play") {
        const pulse = 0.6 + Math.sin(this.time * 6) * 0.4;
        ctx.fillStyle = `rgba(236,230,216,${0.35 + pulse * 0.4})`;
        ctx.beginPath();
        ctx.moveTo(w.x, w.y - dh - 16);
        ctx.lineTo(w.x - 6, w.y - dh - 26);
        ctx.lineTo(w.x + 6, w.y - dh - 26);
        ctx.fill();
      }
    }
  }

  private drawGrave(w: Worm) {
    if (w.y > WATER_Y - 4) return;
    const ctx = this.ctx;
    const x = w.x;
    const y = w.y;
    ctx.fillStyle = "rgba(22,24,28,0.45)";
    ctx.fillRect(x - 8, y - 2, 16, 3);
    ctx.fillStyle = "#c8c2b4";
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 2);
    ctx.lineTo(x - 7, y - 20);
    ctx.quadraticCurveTo(x, y - 28, x + 7, y - 20);
    ctx.lineTo(x + 7, y - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = w.team === 0 ? "#6b7c4a" : "#9a3b3b";
    ctx.font = "700 11px Teko, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(w.name[0] ?? "", x, y - 10);
  }

  private drawAim() {
    const w = this.active();
    if (!w || this.ai.on) return;
    const ctx = this.ctx;
    const ang = this.fireAngle(w);
    const x = w.x + w.face * 10;
    const y = w.y - 16;
    const len = 34 + (this.phase === "charge" ? this.power * 22 : 0);
    ctx.strokeStyle = "rgba(236,230,216,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
    if (this.weapon === "bazooka" || this.weapon === "grenade") this.drawTrajectory(w);
    if (this.weapon === "strike") {
      const sx = this.strikeX ?? this.pointerWorld?.x ?? w.x;
      ctx.strokeStyle = "rgba(236,230,216,0.35)";
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, WATER_Y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawTrajectory(w: Worm) {
    const power = this.phase === "charge" ? this.power : 0.58;
    const ang = this.fireAngle(w);
    const sp = this.weapon === "bazooka" ? 200 + 560 * power : 160 + 480 * power;
    const windF = this.weapon === "bazooka" ? 1 : 0.55;
    let x = w.x + w.face * 14;
    let y = w.y - 16;
    let vx = Math.cos(ang) * sp;
    let vy = Math.sin(ang) * sp;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(236,230,216,0.55)";
    for (let i = 0; i < 70; i++) {
      vx += this.wind * 92 * windF * STEP;
      vy += GRAVITY * STEP;
      x += vx * STEP;
      y += vy * STEP;
      if (this.terrain.solid(x, y) || y > WATER_Y) break;
      if (i % 3 === 0) {
        ctx.beginPath();
        ctx.arc(x, y, i > 40 ? 1.2 : 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawShots() {
    const ctx = this.ctx;
    for (const s of this.shots) {
      const img =
        s.kind === "rocket"
          ? this.imgs["rocket.png"]
          : s.kind === "grenade" || s.kind === "bomb"
            ? this.imgs["grenade.png"]
            : s.kind === "tnt"
              ? this.imgs["dynamite.png"]
              : null;
      const frame = ((this.time * 8) | 0) % 4;
      if (img) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.kind === "rocket" ? Math.atan2(s.vy, s.vx) : s.rot);
        blit(ctx, img, frame, -16, -16, 32, 32, false);
        ctx.restore();
      } else {
        ctx.fillStyle = s.kind === "tnt" ? "#9a3b3b" : "#c5cdd4";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.kind === "tnt" ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (s.kind === "tnt") {
        ctx.fillStyle = "#ece6d8";
        ctx.font = "700 13px Teko, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(Math.max(1, Math.ceil(s.fuse))), s.x, s.y - 18);
      }
    }
  }

  private drawPlanes() {
    const img = this.imgs["plane.png"];
    for (const p of this.planes) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.vx < 0) ctx.scale(-1, 1);
      if (img) ctx.drawImage(img, -70, -28, 140, 56);
      else {
        ctx.fillStyle = "#6b7c4a";
        ctx.fillRect(-40, -8, 80, 16);
      }
      ctx.restore();
    }
  }

  private drawBooms() {
    const img = this.imgs["explosion.png"];
    for (const b of this.booms) {
      const frame = Math.min(3, (b.t * 10) | 0);
      const s = b.r * 2.4;
      if (img) blit(this.ctx, img, frame, b.x - s / 2, b.y - s / 2, s, s, false);
      else {
        this.ctx.fillStyle = `rgba(236,160,60,${1 - b.t * 2.2})`;
        this.ctx.beginPath();
        this.ctx.arc(b.x, b.y, b.r * (0.6 + b.t * 2), 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  private drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const a = p.life / (p.max || 1);
      if (p.kind === "num" && p.text) {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color ?? "#ece6d8";
        ctx.font = "700 14px Outfit, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(p.text, p.x, p.y);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.globalAlpha = Math.max(0, a);
      if (p.kind === "smoke") ctx.fillStyle = "rgba(70,62,54,0.8)";
      else if (p.kind === "spark") ctx.fillStyle = "#ece6d8";
      else if (p.kind === "splash") ctx.fillStyle = "rgba(160,210,214,0.8)";
      else if (p.kind === "tracer") ctx.fillStyle = "rgba(236,230,216,0.7)";
      else ctx.fillStyle = "#6a4a32";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawBanner() {
    const ctx = this.ctx;
    const a = clamp(this.bannerT * 2, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(11,13,16,0.62)";
    const w = Math.min(420, this.cssW - 32);
    ctx.fillRect((this.cssW - w) / 2, 72, w, 44);
    ctx.fillStyle = "#ece6d8";
    ctx.font = "600 28px Teko, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(this.banner, this.cssW / 2, 102);
    ctx.globalAlpha = 1;
  }

  private drawPowerHud() {
    const ctx = this.ctx;
    const w = Math.min(220, this.cssW - 48);
    const x = (this.cssW - w) / 2;
    const y = this.cssH - (this.touch ? 138 : 78);
    ctx.fillStyle = "rgba(11,13,16,0.55)";
    ctx.fillRect(x, y, w, 10);
    ctx.fillStyle = "#ece6d8";
    ctx.fillRect(x, y, w * this.power, 10);
  }

  resize() {
    const parent = this.canvas.parentElement;
    this.cssW = parent?.clientWidth || window.innerWidth;
    this.cssH = parent?.clientHeight || window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
  }

  private bind() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVis);
    this.canvas.addEventListener("pointerdown", this.onPtrDown);
    this.canvas.addEventListener("pointermove", this.onPtrMove);
    this.canvas.addEventListener("pointerup", this.onPtrUp);
    this.canvas.addEventListener("pointercancel", this.onPtrUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "ArrowDown") e.preventDefault();
    this.keys.add(e.code);
    this.sfx.unlock();
    if (e.code === "KeyP" || e.code === "Escape") {
      if (this.screen === "play" || this.screen === "pause") this.pause();
      else if (this.screen === "help") this.showHelp(false);
      return;
    }
    if (this.screen === "menu" && e.code === "Enter") {
      this.play(this.mode);
      return;
    }
    if (this.screen === "win" && e.code === "Enter") {
      this.play(this.mode);
      return;
    }
    if (this.screen !== "play") return;
    if (e.code === "Digit1") this.setWeapon("bazooka");
    if (e.code === "Digit2") this.setWeapon("grenade");
    if (e.code === "Digit3") this.setWeapon("dynamite");
    if (e.code === "Digit4") this.setWeapon("shotgun");
    if (e.code === "Digit5") this.setWeapon("punch");
    if (e.code === "Digit6") this.setWeapon("strike");
    if (e.code === "KeyJ" || e.code === "ShiftLeft" || e.code === "ShiftRight") this.jump();
    if (e.code === "KeyN") this.skipTurn();
    if (e.code === "Enter" && this.phase === "turn" && !weaponDef(this.weapon).charges) this.pressFire();
    if (e.code === "Space" && this.phase === "turn") this.pressFire();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === "Space") this.releaseFire();
  };

  private onBlur = () => {
    this.keys.clear();
    this.fireHeld = false;
    this.pointerHeld = false;
    this.walkPad = 0;
    if (this.phase === "charge" && this.screen === "play") {
      this.phase = "turn";
      this.power = 0;
    }
  };

  private onResize = () => this.resize();

  private onVis = () => {
    if (document.visibilityState === "visible") this.sfx.unlock();
    else if (this.screen === "play") this.pause();
  };

  private toWorld(ev: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / this.zoom + this.camX;
    const y = (ev.clientY - rect.top) / this.zoom + this.camY;
    return { x, y };
  }

  private onPtrDown = (ev: PointerEvent) => {
    this.sfx.unlock();
    this.pointerWorld = this.toWorld(ev);
    this.pointerAimT = 0.7;
    if (this.hudFire) return;
    if (this.screen !== "play" || this.loading) return;
    if (this.phase !== "turn" && this.phase !== "charge") return;
    if (this.inputLock > 0) return;
    this.pointerHeld = true;
    this.fireHeld = true;
    this.pressFire();
  };

  private onPtrMove = (ev: PointerEvent) => {
    this.pointerWorld = this.toWorld(ev);
    this.pointerAimT = 0.7;
  };

  private onPtrUp = () => {
    this.pointerHeld = false;
    if (!this.hudFire) this.releaseFire();
    this.fireHeld = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom = clamp(this.zoom * (e.deltaY > 0 ? 0.94 : 1.06), 0.72, 1.7);
  };

  setWalk(dir: number) {
    this.walkPad = dir;
  }

  releaseWalk(dir: number) {
    if (this.walkPad === dir) this.walkPad = 0;
  }

  setMuted(v: boolean) {
    this.muted = v;
    this.sfx.setMuted(v);
    writePrefs(this.muted, this.difficulty);
    this.emit(true);
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    writePrefs(this.muted, this.difficulty);
    this.emit(true);
  }

  pause() {
    if (this.screen === "play") {
      if (this.phase === "charge") {
        this.phase = "turn";
        this.power = 0;
        this.fireHeld = false;
      }
      this.screen = "pause";
    } else if (this.screen === "pause") this.screen = "play";
    this.emit(true);
  }

  toMenu() {
    this.screen = "menu";
    this.worms = [];
    this.previewMap();
    this.emit(true);
  }

  showHelp(v: boolean) {
    this.screen = v ? "help" : "menu";
    this.emit(true);
  }

  private installProbe() {
    window.__controlsTest = {
      getYaw: () => this.active()?.x ?? 0,
      getSpeed: () => {
        const w = this.active();
        return w ? Math.abs(w.vx) + (w.anim === "walk" ? 40 : 0) : 0;
      },
      setKeys: (codes: string[]) => {
        this.forcedKeys = codes.length ? new Set(codes) : null;
      },
      getX: () => this.active()?.x ?? 0,
      getY: () => this.active()?.y ?? 0,
      getGrounded: () => this.active()?.grounded ?? false,
      getPhase: () => this.phase,
      getScreen: () => this.screen,
      getTeam: () => this.team,
      getWeapon: () => this.weapon,
      getMap: () => this.terrain.kind,
      pressFire: () => this.pressFire(),
      releaseFire: () => this.releaseFire(),
      setWeapon: (id: string) => this.setWeapon(id as WeaponId),
      skip: () => this.skipTurn(),
      jump: () => this.jump(),
      zoomOut: () => {
        this.zoom = 0.72;
        this.camX = 0;
        this.camY = 0;
        this.camTX = 0;
        this.camTY = 0;
      },
      dump: () => ({
        screen: this.screen,
        phase: this.phase,
        team: this.team,
        weapon: this.weapon,
        map: this.terrain.kind,
        timer: +this.timer.toFixed(1),
        wind: +this.wind.toFixed(2),
        ai: this.ai.on ? this.ai.stage : "off",
        shots: this.shots.length,
        planes: this.planes.map((p) => ({ x: p.x | 0, dropped: p.dropped, n: p.dropXs.length })),
        active: this.active()
          ? { name: this.active()!.name, x: this.active()!.x | 0, y: this.active()!.y | 0, hp: this.active()!.hp, grounded: this.active()!.grounded, dead: this.active()!.dead }
          : null,
        worms: this.worms.map((w) => ({
          n: w.name,
          t: w.team,
          hp: w.hp,
          x: w.x | 0,
          y: w.y | 0,
          g: w.grounded,
          dead: w.dead,
          water: w.y - 4 > WATER_Y,
        })),
      }),
    };
  }

  snapshot(): UiSnap {
    return {
      screen: this.screen,
      loading: this.loading,
      loadMsg: this.loadMsg,
      mode: this.mode,
      difficulty: this.difficulty,
      phase: this.phase,
      team: this.team,
      wormName: this.active()?.name ?? "",
      timer: Math.max(0, this.timer),
      wind: this.wind,
      weapon: this.weapon,
      ammo: this.ammo[this.team],
      banner: this.banner,
      winner: this.winner,
      muted: this.muted,
      touch: this.touch,
      hpA: this.worms.filter((w) => w.team === 0).map((w) => w.hp),
      hpB: this.worms.filter((w) => w.team === 1).map((w) => w.hp),
      namesA: [...NAMES_A],
      namesB: [...NAMES_B],
      charging: this.phase === "charge",
      power: this.power,
      canAct: this.screen === "play" && !this.ai.on && this.phase === "turn",
    };
  }

  private emit(force: boolean) {
    const snap = this.snapshot();
    const key = `${snap.screen}|${snap.phase}|${snap.team}|${snap.weapon}|${snap.timer | 0}|${snap.loading}|${snap.winner}|${snap.hpA}|${snap.hpB}|${snap.charging}`;
    if (!force && key === this.lastUi) return;
    this.lastUi = key;
    this.onUi(snap);
  }
}

function blit(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  frame: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  flip: boolean,
) {
  const cols = 2;
  const fw = img.width / cols;
  const fh = img.height / cols;
  const sx = (frame % cols) * fw;
  const sy = Math.floor(frame / cols) * fh;
  ctx.save();
  if (flip) {
    ctx.translate(dx + dw / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(dx + dw / 2), 0);
  }
  ctx.drawImage(img, sx, sy, fw, fh, dx, dy, dw, dh);
  ctx.restore();
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys?: (codes: string[]) => void;
      getX?: () => number;
      getY?: () => number;
      getGrounded?: () => boolean;
      getPhase?: () => string;
      getScreen?: () => string;
      getTeam?: () => number;
      getWeapon?: () => string;
      getMap?: () => string;
      pressFire?: () => void;
      releaseFire?: () => void;
      setWeapon?: (id: string) => void;
      skip?: () => void;
      jump?: () => void;
      zoomOut?: () => void;
      dump?: () => unknown;
    };
  }
}
