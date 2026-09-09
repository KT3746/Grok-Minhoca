import { useEffect, useRef, useState } from "react";
import {
  Bomb,
  Crosshair,
  Flame,
  Hand,
  Maximize2,
  Pause,
  Plane,
  Rocket,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { MinhocaGame } from "@/game/game";
import { WEAPONS, type UiSnap, type WeaponId } from "@/game/types";

const INITIAL: UiSnap = {
  screen: "menu",
  loading: false,
  loadMsg: "",
  mode: "cpu",
  difficulty: "recruit",
  phase: "turn",
  team: 0,
  wormName: "",
  timer: 0,
  wind: 0,
  weapon: "bazooka",
  ammo: { bazooka: -1, grenade: 5, dynamite: 2, shotgun: 4, punch: -1, strike: 1 },
  banner: "",
  winner: null,
  muted: false,
  touch: false,
  wide: false,
  hpA: [100, 100, 100, 100],
  hpB: [100, 100, 100, 100],
  namesA: ["Juca", "Chico", "Nando", "Bira"],
  namesB: ["Rango", "Tuco", "Dino", "Leco"],
  charging: false,
  power: 0,
  canAct: false,
};

const ICONS: Record<WeaponId, typeof Rocket> = {
  bazooka: Rocket,
  grenade: Bomb,
  dynamite: Flame,
  shotgun: Crosshair,
  punch: Hand,
  strike: Plane,
};

export function MinhocaApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<MinhocaGame | null>(null);
  const [ui, setUi] = useState<UiSnap>(INITIAL);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new MinhocaGame(canvas, setUi);
    gameRef.current = game;
    void game.start();
    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  const g = gameRef.current;
  const playing = ui.screen === "play";
  const overlay = ui.screen === "menu" || ui.screen === "help" || ui.screen === "win" || ui.screen === "pause";

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-ink text-cream">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full touch-none"
        style={{ touchAction: "none" }}
      />

      {ui.loading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-ink/70">
          <p className="font-display text-4xl tracking-wide">MINHOCA</p>
          <p className="mt-2 text-sm text-muted">{ui.loadMsg}</p>
        </div>
      )}

      {overlay && !ui.loading && (
        <div className="absolute inset-0 z-10 flex flex-col bg-gradient-to-b from-ink/80 via-ink/45 to-ink/75 px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(5.5rem,env(safe-area-inset-bottom))]">
          {ui.screen === "menu" && <Menu ui={ui} g={g} />}
          {ui.screen === "help" && <Help g={g} />}
          {ui.screen === "pause" && <PauseMenu g={g} ui={ui} />}
          {ui.screen === "win" && <Win ui={ui} g={g} />}
        </div>
      )}

      {playing && !ui.loading && (
        <>
          <TopHud ui={ui} g={g} />
          {!ui.wide && <TeamStrip ui={ui} />}
          <WeaponBar ui={ui} g={g} />
          {ui.touch && <TouchPad g={g} ui={ui} />}
          {!ui.touch && (
            <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 text-center text-xs text-muted">
              A/D andar · W/S mirar · espaço disparar · J pular · N passar · 1–6 armas
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Menu({ ui, g }: { ui: UiSnap; g: MinhocaGame | null }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col justify-between">
      <div className="pt-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-muted">Artilharia por turnos</p>
        <h1 className="font-display text-6xl leading-none tracking-wide text-cream sm:text-7xl">MINHOCA</h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
          Dois pelotões, um campo que some a cada explosão. Mire, carregue, e reescreva o terreno.
        </p>
      </div>
      <div className="flex flex-col gap-3 pb-8">
        <div className="flex rounded-lg bg-ink-2 p-1">
          <button
            type="button"
            onClick={() => g?.setDifficulty("recruit")}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
              ui.difficulty === "recruit" ? "bg-ink-3 text-cream" : "text-muted"
            }`}
          >
            Recruta
          </button>
          <button
            type="button"
            onClick={() => g?.setDifficulty("vet")}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
              ui.difficulty === "vet" ? "bg-ink-3 text-cream" : "text-muted"
            }`}
          >
            Veterano
          </button>
        </div>
        <button
          type="button"
          onClick={() => g?.play("cpu")}
          className="rounded-xl bg-cream px-5 py-3.5 text-base font-semibold text-ink transition hover:bg-steel"
        >
          Combate vs CPU
        </button>
        <button
          type="button"
          onClick={() => g?.play("hotseat")}
          className="rounded-xl border border-border bg-ink-2 px-5 py-3.5 text-base font-semibold text-cream"
        >
          Dois jogadores
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => g?.showHelp(true)}
            className="flex-1 rounded-xl border border-border py-3 text-sm font-medium text-cream"
          >
            Como jogar
          </button>
          <button
            type="button"
            onClick={() => g?.setMuted(!ui.muted)}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-border"
            aria-label={ui.muted ? "Ativar som" : "Silenciar"}
          >
            {ui.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function Help({ g }: { g: MinhocaGame | null }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col justify-center gap-6">
      <h2 className="font-display text-5xl tracking-wide">Como jogar</h2>
      <ul className="space-y-3 text-sm leading-relaxed text-cream/90">
        <li>Ande com A/D ou os botões. Pule com J ou Shift.</li>
        <li>Mire com W/S. No toque, arraste no campo. O mouse também mira.</li>
        <li>Segure o disparo para a potência da bazuca e da granada. A linha pontilhada mostra a curva.</li>
        <li>No celular: − e + no canto, ou pinça com dois dedos. O botão de campo abre o mapa inteiro.</li>
        <li>Explosões cavam o chão. Quedas, água e fogo amigo também matam.</li>
        <li>O último pelotão em pé vence. Esc ou P pausa.</li>
      </ul>
      <button
        type="button"
        onClick={() => g?.showHelp(false)}
        className="rounded-xl bg-cream py-3 font-semibold text-ink"
      >
        Entendi
      </button>
    </div>
  );
}

function PauseMenu({ g, ui }: { g: MinhocaGame | null; ui: UiSnap }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-sm flex-col justify-center gap-3">
      <h2 className="font-display text-5xl tracking-wide">Pausa</h2>
      <button type="button" onClick={() => g?.pause()} className="rounded-xl bg-cream py-3 font-semibold text-ink">
        Continuar
      </button>
      <button
        type="button"
        onClick={() => g?.setMuted(!ui.muted)}
        className="rounded-xl border border-border bg-ink-2 py-3 font-medium"
      >
        {ui.muted ? "Ativar som" : "Silenciar"}
      </button>
      <button type="button" onClick={() => g?.toMenu()} className="rounded-xl py-3 text-muted">
        Desistir
      </button>
    </div>
  );
}

function Win({ ui, g }: { ui: UiSnap; g: MinhocaGame | null }) {
  const draw = ui.winner === null;
  const name = ui.winner === 0 ? "Oliva" : "Rubro";
  return (
    <div className="mx-auto flex h-full w-full max-w-sm flex-col justify-center gap-4">
      <p className="text-xs uppercase tracking-[0.25em] text-muted">Fim de combate</p>
      {draw ? (
        <>
          <h2 className="font-display text-6xl leading-none tracking-wide">Empate</h2>
          <p className="text-muted">Os dois pelotões caíram.</p>
        </>
      ) : (
        <>
          <h2 className="font-display text-6xl leading-none tracking-wide">Equipe {name}</h2>
          <p className="text-muted">venceu o campo.</p>
        </>
      )}
      <button type="button" onClick={() => g?.play(ui.mode)} className="rounded-xl bg-cream py-3 font-semibold text-ink">
        Revanche
      </button>
      <button type="button" onClick={() => g?.toMenu()} className="rounded-xl border border-border py-3">
        Menu
      </button>
    </div>
  );
}

function TopHud({ ui, g }: { ui: UiSnap; g: MinhocaGame | null }) {
  const windN = Math.max(1, Math.round(Math.abs(ui.wind) * 5));
  const arrow = (ui.wind < 0 ? "‹" : "›").repeat(windN);
  const team = ui.team === 0 ? "Oliva" : "Rubro";
  const low = ui.timer <= 6;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="rounded-lg bg-ink/70 px-3 py-2">
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Vento</p>
        <p className="font-display text-2xl leading-none tabular-nums text-cream">
          {arrow} <span className="text-lg text-muted">{Math.abs(ui.wind).toFixed(1)}</span>
        </p>
      </div>
      <div className="rounded-lg bg-ink/70 px-4 py-2 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-muted">
          {team} · {ui.wormName}
        </p>
        <p className={`font-display text-4xl leading-none tabular-nums ${low ? "text-crimson" : "text-cream"}`}>
          {Math.ceil(ui.timer)}
        </p>
      </div>
      <div className="pointer-events-auto flex gap-1.5">
        {ui.touch && (
          <>
            <button
              type="button"
              onClick={() => g?.bumpZoom(1)}
              className="flex size-10 items-center justify-center rounded-lg bg-ink/70"
              aria-label="Aproximar"
            >
              <ZoomIn className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => g?.bumpZoom(-1)}
              className="flex size-10 items-center justify-center rounded-lg bg-ink/70"
              aria-label="Afastar"
            >
              <ZoomOut className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => g?.fitWorld()}
              className="flex size-10 items-center justify-center rounded-lg bg-ink/70"
              aria-label="Ver campo"
            >
              <Maximize2 className="size-4" />
            </button>
          </>
        )}
        {!ui.touch && (
          <button
            type="button"
            onClick={() => g?.skipTurn()}
            disabled={!ui.canAct}
            className="flex h-11 items-center rounded-lg bg-ink/70 px-3 text-xs font-medium uppercase tracking-wide disabled:opacity-40"
          >
            Passar
          </button>
        )}
        <button
          type="button"
          onClick={() => g?.setMuted(!ui.muted)}
          className="flex size-10 items-center justify-center rounded-lg bg-ink/70"
          aria-label="Som"
        >
          {ui.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
        <button
          type="button"
          onClick={() => g?.pause()}
          className="flex size-10 items-center justify-center rounded-lg bg-ink/70"
          aria-label="Pausa"
        >
          <Pause className="size-4" />
        </button>
      </div>
    </div>
  );
}

function TeamStrip({ ui }: { ui: UiSnap }) {
  return (
    <div className="pointer-events-none absolute top-16 left-3 right-3 z-10 flex justify-between gap-4">
      <MiniTeam names={ui.namesA} hp={ui.hpA} accent="bg-olive-2" active={ui.wormName} />
      <MiniTeam names={ui.namesB} hp={ui.hpB} accent="bg-crimson" align="right" active={ui.wormName} />
    </div>
  );
}

function MiniTeam({
  names,
  hp,
  accent,
  align = "left",
  active,
}: {
  names: string[];
  hp: number[];
  accent: string;
  align?: "left" | "right";
  active?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${align === "right" ? "items-end" : "items-start"}`}>
      {names.map((n, i) => {
        const dead = (hp[i] ?? 0) <= 0;
        const on = !dead && n === active;
        return (
          <div key={n} className={`flex items-center gap-2 ${dead ? "opacity-40" : ""}`}>
            {align === "right" && (
              <span className={`text-xs ${on ? "font-semibold text-cream" : "text-muted"}`}>{n}</span>
            )}
            <div className={`h-1 w-14 overflow-hidden rounded-full bg-ink/70 ${on ? "ring-1 ring-cream/50" : ""}`}>
              <div className={`h-full ${accent}`} style={{ width: `${hp[i] ?? 0}%` }} />
            </div>
            {align === "left" && (
              <span className={`text-xs ${on ? "font-semibold text-cream" : "text-muted"}`}>{n}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WeaponBar({ ui, g }: { ui: UiSnap; g: MinhocaGame | null }) {
  const compact = ui.wide;
  return (
    <div
      className={`absolute z-10 flex max-w-[min(100%,42rem)] gap-1 overflow-x-auto px-2 ${
        compact
          ? "top-[4.25rem] left-1/2 -translate-x-1/2 justify-center"
          : ui.touch
            ? "bottom-24 left-0 right-0 justify-center"
            : "bottom-10 left-0 right-0 justify-center"
      }`}
    >
      {WEAPONS.map((w) => {
        const Icon = ICONS[w.id];
        const ammo = ui.ammo[w.id];
        const empty = ammo === 0;
        const on = ui.weapon === w.id;
        return (
          <button
            key={w.id}
            type="button"
            disabled={empty || !ui.canAct}
            onClick={() => g?.setWeapon(w.id)}
            className={`flex items-center justify-center rounded-lg ${
              compact ? "size-10" : "min-w-12 flex-col px-2 py-1.5"
            } ${on ? "bg-cream text-ink" : "bg-ink/80 text-cream"} ${empty ? "opacity-35" : ""}`}
            aria-label={w.label}
          >
            <Icon className="size-4" />
            {!compact && (
              <>
                <span className="mt-0.5 text-2xs font-medium uppercase tracking-wide">{w.label}</span>
                <span className={`text-xs tabular-nums ${on ? "text-ink/70" : "text-muted"}`}>
                  {ammo < 0 ? "∞" : ammo}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TouchPad({ g, ui }: { g: MinhocaGame | null; ui: UiSnap }) {
  const slim = ui.wide;
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="flex gap-2">
        <PadBtn
          label="Esq"
          slim={slim}
          onDown={() => g?.setWalk(-1)}
          onUp={() => g?.releaseWalk(-1)}
        />
        <PadBtn
          label="Dir"
          slim={slim}
          onDown={() => g?.setWalk(1)}
          onUp={() => g?.releaseWalk(1)}
        />
      </div>
      <div className={`flex items-end gap-2 ${slim ? "" : "flex-col"}`}>
        <PadBtn label="Pular" slim={slim} onDown={() => g?.jump()} />
        <PadBtn label="Passar" slim={slim} onDown={() => g?.skipTurn()} />
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            g?.pressFire();
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            g?.releaseFire();
          }}
          onPointerCancel={() => g?.releaseFire()}
          className={`flex items-center justify-center rounded-full border border-border font-display tracking-wide ${
            slim ? "h-14 w-14 text-lg" : "h-16 w-16 text-xl"
          } ${ui.charging ? "bg-cream text-ink" : "bg-ink-2/90 text-cream"} ${
            !ui.canAct && !ui.charging ? "opacity-40" : ""
          }`}
        >
          FOGO
        </button>
      </div>
    </div>
  );
}

function PadBtn({
  label,
  onDown,
  onUp,
  slim,
}: {
  label: string;
  onDown: () => void;
  onUp?: () => void;
  slim?: boolean;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown();
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onUp?.();
      }}
      onPointerCancel={() => onUp?.()}
      className={`flex items-center justify-center rounded-xl bg-ink/80 px-3 text-xs font-medium uppercase tracking-wide ${
        slim ? "h-12 min-w-12" : "h-14 min-w-14"
      }`}
    >
      {label}
    </button>
  );
}
