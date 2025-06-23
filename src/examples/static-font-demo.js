const fs = require("fs");
const path = require("path");
const FontParser = require("../font-parser");

console.log("=== STATIC FONT DEMO - SIGMASERIF ===\n");

// Create parser and load static font
const parser = new FontParser();
const fontPath = path.join(__dirname, "..", "fonts", "BebasNeue-Regular.ttf");
const fontBuffer = fs.readFileSync(fontPath).buffer;
const font = parser.fromBuffer(fontBuffer);

// Show font data
console.log("Font Information:");
console.log(`  Name: ${font.data.name}`);
console.log(`  Units per EM: ${font.data.unitsPerEm}`);
console.log(`  Variable Font: ${font.data.isVariable}`);
console.log(`  Tables: ${font.data.tables.join(", ")}`);

console.log("\n=== STATIC FONT TESTS ===\n");

const outputDir = path.join(__dirname, "..", "svg-output");

// Test different texts with static font
const testTexts = [
  { text: "A", name: "static-single-char" },
  { text: "Hello", name: "static-hello" },
  { text: "Typography", name: "static-typography" },
  { text: "SigmaSerif Font", name: "static-full-name" },
];

console.log("Static Font Tests (72px):");
console.log("Text             | ViewBox                    | Width  | Height");
console.log("─".repeat(75));

testTexts.forEach((test) => {
  const result = parser.path(test.text, {
    size: 72,
  });

  console.log(
    `${test.text.padEnd(16)} | ${result.viewBox.padEnd(26)} | ${result.width
      .toFixed(1)
      .padStart(6)}px | ${result.height.toFixed(1).padStart(6)}px`
  );

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="${result.viewBox}" 
     width="${result.width}" height="${result.height}">
  ${result.paths}
</svg>`;

  const filename = `${test.name}.svg`;
  fs.writeFileSync(path.join(outputDir, filename), svg);
});

// Test different sizes
console.log("\n=== SIZE TESTS ===\n");

const sizeTests = [36, 72, 144];
const testText = "Hello";

console.log("Size Tests (Hello):");
console.log("Size | ViewBox                    | Width  | Height");
console.log("─".repeat(65));

sizeTests.forEach((size) => {
  const result = parser.path(testText, {
    size: size,
  });

  console.log(
    `${size.toString().padStart(4)} | ${result.viewBox.padEnd(
      26
    )} | ${result.width.toFixed(1).padStart(6)}px | ${result.height
      .toFixed(1)
      .padStart(6)}px`
  );

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="${result.viewBox}" 
     width="${result.width}" height="${result.height}">
  ${result.paths}
</svg>`;

  const filename = `static-size-${size}px.svg`;
  fs.writeFileSync(path.join(outputDir, filename), svg);
});

console.log("\n=== COMPARISON ===");
console.log("Generated static font test files:");
console.log("✓ Single character test");
console.log("✓ Word tests");
console.log("✓ Size scaling tests");
console.log("\nCheck svg-output folder to compare with variable font results!");
