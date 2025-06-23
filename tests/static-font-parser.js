/**
 * Font Parser - Parse OpenType/TrueType fonts and extract SVG paths
 * No external dependencies - pure JavaScript implementation
 */

class FontParser {
  constructor(fontBuffer) {
    this.buffer = fontBuffer;
    this.dataView = new DataView(fontBuffer);
    this.offset = 0;
    this.tables = {};
    this.glyphCache = new Map();

    this.parseFont();
  }

  // Binary reading utilities
  readUint8() {
    return this.dataView.getUint8(this.offset++);
  }

  readInt8() {
    return this.dataView.getInt8(this.offset++);
  }

  readUint16() {
    const value = this.dataView.getUint16(this.offset, false); // Big endian
    this.offset += 2;
    return value;
  }

  readUint32() {
    const value = this.dataView.getUint32(this.offset, false); // Big endian
    this.offset += 4;
    return value;
  }

  readInt16() {
    const value = this.dataView.getInt16(this.offset, false); // Big endian
    this.offset += 2;
    return value;
  }

  readInt32() {
    const value = this.dataView.getInt32(this.offset, false); // Big endian
    this.offset += 4;
    return value;
  }

  readTag() {
    const tag = String.fromCharCode(
      this.readUint8(),
      this.readUint8(),
      this.readUint8(),
      this.readUint8()
    );
    return tag;
  }

  readFixed() {
    return this.readInt32() / 65536;
  }

  readF2Dot14() {
    return this.readInt16() / 16384;
  }

  seek(offset) {
    this.offset = offset;
  }

  // Parse the main font structure
  parseFont() {
    this.offset = 0;

    // Read table directory
    const sfntVersion = this.readUint32();
    const numTables = this.readUint16();
    const searchRange = this.readUint16();
    const entrySelector = this.readUint16();
    const rangeShift = this.readUint16();

    console.log(
      `Font version: 0x${sfntVersion.toString(16)}, Tables: ${numTables}`
    );

    // Read table records
    for (let i = 0; i < numTables; i++) {
      const tag = this.readTag();
      const checksum = this.readUint32();
      const offset = this.readUint32();
      const length = this.readUint32();

      this.tables[tag] = {
        tag,
        checksum,
        offset,
        length,
      };
    }

    console.log("Available tables:", Object.keys(this.tables));

    // Parse essential tables
    this.parseHeadTable();
    this.parseCmapTable();

    // Check if this is a TrueType or CFF font
    if (this.tables["glyf"] && this.tables["loca"]) {
      this.fontType = "truetype";
      this.parseLocaTable();
    } else if (this.tables["CFF "]) {
      this.fontType = "cff";
      console.log("CFF font detected - using basic outline parsing");
      this.parseCFFTable();
    } else {
      throw new Error("Unknown font type - no glyf/loca or CFF table found");
    }

    this.parseHmtxTable();
  }

  // Parse head table for font metadata
  parseHeadTable() {
    if (!this.tables["head"]) {
      throw new Error("head table not found");
    }

    this.seek(this.tables["head"].offset);

    const majorVersion = this.readUint16();
    const minorVersion = this.readUint16();
    const fontRevision = this.readFixed();
    const checksumAdjustment = this.readUint32();
    const magicNumber = this.readUint32();
    const flags = this.readUint16();
    this.unitsPerEm = this.readUint16();

    // Skip created/modified dates (16 bytes total)
    this.offset += 16;

    this.xMin = this.readInt16();
    this.yMin = this.readInt16();
    this.xMax = this.readInt16();
    this.yMax = this.readInt16();

    const macStyle = this.readUint16();
    const lowestRecPPEM = this.readUint16();
    const fontDirectionHint = this.readInt16();
    this.indexToLocFormat = this.readInt16(); // 0 = short, 1 = long
    const glyphDataFormat = this.readInt16();

    console.log(`Units per Em: ${this.unitsPerEm}`);
    console.log(
      `Bounds: (${this.xMin}, ${this.yMin}) to (${this.xMax}, ${this.yMax})`
    );
    console.log(
      `Loca format: ${this.indexToLocFormat === 0 ? "short" : "long"}`
    );
  }

  // Parse character map table
  parseCmapTable() {
    if (!this.tables["cmap"]) {
      throw new Error("cmap table not found");
    }

    this.seek(this.tables["cmap"].offset);

    const version = this.readUint16();
    const numTables = this.readUint16();

    // Find Unicode BMP subtable (platform 3, encoding 1) or Unicode full (platform 3, encoding 10)
    let subtableOffset = null;

    for (let i = 0; i < numTables; i++) {
      const platformID = this.readUint16();
      const encodingID = this.readUint16();
      const offset = this.readUint32();

      // Prefer Unicode BMP (platform 3, encoding 1) or Unicode (platform 0, encoding 3)
      if (
        (platformID === 3 && encodingID === 1) ||
        (platformID === 0 && encodingID === 3)
      ) {
        subtableOffset = this.tables["cmap"].offset + offset;
        break;
      }
    }

    if (!subtableOffset) {
      throw new Error("No suitable Unicode cmap subtable found");
    }

    this.parseCmapSubtable(subtableOffset);
  }

  parseCmapSubtable(offset) {
    this.seek(offset);

    const format = this.readUint16();
    console.log(`CMap format: ${format}`);

    this.charToGlyph = new Map();

    if (format === 4) {
      this.parseCmapFormat4(offset);
    } else if (format === 12) {
      this.parseCmapFormat12(offset);
    } else {
      throw new Error(`Unsupported cmap format: ${format}`);
    }
  }

  parseCmapFormat4(offset) {
    this.seek(offset);

    const format = this.readUint16();
    const length = this.readUint16();
    const language = this.readUint16();
    const segCountX2 = this.readUint16();
    const segCount = segCountX2 / 2;
    const searchRange = this.readUint16();
    const entrySelector = this.readUint16();
    const rangeShift = this.readUint16();

    // Read arrays
    const endCode = [];
    for (let i = 0; i < segCount; i++) {
      endCode.push(this.readUint16());
    }

    const reservedPad = this.readUint16();

    const startCode = [];
    for (let i = 0; i < segCount; i++) {
      startCode.push(this.readUint16());
    }

    const idDelta = [];
    for (let i = 0; i < segCount; i++) {
      idDelta.push(this.readInt16());
    }

    const idRangeOffsetStart = this.offset;
    const idRangeOffset = [];
    for (let i = 0; i < segCount; i++) {
      idRangeOffset.push(this.readUint16());
    }

    // Process segments
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

    console.log(`Loaded ${this.charToGlyph.size} character mappings`);
  }

  parseCmapFormat12(offset) {
    this.seek(offset);

    const format = this.readUint16();
    const reserved = this.readUint16();
    const length = this.readUint32();
    const language = this.readUint32();
    const numGroups = this.readUint32();

    for (let i = 0; i < numGroups; i++) {
      const startCharCode = this.readUint32();
      const endCharCode = this.readUint32();
      const startGlyphID = this.readUint32();

      for (let c = startCharCode; c <= endCharCode; c++) {
        const glyphIndex = startGlyphID + (c - startCharCode);
        this.charToGlyph.set(c, glyphIndex);
      }
    }

    console.log(
      `Loaded ${this.charToGlyph.size} character mappings (format 12)`
    );
  }

  // Parse glyph location table
  parseLocaTable() {
    if (!this.tables["loca"]) {
      throw new Error("loca table not found");
    }

    this.seek(this.tables["loca"].offset);
    this.glyphOffsets = [];

    // Get number of glyphs from maxp table
    if (!this.tables["maxp"]) {
      throw new Error("maxp table not found");
    }

    const maxpOffset = this.tables["maxp"].offset;
    this.seek(maxpOffset);
    const maxpVersion = this.readFixed();
    const numGlyphs = this.readUint16();

    // Return to loca table
    this.seek(this.tables["loca"].offset);

    if (this.indexToLocFormat === 0) {
      // Short format - offsets are divided by 2
      for (let i = 0; i <= numGlyphs; i++) {
        this.glyphOffsets.push(this.readUint16() * 2);
      }
    } else {
      // Long format
      for (let i = 0; i <= numGlyphs; i++) {
        this.glyphOffsets.push(this.readUint32());
      }
    }

    console.log(`Loaded ${numGlyphs} glyph offsets`);
  }

  // Parse horizontal metrics table
  parseHmtxTable() {
    if (!this.tables["hmtx"] || !this.tables["hhea"]) {
      console.warn(
        "hmtx or hhea table not found - metrics will be unavailable"
      );
      return;
    }

    // Get numberOfHMetrics from hhea table
    this.seek(this.tables["hhea"].offset);
    const hheaVersion = this.readFixed();
    const ascender = this.readInt16();
    const descender = this.readInt16();
    const lineGap = this.readInt16();
    const advanceWidthMax = this.readUint16();
    const minLeftSideBearing = this.readInt16();
    const minRightSideBearing = this.readInt16();
    const xMaxExtent = this.readInt16();
    const caretSlopeRise = this.readInt16();
    const caretSlopeRun = this.readInt16();
    const caretOffset = this.readInt16();
    // Skip 4 reserved values
    this.offset += 8;
    const metricDataFormat = this.readInt16();
    const numberOfHMetrics = this.readUint16();

    // Parse hmtx table
    this.seek(this.tables["hmtx"].offset);
    this.horizontalMetrics = [];

    for (let i = 0; i < numberOfHMetrics; i++) {
      const advanceWidth = this.readUint16();
      const leftSideBearing = this.readInt16();
      this.horizontalMetrics.push({ advanceWidth, leftSideBearing });
    }

    console.log(`Loaded ${numberOfHMetrics} horizontal metrics`);
  }

  // Get glyph ID for a character
  getGlyphId(character) {
    const codePoint =
      typeof character === "string" ? character.codePointAt(0) : character;
    return this.charToGlyph.get(codePoint) || 0; // Return 0 (.notdef) if not found
  }

  // Get glyph metrics
  getGlyphMetrics(glyphId) {
    if (!this.horizontalMetrics || glyphId >= this.horizontalMetrics.length) {
      return { advanceWidth: this.unitsPerEm, leftSideBearing: 0 };
    }
    return this.horizontalMetrics[glyphId];
  }

  // Parse a single glyph from glyf table
  parseGlyph(glyphId) {
    if (this.glyphCache.has(glyphId)) {
      return this.glyphCache.get(glyphId);
    }

    if (this.fontType === "cff") {
      // Use CFF glyph parsing
      const glyph = this.parseCFFGlyph(glyphId);
      if (glyph) {
        this.glyphCache.set(glyphId, glyph);
      }
      return glyph;
    }

    if (
      !this.tables["glyf"] ||
      !this.glyphOffsets ||
      glyphId >= this.glyphOffsets.length - 1
    ) {
      return null;
    }

    const offset = this.glyphOffsets[glyphId];
    const nextOffset = this.glyphOffsets[glyphId + 1];

    if (offset === nextOffset) {
      // Empty glyph
      const emptyGlyph = {
        contours: [],
        instructions: [],
        xMin: 0,
        yMin: 0,
        xMax: 0,
        yMax: 0,
      };
      this.glyphCache.set(glyphId, emptyGlyph);
      return emptyGlyph;
    }

    this.seek(this.tables["glyf"].offset + offset);

    const numberOfContours = this.readInt16();
    const xMin = this.readInt16();
    const yMin = this.readInt16();
    const xMax = this.readInt16();
    const yMax = this.readInt16();

    let glyph;

    if (numberOfContours >= 0) {
      // Simple glyph
      glyph = this.parseSimpleGlyph(numberOfContours, xMin, yMin, xMax, yMax);
    } else {
      // Composite glyph
      glyph = this.parseCompositeGlyph(
        numberOfContours,
        xMin,
        yMin,
        xMax,
        yMax
      );
    }

    this.glyphCache.set(glyphId, glyph);
    return glyph;
  }

  parseSimpleGlyph(numberOfContours, xMin, yMin, xMax, yMax) {
    // Read contour end points
    const contourEndPts = [];
    for (let i = 0; i < numberOfContours; i++) {
      contourEndPts.push(this.readUint16());
    }

    const numPoints =
      contourEndPts.length > 0
        ? contourEndPts[contourEndPts.length - 1] + 1
        : 0;

    // Read instruction length and instructions
    const instructionLength = this.readUint16();
    const instructions = [];
    for (let i = 0; i < instructionLength; i++) {
      instructions.push(this.readUint8());
    }

    if (numPoints === 0) {
      return { contours: [], instructions, xMin, yMin, xMax, yMax };
    }

    // Read flags
    const flags = [];
    let i = 0;
    while (i < numPoints) {
      const flag = this.readUint8();
      flags.push(flag);
      i++;

      // Repeat flag
      if (flag & 0x08) {
        const repeatCount = this.readUint8();
        for (let j = 0; j < repeatCount; j++) {
          flags.push(flag);
          i++;
        }
      }
    }

    // Read x coordinates
    const xCoords = [];
    let x = 0;
    for (let i = 0; i < numPoints; i++) {
      const flag = flags[i];
      if (flag & 0x02) {
        // X_SHORT_VECTOR
        const dx = this.readUint8();
        x += flag & 0x10 ? dx : -dx; // POSITIVE_X_SHORT_VECTOR
      } else if (!(flag & 0x10)) {
        // Not SAME_X
        x += this.readInt16();
      }
      xCoords.push(x);
    }

    // Read y coordinates
    const yCoords = [];
    let y = 0;
    for (let i = 0; i < numPoints; i++) {
      const flag = flags[i];
      if (flag & 0x04) {
        // Y_SHORT_VECTOR
        const dy = this.readUint8();
        y += flag & 0x20 ? dy : -dy; // POSITIVE_Y_SHORT_VECTOR
      } else if (!(flag & 0x20)) {
        // Not SAME_Y
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
          onCurve: !!(flags[pointIndex] & 0x01), // ON_CURVE_POINT
        });
        pointIndex++;
      }

      contours.push(points);
    }

    return { contours, instructions, xMin, yMin, xMax, yMax };
  }

  parseCompositeGlyph(numberOfContours, xMin, yMin, xMax, yMax) {
    const ARG_1_AND_2_ARE_WORDS = 0x0001;
    const ARGS_ARE_XY_VALUES = 0x0002;
    const WE_HAVE_A_SCALE = 0x0008;
    const MORE_COMPONENTS = 0x0020;
    const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
    const WE_HAVE_A_TWO_BY_TWO = 0x0080;
    const WE_HAVE_INSTRUCTIONS = 0x0100;

    const allContours = [];

    let flags;
    do {
      flags = this.readUint16();
      const glyphIndex = this.readUint16();

      // --- read arguments (either words or bytes) --- //
      let arg1, arg2;
      if (flags & ARG_1_AND_2_ARE_WORDS) {
        arg1 = this.readInt16();
        arg2 = this.readInt16();
      } else {
        arg1 = this.readInt8();
        arg2 = this.readInt8();
      }

      // Decide whether arguments are dx/dy or point numbers. We only care about dx/dy.
      const dx = flags & ARGS_ARE_XY_VALUES ? arg1 : 0;
      const dy = flags & ARGS_ARE_XY_VALUES ? arg2 : 0;

      // --- read transform matrix --- //
      let m00 = 1,
        m01 = 0,
        m10 = 0,
        m11 = 1;
      if (flags & WE_HAVE_A_SCALE) {
        m00 = m11 = this.readF2Dot14();
      } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
        m00 = this.readF2Dot14();
        m11 = this.readF2Dot14();
      } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
        m00 = this.readF2Dot14();
        m01 = this.readF2Dot14();
        m10 = this.readF2Dot14();
        m11 = this.readF2Dot14();
      }

      // --- fetch component glyph and transform its contours --- //
      const baseGlyph = this.parseGlyph(glyphIndex);
      if (baseGlyph && baseGlyph.contours && baseGlyph.contours.length) {
        for (const contour of baseGlyph.contours) {
          const transformed = contour.map((pt) => {
            const x = pt.x;
            const y = pt.y;
            const newPt = {
              ...pt,
              x: x * m00 + y * m01 + dx,
              y: x * m10 + y * m11 + dy,
            };
            if (pt.cubic) {
              // transform control points as well
              const x1 = pt.x1 * m00 + pt.y1 * m01 + dx;
              const y1 = pt.x1 * m10 + pt.y1 * m11 + dy;
              const x2 = pt.x2 * m00 + pt.y2 * m01 + dx;
              const y2 = pt.x2 * m10 + pt.y2 * m11 + dy;
              newPt.x1 = x1;
              newPt.y1 = y1;
              newPt.x2 = x2;
              newPt.y2 = y2;
            }
            return newPt;
          });
          allContours.push(transformed);
        }
      }
    } while (flags & MORE_COMPONENTS);

    // Skip instructions if present
    if (flags & WE_HAVE_INSTRUCTIONS) {
      const instrLength = this.readUint16();
      this.offset += instrLength;
    }

    return { contours: allContours, instructions: [], xMin, yMin, xMax, yMax };
  }

  // Convert glyph to SVG path
  glyphToSVGPath(character, options = {}) {
    const glyphId = this.getGlyphId(character);
    const glyph = this.parseGlyph(glyphId);

    if (!glyph || glyph.contours.length === 0) {
      return "";
    }

    const scale = options.scale || 1;
    const flipY = options.flipY !== false; // Default to true

    let pathData = "";

    for (const contour of glyph.contours) {
      if (contour.length === 0) continue;

      pathData += this.contourToSVGPath(contour, scale, flipY);
    }

    return pathData;
  }

  // Get actual bounds of a glyph (including control points)
  getGlyphBounds(character, options = {}) {
    const glyphId = this.getGlyphId(character);
    const glyph = this.parseGlyph(glyphId);

    if (!glyph || glyph.contours.length === 0) {
      return null;
    }

    const scale = options.scale || 1;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const contour of glyph.contours) {
      for (const point of contour) {
        minX = Math.min(minX, point.x * scale);
        minY = Math.min(minY, point.y * scale);
        maxX = Math.max(maxX, point.x * scale);
        maxY = Math.max(maxY, point.y * scale);

        if (point.cubic) {
          minX = Math.min(minX, point.x1 * scale, point.x2 * scale);
          minY = Math.min(minY, point.y1 * scale, point.y2 * scale);
          maxX = Math.max(maxX, point.x1 * scale, point.x2 * scale);
          maxY = Math.max(maxY, point.y1 * scale, point.y2 * scale);
        }
      }
    }

    // Apply Y-flip if needed
    if (options.flipY !== false) {
      const tempMinY = minY;
      minY = -maxY;
      maxY = -tempMinY;
    }

    return {
      minX: isFinite(minX) ? minX : 0,
      minY: isFinite(minY) ? minY : 0,
      maxX: isFinite(maxX) ? maxX : 0,
      maxY: isFinite(maxY) ? maxY : 0,
      width: isFinite(maxX) && isFinite(minX) ? maxX - minX : 0,
      height: isFinite(maxY) && isFinite(minY) ? maxY - minY : 0,
    };
  }

  // Generate complete SVG with proper viewBox
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
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-size="16">No glyph</text></svg>`;
    }

    const viewBoxX = bounds.minX - padding;
    const viewBoxY = bounds.minY - padding;
    const viewBoxWidth = bounds.width + padding * 2;
    const viewBoxHeight = bounds.height + padding * 2;

    return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" 
       viewBox="${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}" 
       width="${width}" height="${height}">
    <path d="${path}" 
          fill="black" 
          stroke="none"/>
  </svg>`;
  }

  contourToSVGPath(points, scale = 1, flipY = true) {
    if (!points.length) return "";

    const pts = [...points];

    // Ensure first point is on-curve (inject implied point if necessary)
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

    const coord = (pt) =>
      `${pt.x * scale} ${flipY ? -pt.y * scale : pt.y * scale}`;
    let path = `M ${coord(pts[0])}`;

    let i = 1;
    while (i < pts.length) {
      const curr = pts[i % pts.length];

      if (curr.onCurve) {
        if (curr.cubic) {
          // PostScript/CFF cubic segment – control points attached to end point
          const c1 = `${curr.x1 * scale} ${
            flipY ? -curr.y1 * scale : curr.y1 * scale
          }`;
          const c2 = `${curr.x2 * scale} ${
            flipY ? -curr.y2 * scale : curr.y2 * scale
          }`;
          path += ` C ${c1} ${c2} ${coord(curr)}`;
        } else {
          path += ` L ${coord(curr)}`;
        }
        i += 1;
        continue;
      }

      // Quadratic segment(s)
      const control = curr;
      const next = pts[(i + 1) % pts.length];
      let end;

      if (next.onCurve) {
        end = next;
        i += 2; // we consumed next as well
      } else {
        // implied on-curve midpoint
        end = {
          x: (control.x + next.x) / 2,
          y: (control.y + next.y) / 2,
          onCurve: true,
        };
        i += 1; // keep next for following iteration
      }

      path += ` Q ${coord(control)} ${coord(end)}`;
    }

    path += " Z";
    return path;
  }

  // Convert cubic Bezier to SVG path (for CFF curves)
  cubicToSVGPath(x1, y1, x2, y2, x3, y3, scale = 1, flipY = true) {
    const cx1 = x1 * scale;
    const cy1 = flipY ? -y1 * scale : y1 * scale;
    const cx2 = x2 * scale;
    const cy2 = flipY ? -y2 * scale : y2 * scale;
    const cx3 = x3 * scale;
    const cy3 = flipY ? -y3 * scale : y3 * scale;

    return `C ${cx1} ${cy1} ${cx2} ${cy2} ${cx3} ${cy3}`;
  }

  // Get font information
  getFontInfo() {
    return {
      unitsPerEm: this.unitsPerEm,
      bounds: {
        xMin: this.xMin,
        yMin: this.yMin,
        xMax: this.xMax,
        yMax: this.yMax,
      },
      numGlyphs: this.glyphOffsets
        ? this.glyphOffsets.length - 1
        : this.horizontalMetrics
        ? this.horizontalMetrics.length
        : 0,
      tables: Object.keys(this.tables),
    };
  }

  // Parse CFF table for PostScript outlines
  parseCFFTable() {
    if (!this.tables["CFF "]) {
      throw new Error("CFF table not found");
    }

    const cffStart = this.tables["CFF "].offset;
    this.seek(cffStart);

    // Read CFF header
    const major = this.readUint8();
    const minor = this.readUint8();
    const hdrSize = this.readUint8();
    const offSize = this.readUint8();

    console.log(
      `CFF version ${major}.${minor}, header size: ${hdrSize}, offset size: ${offSize}`
    );

    // Skip to end of header
    this.seek(cffStart + hdrSize);

    // Read Name INDEX
    const nameIndex = this.readIndex();

    // Read Top DICT INDEX
    const topDictIndex = this.readIndex();

    // Read String INDEX
    const stringIndex = this.readIndex();

    // Read Global Subr INDEX
    const globalSubrIndex = this.readIndex();
    this.cffGlobalSubrs = globalSubrIndex;

    // Calculate bias for global subroutines
    const nGlobalSubrs = this.cffGlobalSubrs.length;
    let globalBias;
    if (nGlobalSubrs < 1240) globalBias = 107;
    else if (nGlobalSubrs < 33900) globalBias = 1131;
    else globalBias = 32768;
    this.cffGlobalBias = globalBias;

    // Parse Top DICT
    if (topDictIndex.length > 0) {
      this.parseTopDict(topDictIndex[0], cffStart, stringIndex);
    }

    // Parse Private DICT to get local subroutines
    if (this.cffData && this.cffData.privateDict) {
      this.parsePrivateDict(
        this.cffData.privateDict.offset,
        this.cffData.privateDict.size
      );
    }

    // Parse CharStrings INDEX if we found the offset
    if (this.cffData && this.cffData.charStringsOffset) {
      this.seek(this.cffData.charStringsOffset);
      this.cffCharStrings = this.readIndex();
      console.log(`Loaded ${this.cffCharStrings.length} CFF CharStrings`);
    }

    console.log("CFF parsing completed");
  }

  // Read CFF INDEX structure
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

  // Read offset of specified size
  readOffset(offSize) {
    let offset = 0;
    for (let i = 0; i < offSize; i++) {
      offset = (offset << 8) | this.readUint8();
    }
    return offset;
  }

  // Parse Top DICT
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

  // Process DICT operator
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

  // Parse Private DICT
  parsePrivateDict(offset, size) {
    this.seek(offset);
    const dictData = [];
    for (let i = 0; i < size; i++) {
      dictData.push(this.readUint8());
    }

    let i = 0;
    const operands = [];
    let localSubrOffset = null;

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

        // Process Private DICT operators
        if (op === 19) {
          // Subrs
          if (operands.length >= 1) {
            localSubrOffset = offset + operands[0];
          }
        }

        operands.length = 0;
      } else {
        // Operand
        const operand = this.readDictOperand(dictData, i);
        operands.push(operand.value);
        i = operand.nextIndex - 1;
      }
      i++;
    }

    // Read local subroutines if offset found
    if (localSubrOffset) {
      this.seek(localSubrOffset);
      this.cffLocalSubrs = this.readIndex();

      // Calculate bias for local subroutines (following Typr.js logic)
      const nSubrs = this.cffLocalSubrs.length;
      let bias;
      if (nSubrs < 1240) bias = 107;
      else if (nSubrs < 33900) bias = 1131;
      else bias = 32768;

      this.cffLocalBias = bias;
      console.log(
        `Loaded ${this.cffLocalSubrs.length} local subroutines, bias: ${bias}`
      );
    } else {
      this.cffLocalSubrs = [];
      this.cffLocalBias = 0;
    }
  }

  // Read DICT operand
  readDictOperand(data, index) {
    const b0 = data[index];

    if (b0 >= 32 && b0 <= 246) {
      return { value: b0 - 139, nextIndex: index + 1 };
    } else if (b0 >= 247 && b0 <= 250) {
      const b1 = data[index + 1];
      return { value: (b0 - 247) * 256 + b1 + 108, nextIndex: index + 2 };
    } else if (b0 >= 251 && b0 <= 254) {
      const b1 = data[index + 1];
      return { value: -(b0 - 251) * 256 - b1 - 108, nextIndex: index + 2 };
    } else if (b0 === 28) {
      const b1 = data[index + 1];
      const b2 = data[index + 2];
      return { value: (b1 << 8) | b2, nextIndex: index + 3 };
    } else if (b0 === 29) {
      const b1 = data[index + 1];
      const b2 = data[index + 2];
      const b3 = data[index + 3];
      const b4 = data[index + 4];
      return {
        value: (b1 << 24) | (b2 << 16) | (b3 << 8) | b4,
        nextIndex: index + 5,
      };
    }

    return { value: 0, nextIndex: index + 1 };
  }

  // Parse CFF glyph using CharString interpreter
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

  // Draw CFF CharString using Typr.js-style state-based approach
  drawCFF(charString, state) {
    const { stack, path } = state;
    let { x, y, nStems, haveWidth, width, open } = state;
    let i = 0;

    const nominalWidthX = this.cffData?.privateDict?.nominalWidthX || 0;

    while (i < charString.length) {
      const b = charString[i];

      if (b >= 32) {
        // Operand
        const operand = this.readCharStringOperand(charString, i);
        stack.push(operand.value);
        i = operand.nextIndex;
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
            y += stack.pop();
            path.push({ type: "moveto", x, y });
            open = true;
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
              const subrIndex = Math.round(stack.pop());
              const subrs =
                op === 10 ? this.cffLocalSubrs : this.cffGlobalSubrs;
              const bias =
                op === 10
                  ? this.cffLocalBias || 107
                  : this.cffGlobalBias || 107;

              const adjustedIndex = subrIndex + bias;
              if (subrs && adjustedIndex >= 0 && adjustedIndex < subrs.length) {
                // Save state before subroutine call
                state.x = x;
                state.y = y;
                state.nStems = nStems;
                state.haveWidth = haveWidth;
                state.width = width;
                state.open = open;

                // Call subroutine recursively
                this.drawCFF(subrs[adjustedIndex], state);

                // Restore state after subroutine call
                x = state.x;
                y = state.y;
                nStems = state.nStems;
                haveWidth = state.haveWidth;
                width = state.width;
                open = state.open;
              }
            }
            break;

          case 11: // return
            // Return from subroutine
            state.x = x;
            state.y = y;
            state.nStems = nStems;
            state.haveWidth = haveWidth;
            state.width = width;
            state.open = open;
            return;

          case 14: // endchar
            if (stack.length > 0 && !haveWidth) {
              width = stack.shift() + nominalWidthX;
              haveWidth = true;
            }
            if (open) {
              path.push({ type: "closepath" });
            }
            break;

          case 21: // rmoveto
            if (stack.length > 2 && !haveWidth) {
              width = stack.shift() + nominalWidthX;
              haveWidth = true;
            }
            if (open) {
              path.push({ type: "closepath" });
            }
            x += stack.shift();
            y += stack.shift();
            path.push({ type: "moveto", x, y });
            open = true;
            break;

          case 22: // hmoveto
            if (stack.length > 1 && !haveWidth) {
              width = stack.shift() + nominalWidthX;
              haveWidth = true;
            }
            if (open) {
              path.push({ type: "closepath" });
            }
            x += stack.pop();
            path.push({ type: "moveto", x, y });
            open = true;
            break;

          case 30: // vhcurveto
          case 31: // hvcurveto
            {
              let alternate = op === 31;
              while (stack.length >= 4) {
                let c1x, c1y, c2x, c2y;

                if (alternate) {
                  c1x = x + stack.shift();
                  c1y = y;
                  c2x = c1x + stack.shift();
                  c2y = c1y + stack.shift();
                  y = c2y + stack.shift();
                  if (stack.length === 1) {
                    x = c2x + stack.shift();
                  } else {
                    x = c2x;
                  }
                } else {
                  c1x = x;
                  c1y = y + stack.shift();
                  c2x = c1x + stack.shift();
                  c2y = c1y + stack.shift();
                  x = c2x + stack.shift();
                  if (stack.length === 1) {
                    y = c2y + stack.shift();
                  } else {
                    y = c2y;
                  }
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

          default:
            // Unknown operator - clear stack
            stack.length = 0;
            break;
        }
        i++;
      }
    }

    // Update final state
    state.x = x;
    state.y = y;
    state.nStems = nStems;
    state.haveWidth = haveWidth;
    state.width = width;
    state.open = open;
  }

  // Calculate subroutine index (CFF uses a bias scheme)
  calculateSubrIndex(index, subrArray) {
    const count = subrArray.length;
    let bias;

    if (count < 1240) {
      bias = 107;
    } else if (count < 33900) {
      bias = 1131;
    } else {
      bias = 32768;
    }

    return index + bias;
  }

  // Read CharString operand
  readCharStringOperand(data, index) {
    const b0 = data[index];

    if (b0 >= 32 && b0 <= 246) {
      return { value: b0 - 139, nextIndex: index + 1 };
    } else if (b0 >= 247 && b0 <= 250) {
      const b1 = data[index + 1];
      return { value: (b0 - 247) * 256 + b1 + 108, nextIndex: index + 2 };
    } else if (b0 >= 251 && b0 <= 254) {
      const b1 = data[index + 1];
      return { value: -(b0 - 251) * 256 - b1 - 108, nextIndex: index + 2 };
    } else if (b0 === 28) {
      const b1 = data[index + 1];
      const b2 = data[index + 2];
      return { value: (b1 << 8) | b2, nextIndex: index + 3 };
    } else if (b0 === 255) {
      // 32-bit fixed point number
      const b1 = data[index + 1];
      const b2 = data[index + 2];
      const b3 = data[index + 3];
      const b4 = data[index + 4];
      const value = ((b1 << 24) | (b2 << 16) | (b3 << 8) | b4) / 65536;
      return { value, nextIndex: index + 5 };
    }

    return { value: 0, nextIndex: index + 1 };
  }

  // Convert CFF path commands to glyph format
  cffPathToGlyph(pathCommands) {
    if (pathCommands.length === 0) return null;

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
        // Store cubic curve information for proper SVG generation
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
        // Close current contour
        if (currentContour.length > 0) {
          contours.push(currentContour);
          currentContour = [];
        }
      }
    }

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
}

// Export for use
if (typeof module !== "undefined" && module.exports) {
  module.exports = FontParser;
}
