import { access, readFile } from "node:fs/promises";

const required = [
  "dist/index.html",
  "dist/manifest.webmanifest",
  "dist/sw.js",
  "dist/worldseed-mark.svg",
];

await Promise.all(required.map((path) => access(path)));

const html = await readFile("dist/index.html", "utf8");
for (const marker of ["WorldSeed", "type=\"module\""]) {
  if (!html.includes(marker)) {
    throw new Error(`Production HTML is missing ${marker}`);
  }
}

console.log(`Validated ${required.length} required production files.`);
