const fs = require("fs");
const path = require("path");
const FontParser = require("../font-parser");

// New API Demo
console.log("=== NEW FONTPARSER API DEMO ===\n");

// Create parser instance
const parser = new FontParser();

// Load font from buffer (Node.js context)
const fontPath = path.join(__dirname, "..", "fonts", "Obviously-Variable.ttf");
const fontBuffer = fs.readFileSync(fontPath).buffer;
const font = parser.fromBuffer(fontBuffer);

// Access font data
console.log("Font Data:");
console.log(`  Name: ${font.data.name}`);
console.log(`  Units per EM: ${font.data.unitsPerEm}`);
console.log(`  Variable Font: ${font.data.isVariable}`);
console.log(`  Available Tables: ${font.data.tables.join(", ")}`);

if (font.data.isVariable) {
  console.log("  Variable Axes:");
  font.data.axes.forEach((axis) => {
    console.log(
      `    ${axis.tag}: ${axis.min} to ${axis.max} (default: ${axis.default})`
    );
  });
}

console.log("\n=== TEXT RENDERING ===\n");

// Basic text rendering
const basicText = parser.path("Hello", { size: 72 });
console.log("Basic text rendering:");
console.log(`  Width: ${basicText.width.toFixed(1)}px`);
console.log(`  ViewBox: ${basicText.viewBox}`);

// With kerning adjustment
const kernedText = parser.path("Hello", {
  size: 72,
  kerning: -0.1, // Tighten spacing by 10%
});
console.log("\nWith tight kerning (-0.1):");
console.log(`  Width: ${kernedText.width.toFixed(1)}px`);

// Variable font variations
if (font.data.isVariable) {
  const lightText = parser.path("Hello", {
    size: 72,
    variable: { wght: 150, wdth: 100 },
  });

  const boldText = parser.path("Hello", {
    size: 72,
    variable: { wght: 800, wdth: 800 },
  });

  console.log("\nVariable font variations:");
  console.log(`  Light condensed width: ${lightText.width.toFixed(1)}px`);
  console.log(`  Bold extended width: ${boldText.width.toFixed(1)}px`);
}

// Generate SVG files with new API
const outputDir = path.join(__dirname, "..", "svg-output");

const examples = [
  { text: "Hello", options: { size: 72 }, filename: "new-api-basic.svg" },
  {
    text: "Hello",
    options: { size: 72, kerning: -0.2 },
    filename: "new-api-tight.svg",
  },
  {
    text: "Hello",
    options: { size: 72, kerning: 0.1 },
    filename: "new-api-loose.svg",
  },
];

if (font.data.isVariable) {
  examples.push(
    {
      text: "Hello",
      options: { size: 72, variable: { wght: 150, wdth: 100 } },
      filename: "new-api-light.svg",
    },
    {
      text: "Hello",
      options: { size: 72, variable: { wght: 800, wdth: 800 } },
      filename: "new-api-bold.svg",
    }
  );
}

console.log("\n=== GENERATING SVG FILES ===\n");

examples.forEach((example) => {
  const result = parser.path(example.text, example.options);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="${result.viewBox}" 
     width="400" height="100">
  ${result.paths}
</svg>`;

  fs.writeFileSync(path.join(outputDir, example.filename), svg);
  console.log(
    `Generated ${example.filename} - width: ${result.width.toFixed(1)}px`
  );
});

console.log("\n=== FUTURE API PREVIEW ===");
console.log(`
// Frontend usage:
const parser = new FontParser();
const font = await parser.from('https://fonts.com/myfont.woff2');

// Generate paths
const result = parser.path('Hello World', {
  size: 48,
  kerning: -0.05,
  variable: { wght: 600, wdth: 120 }
});

// Use with canvas or SVG manipulation
const points = parser.points(result.characters, { details: 0.1 }); // Future feature
`);

console.log("Demo complete! New API is much cleaner and more intuitive.");
