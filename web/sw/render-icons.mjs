// Renders public/icons/icon.svg into the PNG and ICO files the manifest and iOS need:
//   pnpm exec node sw/render-icons.mjs
// The maskable icon is full-bleed (the OS applies its own mask); the art sits inside the
// central 80% safe zone already. Run it when the SVG changes and commit the output.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const svg = readFileSync(join(PUBLIC, "icons", "icon.svg"), "utf8");
const fullBleed = svg.replace(' rx="112"', "");

const browser = await chromium.launch();
async function png(markup, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${String(size)}px;height:${String(size)}px}</style>${markup}`);
  const bytes = await page.screenshot({ omitBackground: true });
  await page.close();
  return bytes;
}

writeFileSync(join(PUBLIC, "icons", "icon-192.png"), await png(svg, 192));
writeFileSync(join(PUBLIC, "icons", "icon-512.png"), await png(svg, 512));
writeFileSync(join(PUBLIC, "icons", "icon-maskable-512.png"), await png(fullBleed, 512));
writeFileSync(join(PUBLIC, "apple-touch-icon.png"), await png(fullBleed, 180));

// favicon.ico: one 48 px PNG image in an ICO container.
const ico = await png(svg, 48);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header[6] = 48;
header[7] = 48;
header.writeUInt16LE(1, 12); // colour planes
header.writeUInt16LE(32, 14); // bits per pixel
header.writeUInt32LE(ico.length, 14 + 4);
header.writeUInt32LE(22, 18);
writeFileSync(join(PUBLIC, "favicon.ico"), Buffer.concat([header, ico]));
await browser.close();
