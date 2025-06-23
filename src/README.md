# Font Parser - Extract SVG Paths from Fonts

A pure JavaScript font parser that extracts SVG paths from OpenType/TrueType fonts without external dependencies.

## Features

- **No dependencies** - Pure JavaScript implementation
- **TrueType support** - Parses TrueType outline fonts (.ttf)
- **Full CFF support** - Handles CFF/PostScript outline fonts (.otf) with real glyph outlines
- **Unicode mapping** - Converts characters to glyph IDs via cmap table
- **SVG path generation** - Converts font outlines to SVG path data
- **Font metrics** - Extracts advance width, left side bearing, and other metrics
- **Browser compatible** - Works in both Node.js and browsers

## Installation

No installation required - just include the `font-parser.js` file:

```javascript
// Node.js
const FontParser = require('./font-parser.js');

// Browser
<script src="font-parser.js"></script>
```

## Usage

### Basic Example

```javascript
const fs = require('fs');
const FontParser = require('./font-parser.js');

// Load font file
const fontBuffer = fs.readFileSync('your-font.otf');

// Create parser instance
const parser = new FontParser(fontBuffer.buffer);

// Get font information
const fontInfo = parser.getFontInfo();
console.log(fontInfo);

// Convert character to SVG path
const svgPath = parser.glyphToSVGPath('A', { scale: 0.1 });
console.log(svgPath); // "M 5 0 L 48.68 0 L 48.68 -70 L 5 -70 Z"

// Get glyph metrics
const glyphId = parser.getGlyphId('A');
const metrics = parser.getGlyphMetrics(glyphId);
console.log(metrics); // { advanceWidth: 671, leftSideBearing: 5 }
```

### Complete SVG Generation

```javascript
const word = 'Hello';
let x = 0;
let paths = '';

for (const char of word) {
  const path = parser.glyphToSVGPath(char, { scale: 0.1 });
  const glyphId = parser.getGlyphId(char);
  const metrics = parser.getGlyphMetrics(glyphId);
  
  if (path) {
    // Transform path to position it correctly
    const transformedPath = path.replace(/M\s*(-?\d+(?:\.\d+)?)\s*(-?\d+(?:\.\d+)?)/g, 
      (match, xCoord, yCoord) => `M ${parseFloat(xCoord) + x} ${parseFloat(yCoord)}`);
    
    paths += `<path d="${transformedPath}" fill="black"/>`;
  }
  
  x += metrics ? metrics.advanceWidth * 0.1 : 50;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} 100">
  ${paths}
</svg>`;
```

## API Reference

### Constructor

```javascript
new FontParser(fontBuffer)
```

- `fontBuffer` - ArrayBuffer containing font data

### Methods

#### `getFontInfo()`

Returns font metadata:

```javascript
{
  unitsPerEm: 1000,
  bounds: { xMin: -160, yMin: -235, xMax: 1138, yMax: 918 },
  numGlyphs: 405,
  tables: ['CFF ', 'GDEF', 'GPOS', 'GSUB', 'OS/2', 'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'post']
}
```

#### `getGlyphId(character)`

Converts Unicode character to glyph ID:

```javascript
const glyphId = parser.getGlyphId('A'); // Returns: 34
```

#### `getGlyphMetrics(glyphId)`

Returns glyph metrics:

```javascript
const metrics = parser.getGlyphMetrics(34);
// Returns: { advanceWidth: 671, leftSideBearing: 5 }
```

#### `glyphToSVGPath(character, options)`

Converts character to SVG path:

```javascript
const path = parser.glyphToSVGPath('A', { 
  scale: 0.1,     // Scale factor (default: 1)
  flipY: true     // Flip Y axis (default: true)
});
```

## Font Support

### TrueType Fonts (.ttf)

Full support for TrueType outline fonts:
- ✅ Simple glyphs with quadratic Bezier curves
- ✅ Contour processing with on/off curve points
- ✅ Proper coordinate scaling and Y-axis flipping
- ⚠️ Composite glyphs (placeholder implementation)

### CFF/PostScript Fonts (.otf)

Full support for CFF outline fonts:
- ✅ Font metadata parsing
- ✅ Character to glyph mapping
- ✅ Glyph metrics
- ✅ CharString interpreter with major operators
- ✅ Cubic Bezier curve support
- ✅ Real glyph outline extraction

## Browser Demo

Open `demo.html` in a browser to test the parser interactively:

1. Select a font file (.otf or .ttf)
2. Click "Parse Font" to load font information
3. Enter text and click "Generate SVG" to see the results

## Limitations

- **Advanced CharString operators**: Some less common CFF operators not yet implemented
- **Composite glyphs**: Not fully implemented for TrueType fonts
- **Hinting**: Not processed (only outline data)
- **Advanced features**: No support for ligatures, kerning, or OpenType features

## Font Table Support

| Table | Purpose | Status |
|-------|---------|--------|
| head  | Font metadata | ✅ Full |
| cmap  | Character mapping | ✅ Formats 4, 12 |
| hhea  | Horizontal header | ✅ Full |
| hmtx  | Horizontal metrics | ✅ Full |
| maxp  | Maximum profile | ✅ Basic |
| loca  | Glyph locations | ✅ Full |
| glyf  | Glyph data | ✅ Simple glyphs |
| CFF   | PostScript outlines | ✅ Full |

## Examples

Run the included examples:

```bash
# Basic API usage
node example.js

# Comprehensive test
node test.js
```

## License

MIT License - Feel free to use in your projects! 