/**
 * Modern Font-to-SVG Parser
 *
 * Features:
 * - Zero dependencies
 * - TrueType + CFF (OpenType) support
 * - Variable font support with axis scaling
 * - Transform-free SVG output (coordinates embedded directly)
 * - Optimized for canvas manipulation and path sampling
 *
 * Usage:
 *   const parser = new FontParser();
 *   const font = await parser.from(url) or parser.fromBuffer(buffer);
 *   const result = parser.path(text, {size, kerning, variable: {...}});
 *
 * @author Optimized Font Parser
 * @version 2.0.0
 */

export default class FontParser {
  constructor() {
    // Font data
    this.buffer = null;
    this.dataView = null;
    this.offset = 0;

    // Parsed font structure
    this.tables = {};
    this.fontType = null; // 'truetype' or 'cff'
    this.unitsPerEm = 1000;

    // Font metrics
    this.xMin = 0;
    this.yMin = 0;
    this.xMax = 0;
    this.yMax = 0;
    this.ascender = 0;
    this.descender = 0;
    this.lineGap = 0;

    // Glyph data
    this.horizontalMetrics = [];
    this.charToGlyph = new Map();
    this.glyphCache = new Map();
    this.indexToLocFormat = 0;
    this.glyphOffsets = [];
    this.glyphParseCache = new Map(); // Cache parsed glyph data

    // Variable font data
    this.isVariableFont = false;
    this.variationAxes = [];
    this.currentAxisValues = {};

    // CFF data
    this.cffData = null;
    this.cffCharStrings = [];
    this.cffGlobalSubrs = [];
    this.cffLocalSubrs = [];
    this.cffGlobalBias = 107;
    this.cffLocalBias = 107;

    // Public API data
    this._data = null;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Load font from URL (async)
   * @param {string} url - Font file URL
   * @returns {FontParser} this
   */
  async from(url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return this.fromBuffer(arrayBuffer);
  }

  /**
   * Load font from buffer (sync)
   * @param {ArrayBuffer} fontBuffer - Font file data
   * @returns {FontParser} this
   */
  fromBuffer(fontBuffer) {
    // Check for unsupported formats
    const view = new DataView(fontBuffer);
    const signature = view.getUint32(0, false);

    if (signature === 0x774f4632) {
      // WOFF2
      throw new Error(
        "WOFF2 fonts not supported. Please use TTF or OTF fonts."
      );
    }

    if (signature === 0x774f4646) {
      // WOFF
      throw new Error("WOFF fonts not supported. Please use TTF or OTF fonts.");
    }

    // Process regular fonts (TTF/OTF)
    this._initializeFont(fontBuffer);
    this._parseFont();
    this._buildMetadata();
    return this;
  }

  /**
   * Get font metadata
   * @returns {Object} Font information
   */
  get data() {
    return this._data;
  }

  /**
   * Convert text to SVG paths with embedded coordinates
   * @param {string} text - Text to convert
   * @param {Object} options - Rendering options
   * @param {number} options.size - Font size (default: 72)
   * @param {number} options.kerning - Kerning adjustment -1 to 1 (default: 0)
   * @param {Object} options.variable - Variable font axis values
   * @returns {Object} SVG data with paths, viewBox, dimensions, and metadata
   */
  path(text, options = {}) {
    if (!this.buffer) {
      throw new Error("No font loaded. Use from() or fromBuffer() first.");
    }

    const opts = this._normalizeOptions(options);
    const scale = opts.size / this.unitsPerEm;

    // Apply variable font settings
    if (opts.variable && this.isVariableFont) {
      this.setVariation(opts.variable);
    }

    // Generate character paths
    const pathResults = this._generateCharacterPaths(text, opts, scale);

    // Calculate tight viewBox
    const viewBoxData = this._calculateViewBox(pathResults, opts.size);

    return {
      paths: pathResults.paths.map((p) => `<path d="${p.path}"/>`).join("\n"),
      viewBox: `${viewBoxData.x} ${viewBoxData.y} ${viewBoxData.width} ${viewBoxData.height}`,
      width: viewBoxData.textWidth,
      height: viewBoxData.textHeight,
      baseline: pathResults.baseline,
      ascender: pathResults.ascender,
      descender: pathResults.descender,
      characters: pathResults.paths,
    };
  }

  // ============================================================================
  // VARIABLE FONT API
  // ============================================================================

  /**
   * Set variable font axis values
   * @param {Object} axisValues - Axis tag/value pairs (e.g., {wght: 400, wdth: 100})
   * @returns {FontParser} this
   */
  setVariation(axisValues) {
    if (!this.isVariableFont) return this;

    for (const [tag, value] of Object.entries(axisValues)) {
      const axis = this.variationAxes.find((a) => a.tag === tag);
      if (axis) {
        this.currentAxisValues[tag] = Math.max(
          axis.min,
          Math.min(axis.max, value)
        );
      }
    }

    this.glyphCache.clear(); // Clear cache when variation changes
    return this;
  }

  /**
   * Get current variable font axis values
   * @returns {Object} Current axis values
   */
  getVariation() {
    return { ...this.currentAxisValues };
  }

  /**
   * Get available variable font axes
   * @returns {Array} Axis definitions
   */
  getAxes() {
    return this.variationAxes ? [...this.variationAxes] : [];
  }

  // ============================================================================
  // CREATIVE CODING UTILITIES
  // ============================================================================

  /**
   * Sample points along text paths (perfect for creative coding)
   * @param {string} text - Text to convert
   * @param {Object} options - Sampling options
   * @param {number} options.size - Font size (default: 72)
   * @param {number} options.density - Sampling density 1-10 (default: 3)
   * @param {Object} options.variable - Variable font axis values
   * @returns {Array} Array of point objects with x, y, charIndex
   */
  samplePoints(text, options = {}) {
    const opts = {
      size: options.size || 72,
      density: Math.max(1, Math.min(10, options.density || 3)),
      variable: options.variable || {},
    };

    const result = this.path(text, opts);
    const points = [];

    // Parse viewBox
    const [vbX, vbY, vbWidth, vbHeight] = result.viewBox.split(" ").map(Number);
    const step = Math.max(1, Math.floor(8 / opts.density));

    result.characters.forEach((char, charIndex) => {
      const path2D = new Path2D(char.path);

      // Create temporary canvas for path testing
      const canvas =
        typeof document !== "undefined"
          ? document.createElement("canvas")
          : { getContext: () => ({ isPointInPath: () => false }) };
      const ctx = canvas.getContext("2d");

      // Sample points within viewbox
      for (let x = vbX; x < vbX + vbWidth; x += step) {
        for (let y = vbY; y < vbY + vbHeight; y += step) {
          if (ctx.isPointInPath(path2D, x, y)) {
            points.push({
              x: x,
              y: y,
              charIndex: charIndex,
              char: char.char,
              advance: char.advance,
            });
          }
        }
      }
    });

    return points;
  }

  /**
   * Get individual character paths as separate objects
   * @param {string} text - Text to convert
   * @param {Object} options - Rendering options
   * @returns {Array} Array of character path objects
   */
  getCharacterPaths(text, options = {}) {
    const result = this.path(text, options);

    return result.characters.map((char, index) => ({
      char: char.char,
      path: char.path,
      x: char.x,
      y: char.y,
      advance: char.advance,
      index: index,
      bounds: this._calculatePathBounds(char.path),
    }));
  }

  /**
   * Get text bounds for alignment and positioning
   * @param {string} text - Text to measure
   * @param {Object} options - Rendering options
   * @returns {Object} Bounds object with x, y, width, height
   */
  getTextBounds(text, options = {}) {
    const result = this.path(text, options);
    const [x, y, width, height] = result.viewBox.split(" ").map(Number);

    return {
      x: x,
      y: y,
      width: width,
      height: height,
      textWidth: result.width,
      textHeight: result.height,
      baseline: result.baseline,
      ascender: result.ascender,
      descender: result.descender,
    };
  }

  /**
   * Create aligned text paths (left, center, right)
   * @param {string} text - Text to convert
   * @param {Object} options - Rendering options
   * @param {string} options.align - Alignment: 'left', 'center', 'right' (default: 'left')
   * @param {number} options.containerWidth - Container width for alignment
   * @returns {Object} SVG data with aligned paths
   */
  alignedPath(text, options = {}) {
    const opts = { ...options };
    const align = opts.align || "left";
    const containerWidth = opts.containerWidth || 800;

    // Remove align and containerWidth from font options
    delete opts.align;
    delete opts.containerWidth;

    const result = this.path(text, opts);
    const bounds = this.getTextBounds(text, opts);

    let offsetX = 0;
    switch (align) {
      case "center":
        offsetX = (containerWidth - bounds.textWidth) / 2;
        break;
      case "right":
        offsetX = containerWidth - bounds.textWidth;
        break;
      default: // 'left'
        offsetX = 0;
    }

    // Transform paths if offset needed
    if (offsetX !== 0) {
      const transformedPaths = result.characters.map((char) => ({
        ...char,
        path: this._translatePath(char.path, offsetX, 0),
        x: char.x + offsetX,
      }));

      return {
        ...result,
        characters: transformedPaths,
        paths: transformedPaths.map((p) => `<path d="${p.path}"/>`).join("\n"),
        alignment: align,
        offsetX: offsetX,
      };
    }

    return { ...result, alignment: align, offsetX: 0 };
  }

  // ============================================================================
  // INTERNAL IMPLEMENTATION
  // ============================================================================

  /**
   * Initialize font data structures
   * @private
   */
  _initializeFont(fontBuffer) {
    this.buffer = fontBuffer;
    this.dataView = new DataView(fontBuffer);
    this.offset = 0;
    this.tables = {};
    this.glyphCache.clear();
    this.charToGlyph.clear();
  }

  /**
   * Normalize and validate options
   * @private
   */
  _normalizeOptions(options) {
    return {
      size: Math.max(1, options.size || 72),
      kerning: Math.max(-1, Math.min(1, options.kerning || 0)),
      variable: options.variable || {},
    };
  }

  /**
   * Generate character paths for text
   * @private
   */
  _generateCharacterPaths(text, opts, scale) {
    const paths = [];
    let currentX = 0;
    let minY = Infinity;
    let maxY = -Infinity;

    // Calculate baseline metrics
    const ascender = this.ascender || this.yMax || this.unitsPerEm * 0.8;
    const descender = this.descender || this.yMin || -this.unitsPerEm * 0.2;
    const scaledAscender = ascender * scale;
    const scaledDescender = descender * scale;
    const baselineY = scaledAscender; // SVG coordinate system

    for (const char of text) {
      if (char === " ") {
        currentX += opts.size * 0.3; // Space width
        continue;
      }

      const glyphId = this.getGlyphId(char);
      const pathData = this.glyphToSVGPath(char, {
        scale,
        flipY: true,
        offsetX: currentX,
        offsetY: baselineY,
      });

      if (pathData) {
        const bounds = this.getGlyphBounds(char, {
          scale,
          flipY: true,
          offsetX: currentX,
          offsetY: baselineY,
        });

        if (bounds) {
          minY = Math.min(minY, bounds.minY);
          maxY = Math.max(maxY, bounds.maxY);
        }

        const metrics = this.getGlyphMetrics(glyphId);
        paths.push({
          char,
          path: pathData,
          x: currentX,
          y: baselineY,
          advance: metrics.advanceWidth * scale,
        });
      }

      // Advance with kerning
      const metrics = this.getGlyphMetrics(glyphId);
      const advance = metrics.advanceWidth * scale;
      const kerningAdjustment = opts.kerning * advance;
      currentX += advance + kerningAdjustment;
    }

    return {
      paths,
      totalWidth: currentX,
      minY: isFinite(minY) ? minY : 0,
      maxY: isFinite(maxY) ? maxY : scaledAscender,
      baseline: baselineY,
      ascender: scaledAscender,
      descender: scaledDescender,
    };
  }

  /**
   * Calculate tight viewBox for generated paths
   * @private
   */
  _calculateViewBox(pathResults, fontSize) {
    const padding = fontSize * 0.1;
    const x = 0 - padding;
    const y = pathResults.minY - padding;
    const width = pathResults.totalWidth + padding * 2;
    const height = pathResults.maxY - pathResults.minY + padding * 2;

    return {
      x,
      y,
      width,
      height,
      textWidth: pathResults.totalWidth,
      textHeight: pathResults.maxY - pathResults.minY,
    };
  }

  /**
   * Build font metadata object
   * @private
   */
  _buildMetadata() {
    this._data = {
      name: this._extractFontName(),
      unitsPerEm: this.unitsPerEm,
      isVariable: this.isVariableFont,
      axes: this.isVariableFont ? this.getAxes() : [],
      tables: Object.keys(this.tables),
      bounds: {
        xMin: this.xMin,
        yMin: this.yMin,
        xMax: this.xMax,
        yMax: this.yMax,
      },
      metrics: {
        ascender: this.ascender || this.yMax || this.unitsPerEm * 0.8,
        descender: this.descender || this.yMin || -this.unitsPerEm * 0.2,
        lineGap: this.lineGap || 0,
      },
      numGlyphs: this._getNumGlyphs(),
    };
  }

  /**
   * Extract font name (simplified)
   * @private
   */
  _extractFontName() {
    // TODO: Implement proper name table parsing
    return "Unknown Font";
  }

  /**
   * Get number of glyphs in font
   * @private
   */
  _getNumGlyphs() {
    if (this.tables.maxp) {
      this.seek(this.tables.maxp.offset + 4);
      return this.readUint16();
    }
    return 0;
  }

  /**
   * Calculate bounds of a path string
   * @private
   */
  _calculatePathBounds(pathString) {
    // Simple bounds calculation by parsing path coordinates
    const coords = pathString.match(/-?\d+\.?\d*/g);
    if (!coords || coords.length < 2) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (let i = 0; i < coords.length; i += 2) {
      const x = parseFloat(coords[i]);
      const y = parseFloat(coords[i + 1]);
      if (!isNaN(x) && !isNaN(y)) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    return {
      x: isFinite(minX) ? minX : 0,
      y: isFinite(minY) ? minY : 0,
      width: isFinite(maxX) && isFinite(minX) ? maxX - minX : 0,
      height: isFinite(maxY) && isFinite(minY) ? maxY - minY : 0,
    };
  }

  /**
   * Translate a path by offsetX and offsetY
   * @private
   */
  _translatePath(pathString, offsetX, offsetY) {
    if (offsetX === 0 && offsetY === 0) return pathString;

    // Simple path translation by adjusting coordinates
    return pathString.replace(
      /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g,
      (match, x, y) => {
        const newX = parseFloat(x) + offsetX;
        const newY = parseFloat(y) + offsetY;
        return `${newX} ${newY}`;
      }
    );
  }

  // Apply affine transform to an SVG path string (simple regex replacement)
  _applyMatrixToPath(pathString, part, scale, flipY, offsetX, offsetY) {
    if (!pathString) return "";
    const { a: m00, b: m10, c: m01, d: m11, tx: dx, ty: dy } = part.m;
    return pathString.replace(
      /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g,
      (match, xs, ys) => {
        // current coords are already scaled; first convert back to font units
        const xSvg = parseFloat(xs) - offsetX;
        const ySvg = parseFloat(ys) - offsetY;
        const xFont = xSvg / scale;
        const yFont = flipY ? -ySvg / scale : ySvg / scale;

        // apply component matrix in font units
        const nxFont = xFont * m00 + yFont * m01 + dx;
        const nyFont = xFont * m10 + yFont * m11 + dy;

        // convert back to svg coords
        const nxSvg = nxFont * scale + offsetX;
        const nySvg = (flipY ? -nyFont : nyFont) * scale + offsetY;
        return `${nxSvg} ${nySvg}`;
      }
    );
  }

  // ============================================================================
  // BINARY READING UTILITIES
  // ============================================================================

  /**
   * Read unsigned 8-bit integer
   * @private
   */
  readUint8() {
    if (this.offset >= this.dataView.byteLength) {
      throw new Error("Unexpected end of font data");
    }
    return this.dataView.getUint8(this.offset++);
  }

  /**
   * Read signed 8-bit integer
   * @private
   */
  readInt8() {
    if (this.offset >= this.dataView.byteLength) {
      throw new Error("Unexpected end of font data");
    }
    return this.dataView.getInt8(this.offset++);
  }

  /**
   * Read unsigned 16-bit integer (big-endian)
   * @private
   */
  readUint16() {
    if (this.offset + 1 >= this.dataView.byteLength) {
      throw new Error("Unexpected end of font data");
    }
    const value = this.dataView.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  /**
   * Read unsigned 32-bit integer (big-endian)
   * @private
   */
  readUint32() {
    if (this.offset + 3 >= this.dataView.byteLength) {
      throw new Error("Unexpected end of font data");
    }
    const value = this.dataView.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  /**
   * Read signed 16-bit integer (big-endian)
   * @private
   */
  readInt16() {
    if (this.offset + 1 >= this.dataView.byteLength) {
      throw new Error("Unexpected end of font data");
    }
    const value = this.dataView.getInt16(this.offset, false);
    this.offset += 2;
    return value;
  }

  /**
   * Read signed 32-bit integer (big-endian)
   * @private
   */
  readInt32() {
    if (this.offset + 3 >= this.dataView.byteLength) {
      throw new Error("Unexpected end of font data");
    }
    const value = this.dataView.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  /**
   * Read 32-bit fixed point number (16.16)
   * @private
   */
  readFixed() {
    return this.readInt32() / 65536;
  }

  /**
   * Read 16-bit fixed point number (2.14)
   * @private
   */
  readF2Dot14() {
    return this.readInt16() / 16384;
  }

  /**
   * Read 4-character tag
   * @private
   */
  readTag() {
    return String.fromCharCode(
      this.readUint8(),
      this.readUint8(),
      this.readUint8(),
      this.readUint8()
    );
  }

  /**
   * Seek to offset in font data
   * @private
   */
  seek(offset) {
    if (offset < 0 || offset >= this.dataView.byteLength) {
      throw new Error(`Invalid seek offset: ${offset}`);
    }
    this.offset = offset;
  }

  // ============================================================================
  // FONT STRUCTURE PARSING
  // ============================================================================

  /**
   * Parse font structure and tables
   * @private
   */
  _parseFont() {
    this.offset = 0;

    // Read table directory
    const sfntVersion = this.readUint32();
    const numTables = this.readUint16();
    this.offset += 6; // Skip searchRange, entrySelector, rangeShift

    // Read table records
    this._parseTableDirectory(numTables);

    // Parse essential tables in order
    this._parseHeadTable();
    this._parseCmapTable();
    this._parseHmtxTable();

    // Determine font type and parse outlines
    this._determineFontType();

    // Parse variable font tables
    this._parseVariableFontTables();
  }

  /**
   * Parse table directory
   * @private
   */
  _parseTableDirectory(numTables) {
    for (let i = 0; i < numTables; i++) {
      const tag = this.readTag();
      this.readUint32(); // Skip checksum
      const offset = this.readUint32();
      const length = this.readUint32();
      this.tables[tag] = { tag, offset, length };
    }
  }

  /**
   * Determine font type and parse appropriate outline tables
   * @private
   */
  _determineFontType() {
    if (this.tables.glyf && this.tables.loca) {
      this.fontType = "truetype";
      this._parseLocaTable();
    } else if (this.tables["CFF "]) {
      this.fontType = "cff";
      this._parseCFFTable();
    } else {
      throw new Error(
        "Unsupported font type - no glyf/loca or CFF table found"
      );
    }
  }

  /**
   * Parse variable font tables if present
   * @private
   */
  _parseVariableFontTables() {
    this.isVariableFont = !!this.tables.fvar;
    if (this.isVariableFont) {
      this.currentAxisValues = {};
      this._parseFvarTable();
    }
  }

  /**
   * Parse head table (font header)
   * @private
   */
  _parseHeadTable() {
    if (!this.tables.head) {
      throw new Error("Required head table not found");
    }

    this.seek(this.tables.head.offset);
    this.offset += 18; // Skip to unitsPerEm
    this.unitsPerEm = this.readUint16();
    this.offset += 16; // Skip to bounds
    this.xMin = this.readInt16();
    this.yMin = this.readInt16();
    this.xMax = this.readInt16();
    this.yMax = this.readInt16();
    this.offset += 6; // Skip to indexToLocFormat
    this.indexToLocFormat = this.readInt16();
  }

  /**
   * Parse character map table
   * @private
   */
  _parseCmapTable() {
    if (!this.tables.cmap) {
      throw new Error("Required cmap table not found");
    }

    this.seek(this.tables.cmap.offset);
    this.offset += 2; // Skip version
    const numTables = this.readUint16();

    // Find best cmap subtable - using Typr.js platform/encoding preference order
    let subtableOffset = null;
    let bestPlatformEncoding = null;
    const cmapSubtables = [];

    for (let i = 0; i < numTables; i++) {
      const platformID = this.readUint16();
      const encodingID = this.readUint16();
      const offset = this.readUint32();
      cmapSubtables.push({ platformID, encodingID, offset });
    }

    // Platform/encoding preference order from Typr.js
    const preferences = [
      { platform: 3, encoding: 10 }, // Windows Unicode full
      { platform: 0, encoding: 4 }, // Unicode 2.0+
      { platform: 3, encoding: 1 }, // Windows Unicode BMP
      { platform: 1, encoding: 0 }, // Mac Roman
      { platform: 0, encoding: 3 }, // Unicode default
      { platform: 0, encoding: 1 }, // Unicode 1.1
      { platform: 3, encoding: 0 }, // Windows Symbol
      { platform: 3, encoding: 5 }, // Windows Korean
    ];

    // Find the best subtable according to preference order
    for (const pref of preferences) {
      const subtable = cmapSubtables.find(
        (st) =>
          st.platformID === pref.platform && st.encodingID === pref.encoding
      );
      if (subtable) {
        subtableOffset = this.tables.cmap.offset + subtable.offset;
        bestPlatformEncoding = `p${pref.platform}e${pref.encoding}`;
        break;
      }
    }

    if (!subtableOffset) {
      throw new Error("No Unicode cmap subtable found");
    }

    this._parseCmapSubtable(subtableOffset);
  }

  /**
   * Parse cmap subtable based on format
   * @private
   */
  _parseCmapSubtable(offset) {
    this.seek(offset);
    const format = this.readUint16();

    switch (format) {
      case 4:
        this._parseCmapFormat4();
        break;
      case 6:
        this._parseCmapFormat6();
        break;
      case 12:
        this._parseCmapFormat12();
        break;
      default:
        console.warn(`Unsupported cmap format: ${format}`);
        break;
    }
  }

  /**
   * Parse cmap format 4 (BMP Unicode)
   * @private
   */
  _parseCmapFormat4() {
    this.offset += 4; // Skip length, language
    const segCountX2 = this.readUint16();
    const segCount = segCountX2 / 2;
    this.offset += 6; // Skip searchRange, entrySelector, rangeShift

    // Read segment arrays
    const endCode = Array.from({ length: segCount }, () => this.readUint16());
    this.readUint16(); // Skip reservedPad
    const startCode = Array.from({ length: segCount }, () => this.readUint16());
    const idDelta = Array.from({ length: segCount }, () => this.readInt16());
    const idRangeOffsetStart = this.offset;
    const idRangeOffset = Array.from({ length: segCount }, () =>
      this.readUint16()
    );

    // Process segments to build character-to-glyph mapping
    for (let i = 0; i < segCount; i++) {
      for (let c = startCode[i]; c <= endCode[i]; c++) {
        let glyphIndex = 0;
        if (idRangeOffset[i] === 0) {
          glyphIndex = (c + idDelta[i]) & 0xffff;
        } else {
          const glyphIndexOffset =
            idRangeOffsetStart +
            i * 2 +
            idRangeOffset[i] +
            (c - startCode[i]) * 2;
          this.seek(glyphIndexOffset);
          const glyphIndexFromArray = this.readUint16();
          if (glyphIndexFromArray !== 0) {
            glyphIndex = (glyphIndexFromArray + idDelta[i]) & 0xffff;
          }
        }
        if (glyphIndex !== 0) {
          this.charToGlyph.set(c, glyphIndex);
        }
      }
    }
  }

  /**
   * Parse cmap format 6 (Trimmed table mapping)
   * @private
   */
  _parseCmapFormat6() {
    this.offset += 4; // Skip length, language
    const firstCode = this.readUint16();
    const entryCount = this.readUint16();

    for (let i = 0; i < entryCount; i++) {
      const glyphId = this.readUint16();
      if (glyphId !== 0) {
        this.charToGlyph.set(firstCode + i, glyphId);
      }
    }
  }

  /**
   * Parse cmap format 12 (Full Unicode)
   * @private
   */
  _parseCmapFormat12() {
    this.offset += 2; // Skip reserved
    this.offset += 4; // Skip length
    this.offset += 4; // Skip language
    const numGroups = this.readUint32();

    for (let i = 0; i < numGroups; i++) {
      const startCharCode = this.readUint32();
      const endCharCode = this.readUint32();
      const startGlyphID = this.readUint32();

      for (let c = startCharCode; c <= endCharCode; c++) {
        this.charToGlyph.set(c, startGlyphID + (c - startCharCode));
      }
    }
  }

  /**
   * Parse horizontal metrics tables (hhea + hmtx)
   * @private
   */
  _parseHmtxTable() {
    if (!this.tables.hmtx || !this.tables.hhea) {
      console.warn("hmtx or hhea table missing - metrics unavailable");
      return;
    }

    // Parse hhea table first to get font metrics
    this.seek(this.tables.hhea.offset);
    const hheaVersion = this.readFixed();
    this.ascender = this.readInt16();
    this.descender = this.readInt16();
    this.lineGap = this.readInt16();
    const advanceWidthMax = this.readUint16();
    const minLeftSideBearing = this.readInt16();
    const minRightSideBearing = this.readInt16();
    const xMaxExtent = this.readInt16();
    const caretSlopeRise = this.readInt16();
    const caretSlopeRun = this.readInt16();
    const caretOffset = this.readInt16();
    // Skip 4 reserved values (8 bytes)
    this.offset += 8;
    const metricDataFormat = this.readInt16();
    const numberOfHMetrics = this.readUint16();

    // Parse hmtx table
    this.seek(this.tables.hmtx.offset);
    this.horizontalMetrics = Array.from({ length: numberOfHMetrics }, () => ({
      advanceWidth: this.readUint16(),
      leftSideBearing: this.readInt16(),
    }));
  }

  /**
   * Parse glyph locations table (TrueType)
   * @private
   */
  _parseLocaTable() {
    if (!this.tables.maxp || !this.tables.loca) {
      throw new Error("Required maxp or loca table not found");
    }

    this.seek(this.tables.maxp.offset + 4);
    const numGlyphs = this.readUint16();

    this.seek(this.tables.loca.offset);
    this.glyphOffsets = Array.from({ length: numGlyphs + 1 }, () =>
      this.indexToLocFormat === 0 ? this.readUint16() * 2 : this.readUint32()
    );
  }

  /**
   * Parse CFF table (Compact Font Format)
   * @private
   */
  _parseCFFTable() {
    if (!this.tables["CFF "]) {
      throw new Error("CFF table not found");
    }

    try {
      const cffStart = this.tables["CFF "].offset;
      this.seek(cffStart);

      // Read CFF header
      const major = this.readUint8();
      const minor = this.readUint8();
      const hdrSize = this.readUint8();
      const offSize = this.readUint8();

      // Skip to end of header
      this.seek(cffStart + hdrSize);

      // Read INDEXes
      const nameIndex = this.readIndex();
      const topDictIndex = this.readIndex();
      const stringIndex = this.readIndex();
      this.cffGlobalSubrs = this.readIndex();

      // Calculate global subroutine bias
      const nGlobalSubrs = this.cffGlobalSubrs.length;
      this.cffGlobalBias =
        nGlobalSubrs < 1240 ? 107 : nGlobalSubrs < 33900 ? 1131 : 32768;

      // Parse Top DICT
      if (topDictIndex.length > 0) {
        this.parseTopDict(topDictIndex[0], cffStart, stringIndex);
      }

      // Parse Private DICT and local subroutines
      if (this.cffData?.privateDict) {
        this.parsePrivateDict(
          this.cffData.privateDict.offset,
          this.cffData.privateDict.size
        );
      }

      // Parse CharStrings
      if (this.cffData?.charStringsOffset) {
        this.seek(this.cffData.charStringsOffset);
        this.cffCharStrings = this.readIndex();
      }
    } catch (error) {
      console.warn("CFF table parsing failed:", error.message);
      // Set minimal fallback
      this.fontType = "cff";
      this.cffCharStrings = [];
      this.cffData = { charStringsOffset: null };
    }
  }

  /**
   * Parse font variations table (variable fonts)
   * @private
   */
  _parseFvarTable() {
    if (!this.tables.fvar) {
      throw new Error("fvar table not found");
    }

    this.seek(this.tables.fvar.offset + 4);
    const axesArrayOffset = this.readUint16();
    this.readUint16(); // Skip reserved
    const axisCount = this.readUint16();
    this.offset += 6; // Skip axisSize, instanceCount, instanceSize

    this.seek(this.tables.fvar.offset + axesArrayOffset);
    this.variationAxes = Array.from({ length: axisCount }, () => {
      const axis = {
        tag: this.readTag(),
        min: this.readFixed(),
        default: this.readFixed(),
        max: this.readFixed(),
        flags: this.readUint16(),
        nameID: this.readUint16(),
      };
      this.currentAxisValues[axis.tag] = axis.default;
      return axis;
    });
  }

  // Public API methods
  setVariation(axisValues) {
    if (!this.isVariableFont) return this;

    for (const [tag, value] of Object.entries(axisValues)) {
      const axis = this.variationAxes.find((a) => a.tag === tag);
      if (axis) {
        this.currentAxisValues[tag] = Math.max(
          axis.min,
          Math.min(axis.max, value)
        );
      }
    }

    this.glyphCache.clear();
    return this;
  }

  getVariation() {
    return { ...this.currentAxisValues };
  }
  getAxes() {
    return this.variationAxes ? [...this.variationAxes] : [];
  }
  getGlyphId(character) {
    const codePoint =
      typeof character === "string" ? character.codePointAt(0) : character;
    return this.charToGlyph.get(codePoint) || 0;
  }

  getGlyphMetrics(glyphId) {
    if (!this.horizontalMetrics || glyphId >= this.horizontalMetrics.length) {
      return { advanceWidth: this.unitsPerEm, leftSideBearing: 0 };
    }

    const baseMetrics = this.horizontalMetrics[glyphId];

    // Apply variable font scaling to metrics if needed
    if (this.isVariableFont) {
      const wght = this.currentAxisValues.wght || 150;
      const wdth = this.currentAxisValues.wdth || 100;

      const widthFactor = wdth / 100;
      const weightFactor = 1 + (wght - 150) / 2000; // More subtle weight scaling for metrics

      return {
        advanceWidth: baseMetrics.advanceWidth * widthFactor,
        leftSideBearing: baseMetrics.leftSideBearing * widthFactor,
      };
    }

    return baseMetrics;
  }

  // Main glyph parsing with caching and variation support
  parseGlyph(glyphId) {
    if (this.glyphCache.has(glyphId)) {
      return this.glyphCache.get(glyphId);
    }

    let baseGlyph;
    if (this.fontType === "cff") {
      baseGlyph = this.parseCFFGlyph(glyphId);
    } else {
      baseGlyph = this.parseTrueTypeGlyph(glyphId);
    }

    const glyph = this.applyVariationToGlyph(baseGlyph, glyphId);
    if (glyph) {
      this.glyphCache.set(glyphId, glyph);
    }
    return glyph;
  }

  // Apply variation (improved scaling for better metrics)
  applyVariationToGlyph(baseGlyph, glyphId) {
    if (!this.isVariableFont || !baseGlyph) return baseGlyph;

    const wght = this.currentAxisValues.wght || 150;
    const wdth = this.currentAxisValues.wdth || 100;

    // More realistic scaling factors
    const widthFactor = wdth / 100;
    const weightFactor = 1 + (wght - 150) / 1500; // More subtle weight scaling

    return this.transformGlyph(baseGlyph, widthFactor, weightFactor);
  }

  transformGlyph(glyph, widthFactor, weightFactor) {
    const variatedGlyph = {
      ...glyph,
      contours: glyph.contours.map((contour) =>
        contour.map((point) => ({
          ...point,
          x: point.x * widthFactor,
          y: point.y * weightFactor,
          ...(point.cubic && {
            x1: point.x1 * widthFactor,
            y1: point.y1 * weightFactor,
            x2: point.x2 * widthFactor,
            y2: point.y2 * weightFactor,
          }),
        }))
      ),
    };

    // Recalculate bounds
    const bounds = this.calculateGlyphBounds(variatedGlyph.contours);
    return { ...variatedGlyph, ...bounds };
  }

  calculateGlyphBounds(contours) {
    let xMin = Infinity,
      yMin = Infinity,
      xMax = -Infinity,
      yMax = -Infinity;

    for (const contour of contours) {
      for (const point of contour) {
        xMin = Math.min(xMin, point.x);
        yMin = Math.min(yMin, point.y);
        xMax = Math.max(xMax, point.x);
        yMax = Math.max(yMax, point.y);

        if (point.cubic) {
          xMin = Math.min(xMin, point.x1, point.x2);
          yMin = Math.min(yMin, point.y1, point.y2);
          xMax = Math.max(xMax, point.x1, point.x2);
          yMax = Math.max(yMax, point.y1, point.y2);
        }
      }
    }

    return {
      xMin: isFinite(xMin) ? xMin : 0,
      yMin: isFinite(yMin) ? yMin : 0,
      xMax: isFinite(xMax) ? xMax : 0,
      yMax: isFinite(yMax) ? yMax : 0,
    };
  }

  // SVG generation methods
  glyphToSVGPath(character, options = {}, _visited = new Set()) {
    const glyphId =
      typeof character === "number" ? character : this.getGlyphId(character);

    // Prevent infinite recursion for malformed fonts
    if (_visited.has(glyphId)) return "";
    _visited.add(glyphId);

    const glyph = this.parseGlyph(glyphId);
    if (!glyph) return "";

    // If glyph has direct contours, draw them
    if (glyph.contours && glyph.contours.length) {
      const scale = options.scale || 1;
      const flipY = options.flipY !== false;
      const offsetX = options.offsetX || 0;
      const offsetY = options.offsetY || 0;
      return glyph.contours
        .map((contour) =>
          this.contourToSVGPath(contour, scale, flipY, offsetX, offsetY)
        )
        .join(" ");
    }

    // Composite glyph: iterate parts
    if (glyph.parts && glyph.parts.length) {
      const scale = options.scale || 1;
      const flipY = options.flipY !== false;
      const offsetX = options.offsetX || 0;
      const offsetY = options.offsetY || 0;
      let combined = "";

      for (const part of glyph.parts) {
        // Recursively get sub path without flipY to keep in font space
        const subPath = this.glyphToSVGPath(
          part.glyphIndex,
          { ...options, flipY },
          _visited
        );
        if (!subPath) continue;

        combined +=
          this._applyMatrixToPath(
            subPath,
            part,
            scale,
            flipY,
            offsetX,
            offsetY
          ) + " ";
      }
      return combined.trim();
    }

    return "";
  }

  glyphToSVG(character, options = {}) {
    const scale = options.scale || 0.1;
    const padding = options.padding || 10;
    const width = options.width || 200;
    const height = options.height || 200;

    const path = this.glyphToSVGPath(character, {
      scale,
      flipY: options.flipY,
    });
    const bounds = this.getGlyphBounds(character, {
      scale,
      flipY: options.flipY,
    });

    if (!path || !bounds) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="50%" y="50%" text-anchor="middle" font-size="16">No glyph</text></svg>`;
    }

    const viewBoxX = bounds.minX - padding;
    const viewBoxY = bounds.minY - padding;
    const viewBoxWidth = bounds.width + padding * 2;
    const viewBoxHeight = bounds.height + padding * 2;

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}" 
     width="${width}" height="${height}">
  <path d="${path}" fill="black" stroke="none"/>
</svg>`;
  }

  getGlyphBounds(character, options = {}, _visited = new Set()) {
    const glyphId =
      typeof character === "number" ? character : this.getGlyphId(character);
    if (_visited.has(glyphId)) return null;
    _visited.add(glyphId);

    const glyph = this.parseGlyph(glyphId);
    if (!glyph) return null;

    // If simple glyph
    if (glyph.contours && glyph.contours.length) {
      const scale = options.scale || 1;
      const offsetX = options.offsetX || 0;
      const offsetY = options.offsetY || 0;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (const contour of glyph.contours) {
        for (const point of contour) {
          const x = point.x * scale + offsetX;
          const y =
            (options.flipY !== false ? -point.y : point.y) * scale + offsetY;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          if (point.cubic) {
            const cx1 = point.x1 * scale + offsetX;
            const cy1 =
              (options.flipY !== false ? -point.y1 : point.y1) * scale +
              offsetY;
            const cx2 = point.x2 * scale + offsetX;
            const cy2 =
              (options.flipY !== false ? -point.y2 : point.y2) * scale +
              offsetY;
            minX = Math.min(minX, cx1, cx2);
            minY = Math.min(minY, cy1, cy2);
            maxX = Math.max(maxX, cx1, cx2);
            maxY = Math.max(maxY, cy1, cy2);
          }
        }
      }
      return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }

    // Composite glyph
    if (glyph.parts && glyph.parts.length) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      const scale = options.scale || 1;
      const flipY = options.flipY !== false;
      const offsetX = options.offsetX || 0;
      const offsetY = options.offsetY || 0;

      for (const part of glyph.parts) {
        const subBounds = this.getGlyphBounds(
          part.glyphIndex,
          options,
          _visited
        );
        if (!subBounds) continue;

        // Transform the four corners
        const transformPoint = (x, y) => {
          const tx = x * part.m.a + y * part.m.c + part.m.tx;
          const ty = x * part.m.b + y * part.m.d + part.m.ty;
          return [tx, ty];
        };

        const corners = [
          [subBounds.minX, subBounds.minY],
          [subBounds.minX, subBounds.maxY],
          [subBounds.maxX, subBounds.minY],
          [subBounds.maxX, subBounds.maxY],
        ];
        for (const [x, y] of corners) {
          const [nx, ny] = transformPoint(
            x / scale,
            flipY ? -y / scale : y / scale
          );
          const fx = nx * scale + offsetX;
          const fy = (flipY ? -ny : ny) * scale + offsetY;
          minX = Math.min(minX, fx);
          minY = Math.min(minY, fy);
          maxX = Math.max(maxX, fx);
          maxY = Math.max(maxY, fy);
        }
      }

      return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }

    return null;
  }

  contourToSVGPath(points, scale = 1, flipY = true, offsetX = 0, offsetY = 0) {
    if (!points.length) return "";

    const pts = [...points];

    // Ensure first point is on-curve
    if (!pts[0].onCurve) {
      const last = pts[pts.length - 1];
      const firstOn = last.onCurve
        ? { ...last }
        : {
            x: (last.x + pts[0].x) / 2,
            y: (last.y + pts[0].y) / 2,
            onCurve: true,
          };
      pts.unshift(firstOn);
    }

    const coord = (pt) => {
      const x = pt.x * scale + offsetX;
      const y = flipY ? -pt.y * scale + offsetY : pt.y * scale + offsetY;
      return `${x} ${y}`;
    };
    let path = `M ${coord(pts[0])}`;

    let i = 1;
    while (i < pts.length) {
      const curr = pts[i % pts.length];

      if (curr.onCurve) {
        if (curr.cubic) {
          const c1x = curr.x1 * scale + offsetX;
          const c1y = flipY
            ? -curr.y1 * scale + offsetY
            : curr.y1 * scale + offsetY;
          const c2x = curr.x2 * scale + offsetX;
          const c2y = flipY
            ? -curr.y2 * scale + offsetY
            : curr.y2 * scale + offsetY;
          path += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${coord(curr)}`;
        } else {
          path += ` L ${coord(curr)}`;
        }
        i += 1;
        continue;
      }

      // Quadratic segment
      const control = curr;
      const next = pts[(i + 1) % pts.length];
      let end;

      if (next.onCurve) {
        end = next;
        i += 2;
      } else {
        end = {
          x: (control.x + next.x) / 2,
          y: (control.y + next.y) / 2,
          onCurve: true,
        };
        i += 1;
      }

      path += ` Q ${coord(control)} ${coord(end)}`;
    }

    return path + " Z";
  }

  // Read CFF INDEX structure (based on working static-font-parser.js)
  readIndex() {
    const count = this.readUint16();
    if (count === 0) {
      return [];
    }

    const offSize = this.readUint8();
    const offsets = [];

    for (let i = 0; i <= count; i++) {
      offsets.push(this.readOffset(offSize));
    }

    const dataStart = this.offset;
    const data = [];

    for (let i = 0; i < count; i++) {
      const start = offsets[i] - 1;
      const end = offsets[i + 1] - 1;
      const length = end - start;

      this.seek(dataStart + start);
      const bytes = [];
      for (let j = 0; j < length; j++) {
        bytes.push(this.readUint8());
      }
      data.push(bytes);
    }

    // Move to end of INDEX
    this.seek(dataStart + offsets[count] - 1);

    return data;
  }

  readOffset(offSize) {
    let offset = 0;
    for (let i = 0; i < offSize; i++) {
      offset = (offset << 8) | this.readUint8();
    }
    return offset;
  }

  parseTopDict(dictData, cffStart, stringIndex) {
    this.cffData = {
      charStringsOffset: null,
      privateDict: null,
      fdArray: null,
      fdSelect: null,
    };

    let i = 0;
    const operands = [];

    while (i < dictData.length) {
      const b = dictData[i];

      if (b <= 21) {
        // Operator
        let op = b;
        if (b === 12) {
          // Two-byte operator
          i++;
          op = (b << 8) | dictData[i];
        }

        this.processDictOperator(op, operands, cffStart, stringIndex);
        operands.length = 0;
      } else {
        // Operand
        const operand = this.readDictOperand(dictData, i);
        operands.push(operand.value);
        i = operand.nextIndex - 1;
      }
      i++;
    }
  }

  // Process DICT operator (from working static-font-parser.js)
  processDictOperator(op, operands, cffStart, stringIndex) {
    switch (op) {
      case 17: // CharStrings
        this.cffData.charStringsOffset = cffStart + operands[0];
        break;
      case 18: // Private
        if (operands.length >= 2) {
          this.cffData.privateDict = {
            size: operands[0],
            offset: cffStart + operands[1],
          };
        }
        break;
      // Add more operators as needed
    }
  }

  parsePrivateDict(offset, size) {
    this.seek(offset);
    const dictData = Array.from({ length: size }, () => this.readUint8());

    let i = 0;
    const operands = [];
    let localSubrOffset = null;

    while (i < dictData.length) {
      const b = dictData[i];
      if (b <= 21) {
        let op = b;
        if (b === 12) {
          op = (b << 8) | dictData[++i];
        }

        if (op === 19 && operands.length >= 1) {
          localSubrOffset = offset + operands[0];
        }

        operands.length = 0;
      } else {
        const operand = this.readDictOperand(dictData, i);
        operands.push(operand.value);
        i = operand.nextIndex - 1;
      }
      i++;
    }

    if (localSubrOffset) {
      this.seek(localSubrOffset);
      this.cffLocalSubrs = this.readIndex();
      const nSubrs = this.cffLocalSubrs.length;
      this.cffLocalBias = nSubrs < 1240 ? 107 : nSubrs < 33900 ? 1131 : 32768;
    } else {
      this.cffLocalSubrs = [];
      this.cffLocalBias = 0;
    }
  }

  readDictOperand(data, index) {
    const b0 = data[index];
    if (b0 >= 32 && b0 <= 246) return { value: b0 - 139, nextIndex: index + 1 };
    if (b0 >= 247 && b0 <= 250)
      return {
        value: (b0 - 247) * 256 + data[index + 1] + 108,
        nextIndex: index + 2,
      };
    if (b0 >= 251 && b0 <= 254)
      return {
        value: -(b0 - 251) * 256 - data[index + 1] - 108,
        nextIndex: index + 2,
      };
    if (b0 === 28)
      return {
        value: (data[index + 1] << 8) | data[index + 2],
        nextIndex: index + 3,
      };
    if (b0 === 29)
      return {
        value:
          (data[index + 1] << 24) |
          (data[index + 2] << 16) |
          (data[index + 3] << 8) |
          data[index + 4],
        nextIndex: index + 5,
      };
    return { value: 0, nextIndex: index + 1 };
  }

  // CFF glyph parsing (based on working static-font-parser.js)
  parseCFFGlyph(glyphId) {
    if (!this.cffCharStrings || glyphId >= this.cffCharStrings.length) {
      return null;
    }

    const charString = this.cffCharStrings[glyphId];
    if (!charString || charString.length === 0) {
      return null;
    }

    try {
      // Use Typr.js-style state-based interpretation
      const state = {
        stack: [],
        x: 0,
        y: 0,
        nStems: 0,
        haveWidth: false,
        width: 0,
        open: false,
        path: [],
      };

      this.drawCFF(charString, state);
      return this.cffPathToGlyph(state.path);
    } catch (error) {
      console.warn(`Error parsing CFF glyph ${glyphId}:`, error.message);
      return null;
    }
  }

  // Draw CFF CharString using iterative approach to prevent stack overflow
  drawCFF(charString, state) {
    // Use a call stack to handle subroutines iteratively
    const callStack = [
      {
        charString: charString,
        index: 0,
      },
    ];

    const { stack, path } = state;
    let { x, y, nStems, haveWidth, width, open } = state;

    const nominalWidthX = this.cffData?.privateDict?.nominalWidthX || 0;

    while (callStack.length > 0) {
      const current = callStack[callStack.length - 1];
      const charString = current.charString;
      let i = current.index;

      while (i < charString.length) {
        const b = charString[i];

        if (b >= 32) {
          // Operand
          const operand = this.readCharStringOperand(charString, i);
          stack.push(operand.value);
          i = operand.nextIndex - 1; // -1 because loop increments i
        } else {
          // Operator
          let op = b;
          if (b === 12) {
            // Two-byte operator
            i++;
            op = (b << 8) | charString[i];
          }

          // Process operator (following Typr.js logic)
          switch (op) {
            case 1: // hstem
            case 18: // hstemhm
              {
                const hasWidthArg = stack.length % 2 !== 0;
                if (hasWidthArg && !haveWidth) {
                  width = stack.shift() + nominalWidthX;
                }
                nStems += stack.length >> 1;
                stack.length = 0;
                haveWidth = true;
              }
              break;

            case 3: // vstem
            case 23: // vstemhm
              {
                const hasWidthArg = stack.length % 2 !== 0;
                if (hasWidthArg && !haveWidth) {
                  width = stack.shift() + nominalWidthX;
                }
                nStems += stack.length >> 1;
                stack.length = 0;
                haveWidth = true;
              }
              break;

            case 4: // vmoveto
              if (stack.length > 1 && !haveWidth) {
                width = stack.shift() + nominalWidthX;
                haveWidth = true;
              }
              if (open) {
                path.push({ type: "closepath" });
              }
              if (stack.length > 0) {
                y += stack.pop();
              }
              path.push({ type: "moveto", x, y });
              open = true;
              stack.length = 0;
              break;

            case 5: // rlineto
              while (stack.length > 0) {
                x += stack.shift();
                y += stack.shift();
                path.push({ type: "lineto", x, y });
              }
              break;

            case 6: // hlineto
            case 7: // vlineto
              {
                const isX = op === 6;
                let alternate = isX;
                while (stack.length > 0) {
                  const sval = stack.shift();
                  if (alternate) {
                    x += sval;
                  } else {
                    y += sval;
                  }
                  alternate = !alternate;
                  path.push({ type: "lineto", x, y });
                }
              }
              break;

            case 8: // rrcurveto
              while (stack.length >= 6) {
                const c1x = x + stack.shift();
                const c1y = y + stack.shift();
                const c2x = c1x + stack.shift();
                const c2y = c1y + stack.shift();
                x = c2x + stack.shift();
                y = c2y + stack.shift();
                path.push({
                  type: "curveto",
                  x1: c1x,
                  y1: c1y,
                  x2: c2x,
                  y2: c2y,
                  x3: x,
                  y3: y,
                });
              }
              break;

            case 10: // callsubr
            case 29: // callgsubr
              if (stack.length > 0) {
                const subrIndexRaw = Math.round(stack.pop());
                const subrs =
                  op === 10 ? this.cffLocalSubrs : this.cffGlobalSubrs;
                const bias =
                  op === 10
                    ? this.cffLocalBias || 107
                    : this.cffGlobalBias || 107;
                const adjustedIndex = subrIndexRaw + bias;
                if (
                  subrs &&
                  adjustedIndex >= 0 &&
                  adjustedIndex < subrs.length
                ) {
                  current.index = i + 1;
                  callStack.push({
                    charString: subrs[adjustedIndex],
                    index: 0,
                  });
                  i = charString.length; // jump out to process subroutine
                }
                // If out-of-range, just ignore the call
              }
              break;

            case 11: // return
              // Return from subroutine
              callStack.pop();
              if (callStack.length === 0) {
                // We're done
                state.x = x;
                state.y = y;
                state.nStems = nStems;
                state.haveWidth = haveWidth;
                state.width = width;
                state.open = open;
                return;
              }
              // Break out of inner loop to continue with parent
              i = charString.length;
              break;

            case 14: // endchar
              if (stack.length > 0 && !haveWidth) {
                width = stack.shift() + nominalWidthX;
                haveWidth = true;
              }
              if (open) {
                path.push({ type: "closepath" });
              }
              // endchar marks the end of the charstring
              state.x = x;
              state.y = y;
              state.nStems = nStems;
              state.haveWidth = haveWidth;
              state.width = width;
              state.open = open;
              return;

            case 21: // rmoveto
              if (stack.length > 2 && !haveWidth) {
                width = stack.shift() + nominalWidthX;
                haveWidth = true;
              }
              if (open) {
                path.push({ type: "closepath" });
              }
              if (stack.length >= 2) {
                x += stack.shift();
                y += stack.shift();
              }
              path.push({ type: "moveto", x, y });
              open = true;
              stack.length = 0;
              break;

            case 22: // hmoveto
              if (stack.length > 1 && !haveWidth) {
                width = stack.shift() + nominalWidthX;
                haveWidth = true;
              }
              if (open) {
                path.push({ type: "closepath" });
              }
              if (stack.length > 0) {
                x += stack.pop();
              }
              path.push({ type: "moveto", x, y });
              open = true;
              stack.length = 0;
              break;

            case 30: // vhcurveto
            case 31: // hvcurveto
              {
                const isX = op === 31;
                let alternate = isX;
                while (stack.length >= 4) {
                  let c1x, c1y, c2x, c2y;
                  if (alternate) {
                    c1x = x + stack.shift();
                    c1y = y;
                    c2x = c1x + stack.shift();
                    c2y = c1y + stack.shift();
                    y = c2y + stack.shift();
                    x = stack.length === 1 ? c2x + stack.shift() : c2x;
                  } else {
                    c1x = x;
                    c1y = y + stack.shift();
                    c2x = c1x + stack.shift();
                    c2y = c1y + stack.shift();
                    x = c2x + stack.shift();
                    y = stack.length === 1 ? c2y + stack.shift() : c2y;
                  }
                  path.push({
                    type: "curveto",
                    x1: c1x,
                    y1: c1y,
                    x2: c2x,
                    y2: c2y,
                    x3: x,
                    y3: y,
                  });
                  alternate = !alternate;
                }
              }
              break;

            case 19: // hintmask
            case 20: // cntrmask
              {
                // Handle potential width arg first
                if (stack.length % 2 !== 0 && !haveWidth) {
                  width = stack.shift() + nominalWidthX;
                  haveWidth = true;
                }
                nStems += stack.length >> 1;
                stack.length = 0;
                // Consume (nStems+7)/8 mask bytes following the operator
                const maskBytes = Math.ceil(nStems / 8);
                i += maskBytes;
              }
              break;

            case 34: // flex (12 34)
              {
                // flex: dx1 dy1 dx2 dy2 dx3 dy3 dx4 dy4 dx5 dy5 dx6 dy6 flexDepth
                if (stack.length >= 13) {
                  const flexDepth = stack.pop();
                  const dy6 = stack.pop();
                  const dx6 = stack.pop();
                  // Consume the rest of the operands (we ignore drawing for now)
                  stack.length = 0;
                  x += dx6;
                  y += dy6;
                  path.push({ type: "lineto", x, y });
                } else {
                  stack.length = 0;
                }
              }
              break;
            case 35: // hflex (12 35) – horizontal flex, 7 numbers
              {
                if (stack.length >= 7) {
                  const dx6 = stack.pop(); // last horizontal move
                  // ignore rest
                  stack.length = 0;
                  x += dx6;
                  // y unchanged
                  path.push({ type: "lineto", x, y });
                } else {
                  stack.length = 0;
                }
              }
              break;
            case 36: // hflex1 (12 36) – 9 numbers
              {
                if (stack.length >= 9) {
                  const dy6 = stack.pop();
                  const dx6 = stack.pop();
                  stack.length = 0;
                  x += dx6;
                  y += dy6;
                  path.push({ type: "lineto", x, y });
                } else {
                  stack.length = 0;
                }
              }
              break;
            case 37: // flex1 (12 37) – 11 numbers (dx/dy pairs) last pair determined by remaining distance
              {
                if (stack.length >= 11) {
                  const dyFinal = stack.pop();
                  const dxFinal = stack.pop();
                  stack.length = 0;
                  x += dxFinal;
                  y += dyFinal;
                  path.push({ type: "lineto", x, y });
                } else {
                  stack.length = 0;
                }
              }
              break;

            default:
              // Ignore unsupported operators
              stack.length = 0;
              break;
          }
        }
        i++;
      }
    }

    // Update state
    state.x = x;
    state.y = y;
    state.nStems = nStems;
    state.haveWidth = haveWidth;
    state.width = width;
    state.open = open;
  }

  readCharStringOperand(data, index) {
    const b0 = data[index];
    if (b0 >= 32 && b0 <= 246) return { value: b0 - 139, nextIndex: index + 1 };
    if (b0 >= 247 && b0 <= 250)
      return {
        value: (b0 - 247) * 256 + data[index + 1] + 108,
        nextIndex: index + 2,
      };
    if (b0 >= 251 && b0 <= 254)
      return {
        value: -(b0 - 251) * 256 - data[index + 1] - 108,
        nextIndex: index + 2,
      };
    if (b0 === 28)
      return {
        value: (data[index + 1] << 8) | data[index + 2],
        nextIndex: index + 3,
      };
    if (b0 === 255)
      return {
        value:
          ((data[index + 1] << 24) |
            (data[index + 2] << 16) |
            (data[index + 3] << 8) |
            data[index + 4]) /
          65536,
        nextIndex: index + 5,
      };
    return { value: 0, nextIndex: index + 1 };
  }

  cffPathToGlyph(pathCommands) {
    if (!pathCommands.length) return null;

    const contours = [];
    let currentContour = [];
    let xMin = Infinity,
      yMin = Infinity,
      xMax = -Infinity,
      yMax = -Infinity;

    for (const cmd of pathCommands) {
      if (cmd.type === "moveto") {
        if (currentContour.length > 0) {
          contours.push(currentContour);
          currentContour = [];
        }
        currentContour.push({ x: cmd.x, y: cmd.y, onCurve: true });
        xMin = Math.min(xMin, cmd.x);
        yMin = Math.min(yMin, cmd.y);
        xMax = Math.max(xMax, cmd.x);
        yMax = Math.max(yMax, cmd.y);
      } else if (cmd.type === "lineto") {
        currentContour.push({ x: cmd.x, y: cmd.y, onCurve: true });
        xMin = Math.min(xMin, cmd.x);
        yMin = Math.min(yMin, cmd.y);
        xMax = Math.max(xMax, cmd.x);
        yMax = Math.max(yMax, cmd.y);
      } else if (cmd.type === "curveto") {
        currentContour.push({
          x: cmd.x3,
          y: cmd.y3,
          onCurve: true,
          cubic: true,
          x1: cmd.x1,
          y1: cmd.y1,
          x2: cmd.x2,
          y2: cmd.y2,
        });
        xMin = Math.min(xMin, cmd.x1, cmd.x2, cmd.x3);
        yMin = Math.min(yMin, cmd.y1, cmd.y2, cmd.y3);
        xMax = Math.max(xMax, cmd.x1, cmd.x2, cmd.x3);
        yMax = Math.max(yMax, cmd.y1, cmd.y2, cmd.y3);
      } else if (cmd.type === "closepath") {
        if (currentContour.length > 0) {
          contours.push(currentContour);
          currentContour = [];
        }
      }
    }

    // Always push the last contour if it has points
    if (currentContour.length > 0) {
      contours.push(currentContour);
    }

    return {
      contours,
      instructions: [],
      xMin: isFinite(xMin) ? xMin : 0,
      yMin: isFinite(yMin) ? yMin : 0,
      xMax: isFinite(xMax) ? xMax : 0,
      yMax: isFinite(yMax) ? yMax : 0,
    };
  }

  // TrueType glyph parsing (simplified)
  parseTrueTypeGlyph(glyphId, recursionDepth = 0) {
    if (!this.glyphOffsets || glyphId >= this.glyphOffsets.length - 1) {
      return null;
    }

    // Check cache first
    const cacheKey = `${glyphId}_${recursionDepth}`;
    if (this.glyphParseCache.has(cacheKey)) {
      return this.glyphParseCache.get(cacheKey);
    }

    // Prevent excessive recursion depth
    if (recursionDepth > 10) {
      const emptyGlyph = {
        contours: [],
        instructions: [],
        xMin: 0,
        yMin: 0,
        xMax: 0,
        yMax: 0,
      };
      this.glyphParseCache.set(cacheKey, emptyGlyph);
      return emptyGlyph;
    }

    const offset = this.glyphOffsets[glyphId];
    const nextOffset = this.glyphOffsets[glyphId + 1];
    if (offset === nextOffset) {
      const emptyGlyph = {
        contours: [],
        instructions: [],
        xMin: 0,
        yMin: 0,
        xMax: 0,
        yMax: 0,
      };
      this.glyphParseCache.set(cacheKey, emptyGlyph);
      return emptyGlyph;
    }

    this.seek(this.tables.glyf.offset + offset);
    const numberOfContours = this.readInt16();
    const xMin = this.readInt16();
    const yMin = this.readInt16();
    const xMax = this.readInt16();
    const yMax = this.readInt16();

    let result;
    if (numberOfContours >= 0) {
      result = this.parseSimpleGlyph(numberOfContours, xMin, yMin, xMax, yMax);
    } else {
      result = this.parseCompositeGlyph(
        numberOfContours,
        xMin,
        yMin,
        xMax,
        yMax,
        recursionDepth
      );
    }

    // Cache the result
    this.glyphParseCache.set(cacheKey, result);
    return result;
  }

  parseSimpleGlyph(numberOfContours, xMin, yMin, xMax, yMax) {
    const contourEndPts = Array.from({ length: numberOfContours }, () =>
      this.readUint16()
    );
    const numPoints =
      contourEndPts.length > 0
        ? contourEndPts[contourEndPts.length - 1] + 1
        : 0;

    const instructionLength = this.readUint16();
    this.offset += instructionLength; // Skip instructions

    if (numPoints === 0)
      return { contours: [], instructions: [], xMin, yMin, xMax, yMax };

    // Read flags
    const flags = [];
    let i = 0;
    while (i < numPoints) {
      const flag = this.readUint8();
      flags.push(flag);
      i++;
      if (flag & 0x08) {
        const repeatCount = this.readUint8();
        for (let j = 0; j < repeatCount; j++) {
          flags.push(flag);
          i++;
        }
      }
    }

    // Read coordinates
    const xCoords = [];
    const yCoords = [];
    let x = 0,
      y = 0;

    for (let i = 0; i < numPoints; i++) {
      const flag = flags[i];
      if (flag & 0x02) {
        const dx = this.readUint8();
        x += flag & 0x10 ? dx : -dx;
      } else if (!(flag & 0x10)) {
        x += this.readInt16();
      }
      xCoords.push(x);
    }

    for (let i = 0; i < numPoints; i++) {
      const flag = flags[i];
      if (flag & 0x04) {
        const dy = this.readUint8();
        y += flag & 0x20 ? dy : -dy;
      } else if (!(flag & 0x20)) {
        y += this.readInt16();
      }
      yCoords.push(y);
    }

    // Build contours
    const contours = [];
    let pointIndex = 0;
    for (
      let contourIndex = 0;
      contourIndex < numberOfContours;
      contourIndex++
    ) {
      const endPt = contourEndPts[contourIndex];
      const points = [];
      while (pointIndex <= endPt) {
        points.push({
          x: xCoords[pointIndex],
          y: yCoords[pointIndex],
          onCurve: !!(flags[pointIndex] & 0x01),
        });
        pointIndex++;
      }
      contours.push(points);
    }

    return { contours, instructions: [], xMin, yMin, xMax, yMax };
  }

  parseCompositeGlyph(
    numberOfContours,
    xMin,
    yMin,
    xMax,
    yMax,
    recursionDepth
  ) {
    // Build list of components (parts) without expanding them
    const parts = [];
    let flags;

    do {
      flags = this.readUint16();
      const glyphIndex = this.readUint16();

      let arg1, arg2;
      if (flags & 0x0001) {
        arg1 = this.readInt16();
        arg2 = this.readInt16();
      } else {
        arg1 = this.readInt8();
        arg2 = this.readInt8();
      }

      let dx = 0,
        dy = 0;
      if (flags & 0x0002) {
        // ARGS_ARE_XY_VALUES
        dx = arg1;
        dy = arg2;
      } else {
        // Point matching – ignore for now
        dx = 0;
        dy = 0;
      }

      let m00 = 1,
        m01 = 0,
        m10 = 0,
        m11 = 1;
      if (flags & 0x0008) {
        // WE_HAVE_A_SCALE
        m00 = m11 = this.readF2Dot14();
      } else if (flags & 0x0040) {
        // WE_HAVE_AN_X_AND_Y_SCALE
        m00 = this.readF2Dot14();
        m11 = this.readF2Dot14();
      } else if (flags & 0x0080) {
        // WE_HAVE_A_TWO_BY_TWO
        m00 = this.readF2Dot14();
        m01 = this.readF2Dot14();
        m10 = this.readF2Dot14();
        m11 = this.readF2Dot14();
      }

      parts.push({
        glyphIndex,
        m: { a: m00, b: m10, c: m01, d: m11, tx: dx, ty: dy },
      });
    } while (flags & 0x0020);

    if (flags & 0x0100) {
      const instrLength = this.readUint16();
      this.offset += instrLength;
    }

    return {
      contours: [], // composite glyphs do not store contours directly
      parts,
      instructions: [],
      xMin,
      yMin,
      xMax,
      yMax,
    };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = FontParser;
}
