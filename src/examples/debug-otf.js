import FontParser from "../font-parser.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const demo = async () => {
  const parser = new FontParser();
  const fontPath = path.join(__dirname, "../fonts/SigmaSerif-Headline.otf");
  const buffer = readFileSync(fontPath);
  parser.fromBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

  console.log("Font type:", parser.fontType);
  console.log("CFF CharStrings length:", parser.cffCharStrings?.length);
  console.log("Glyph cache size:", parser.glyphCache.size);
  
  // Test individual characters
  const chars = "Hello";
  console.log("\nTesting individual characters:");
  
  for (const char of chars) {
    const glyphId = parser.getGlyphId(char);
    console.log(`\nCharacter '${char}' -> Glyph ID: ${glyphId}`);
    
    if (glyphId === 0) {
      console.log("  WARNING: Glyph ID is 0 (missing glyph)");
      continue;
    }
    
    const glyph = parser.parseGlyph(glyphId);
    if (glyph) {
      console.log(`  Contours: ${glyph.contours?.length || 0}`);
      console.log(`  Bounds: xMin=${glyph.xMin}, yMin=${glyph.yMin}, xMax=${glyph.xMax}, yMax=${glyph.yMax}`);
    } else {
      console.log("  ERROR: Failed to parse glyph");
    }
  }
  
  // Test path generation
  console.log("\n\nTesting path generation:");
  const result = parser.path("Hello", { size: 72 });
  console.log("Characters found:", result.characters.length);
  console.log("Character details:");
  result.characters.forEach((char, i) => {
    console.log(`  ${i}: '${char.char}' - has path: ${!!char.path}`);
  });
};

demo().catch(console.error);