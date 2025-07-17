// Export SVG files for sample characters from every font in src/fonts
// Usage: node scripts/export-svgs.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FontParser from "../src/font-parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FONTS_DIR = path.join(__dirname, "../src/fonts");
const OUTPUT_DIR = path.join(__dirname, "../svg-output");

const SAMPLE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 " +
  "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ";

const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });

const run = async () => {
  ensureDir(OUTPUT_DIR);
  const files = fs
    .readdirSync(FONTS_DIR)
    .filter((f) => /\.(ttf|otf)$/i.test(f));

  for (const file of files) {
    const fontBuf = fs.readFileSync(path.join(FONTS_DIR, file));
    const ab = fontBuf.buffer.slice(
      fontBuf.byteOffset,
      fontBuf.byteOffset + fontBuf.byteLength
    );

    const parser = new FontParser();
    parser.fromBuffer(ab);

    if (parser.isVariableFont) {
      const axisValues = {};
      parser.getAxes().forEach((axis) => {
        axisValues[axis.tag] = (axis.min + axis.max) / 2; // midpoint
      });
      parser.setVariation(axisValues);
    }

    const fontOutDir = path.join(OUTPUT_DIR, path.parse(file).name);
    ensureDir(fontOutDir);

    for (const ch of SAMPLE_CHARS) {
      if (ch === " ") continue; // skip space
      const pathData = parser.glyphToSVG(ch, {
        scale: 0.08,
        width: 200,
        height: 200,
      });
      const hex = ch.codePointAt(0).toString(16).padStart(4, "0");
      fs.writeFileSync(path.join(fontOutDir, `U${hex}.svg`), pathData, "utf8");
    }
    console.log(`Exported SVGs for ${file}`);
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
