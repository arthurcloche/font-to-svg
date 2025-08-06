# FontToSVG.js

A minimal JavaScript library for extracting SVG paths from TrueType (TTF) fonts, including variable font support.

## Files

- **`FontToSVG.js`** - The main library (1,400+ lines)
- **`font-showcase.html`** - Interactive demo showing all fonts with variable axis controls
- **`example.html`** - Simple usage examples
- **`fonts/ttfs/`** - Sample TTF fonts for testing

## Quick Start

```javascript
// Load a font
const response = await fetch('path/to/font.ttf');
const buffer = await response.arrayBuffer();
const font = FontToSVG.parse(buffer);

// Get SVG path for text
const path = FontToSVG.textToPath(font, 'Hello World', 100);

// For variable fonts, pass axis values
const path = FontToSVG.textToPath(font, 'Hello', 100, { wght: 700 });
```

## Features

- ✅ Parse TTF fonts
- ✅ Extract glyph outlines as SVG paths
- ✅ Full variable font support (axes transformation)
- ✅ Composite glyph support
- ✅ Proper character mapping (cmap)

## Viewing the Demos

1. Start a local web server:
   ```bash
   python3 -m http.server 8000
   ```

2. Open in browser:
   - `http://localhost:8000/font-showcase.html` - See all fonts with interactive controls
   - `http://localhost:8000/example.html` - Simple usage examples

## API

### `FontToSVG.parse(buffer)`
Parse a font from an ArrayBuffer.

### `FontToSVG.textToPath(font, text, size, variableAxes)`
Convert text to SVG path string.
- `font` - Parsed font object
- `text` - Text to render
- `size` - Font size in pixels
- `variableAxes` - (Optional) Object with axis values, e.g. `{ wght: 700, wdth: 150 }`

### `FontToSVG.charToPath(font, char, size, variableAxes)`
Convert a single character to SVG path.

### `FontToSVG.getMetrics(font)`
Get font metrics (unitsPerEm, ascender, descender, lineGap).

### `FontToSVG.getVariableAxes(font)`
Get available variable font axes with their ranges.
