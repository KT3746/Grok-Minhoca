export const WORLD_W = 2200;
export const WORLD_H = 760;
export const WATER_Y = 700;
export const STEP = 1 / 60;
export const GRAVITY = 1480;
export const WORM_R = 12;
export const WORM_DRAW = 50;
export const MAX_CLIMB = 16;
export const WALK_SPEED = 78;
export const JUMP_VY = -430;
export const TURN_SECS = 32;

export type Team = 0 | 1;
export type WeaponId = "bazooka" | "grenade" | "dynamite" | "shotgun" | "punch" | "strike";
export type Phase = "intro" | "turn" | "charge" | "fly" | "settle" | "over";
export type Screen = "menu" | "play" | "pause" | "win" | "help";
export type Mode = "cpu" | "hotseat";
export type Difficulty = "recruit" | "vet";
export type Anim = "idle" | "walk" | "aim" | "hurt" | "dead";

export type WeaponDef = {
  id: WeaponId;
  label: string;
  ammo: number;
  charges: boolean;
};

export const WEAPONS: WeaponDef[] = [
  { id: "bazooka", label: "Bazuca", ammo: -1, charges: true },
  { id: "grenade", label: "Granada", ammo: 5, charges: true },
  { id: "dynamite", label: "Dinamite", ammo: 2, charges: false },
  { id: "shotgun", label: "Espingarda", ammo: 4, charges: false },
  { id: "punch", label: "Soco", ammo: -1, charges: false },
  { id: "strike", label: "Bombardeio", ammo: 1, charges: false },
];

export const NAMES_A = ["Juca", "Chico", "Nando", "Bira"] as const;
export const NAMES_B = ["Rango", "Tuco", "Dino", "Leco"] as const;

export type Worm = {
  id: number;
  team: Team;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  face: 1 | -1;
  aim: number;
  anim: Anim;
  animT: number;
  hurtT: number;
  flashT: number;
  drownT: number;
  walkAcc: number;
  grounded: boolean;
  dead: boolean;
};

export type Shot = {
  kind: "rocket" | "grenade" | "tnt" | "bomb";
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuse: number;
  bounce: number;
  windF: number;
  blast: number;
  dmg: number;
  rot: number;
  owner: number;
};

export type PlaneRun = {
  x: number;
  y: number;
  vx: number;
  dropXs: number[];
  dropped: number;
};

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  kind: "dirt" | "smoke" | "spark" | "splash" | "num" | "tracer";
  text?: string;
  color?: string;
};

export type Boom = {
  x: number;
  y: number;
  t: number;
  r: number;
};

export type Ammo = Record<WeaponId, number>;

export type UiSnap = {
  screen: Screen;
  loading: boolean;
  loadMsg: string;
  mode: Mode;
  difficulty: Difficulty;
  phase: Phase;
  team: Team;
  wormName: string;
  timer: number;
  wind: number;
  weapon: WeaponId;
  ammo: Ammo;
  banner: string;
  winner: Team | null;
  muted: boolean;
  touch: boolean;
  wide: boolean;
  hpA: number[];
  hpB: number[];
  namesA: string[];
  namesB: string[];
  charging: boolean;
  power: number;
  canAct: boolean;
};

export function emptyAmmo(): Ammo {
  const a = {} as Ammo;
  for (const w of WEAPONS) a[w.id] = w.ammo;
  return a;
}

export function weaponDef(id: WeaponId): WeaponDef {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}
