# 🎨 Font Parser - Creative Typography for JavaScript

A modern, zero-dependency font parser that converts fonts into SVG paths for creative coding, animations, and interactive typography. Perfect replacement for p5.js `font.textToPoint()` with advanced features.

## ✨ Features

- **🔧 Zero dependencies** - Pure JavaScript implementation
- **📝 Multiple font formats** - TTF, OTF, and Variable Fonts
- **🎯 Creative coding ready** - Built-in path sampling and utilities
- **⚡ Variable font support** - Real-time axis interpolation
- **🌐 Universal compatibility** - Works in browsers and Node.js
- **🎨 Canvas optimized** - Direct path2D support for animations
- **📏 Web-standard sizing** - Accurate font metrics and scaling

## 🚀 Quick Start

### Installation

```bash
# Just download the font-parser.js file - no dependencies!
# Or clone this repo
git clone https://github.com/your-repo/font-to-svg.git
```

### Basic Usage

```javascript
// Browser
import FontParser from './font-parser.js';

// Create parser instance
const parser = new FontParser();

// Load font from URL
const font = await parser.from('./fonts/MyFont.ttf');

// Generate SVG paths
const result = parser.path('Hello World', { 
  size: 72,
  kerning: 0.1 
});

// Use the SVG
document.innerHTML = `<svg viewBox="${result.viewBox}">${result.paths}</svg>`;
```

### Creative Coding with Canvas

```javascript
const parser = new FontParser();
const font = await parser.from('./fonts/MyFont.ttf');

// Sample points for particle effects
const points = parser.samplePoints('CREATIVE', {
  size: 120,
  density: 5
});

// Draw animated particles
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  points.forEach((point, i) => {
    const wave = Math.sin(Date.now() * 0.001 + i * 0.1) * 5;
    ctx.fillStyle = `hsl(${i * 2}, 70%, 60%)`;
    ctx.beginPath();
    ctx.arc(point.x + wave, point.y, 2, 0, Math.PI * 2);
    ctx.fill();
  });
  
  requestAnimationFrame(animate);
}
animate();
```

### Variable Fonts

```javascript
const parser = new FontParser();
const font = await parser.from('./fonts/Obviously-Variable.ttf');

// Check if it's a variable font
if (font.data.isVariable) {
  console.log('Available axes:', font.data.axes);
  
  // Generate with different weights
  const light = parser.path('Variable', { 
    size: 72, 
    variable: { wght: 200, wdth: 100 } 
  });
  
  const bold = parser.path('Variable', { 
    size: 72, 
    variable: { wght: 800, wdth: 400 } 
  });
}
```

## 📖 API Reference

### Core Methods

#### `new FontParser()`
Creates a new font parser instance.

#### `await parser.from(url)`
Load font from URL (async).

#### `parser.fromBuffer(arrayBuffer)`
Load font from ArrayBuffer (sync).

#### `parser.path(text, options)`
Main method - converts text to SVG paths.

**Options:**
- `size` - Font size in pixels (default: 72)
- `kerning` - Letter spacing adjustment -1 to 1 (default: 0)
- `variable` - Variable font axis values `{ wght: 400, wdth: 100 }`

**Returns:**
```javascript
{
  paths: '<path d="..."/>',  // SVG path elements
  viewBox: '0 0 200 100',    // Tight viewBox
  width: 200,                // Text width
  height: 100,               // Text height
  characters: [...],         // Individual character data
  baseline: 75,              // Baseline position
  ascender: 80,              // Ascender height
  descender: -20             // Descender depth
}
```

### Creative Coding Methods

#### `parser.samplePoints(text, options)`
Extract points along text paths for particle effects.

**Options:**
- `size` - Font size
- `density` - Point density 1-10 (default: 3)
- `variable` - Variable font settings

**Returns:** Array of `{x, y, charIndex, char, advance}` objects

#### `parser.getCharacterPaths(text, options)`
Get individual character paths as separate objects.

#### `parser.alignedPath(text, options)`
Generate text with alignment (left, center, right).

**Options:**
- `align` - 'left', 'center', 'right'
- `containerWidth` - Width for alignment calculation
- Plus all standard path options

#### `parser.getTextBounds(text, options)`
Get precise text measurements for positioning.

## 🎯 Font Format Support

| Format | Status | Features |
|--------|--------|----------|
| **TTF** | ✅ Full | TrueType outlines, quadratic curves |
| **OTF** | ✅ Full | CFF/PostScript outlines, cubic curves |
| **Variable** | ✅ Full | Weight, width, and custom axes |
| **WOFF2** | ❌ Not supported | Use TTF/OTF instead |
| **WOFF** | ❌ Not supported | Use TTF/OTF instead |

## 🎨 Examples & Demos

### Interactive Demos
- **Font Showcase** - `src/examples/font-showcase.html`
- **Canvas Creative Coding** - `src/examples/canvas-creative-coding.html`
- **Path Drawing** - `src/examples/canvas-path-drawing.html`

### Node.js Examples
- **Static Font Demo** - `src/examples/static-font-demo.js`
- **Variable Font Demo** - `src/examples/variable-font-demo.js`

Run examples:
```bash
# View interactive demos in browser
open src/examples/font-showcase.html

# Run Node.js examples
node src/examples/static-font-demo.js
node src/examples/variable-font-demo.js
```

## 🔄 Migration from p5.js

Replace p5.js `font.textToPoint()` easily:

```javascript
// Old p5.js way
const points = font.textToPoints('Hello', x, y, fontSize);

// New way with Font Parser
const parser = new FontParser();
const font = await parser.from('./font.ttf');
const points = parser.samplePoints('Hello', { 
  size: fontSize, 
  density: 3 
});
// Points now have x, y and additional metadata
```

## 🚀 Performance

- **Zero dependencies** - No external libraries
- **Efficient caching** - Glyphs cached after first parse
- **Variable font optimization** - Real-time axis interpolation
- **Canvas ready** - Direct Path2D integration

## 🛠️ Technical Details

### Supported Font Tables
- **head** - Font metadata and scaling
- **cmap** - Unicode character mapping (formats 4, 12)
- **hhea/hmtx** - Horizontal metrics and spacing
- **glyf/loca** - TrueType glyph outlines
- **CFF** - PostScript/OpenType outlines
- **fvar** - Variable font axes and ranges
- **maxp** - Font limits and capabilities

### Coordinate System
- SVG coordinate system (Y+ downward)
- Web-standard font sizing (16px = 16px)
- Transform-free output (coordinates embedded directly)
- Proper baseline and ascender/descender handling

## 🤝 Contributing

Contributions welcome! Areas for improvement:
- Additional font formats (WOFF/WOFF2)
- OpenType feature support (ligatures, kerning tables)
- Font name table parsing
- Advanced glyph composition
- Performance optimizations

## 📄 License

MIT License - Free for personal and commercial use!

## 🙏 Acknowledgments

Built to replace p5.js `font.textToPoint()` with modern web standards and enhanced creative coding capabilities. Perfect for:

- **Creative coding** (p5.js, Three.js, Canvas)
- **Interactive typography** (animations, effects)
- **Data visualization** (custom text rendering)
- **Game development** (text as paths)
- **Web art** (SVG manipulation)

---

**Ready to create amazing typography? Start with the examples and build something awesome! 🎨** 