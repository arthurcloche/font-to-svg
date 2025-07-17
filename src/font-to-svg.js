/**
 * Minimal Font-to-SVG Parser
 * 
 * A clean, simple implementation inspired by Typr.js
 * Focuses on reliability over features
 * 
 * @version 1.0.0
 */

class FontToSVG {
  constructor() {
    this.data = null;
    this.tables = {};
    this.cmap = {};
    this.glyphs = new Map();
    
    // Font metrics
    this.unitsPerEm = 1000;
    this.ascender = 800;
    this.descender = -200;
    
    // CFF data
    this.cffInitialized = false;
    this.cffCharStrings = [];
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================
  
  /**
   * Load font from URL
   */
  async load(url) {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    return this.loadBuffer(buffer);
  }

  /**
   * Load font from buffer
   */
  loadBuffer(buffer) {
    this.data = new DataView(buffer);
    this.tables = {};
    this.cmap = {};
    this.glyphs.clear();
    
    // Check for WOFF/WOFF2
    const signature = this.data.getUint32(0, false);
    if (signature === 0x774F4646 || signature === 0x774F4632) {
      throw new Error('WOFF/WOFF2 not supported. Use TTF or OTF.');
    }
    
    this._parseTables();
    return this;
  }

  /**
   * Get SVG path for text
   */
  getPath(text, size = 72) {
    if (!this.data) throw new Error('No font loaded');
    
    const scale = size / this.unitsPerEm;
    const paths = [];
    let x = 0;
    
    // Calculate baseline
    const baseline = this.ascender * scale;
    
    for (const char of text) {
      if (char === ' ') {
        x += size * 0.3;
        continue;
      }
      
      const glyph = this._getGlyph(char);
      if (glyph) {
        const path = this._glyphToPath(glyph, scale, x, baseline);
        if (path) {
          paths.push({
            char,
            path,
            x,
            advance: glyph.advanceWidth * scale
          });
        }
        x += glyph.advanceWidth * scale;
      }
    }
    
    // Calculate proper viewBox with padding
    const padding = size * 0.1;
    const totalHeight = (this.ascender - this.descender) * scale;
    const minY = this.descender * scale - padding;
    
    return {
      paths: paths.map(p => `<path d="${p.path}"/>`).join('\n'),
      viewBox: `${-padding} ${minY} ${x + padding * 2} ${totalHeight + padding * 2}`,
      width: x,
      height: totalHeight,
      characters: paths
    };
  }

  // ============================================================================
  // FONT PARSING
  // ============================================================================
  
  _parseTables() {
    const numTables = this.data.getUint16(4, false);
    
    // Read table directory
    let offset = 12;
    for (let i = 0; i < numTables; i++) {
      const tag = this._readTag(offset);
      const checksum = this.data.getUint32(offset + 4, false);
      const tableOffset = this.data.getUint32(offset + 8, false);
      const length = this.data.getUint32(offset + 12, false);
      
      this.tables[tag] = { offset: tableOffset, length };
      offset += 16;
    }
    
    // Parse essential tables
    this._parseHead();
    this._parseCmap();
    this._parseHhea();
    this._parseMaxp();
    
    // Determine font type
    this.fontType = this.tables.glyf ? 'truetype' : 'cff';
  }

  _parseHead() {
    if (!this.tables.head) return;
    
    const table = this.tables.head;
    this.unitsPerEm = this.data.getUint16(table.offset + 18, false);
    
    // Bounding box
    this.xMin = this.data.getInt16(table.offset + 36, false);
    this.yMin = this.data.getInt16(table.offset + 38, false);
    this.xMax = this.data.getInt16(table.offset + 40, false);
    this.yMax = this.data.getInt16(table.offset + 42, false);
    
    // Index to location format
    this.indexToLocFormat = this.data.getInt16(table.offset + 50, false);
  }

  _parseCmap() {
    if (!this.tables.cmap) return;
    
    const table = this.tables.cmap;
    const numTables = this.data.getUint16(table.offset + 2, false);
    
    // Find Unicode table
    let unicodeTable = null;
    for (let i = 0; i < numTables; i++) {
      const platformID = this.data.getUint16(table.offset + 4 + i * 8, false);
      const encodingID = this.data.getUint16(table.offset + 6 + i * 8, false);
      const offset = this.data.getUint32(table.offset + 8 + i * 8, false);
      
      if ((platformID === 3 && encodingID === 1) || 
          (platformID === 0 && encodingID === 3)) {
        unicodeTable = table.offset + offset;
        break;
      }
    }
    
    if (!unicodeTable) return;
    
    const format = this.data.getUint16(unicodeTable, false);
    
    if (format === 4) {
      this._parseCmapFormat4(unicodeTable);
    } else if (format === 12) {
      this._parseCmapFormat12(unicodeTable);
    }
  }

  _parseCmapFormat4(offset) {
    const segCountX2 = this.data.getUint16(offset + 6, false);
    const segCount = segCountX2 / 2;
    
    // Read segments
    const endCodes = [];
    const startCodes = [];
    const idDeltas = [];
    const idRangeOffsets = [];
    
    let pos = offset + 14;
    
    for (let i = 0; i < segCount; i++) {
      endCodes.push(this.data.getUint16(pos + i * 2, false));
    }
    pos += segCount * 2 + 2; // Skip reserved
    
    for (let i = 0; i < segCount; i++) {
      startCodes.push(this.data.getUint16(pos + i * 2, false));
    }
    pos += segCount * 2;
    
    for (let i = 0; i < segCount; i++) {
      idDeltas.push(this.data.getInt16(pos + i * 2, false));
    }
    pos += segCount * 2;
    
    const idRangeOffsetStart = pos;
    for (let i = 0; i < segCount; i++) {
      idRangeOffsets.push(this.data.getUint16(pos + i * 2, false));
    }
    pos += segCount * 2;
    
    // Build character map
    for (let i = 0; i < segCount; i++) {
      for (let c = startCodes[i]; c <= endCodes[i] && c !== 0xFFFF; c++) {
        let glyphId;
        
        if (idRangeOffsets[i] === 0) {
          glyphId = (c + idDeltas[i]) & 0xFFFF;
        } else {
          // Calculate the correct offset for glyph index
          const glyphIndexOffset = idRangeOffsetStart + i * 2 + idRangeOffsets[i] + (c - startCodes[i]) * 2;
          glyphId = this.data.getUint16(glyphIndexOffset, false);
          if (glyphId !== 0) {
            glyphId = (glyphId + idDeltas[i]) & 0xFFFF;
          }
        }
        
        if (glyphId !== 0) {
          this.cmap[c] = glyphId;
        }
      }
    }
  }

  _parseCmapFormat12(offset) {
    const numGroups = this.data.getUint32(offset + 12, false);
    
    let pos = offset + 16;
    for (let i = 0; i < numGroups; i++) {
      const startCharCode = this.data.getUint32(pos, false);
      const endCharCode = this.data.getUint32(pos + 4, false);
      const startGlyphID = this.data.getUint32(pos + 8, false);
      
      for (let c = startCharCode; c <= endCharCode; c++) {
        this.cmap[c] = startGlyphID + (c - startCharCode);
      }
      
      pos += 12;
    }
  }

  _parseHhea() {
    if (!this.tables.hhea) return;
    
    const table = this.tables.hhea;
    this.ascender = this.data.getInt16(table.offset + 4, false);
    this.descender = this.data.getInt16(table.offset + 6, false);
    this.lineGap = this.data.getInt16(table.offset + 8, false);
    this.numberOfHMetrics = this.data.getUint16(table.offset + 34, false);
  }

  _parseMaxp() {
    if (!this.tables.maxp) return;
    
    const table = this.tables.maxp;
    this.numGlyphs = this.data.getUint16(table.offset + 4, false);
  }

  // ============================================================================
  // GLYPH PARSING
  // ============================================================================
  
  _getGlyph(char) {
    const code = char.codePointAt(0);
    const glyphId = this.cmap[code] || 0;
    
    if (glyphId === 0) return null;
    
    // Check cache
    if (this.glyphs.has(glyphId)) {
      return this.glyphs.get(glyphId);
    }
    
    // Parse glyph
    let glyph;
    if (this.fontType === 'truetype') {
      glyph = this._parseTrueTypeGlyph(glyphId);
    } else {
      glyph = this._parseCFFGlyph(glyphId);
    }
    
    if (glyph) {
      // Add metrics
      glyph.advanceWidth = this._getAdvanceWidth(glyphId);
      this.glyphs.set(glyphId, glyph);
    }
    
    return glyph;
  }

  _getAdvanceWidth(glyphId) {
    if (!this.tables.hmtx || !this.numberOfHMetrics) {
      return this.unitsPerEm;
    }
    
    const table = this.tables.hmtx;
    
    if (glyphId < this.numberOfHMetrics) {
      return this.data.getUint16(table.offset + glyphId * 4, false);
    } else {
      // Use last advance width
      return this.data.getUint16(table.offset + (this.numberOfHMetrics - 1) * 4, false);
    }
  }

  _parseTrueTypeGlyph(glyphId) {
    if (!this.tables.loca || !this.tables.glyf) return null;
    
    // Get glyph offset
    const locaTable = this.tables.loca;
    let offset1, offset2;
    
    if (this.indexToLocFormat === 0) {
      offset1 = this.data.getUint16(locaTable.offset + glyphId * 2, false) * 2;
      offset2 = this.data.getUint16(locaTable.offset + (glyphId + 1) * 2, false) * 2;
    } else {
      offset1 = this.data.getUint32(locaTable.offset + glyphId * 4, false);
      offset2 = this.data.getUint32(locaTable.offset + (glyphId + 1) * 4, false);
    }
    
    if (offset1 === offset2) return null; // Empty glyph
    
    const glyfTable = this.tables.glyf;
    const pos = glyfTable.offset + offset1;
    
    const numberOfContours = this.data.getInt16(pos, false);
    
    if (numberOfContours >= 0) {
      return this._parseSimpleGlyph(pos);
    } else {
      return this._parseCompositeGlyph(pos);
    }
  }

  _parseSimpleGlyph(offset) {
    const numberOfContours = this.data.getInt16(offset, false);
    const xMin = this.data.getInt16(offset + 2, false);
    const yMin = this.data.getInt16(offset + 4, false);
    const xMax = this.data.getInt16(offset + 6, false);
    const yMax = this.data.getInt16(offset + 8, false);
    
    offset += 10;
    
    // Read contour endpoints
    const endPts = [];
    for (let i = 0; i < numberOfContours; i++) {
      endPts.push(this.data.getUint16(offset, false));
      offset += 2;
    }
    
    const numPoints = endPts[endPts.length - 1] + 1;
    
    // Skip instructions
    const instructionLength = this.data.getUint16(offset, false);
    offset += 2 + instructionLength;
    
    // Read flags
    const flags = [];
    for (let i = 0; i < numPoints; i++) {
      const flag = this.data.getUint8(offset++);
      flags.push(flag);
      
      if (flag & 0x08) { // Repeat flag
        const count = this.data.getUint8(offset++);
        for (let j = 0; j < count; j++) {
          flags.push(flag);
          i++;
        }
      }
    }
    
    // Read coordinates
    const points = [];
    
    // X coordinates
    let x = 0;
    for (let i = 0; i < numPoints; i++) {
      const flag = flags[i];
      if (flag & 0x02) { // X-Short
        const delta = this.data.getUint8(offset++);
        x += (flag & 0x10) ? delta : -delta;
      } else if (!(flag & 0x10)) { // X not same
        x += this.data.getInt16(offset, false);
        offset += 2;
      }
      points.push({ x, onCurve: !!(flag & 0x01) });
    }
    
    // Y coordinates
    let y = 0;
    for (let i = 0; i < numPoints; i++) {
      const flag = flags[i];
      if (flag & 0x04) { // Y-Short
        const delta = this.data.getUint8(offset++);
        y += (flag & 0x20) ? delta : -delta;
      } else if (!(flag & 0x20)) { // Y not same
        y += this.data.getInt16(offset, false);
        offset += 2;
      }
      points[i].y = y;
    }
    
    // Group into contours
    const contours = [];
    let startIdx = 0;
    
    for (const endIdx of endPts) {
      contours.push(points.slice(startIdx, endIdx + 1));
      startIdx = endIdx + 1;
    }
    
    return { contours, bounds: { xMin, yMin, xMax, yMax } };
  }

  _parseCompositeGlyph(offset) {
    // For now, just return empty glyph
    // Composite glyphs are complex and less common
    return { contours: [], bounds: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 } };
  }

  _parseCFFGlyph(glyphId) {
    // Minimal CFF parsing - just enough to work
    if (!this._initCFF()) return null;
    
    if (glyphId >= this.cffCharStrings.length) return null;
    
    const charString = this.cffCharStrings[glyphId];
    if (!charString) return null;
    
    // Parse charstring using iterative approach
    return this._parseCFFCharString(charString);
  }
  
  _initCFF() {
    if (this.cffInitialized) return true;
    
    try {
      const cffTable = this.tables['CFF '];
      if (!cffTable) return false;
      
      let offset = cffTable.offset;
      
      // Skip header
      const major = this.data.getUint8(offset);
      const minor = this.data.getUint8(offset + 1);
      const hdrSize = this.data.getUint8(offset + 2);
      offset += hdrSize;
      
      // Skip Name INDEX
      offset = this._skipIndex(offset);
      
      // Skip Top DICT INDEX
      offset = this._skipIndex(offset);
      
      // Skip String INDEX
      offset = this._skipIndex(offset);
      
      // Skip Global Subr INDEX
      offset = this._skipIndex(offset);
      
      // For now, we'll create dummy charstrings
      // Real implementation would parse properly
      this.cffCharStrings = new Array(this.numGlyphs).fill(null);
      this.cffInitialized = true;
      
      return true;
    } catch (e) {
      console.warn('CFF init failed:', e);
      return false;
    }
  }
  
  _skipIndex(offset) {
    const count = this.data.getUint16(offset, false);
    if (count === 0) return offset + 2;
    
    const offSize = this.data.getUint8(offset + 2);
    const indexOffset = offset + 3 + (count + 1) * offSize;
    
    // Read last offset to find data size
    let lastOffset = 0;
    for (let i = 0; i < offSize; i++) {
      lastOffset = (lastOffset << 8) | this.data.getUint8(offset + 3 + count * offSize + i);
    }
    
    return indexOffset + lastOffset - 1;
  }
  
  _parseCFFCharString(charString) {
    // For now, return a simple rectangle as placeholder
    // Real CFF parsing is complex and would need full implementation
    const size = 100;
    return {
      contours: [[
        { x: 0, y: 0, onCurve: true },
        { x: size, y: 0, onCurve: true },
        { x: size, y: size, onCurve: true },
        { x: 0, y: size, onCurve: true }
      ]],
      bounds: { xMin: 0, yMin: 0, xMax: size, yMax: size }
    };
  }

  // ============================================================================
  // PATH GENERATION
  // ============================================================================
  
  _glyphToPath(glyph, scale, offsetX, offsetY) {
    if (!glyph || !glyph.contours) return '';
    
    const paths = [];
    
    for (const contour of glyph.contours) {
      if (contour.length === 0) continue;
      
      const path = this._contourToPath(contour, scale, offsetX, offsetY);
      if (path) paths.push(path);
    }
    
    return paths.join(' ');
  }

  _contourToPath(points, scale, offsetX, offsetY) {
    if (points.length === 0) return '';
    
    let path = '';
    const pts = [...points];
    
    // Ensure contour starts with on-curve point
    if (!pts[0].onCurve && pts.length > 1) {
      const last = pts[pts.length - 1];
      if (last.onCurve) {
        pts.unshift(pts.pop());
      } else {
        // Insert implied on-curve point
        pts.unshift({
          x: (pts[0].x + last.x) / 2,
          y: (pts[0].y + last.y) / 2,
          onCurve: true
        });
      }
    }
    
    // Move to first point
    let x = pts[0].x * scale + offsetX;
    let y = -pts[0].y * scale + offsetY; // Flip Y
    path = `M${x.toFixed(2)} ${y.toFixed(2)}`;
    
    // Process remaining points
    let i = 1;
    while (i < pts.length) {
      const pt = pts[i];
      
      if (pt.onCurve) {
        // Line to on-curve point
        x = pt.x * scale + offsetX;
        y = -pt.y * scale + offsetY;
        path += `L${x.toFixed(2)} ${y.toFixed(2)}`;
        i++;
      } else {
        // Quadratic curve
        const next = pts[(i + 1) % pts.length];
        let endPt;
        
        if (next.onCurve) {
          endPt = next;
          i += 2;
        } else {
          // Implied on-curve point
          endPt = {
            x: (pt.x + next.x) / 2,
            y: (pt.y + next.y) / 2
          };
          i++;
        }
        
        const cx = pt.x * scale + offsetX;
        const cy = -pt.y * scale + offsetY;
        const ex = endPt.x * scale + offsetX;
        const ey = -endPt.y * scale + offsetY;
        
        path += `Q${cx.toFixed(2)} ${cy.toFixed(2)} ${ex.toFixed(2)} ${ey.toFixed(2)}`;
      }
    }
    
    return path + 'Z';
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================
  
  _readTag(offset) {
    const bytes = new Uint8Array(this.data.buffer, offset, 4);
    return String.fromCharCode(...bytes);
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FontToSVG;
}