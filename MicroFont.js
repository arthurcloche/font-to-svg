/**
 * MicroFont.js
 * A minimal, modern TTF/Variable font parser focused on path extraction
 * Built from scratch, inspired by Typr.js
 */

class MicroFont {
  constructor(buffer) {
    this.data = new Uint8Array(buffer);
    this.view = new DataView(buffer);
    this.tables = {};
    this.glyphs = {};

    this._parseFont();
  }

  // ============================================
  // Core Parsing
  // ============================================

  _parseFont() {
    // Read font header
    const signature = this._read32(0);

    // Check signature
    if (
      signature !== 0x00010000 && // TrueType
      signature !== 0x74727565 && // 'true'
      signature !== 0x4f54544f
    ) {
      // 'OTTO' (CFF)
      throw new Error("Invalid font signature");
    }

    this.isOTF = signature === 0x4f54544f;

    // Read table directory
    const numTables = this._read16(4);

    // Parse table records
    for (let i = 0; i < numTables; i++) {
      const offset = 12 + i * 16;
      const tag = this._readTag(offset);
      const checksum = this._read32(offset + 4);
      const tableOffset = this._read32(offset + 8);
      const length = this._read32(offset + 12);

      this.tables[tag] = { offset: tableOffset, length };
    }

    // Parse essential tables
    this._parseHeadTable();
    this._parseHheaTable();
    this._parseMaxpTable();
    this._parseHmtxTable();
    this._parseCmapTable();
    this._parseLocaTable();

    // Parse optional tables
    if (this.tables.fvar) this._parseFvarTable();
    if (this.tables.gvar) this._parseGvarTable();
    if (this.tables.CFF || this.tables["CFF "]) this._parseCFFTable();
  }

  // ============================================
  // Table Parsers
  // ============================================

  _parseHeadTable() {
    const t = this.tables.head;
    if (!t) throw new Error("Missing head table");

    this.head = {
      version: this._read32(t.offset),
      fontRevision: this._read32(t.offset + 4),
      unitsPerEm: this._read16(t.offset + 18),
      xMin: this._read16s(t.offset + 36),
      yMin: this._read16s(t.offset + 38),
      xMax: this._read16s(t.offset + 40),
      yMax: this._read16s(t.offset + 42),
      indexToLocFormat: this._read16(t.offset + 50),
    };
  }

  _parseHheaTable() {
    const t = this.tables.hhea;
    if (!t) throw new Error("Missing hhea table");

    this.hhea = {
      ascender: this._read16s(t.offset + 4),
      descender: this._read16s(t.offset + 6),
      lineGap: this._read16s(t.offset + 8),
      advanceWidthMax: this._read16(t.offset + 10),
      numberOfHMetrics: this._read16(t.offset + 34),
    };
  }

  _parseMaxpTable() {
    const t = this.tables.maxp;
    if (!t) throw new Error("Missing maxp table");

    this.maxp = {
      version: this._read32(t.offset),
      numGlyphs: this._read16(t.offset + 4),
    };
  }

  _parseHmtxTable() {
    const t = this.tables.hmtx;
    if (!t) return;

    this.hmtx = {
      advanceWidth: [],
      leftSideBearing: [],
    };

    let offset = t.offset;
    const numMetrics = this.hhea.numberOfHMetrics;

    // Read metrics
    for (let i = 0; i < numMetrics; i++) {
      this.hmtx.advanceWidth.push(this._read16(offset));
      this.hmtx.leftSideBearing.push(this._read16s(offset + 2));
      offset += 4;
    }

    // Fill remaining with last advance width
    const lastAdvance = this.hmtx.advanceWidth[numMetrics - 1];
    for (let i = numMetrics; i < this.maxp.numGlyphs; i++) {
      this.hmtx.advanceWidth.push(lastAdvance);
      this.hmtx.leftSideBearing.push(this._read16s(offset));
      offset += 2;
    }
  }

  _parseCmapTable() {
    const t = this.tables.cmap;
    if (!t) throw new Error("Missing cmap table");

    const offset = t.offset;
    const version = this._read16(offset);
    const numTables = this._read16(offset + 2);

    // Find Unicode table (prefer format 4 or 12)
    let bestTable = null;
    let bestScore = -1;

    for (let i = 0; i < numTables; i++) {
      const platformID = this._read16(offset + 4 + i * 8);
      const encodingID = this._read16(offset + 6 + i * 8);
      const tableOffset = this._read32(offset + 8 + i * 8);

      let score = 0;
      // Prefer Unicode tables
      if (platformID === 0) score = 3; // Unicode
      else if (platformID === 3 && encodingID === 1)
        score = 2; // Windows Unicode
      else if (platformID === 3 && encodingID === 10) score = 4; // Windows Unicode full

      if (score > bestScore) {
        bestScore = score;
        bestTable = offset + tableOffset;
      }
    }

    if (!bestTable) throw new Error("No suitable cmap subtable found");

    // Parse the selected subtable
    const format = this._read16(bestTable);

    if (format === 4) {
      this._parseCmapFormat4(bestTable);
    } else if (format === 12) {
      this._parseCmapFormat12(bestTable);
    } else {
      throw new Error(`Unsupported cmap format: ${format}`);
    }
  }

  _parseCmapFormat4(offset) {
    const length = this._read16(offset + 2);
    const segCount = this._read16(offset + 6) / 2;

    const endCodes = [];
    const startCodes = [];
    const idDeltas = [];
    const idRangeOffsets = [];

    let pos = offset + 14;

    for (let i = 0; i < segCount; i++) {
      endCodes.push(this._read16(pos));
      pos += 2;
    }

    pos += 2; // Skip reserved

    for (let i = 0; i < segCount; i++) {
      startCodes.push(this._read16(pos));
      pos += 2;
    }

    for (let i = 0; i < segCount; i++) {
      idDeltas.push(this._read16s(pos));
      pos += 2;
    }

    const idRangeOffsetsStart = pos;
    for (let i = 0; i < segCount; i++) {
      idRangeOffsets.push(this._read16(pos));
      pos += 2;
    }

    // Read the glyphIdArray (like Typr.js does)
    const glyphIdArray = [];
    const arrayLength = (offset + length - pos) / 2;
    for (let i = 0; i < arrayLength; i++) {
      glyphIdArray.push(this._read16(pos));
      pos += 2;
    }

    // Build character to glyph map using Typr.js logic
    this.cmap = {};

    for (let i = 0; i < segCount; i++) {
      const start = startCodes[i];
      const end = endCodes[i];
      const delta = idDeltas[i];
      const rangeOffset = idRangeOffsets[i];

      if (start === 0xffff) break;

      for (let c = start; c <= end; c++) {
        let gid = 0;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          // Use Typr.js approach with glyphIdArray
          const arrayIndex =
            c - start + (rangeOffset >> 1) - (idRangeOffsets.length - i);
          if (arrayIndex >= 0 && arrayIndex < glyphIdArray.length) {
            gid = glyphIdArray[arrayIndex];
            if (gid !== 0) gid = (gid + delta) & 0xffff;
          }
        }
        this.cmap[c] = gid;
      }
    }
  }

  _parseCmapFormat12(offset) {
    const length = this._read32(offset + 4);
    const numGroups = this._read32(offset + 12);

    this.cmap = {};
    let pos = offset + 16;

    for (let i = 0; i < numGroups; i++) {
      const startCharCode = this._read32(pos);
      const endCharCode = this._read32(pos + 4);
      const startGlyphID = this._read32(pos + 8);

      for (let c = startCharCode; c <= endCharCode; c++) {
        this.cmap[c] = startGlyphID + (c - startCharCode);
      }

      pos += 12;
    }
  }

  _parseLocaTable() {
    const t = this.tables.loca;
    if (!t) return;

    this.loca = [];
    const isLong = this.head.indexToLocFormat === 1;

    if (isLong) {
      for (let i = 0; i <= this.maxp.numGlyphs; i++) {
        this.loca.push(this._read32(t.offset + i * 4));
      }
    } else {
      for (let i = 0; i <= this.maxp.numGlyphs; i++) {
        this.loca.push(this._read16(t.offset + i * 2) * 2);
      }
    }
  }

  _parseFvarTable() {
    const t = this.tables.fvar;
    if (!t) return;

    const offset = t.offset;
    const majorVersion = this._read16(offset);
    const minorVersion = this._read16(offset + 2);
    const axesArrayOffset = this._read16(offset + 4);
    const axisCount = this._read16(offset + 8);
    const axisSize = this._read16(offset + 10);

    this.fvar = {
      axes: [],
    };

    for (let i = 0; i < axisCount; i++) {
      const axisOffset = offset + axesArrayOffset + i * axisSize;
      this.fvar.axes.push({
        tag: this._readTag(axisOffset),
        minValue: this._read32(axisOffset + 4) / 65536,
        defaultValue: this._read32(axisOffset + 8) / 65536,
        maxValue: this._read32(axisOffset + 12) / 65536,
        flags: this._read16(axisOffset + 16),
        nameID: this._read16(axisOffset + 18),
      });
    }
  }

  _parseGvarTable() {
    // Simplified gvar parsing - implement if needed for variable fonts
    this.gvar = {};
  }

  _parseCFFTable() {
    const t = this.tables.CFF || this.tables["CFF "];
    if (!t) return;

    const data = this.data;
    const offset = t.offset;

    // Read CFF header
    const major = data[offset];
    const minor = data[offset + 1];
    const hdrSize = data[offset + 2];
    const offSize = data[offset + 3];

    let pos = offset + hdrSize;

    // Read Name INDEX
    const nameIndex = this._readCFFIndex(pos);
    pos = nameIndex.end;

    // Read Top DICT INDEX
    const topDictIndex = this._readCFFIndex(pos);
    pos = topDictIndex.end;

    // Read String INDEX
    const stringIndex = this._readCFFIndex(pos);
    pos = stringIndex.end;

    // Read Global Subr INDEX
    const globalSubrIndex = this._readCFFIndex(pos);
    pos = globalSubrIndex.end;

    // Parse Top DICT
    const topDict = this._parseCFFDict(topDictIndex.items[0]);

    // Get CharStrings
    let charStringsOffset = offset + topDict.CharStrings;
    const charStrings = this._readCFFIndex(charStringsOffset);

    // Get Private DICT
    let privateDict = {};
    if (topDict.Private) {
      const privateSize = topDict.Private[0];
      const privateOffset = topDict.Private[1];
      const privateData = data.slice(
        offset + privateOffset,
        offset + privateOffset + privateSize
      );
      privateDict = this._parseCFFDict(privateData);

      // Get Local Subr INDEX if exists
      if (privateDict.Subrs !== undefined) {
        const localSubrOffset = offset + privateOffset + privateDict.Subrs;
        privateDict.localSubrIndex = this._readCFFIndex(localSubrOffset);
      }
    }

    this.CFF = {
      CharStrings: charStrings.items,
      Private: privateDict,
      globalSubrIndex: globalSubrIndex,
      charStrings: charStrings,
    };
  }

  _readCFFIndex(offset) {
    const data = this.data;
    const count = (data[offset] << 8) | data[offset + 1];

    if (count === 0) {
      return { items: [], end: offset + 2 };
    }

    const offSize = data[offset + 2];
    let pos = offset + 3;

    // Read offsets
    const offsets = [];
    for (let i = 0; i <= count; i++) {
      let off = 0;
      for (let j = 0; j < offSize; j++) {
        off = (off << 8) | data[pos++];
      }
      offsets.push(off);
    }

    // Read items
    const items = [];
    const dataStart = pos - 1;
    for (let i = 0; i < count; i++) {
      const start = dataStart + offsets[i];
      const end = dataStart + offsets[i + 1];
      items.push(data.slice(start, end));
    }

    return {
      items: items,
      end: dataStart + offsets[count],
    };
  }

  _parseCFFDict(data) {
    const dict = {};
    const operands = [];

    for (let i = 0; i < data.length; i++) {
      const b0 = data[i];

      if (b0 <= 21) {
        // Operator
        let op = b0;
        if (b0 === 12) {
          op = (b0 << 8) | data[++i];
        }

        // Store operands for this operator
        if (op === 18) {
          // Private
          dict.Private = operands.slice();
        } else if (op === 17) {
          // CharStrings
          dict.CharStrings = operands[0];
        } else if (op === ((12 << 8) | 19)) {
          // Subrs
          dict.Subrs = operands[0];
        }

        operands.length = 0;
      } else if (b0 >= 32 && b0 <= 246) {
        // Small integer
        operands.push(b0 - 139);
      } else if (b0 >= 247 && b0 <= 250) {
        // Medium integer
        const b1 = data[++i];
        operands.push((b0 - 247) * 256 + b1 + 108);
      } else if (b0 >= 251 && b0 <= 254) {
        // Medium negative integer
        const b1 = data[++i];
        operands.push(-(b0 - 251) * 256 - b1 - 108);
      } else if (b0 === 28) {
        // Short integer
        const b1 = data[++i];
        const b2 = data[++i];
        operands.push((b1 << 8) | b2);
      } else if (b0 === 29) {
        // Long integer
        const b1 = data[++i];
        const b2 = data[++i];
        const b3 = data[++i];
        const b4 = data[++i];
        operands.push((b1 << 24) | (b2 << 16) | (b3 << 8) | b4);
      }
    }

    return dict;
  }

  _parseCFFGlyph(gid) {
    if (!this.CFF || !this.CFF.CharStrings[gid]) return null;

    const charString = this.CFF.CharStrings[gid];
    const state = {
      x: 0,
      y: 0,
      stack: [],
      nStems: 0,
      haveWidth: false,
      width: 0,
      open: false,
    };

    const path = { commands: [], points: [] };

    this._executeCFFCharString(charString, state, path);

    if (state.open) {
      path.commands.push("Z");
    }

    return { path };
  }

  _executeCFFCharString(code, state, path) {
    let i = 0;
    const stack = state.stack;
    const bias = this.CFF.Private.defaultWidthX || 0;

    while (i < code.length) {
      const b0 = code[i++];

      if (b0 === 1 || b0 === 3 || b0 === 18 || b0 === 23) {
        // hstem, vstem, hstemhm, vstemhm
        state.nStems += stack.length >> 1;
        stack.length = 0;
      } else if (b0 === 4) {
        // vmoveto
        if (stack.length > 1 && !state.haveWidth) {
          state.width = stack.shift() + bias;
          state.haveWidth = true;
        }
        state.y += stack.pop();
        this._newContour(state, path);
        stack.length = 0;
      } else if (b0 === 5) {
        // rlineto
        while (stack.length > 0) {
          state.x += stack.shift();
          state.y += stack.shift();
          path.commands.push("L");
          path.points.push(state.x, -state.y);
        }
      } else if (b0 === 6) {
        // hlineto
        while (stack.length > 0) {
          state.x += stack.shift();
          path.commands.push("L");
          path.points.push(state.x, -state.y);
          if (stack.length === 0) break;
          state.y += stack.shift();
          path.commands.push("L");
          path.points.push(state.x, -state.y);
        }
      } else if (b0 === 7) {
        // vlineto
        while (stack.length > 0) {
          state.y += stack.shift();
          path.commands.push("L");
          path.points.push(state.x, -state.y);
          if (stack.length === 0) break;
          state.x += stack.shift();
          path.commands.push("L");
          path.points.push(state.x, -state.y);
        }
      } else if (b0 === 8) {
        // rrcurveto
        while (stack.length > 0) {
          const c1x = state.x + stack.shift();
          const c1y = state.y + stack.shift();
          const c2x = c1x + stack.shift();
          const c2y = c1y + stack.shift();
          state.x = c2x + stack.shift();
          state.y = c2y + stack.shift();
          path.commands.push("C");
          path.points.push(c1x, -c1y, c2x, -c2y, state.x, -state.y);
        }
      } else if (b0 === 10) {
        // callsubr
        const subrs = this.CFF.Private.localSubrIndex;
        if (subrs && subrs.items) {
          const bias =
            subrs.items.length < 1240
              ? 107
              : subrs.items.length < 33900
              ? 1131
              : 32768;
          const idx = stack.pop() + bias;
          if (idx >= 0 && idx < subrs.items.length) {
            this._executeCFFCharString(subrs.items[idx], state, path);
          }
        }
      } else if (b0 === 11) {
        // return
        return;
      } else if (b0 === 14) {
        // endchar
        if (stack.length > 0 && !state.haveWidth) {
          state.width = stack.shift() + bias;
          state.haveWidth = true;
        }
        if (state.open) {
          path.commands.push("Z");
          state.open = false;
        }
        return;
      } else if (b0 === 21) {
        // rmoveto
        if (stack.length > 2 && !state.haveWidth) {
          state.width = stack.shift() + bias;
          state.haveWidth = true;
        }
        state.x += stack.shift();
        state.y += stack.shift();
        this._newContour(state, path);
        stack.length = 0;
      } else if (b0 === 22) {
        // hmoveto
        if (stack.length > 1 && !state.haveWidth) {
          state.width = stack.shift() + bias;
          state.haveWidth = true;
        }
        state.x += stack.shift();
        this._newContour(state, path);
        stack.length = 0;
      } else if (b0 === 24) {
        // rcurveline
        while (stack.length > 2) {
          const c1x = state.x + stack.shift();
          const c1y = state.y + stack.shift();
          const c2x = c1x + stack.shift();
          const c2y = c1y + stack.shift();
          state.x = c2x + stack.shift();
          state.y = c2y + stack.shift();
          path.commands.push("C");
          path.points.push(c1x, -c1y, c2x, -c2y, state.x, -state.y);
        }
        state.x += stack.shift();
        state.y += stack.shift();
        path.commands.push("L");
        path.points.push(state.x, -state.y);
      } else if (b0 === 25) {
        // rlinecurve
        while (stack.length > 6) {
          state.x += stack.shift();
          state.y += stack.shift();
          path.commands.push("L");
          path.points.push(state.x, -state.y);
        }
        const c1x = state.x + stack.shift();
        const c1y = state.y + stack.shift();
        const c2x = c1x + stack.shift();
        const c2y = c1y + stack.shift();
        state.x = c2x + stack.shift();
        state.y = c2y + stack.shift();
        path.commands.push("C");
        path.points.push(c1x, -c1y, c2x, -c2y, state.x, -state.y);
      } else if (b0 === 26) {
        // vvcurveto
        if (stack.length & 1) state.x += stack.shift();
        while (stack.length > 0) {
          const c1x = state.x;
          const c1y = state.y + stack.shift();
          const c2x = c1x + stack.shift();
          const c2y = c1y + stack.shift();
          state.x = c2x;
          state.y = c2y + stack.shift();
          path.commands.push("C");
          path.points.push(c1x, -c1y, c2x, -c2y, state.x, -state.y);
        }
      } else if (b0 === 27) {
        // hhcurveto
        if (stack.length & 1) state.y += stack.shift();
        while (stack.length > 0) {
          const c1x = state.x + stack.shift();
          const c1y = state.y;
          const c2x = c1x + stack.shift();
          const c2y = c1y + stack.shift();
          state.x = c2x + stack.shift();
          state.y = c2y;
          path.commands.push("C");
          path.points.push(c1x, -c1y, c2x, -c2y, state.x, -state.y);
        }
      } else if (b0 === 29) {
        // callgsubr
        const subrs = this.CFF.globalSubrIndex;
        if (subrs && subrs.items) {
          const bias =
            subrs.items.length < 1240
              ? 107
              : subrs.items.length < 33900
              ? 1131
              : 32768;
          const idx = stack.pop() + bias;
          if (idx >= 0 && idx < subrs.items.length) {
            this._executeCFFCharString(subrs.items[idx], state, path);
          }
        }
      } else if (b0 === 30) {
        // vhcurveto
        while (stack.length > 0) {
          const c1x = state.x;
          const c1y = state.y + stack.shift();
          const c2x = c1x + stack.shift();
          const c2y = c1y + stack.shift();
          state.x = c2x + stack.shift();
          state.y = c2y + (stack.length === 1 ? stack.shift() : 0);
          path.commands.push("C");
          path.points.push(c1x, -c1y, c2x, -c2y, state.x, -state.y);
          if (stack.length === 0) break;

          const c3x = state.x + stack.shift();
          const c3y = state.y;
          const c4x = c3x + stack.shift();
          const c4y = c3y + stack.shift();
          state.y = c4y + stack.shift();
          state.x = c4x + (stack.length === 1 ? stack.shift() : 0);
          path.commands.push("C");
          path.points.push(c3x, -c3y, c4x, -c4y, state.x, -state.y);
        }
      } else if (b0 === 31) {
        // hvcurveto
        while (stack.length > 0) {
          const c1x = state.x + stack.shift();
          const c1y = state.y;
          const c2x = c1x + stack.shift();
          const c2y = c1y + stack.shift();
          state.y = c2y + stack.shift();
          state.x = c2x + (stack.length === 1 ? stack.shift() : 0);
          path.commands.push("C");
          path.points.push(c1x, -c1y, c2x, -c2y, state.x, -state.y);
          if (stack.length === 0) break;

          const c3x = state.x;
          const c3y = state.y + stack.shift();
          const c4x = c3x + stack.shift();
          const c4y = c3y + stack.shift();
          state.x = c4x + stack.shift();
          state.y = c4y + (stack.length === 1 ? stack.shift() : 0);
          path.commands.push("C");
          path.points.push(c3x, -c3y, c4x, -c4y, state.x, -state.y);
        }
      } else if (b0 >= 32 && b0 <= 246) {
        // number
        stack.push(b0 - 139);
      } else if (b0 >= 247 && b0 <= 250) {
        // number
        const b1 = code[i++];
        stack.push((b0 - 247) * 256 + b1 + 108);
      } else if (b0 >= 251 && b0 <= 254) {
        // number
        const b1 = code[i++];
        stack.push(-(b0 - 251) * 256 - b1 - 108);
      } else if (b0 === 28) {
        // short integer
        const b1 = code[i++];
        const b2 = code[i++];
        const val = (b1 << 8) | b2;
        stack.push(val > 32767 ? val - 65536 : val);
      } else if (b0 === 255) {
        // fixed point number
        const val =
          (code[i] << 24) |
          (code[i + 1] << 16) |
          (code[i + 2] << 8) |
          code[i + 3];
        i += 4;
        stack.push(val / 65536.0);
      }
    }
  }

  _newContour(state, path) {
    if (state.open) path.commands.push("Z");
    path.commands.push("M");
    path.points.push(state.x, -state.y);
    state.open = true;
  }

  // ============================================
  // Glyph Parsing
  // ============================================

  _parseGlyph(gid) {
    if (!this.tables.glyf || !this.loca) return null;

    const start = this.loca[gid];
    const end = this.loca[gid + 1];

    if (start === end) return null; // Empty glyph

    const offset = this.tables.glyf.offset + start;
    const numberOfContours = this._read16s(offset);

    const glyph = {
      numberOfContours,
      xMin: this._read16s(offset + 2),
      yMin: this._read16s(offset + 4),
      xMax: this._read16s(offset + 6),
      yMax: this._read16s(offset + 8),
    };

    // Handle glyphs with invalid bounds (common in some fonts like BebasNeue)
    // Only skip if BOTH dimensions are invalid
    if (glyph.xMin > glyph.xMax && glyph.yMin > glyph.yMax) {
      console.warn(
        `Glyph ${gid} has completely invalid bounds, using empty path`
      );
      return { path: { commands: [], points: [] } };
    }

    if (numberOfContours >= 0) {
      // Simple glyph
      this._parseSimpleGlyph(glyph, offset + 10, numberOfContours);
    } else {
      // Composite glyph
      this._parseCompositeGlyph(glyph, offset + 10);
    }

    return glyph;
  }

  _parseSimpleGlyph(glyph, offset, numberOfContours) {
    // Read endpoints
    const endPts = [];
    for (let i = 0; i < numberOfContours; i++) {
      endPts.push(this._read16(offset));
      offset += 2;
    }

    const numPoints = endPts[endPts.length - 1] + 1;

    // Skip instructions
    const instructionLength = this._read16(offset);
    offset += 2 + instructionLength;

    // Read flags
    const flags = [];
    for (let i = 0; i < numPoints; i++) {
      const flag = this.data[offset++];
      flags.push(flag);

      if (flag & 8) {
        // Repeat flag
        const count = this.data[offset++];
        for (let j = 0; j < count; j++) {
          flags.push(flag);
          i++;
        }
      }
    }

    // Read X coordinates
    const xs = [];
    let x = 0;
    for (let i = 0; i < numPoints; i++) {
      const flag = flags[i];
      if (flag & 2) {
        // X_SHORT_VECTOR
        const delta = this.data[offset++];
        x += flag & 16 ? delta : -delta; // X positive
      } else if (!(flag & 16)) {
        // X not same
        x += this._read16s(offset);
        offset += 2;
      }
      xs.push(x);
    }

    // Read Y coordinates
    const ys = [];
    let y = 0;
    for (let i = 0; i < numPoints; i++) {
      const flag = flags[i];
      if (flag & 4) {
        // Y_SHORT_VECTOR
        const delta = this.data[offset++];
        y += flag & 32 ? delta : -delta; // Y positive
      } else if (!(flag & 32)) {
        // Y not same
        y += this._read16s(offset);
        offset += 2;
      }
      ys.push(y);
    }

    // Build path
    glyph.path = this._buildPath(xs, ys, flags, endPts);
  }

  _parseCompositeGlyph(glyph, offset) {
    glyph.components = [];
    let flags;

    do {
      flags = this._read16(offset);
      const component = {
        glyphIndex: this._read16(offset + 2),
        flags,
      };
      offset += 4;

      // Read transformation data
      if (flags & 1) {
        // ARG_1_AND_2_ARE_WORDS
        component.dx = this._read16s(offset);
        component.dy = this._read16s(offset + 2);
        offset += 4;
      } else {
        component.dx = this.data[offset];
        component.dy = this.data[offset + 1];
        offset += 2;
      }

      if (flags & 8) {
        // WE_HAVE_A_SCALE
        component.scale = this._read16s(offset) / 16384;
        offset += 2;
      } else if (flags & 64) {
        // WE_HAVE_AN_X_AND_Y_SCALE
        component.scaleX = this._read16s(offset) / 16384;
        component.scaleY = this._read16s(offset + 2) / 16384;
        offset += 4;
      } else if (flags & 128) {
        // WE_HAVE_A_TWO_BY_TWO
        component.transform = [
          this._read16s(offset) / 16384,
          this._read16s(offset + 2) / 16384,
          this._read16s(offset + 4) / 16384,
          this._read16s(offset + 6) / 16384,
        ];
        offset += 8;
      }

      glyph.components.push(component);
    } while (flags & 32); // MORE_COMPONENTS

    // Build composite path
    glyph.path = this._buildCompositePath(glyph.components);
  }

  _buildPath(xs, ys, flags, endPts) {
    const commands = [];
    const points = [];

    let contourStart = 0;

    for (let c = 0; c < endPts.length; c++) {
      const contourEnd = endPts[c];
      const numPoints = contourEnd - contourStart + 1;

      if (numPoints < 2) {
        contourStart = contourEnd + 1;
        continue; // Skip invalid contours
      }

      // Build the contour using the same logic as Typr.js
      let firstX = null,
        firstY = null;
      let prevX = null,
        prevY = null;
      let startedPath = false;

      for (let j = 0; j <= numPoints; j++) {
        const i = contourStart + (j % numPoints);
        const isLast = j === numPoints;

        const cur = i;
        const prev = cur === contourStart ? contourEnd : cur - 1;
        const next = cur === contourEnd ? contourStart : cur + 1;

        const onCurve = (flags[cur] & 1) !== 0;
        const onPrev = (flags[prev] & 1) !== 0;

        const x = xs[cur];
        const y = ys[cur];

        if (j === 0) {
          // Find start point
          if (onCurve) {
            commands.push("M");
            points.push(x, -y);
            firstX = prevX = x;
            firstY = prevY = y;
            startedPath = true;
          } else if (onPrev) {
            commands.push("M");
            points.push(xs[prev], -ys[prev]);
            firstX = prevX = xs[prev];
            firstY = prevY = ys[prev];
            startedPath = true;
          } else {
            // Start at midpoint between two off-curve points
            const midX = (xs[prev] + x) / 2;
            const midY = (ys[prev] + y) / 2;
            commands.push("M");
            points.push(midX, -midY);
            firstX = prevX = midX;
            firstY = prevY = midY;
            startedPath = true;
          }
        }

        if (!isLast) {
          if (onCurve) {
            if (startedPath && (x !== prevX || y !== prevY)) {
              commands.push("L");
              points.push(x, -y);
            }
            prevX = x;
            prevY = y;
          } else {
            // Handle off-curve point
            const onNext = (flags[next] & 1) !== 0;

            if (onNext) {
              // Curve to next on-curve point
              commands.push("Q");
              points.push(x, -y, xs[next], -ys[next]);
              prevX = xs[next];
              prevY = ys[next];
              j++; // Skip next point as we've already used it
            } else {
              // Curve to midpoint
              const midX = (x + xs[next]) / 2;
              const midY = (y + ys[next]) / 2;
              commands.push("Q");
              points.push(x, -y, midX, -midY);
              prevX = midX;
              prevY = midY;
            }
          }
        }
      }

      commands.push("Z");
      contourStart = contourEnd + 1;
    }

    return { commands, points };
  }

  _buildCompositePath(components) {
    const commands = [];
    const points = [];

    for (const comp of components) {
      const componentGlyph = this.getGlyph(comp.glyphIndex);
      if (!componentGlyph || !componentGlyph.path) continue;

      const path = componentGlyph.path;
      let pi = 0;

      for (let i = 0; i < path.commands.length; i++) {
        const cmd = path.commands[i];
        commands.push(cmd);

        if (cmd === "M" || cmd === "L") {
          const x = path.points[pi] + (comp.dx || 0);
          const y = path.points[pi + 1] + (comp.dy || 0);
          points.push(x, y);
          pi += 2;
        } else if (cmd === "Q") {
          const cx = path.points[pi] + (comp.dx || 0);
          const cy = path.points[pi + 1] + (comp.dy || 0);
          const x = path.points[pi + 2] + (comp.dx || 0);
          const y = path.points[pi + 3] + (comp.dy || 0);
          points.push(cx, cy, x, y);
          pi += 4;
        }
      }
    }

    return { commands, points };
  }

  // ============================================
  // Binary Reading Utilities
  // ============================================

  _read16(offset) {
    return this.view.getUint16(offset, false);
  }

  _read16s(offset) {
    return this.view.getInt16(offset, false);
  }

  _read32(offset) {
    return this.view.getUint32(offset, false);
  }

  _readTag(offset) {
    return String.fromCharCode(
      this.data[offset],
      this.data[offset + 1],
      this.data[offset + 2],
      this.data[offset + 3]
    );
  }

  // ============================================
  // Public API
  // ============================================

  getGlyph(gid) {
    if (!this.glyphs[gid]) {
      // Try CFF first if available (like Typr.js does)
      if (this.CFF && this.CFF.CharStrings && this.CFF.CharStrings[gid]) {
        this.glyphs[gid] = this._parseCFFGlyph(gid);
      } else {
        this.glyphs[gid] = this._parseGlyph(gid);
      }
    }
    return this.glyphs[gid];
  }

  charToGlyph(char) {
    const code = typeof char === "string" ? char.charCodeAt(0) : char;
    return this.cmap[code] || 0;
  }

  getPath(char, size = 100) {
    const gid = this.charToGlyph(char);
    if (!gid) return "";

    const glyph = this.getGlyph(gid);
    if (!glyph || !glyph.path) return "";

    const scale = size / this.head.unitsPerEm;
    return this._pathToSVG(glyph.path, scale);
  }

  getText(text, size = 100) {
    const paths = [];
    const scale = size / this.head.unitsPerEm;
    let x = 0;

    for (const char of text) {
      const gid = this.charToGlyph(char);
      // Don't skip glyph 0 - it might be a valid .notdef glyph
      // if (gid === undefined || gid === null) continue;

      const glyph = this.getGlyph(gid);
      if (!glyph || !glyph.path || glyph.path.commands.length === 0) {
        // Still advance even if no glyph path
        const advance = this.hmtx.advanceWidth[gid] || this.head.unitsPerEm / 4;
        x += advance * scale;
        continue;
      }

      const path = this._pathToSVG(glyph.path, scale, x, 0);
      paths.push({ char, path, x });

      // Advance
      const advance = this.hmtx.advanceWidth[gid] || 0;
      x += advance * scale;
    }

    return paths;
  }

  _pathToSVG(path, scale, offsetX = 0, offsetY = 0) {
    let svg = "";
    let pi = 0;

    for (const cmd of path.commands) {
      if (cmd === "M") {
        const x = path.points[pi] * scale + offsetX;
        const y = path.points[pi + 1] * scale + offsetY;
        svg += `M${x},${y}`;
        pi += 2;
      } else if (cmd === "L") {
        const x = path.points[pi] * scale + offsetX;
        const y = path.points[pi + 1] * scale + offsetY;
        svg += `L${x},${y}`;
        pi += 2;
      } else if (cmd === "Q") {
        const cx = path.points[pi] * scale + offsetX;
        const cy = path.points[pi + 1] * scale + offsetY;
        const x = path.points[pi + 2] * scale + offsetX;
        const y = path.points[pi + 3] * scale + offsetY;
        svg += `Q${cx},${cy} ${x},${y}`;
        pi += 4;
      } else if (cmd === "C") {
        const c1x = path.points[pi] * scale + offsetX;
        const c1y = path.points[pi + 1] * scale + offsetY;
        const c2x = path.points[pi + 2] * scale + offsetX;
        const c2y = path.points[pi + 3] * scale + offsetY;
        const x = path.points[pi + 4] * scale + offsetX;
        const y = path.points[pi + 5] * scale + offsetY;
        svg += `C${c1x},${c1y} ${c2x},${c2y} ${x},${y}`;
        pi += 6;
      } else if (cmd === "Z") {
        svg += "Z";
      }
    }

    return svg;
  }
}

// Export
if (typeof module !== "undefined" && module.exports) {
  module.exports = MicroFont;
} else if (typeof window !== "undefined") {
  window.MicroFont = MicroFont;
}
