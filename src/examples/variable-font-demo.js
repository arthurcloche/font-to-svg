const fs = require("fs");
const path = require("path");
const FontParser = require("../font-parser");

console.log("=== VARIABLE FONT DEMO - NEW API ===\n");

// Create parser and load font using new API
const parser = new FontParser();
const fontPath = path.join(__dirname, "..", "fonts", "Obviously-Variable.ttf");
const fontBuffer = fs.readFileSync(fontPath).buffer;
const font = parser.fromBuffer(fontBuffer);

// Show font data
console.log("Font Information:");
console.log(`  Name: ${font.data.name}`);
console.log(`  Units per EM: ${font.data.unitsPerEm}`);
console.log(`  Variable Font: ${font.data.isVariable}`);

if (font.data.isVariable) {
  console.log("  Available Axes:");
  font.data.axes.forEach((axis) => {
    console.log(
      `    ${axis.tag}: ${axis.min} to ${axis.max} (default: ${axis.default})`
    );
  });
}

console.log("\n=== TESTING VIEWBOX CONSISTENCY ===\n");

const outputDir = path.join(__dirname, "..", "svg-output");
const testText = "Hello";
const fontSize = 72;

// Test different variations to see viewBox behavior
const variations = [
  { name: "light-condensed", variable: { wght: 150, wdth: 100 } },
  { name: "regular-normal", variable: { wght: 400, wdth: 400 } },
  { name: "bold-extended", variable: { wght: 800, wdth: 800 } },
];

console.log("ViewBox Analysis:");
console.log("Format: [x, y, width, height] | text width | text height");
console.log("─".repeat(70));

variations.forEach((variation) => {
  // Generate text with new API
  const result = parser.path(testText, {
    size: fontSize,
    variable: variation.variable,
  });

  // Parse viewBox for analysis
  const [vbX, vbY, vbWidth, vbHeight] = result.viewBox.split(" ").map(Number);

  console.log(
    `${variation.name.padEnd(18)} | ${result.viewBox.padEnd(
      25
    )} | ${result.width.toFixed(1).padStart(6)}px | ${result.height
      .toFixed(1)
      .padStart(6)}px`
  );

  // Generate SVG file
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="${result.viewBox}" 
     width="${result.width}" height="${result.height}">
  ${result.paths}
</svg>`;

  const filename = `viewbox-test-${variation.name}.svg`;
  fs.writeFileSync(path.join(outputDir, filename), svg);
});

console.log("\n=== KERNING TESTS ===\n");

// Test kerning effects on viewBox
const kerningTests = [
  { kerning: -0.2, name: "tight" },
  { kerning: 0, name: "normal" },
  { kerning: 0.2, name: "loose" },
];

console.log("Kerning ViewBox Tests:");
console.log("Kerning | ViewBox                   | Width  | Height");
console.log("─".repeat(60));

kerningTests.forEach((test) => {
  const result = parser.path(testText, {
    size: fontSize,
    kerning: test.kerning,
    variable: { wght: 400, wdth: 400 },
  });

  console.log(
    `${test.kerning.toString().padStart(7)} | ${result.viewBox.padEnd(
      25
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

  const filename = `kerning-test-${test.name}.svg`;
  fs.writeFileSync(path.join(outputDir, filename), svg);
});

console.log("\n=== SIZE CONSISTENCY TESTS ===\n");

// Test different font sizes to ensure consistent scaling
const sizeTests = [24, 48, 72, 96, 144];

console.log("Font Size Scaling Tests:");
console.log(
  "Size | ViewBox                   | Width  | Height | Width/Size Ratio"
);
console.log("─".repeat(80));

sizeTests.forEach((size) => {
  const result = parser.path(testText, {
    size: size,
    variable: { wght: 400, wdth: 400 },
  });

  const ratio = (result.width / size).toFixed(3);
  console.log(
    `${size.toString().padStart(4)} | ${result.viewBox.padEnd(
      25
    )} | ${result.width.toFixed(1).padStart(6)}px | ${result.height
      .toFixed(1)
      .padStart(6)}px | ${ratio.padStart(8)}`
  );

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="${result.viewBox}" 
     width="${result.width}" height="${result.height}">
  ${result.paths}
</svg>`;

  const filename = `size-test-${size}px.svg`;
  fs.writeFileSync(path.join(outputDir, filename), svg);
});

console.log("\n=== DIFFERENT TEXTS ===\n");

// Test different text lengths
const textTests = [
  { text: "A", name: "single-char" },
  { text: "Hi", name: "short" },
  { text: "Hello", name: "medium" },
  { text: "Hello World", name: "long" },
  { text: "Typography", name: "complex" },
];

console.log("Text Length Tests (72px, regular):");
console.log("Text       | ViewBox                   | Width  | Height");
console.log("─".repeat(65));

textTests.forEach((test) => {
  const result = parser.path(test.text, {
    size: 72,
    variable: { wght: 400, wdth: 400 },
  });

  console.log(
    `${test.text.padEnd(10)} | ${result.viewBox.padEnd(25)} | ${result.width
      .toFixed(1)
      .padStart(6)}px | ${result.height.toFixed(1).padStart(6)}px`
  );

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="${result.viewBox}" 
     width="${result.width}" height="${result.height}">
  ${result.paths}
</svg>`;

  const filename = `text-test-${test.name}.svg`;
  fs.writeFileSync(path.join(outputDir, filename), svg);
});

console.log("\n=== SUMMARY ===");
console.log("Generated test files to verify:");
console.log("✓ ViewBox scaling with font variations");
console.log("✓ Kerning effects on layout");
console.log("✓ Font size consistency");
console.log("✓ Text length handling");
console.log("\nCheck the svg-output folder for visual verification!");
console.log(
  "All files should display at consistent visual sizes despite different viewBox values."
);
