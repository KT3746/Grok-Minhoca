import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

process.env.GITHUB_PAGES = "1";

const result = spawnSync("node", ["scripts/with-app-env.mjs", "vite", "build"], {
  stdio: "inherit",
  env: process.env,
});

const publicDir = join(".output", "public");
const assetsDir = join(publicDir, "assets");
if (!existsSync(assetsDir)) {
  process.exit(result.status === 0 ? 1 : result.status || 1);
}

const files = readdirSync(assetsDir);
const js = files.find((f) => /^index-.*\.js$/.test(f));
const css = files.find((f) => /^styles-.*\.css$/.test(f));
if (!js || !css) {
  console.error("[build-pages] missing hashed client assets in .output/public/assets");
  process.exit(1);
}

const base = "/Grok-Minhoca";
const html = `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0b0d10" />
    <title>MINHOCA</title>
    <meta name="description" content="Guerra de artilharia por turnos com terreno destrutível." />
    <link rel="icon" type="image/svg+xml" href="${base}/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Teko:wght@500;600;700&display=swap" />
    <link rel="stylesheet" href="${base}/assets/${css}" />
    <script>
      self.$R = self.$R || {};
      self.$_TSR = {
        h() { this.hydrated = true; this.c(); },
        e() { this.streamEnded = true; this.c(); },
        c() {
          if (this.hydrated && this.streamEnded) {
            try { delete self.$_TSR; } catch (e) {}
            try { delete self.$R.tsr; } catch (e) {}
          }
        },
        p(script) { !this.initialized ? this.buffer.push(script) : script(); },
        buffer: [],
        router: { manifest: undefined, matches: [] }
      };
    </script>
  </head>
  <body>
    <script type="module" src="${base}/assets/${js}"></script>
  </body>
</html>
`;

for (const name of ["index", "index.html", "404", "404.html"]) {
  const path = join(publicDir, name);
  if (existsSync(path)) rmSync(path);
}
writeFileSync(join(publicDir, "index.html"), html);
writeFileSync(join(publicDir, "404.html"), html);
writeFileSync(join(publicDir, ".nojekyll"), "");
console.log(`[build-pages] wrote index.html + 404.html (${js}, ${css})`);
