// Simple smoke-test for all fonts in src/fonts
// Usage: node tests/smoke-test.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FontParser from "../src/font-parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FONTS_DIR = path.join(__dirname, "../src/fonts");
const SAMPLE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 " +
  "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ";

const run = async () => {
  const files = fs
    .readdirSync(FONTS_DIR)
    .filter((f) => /\.(ttf|otf)$/i.test(f));

  for (const file of files) {
    const filePath = path.join(FONTS_DIR, file);
    const fontData = fs.readFileSync(filePath);
    console.log("\n===", file, "===");

    const parser = new FontParser();
    const arrayBuffer = fontData.buffer.slice(
      fontData.byteOffset,
      fontData.byteOffset + fontData.byteLength
    );

    const t0 = performance.now();
    parser.fromBuffer(arrayBuffer);

    // If variable, pick random axis values within range
    if (parser.isVariableFont) {
      const axisValues = {};
      parser.getAxes().forEach((axis) => {
        const rnd = Math.random();
        axisValues[axis.tag] = axis.min + rnd * (axis.max - axis.min);
      });
      parser.setVariation(axisValues);
      console.log("  Variable axes:", axisValues);
    }

    let missing = [];
    for (const ch of SAMPLE_CHARS) {
      const gid = parser.getGlyphId(ch);
      if (gid === 0 && ch !== " ") missing.push(ch);
      // We still call glyphToSVGPath to ensure no crash
      parser.glyphToSVGPath(ch, { scale: 1 });
    }

    const t1 = performance.now();
    console.log("  Parsed in", (t1 - t0).toFixed(1), "ms");
    console.log(
      "  Missing chars:",
      missing.length ? missing.join("") : "<none>"
    );
  }
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
