import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import FontParser from "../src/font-parser.js";

const fontDir = path.resolve("src/fonts");
const ttfFiles = fs
  .readdirSync(fontDir)
  .filter((f) => f.toLowerCase().endsWith(".ttf"));

if (ttfFiles.length === 0) {
  console.log("No TTF fonts found.");
  process.exit(0);
}

for (const file of ttfFiles) {
  const fullPath = path.join(fontDir, file);
  const buffer = fs.readFileSync(fullPath);
  const arrayBuf = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
  const parser = new FontParser();
  try {
    const t0 = performance.now();
    parser.fromBuffer(arrayBuf);
    const svg = parser.path("Hello", { size: 72 });
    const dt = (performance.now() - t0).toFixed(1);
    console.log(
      `\u2714︎ ${file} parsed in ${dt} ms | paths: ${svg.characters.length}`
    );
  } catch (err) {
    console.error(`\u2716 ${file} FAILED: ${err.message}`);
  }
}