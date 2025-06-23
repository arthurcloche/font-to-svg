const fs = require("fs");
const FontParser = require("./src/font-parser");

// Load the variable font
const fontBuffer = fs.readFileSync("./src/fonts/Obviously-Variable.ttf").buffer;
const parser = new FontParser(fontBuffer);

console.log("=== VARIABLE FONT TEST ===\n");

// Test basic font info
console.log("Font type:", parser.fontType);
console.log("Is variable font:", parser.isVariableFont);

if (parser.isVariableFont) {
  console.log("\n=== AVAILABLE AXES ===\n");
  const axes = parser.getAxes();
  axes.forEach((axis) => {
    console.log(
      `${axis.tag}: ${axis.min} to ${axis.max} (default: ${axis.default})`
    );
  });

  console.log("\n=== TESTING VARIATIONS ===\n");

  // Test different weight/width combinations
  const testCases = [
    { wght: 150, wdth: 100 }, // Light Condensed
    { wght: 400, wdth: 100 }, // Regular Condensed
    { wght: 800, wdth: 100 }, // Bold Condensed
    { wght: 150, wdth: 800 }, // Light Extended
    { wght: 400, wdth: 800 }, // Regular Extended
    { wght: 800, wdth: 800 }, // Bold Extended
  ];

  testCases.forEach((variation, i) => {
    console.log(
      `\nTest ${i + 1}: wght=${variation.wght}, wdth=${variation.wdth}`
    );

    // Set variation
    parser.setVariation(variation);
    console.log("Current variation:", parser.getVariation());

    // Test character 'A'
    const glyphId = parser.getGlyphId("A");
    const glyph = parser.parseGlyph(glyphId);
    const metrics = parser.getGlyphMetrics(glyphId);

    if (glyph) {
      console.log(
        `  Glyph A: ${glyph.contours.length} contours, advance: ${metrics.advanceWidth}`
      );
      console.log(
        `  Bounds: (${glyph.xMin}, ${glyph.yMin}) to (${glyph.xMax}, ${glyph.yMax})`
      );
    }
  });

  console.log("\n=== GENERATING VARIABLE SVGs ===\n");

  // Generate SVGs at different weights
  const outputDir = "./src/svg-output/";
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  [150, 400, 800].forEach((weight) => {
    parser.setVariation({ wght: weight, wdth: 100 });
    const svg = parser.glyphToSVG("A", { scale: 0.1 });
    fs.writeFileSync(`${outputDir}variable-A-wght${weight}.svg`, svg);
    console.log(`Generated variable-A-wght${weight}.svg`);
  });

  [100, 400, 800].forEach((width) => {
    parser.setVariation({ wght: 400, wdth: width });
    const svg = parser.glyphToSVG("A", { scale: 0.1 });
    fs.writeFileSync(`${outputDir}variable-A-wdth${width}.svg`, svg);
    console.log(`Generated variable-A-wdth${width}.svg`);
  });
} else {
  console.log("Font is not a variable font");
}
