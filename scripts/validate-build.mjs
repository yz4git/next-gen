import { access, readFile } from "node:fs/promises";

const required = [
  "dist/index.html",
  "dist/manifest.webmanifest",
  "dist/sw.js",
  "dist/worldseed-mark.svg",
];

await Promise.all(required.map((path) => access(path)));

const html = await readFile("dist/index.html", "utf8");
for (const marker of [
  "WorldSeed",
  "type=\"module\"",
  "v0.1.1 PUBLIC SAFETY",
  "v0.6.0",
  "id=\"privacy-dialog\"",
  "id=\"viewport-attribution\"",
  "id=\"plateau-import-button\"",
  "id=\"metric-tiles\"",
]) {
  if (!html.includes(marker)) {
    throw new Error(`Production HTML is missing ${marker}`);
  }
}

console.log(`Validated ${required.length} required production files.`);
