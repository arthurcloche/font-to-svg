const fs = require("fs");
const path = require("path");
const FontParser = require("../font-parser");

// Load the font
const fontPath = path.join(__dirname, "..", "SigmaSerif-Headline.otf");
const fontBuffer = fs.readFileSync(fontPath).buffer;
const parser = new FontParser(fontBuffer);

// Text to render
const text = "hello world";
const fontSize = 72; // points
const scale = fontSize / parser.unitsPerEm; // Convert from font units to points

console.log(`Font: ${parser.unitsPerEm} units per em`);
console.log(`Font size: ${fontSize}pt`);
console.log(`Scale factor: ${scale}`);

// Generate individual character SVGs and calculate positioning
let currentX = 0;
const baselineY = 0;
const characters = [];

for (let i = 0; i < text.length; i++) {
  const char = text[i];

  if (char === " ") {
    // Handle space character - use average character width or specific space width
    const spaceWidth = fontSize * 0.3; // Approximate space width
    currentX += spaceWidth;
    continue;
  }

  // Get glyph data
  const glyphId = parser.getGlyphId(char);
  const glyph = parser.parseGlyph(glyphId);
  const metrics = parser.getGlyphMetrics(glyphId);

  if (glyph && glyph.contours.length > 0) {
    // Generate SVG path for this character
    const pathData = parser.glyphToSVGPath(char, {
      scale: scale,
      flipY: true,
    });

    // Calculate character bounds
    const bounds = parser.getGlyphBounds(char, {
      scale: scale,
      flipY: true,
    });

    // Store character info
    characters.push({
      char: char,
      x: currentX,
      y: baselineY,
      pathData: pathData,
      bounds: bounds,
      advanceWidth: metrics.advanceWidth * scale,
      leftSideBearing: metrics.leftSideBearing * scale,
    });

    console.log(
      `'${char}': advance=${(metrics.advanceWidth * scale).toFixed(
        1
      )}pt, bounds=(${bounds.minX.toFixed(1)}, ${bounds.minY.toFixed(
        1
      )}) to (${bounds.maxX.toFixed(1)}, ${bounds.maxY.toFixed(1)})`
    );
  }

  // Advance to next character position
  currentX += metrics.advanceWidth * scale;
}

// Calculate overall text bounds
const textWidth = currentX;
const textHeight = fontSize * 1.2; // Approximate line height
const padding = 20;

// Generate combined SVG
let combinedPaths = "";
for (const charInfo of characters) {
  if (charInfo.pathData) {
    // Transform the path to the character's position
    combinedPaths += `<g transform="translate(${charInfo.x}, ${charInfo.y})">`;
    combinedPaths += `<path d="${charInfo.pathData}" fill="black"/>`;
    combinedPaths += `</g>\n`;
  }
}

// Create the final SVG
const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="${-padding} ${-fontSize - padding} ${textWidth + padding * 2} ${
  textHeight + padding * 2
}"
     width="${Math.ceil(textWidth + padding * 2)}" 
     height="${Math.ceil(textHeight + padding * 2)}">
  
  <!-- Background (optional) -->
  <rect x="${-padding}" y="${-fontSize - padding}" 
        width="${textWidth + padding * 2}" 
        height="${textHeight + padding * 2}" 
        fill="none" stroke="#ddd" stroke-width="1"/>
  
  <!-- Baseline guide -->
  <line x1="0" y1="0" x2="${textWidth}" y2="0" 
        stroke="#ccc" stroke-width="0.5" stroke-dasharray="2,2"/>
  
  <!-- Text -->
  ${combinedPaths}
  
</svg>`;

// Save the SVG
const outputPath = path.join(__dirname, "..", "svg-output", "hello-world.svg");
fs.writeFileSync(outputPath, svgContent);

console.log(`\nGenerated hello world SVG: ${outputPath}`);
console.log(`Text width: ${textWidth.toFixed(1)}pt`);
console.log(`Text height: ${textHeight.toFixed(1)}pt`);

// Also generate individual character files for comparison
for (const charInfo of characters) {
  const charSvg = parser.glyphToSVG(charInfo.char, {
    scale: scale / parser.unitsPerEm, // Adjust scale for the glyphToSVG method
    width: Math.ceil(charInfo.advanceWidth + 40),
    height: Math.ceil(fontSize + 40),
  });

  const charPath = path.join(
    __dirname,
    "..",
    "svg-output",
    `hello-char-${charInfo.char}.svg`
  );
  fs.writeFileSync(charPath, charSvg);
}

console.log(`Also generated individual character files in svg-output/`);
