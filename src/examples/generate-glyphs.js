const fs = require("fs");
const path = require("path");
const FontParser = require("../font-parser");

// Path to the OpenType / TrueType font shipped with the repo
const fontPath = path.join(__dirname, "..", "SigmaSerif-Headline.otf");
const fontBuffer = fs.readFileSync(fontPath).buffer;

const parser = new FontParser(fontBuffer);

// Letters we want to export
const letters = ["A", "B", "e", "H", "O", "P", "R"];

// Output directory – same as the one already tracked in repo
const outDir = path.join(__dirname, "..", "svg-output");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

for (const ch of letters) {
  const svg = parser.glyphToSVG(ch, {
    scale: 0.05, // tweak as you like
    padding: 20,
  });

  const outFile = path.join(outDir, `char-${ch}-generated.svg`);
  fs.writeFileSync(outFile, svg, "utf8");
  console.log(`Saved ${outFile}`);
}
