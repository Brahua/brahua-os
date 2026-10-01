// Generates the app icons from the brand (pnpm icons:build) and writes them into the repo, where
// they are committed: the build never runs this. Output:
//   public/icons/icon-192.png, icon-512.png   manifest, purpose "any" (key tile, transparent corners)
//   public/icons/icon-maskable-512.png        manifest, purpose "maskable" (full bleed, safe zone)
//   src/app/icon.png                          favicon, 32×32
//   src/app/apple-icon.png                    iOS home screen, 180×180, opaque
//
// Design ("Panel mono"): a dark key with a lowercase "b" in Archivo 800 at 125 % width (the
// wordmark's face, `.bo-sidebar__brand`) followed by a signal-orange square, like the LED of a key.
// Rendering: `ImageResponse` from next/og (Satori + resvg, already in `next`), so no new
// dependency. The font is the same instance next/font serves, fetched from Google Fonts (needs
// network) and subset to the glyph.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { brandHex } from "../src/design-system/brand-colors";
import { MANIFEST_ICONS } from "../src/lib/pwa";

const ROOT = path.resolve(__dirname, "..");
const MONOGRAM = "b";

async function loadArchivo(): Promise<ArrayBuffer> {
  // An old Safari user agent makes Google Fonts answer with TrueType (Satori does not read WOFF2).
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@125,800&text=${MONOGRAM}`,
    {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1",
      },
    },
  ).then((response) => response.text());
  const url = css.match(/src: url\((.+?)\) format\('truetype'\)/)?.[1];
  if (!url) throw new Error(`No TrueType Archivo in the Google Fonts answer:\n${css}`);
  return fetch(url).then((response) => response.arrayBuffer());
}

/**
 * The "b" plus the orange square; `scale` is the glyph's font size in px. `compact` (the favicon)
 * enlarges the square so it still reads at 16 CSS px.
 */
function Monogram({ scale, compact = false }: { scale: number; compact?: boolean }) {
  const dot = Math.round(scale * (compact ? 0.26 : 0.17));
  return (
    <div style={{ display: "flex", alignItems: "flex-end" }}>
      <div
        style={{
          display: "flex",
          fontFamily: "Archivo",
          fontWeight: 800,
          fontSize: scale,
          lineHeight: 1,
          color: brandHex("ink"),
          letterSpacing: 0,
        }}
      >
        {MONOGRAM}
      </div>
      <div
        style={{
          width: dot,
          height: dot,
          marginLeft: Math.round(scale * (compact ? 0.04 : 0.05)),
          // Sit on the baseline, not on the bottom of the line box (the descender area).
          marginBottom: Math.round(scale * 0.155),
          borderRadius: Math.max(1, Math.round(dot * 0.18)),
          background: brandHex("signal"),
        }}
      />
    </div>
  );
}

/**
 * The key: face, 1 px highlight on top and the darker bottom edge of `--shadow-key`, scaled.
 * `inset` leaves the canvas corners transparent; 0 fills it (iOS and maskable crop it themselves).
 */
function Key({
  size,
  inset,
  radius,
  compact = false,
}: {
  size: number;
  inset: number;
  radius: number;
  compact?: boolean;
}) {
  const edge = Math.max(1, Math.round(size * 0.03));
  const highlight = Math.max(1, Math.round(size / 160));
  return (
    <div style={{ width: size, height: size, display: "flex", padding: inset }}>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius,
          background: brandHex("key"),
          boxShadow: `inset 0 -${edge}px 0 ${brandHex("keyEdge")}, inset 0 ${highlight}px 0 ${brandHex("keyHighlight")}`,
          // Center the monogram on the visible face (above the bottom edge).
          paddingBottom: edge,
        }}
      >
        <Monogram
          scale={Math.round((size - inset * 2) * (compact ? 0.7 : 0.62))}
          compact={compact}
        />
      </div>
    </div>
  );
}

/** Maskable: full bleed; the monogram stays inside the 80 % safe circle (it uses about 60 %). */
function Maskable({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: brandHex("key"),
      }}
    >
      <Monogram scale={Math.round(size * 0.5)} />
    </div>
  );
}

async function render(element: React.ReactElement, size: number, font: ArrayBuffer) {
  const response = new ImageResponse(element, {
    width: size,
    height: size,
    fonts: [{ name: "Archivo", data: font, weight: 800, style: "normal" }],
  });
  return Buffer.from(await response.arrayBuffer());
}

function write(relative: string, png: Buffer) {
  const file = path.join(ROOT, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`${relative} (${png.length} bytes)`);
}

async function main() {
  const font = await loadArchivo();

  for (const icon of MANIFEST_ICONS) {
    const element =
      icon.purpose === "maskable" ? (
        <Maskable size={icon.size} />
      ) : (
        <Key size={icon.size} inset={Math.round(icon.size * 0.04)} radius={icon.size * 0.22} />
      );
    write(path.join("public", icon.src), await render(element, icon.size, font));
  }
  write("src/app/icon.png", await render(<Key size={32} inset={0} radius={7} compact />, 32, font));
  write("src/app/apple-icon.png", await render(<Key size={180} inset={0} radius={0} />, 180, font));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
