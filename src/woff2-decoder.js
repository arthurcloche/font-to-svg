/**
 * WOFF2 Decoder - Basic implementation for browser use
 * 
 * WOFF2 uses Brotli compression and has a complex format.
 * This is a simplified decoder that works with modern browsers.
 */

class WOFF2Decoder {
  constructor() {
    this.transformedGlyfTableData = null;
  }

  /**
   * Decode WOFF2 font to TTF/OTF buffer
   * @param {ArrayBuffer} woff2Buffer - WOFF2 font data
   * @returns {Promise<ArrayBuffer>} - Decompressed font buffer
   */
  async decode(woff2Buffer) {
    const view = new DataView(woff2Buffer);
    let offset = 0;

    // Read WOFF2 header
    const signature = view.getUint32(offset, false); // 'wOF2'
    offset += 4;
    
    if (signature !== 0x774f4632) {
      throw new Error('Not a valid WOFF2 file');
    }

    const flavor = view.getUint32(offset, false);
    offset += 4;
    const length = view.getUint32(offset, false);
    offset += 4;
    const numTables = view.getUint16(offset, false);
    offset += 2;
    const reserved = view.getUint16(offset, false);
    offset += 2;
    const totalSfntSize = view.getUint32(offset, false);
    offset += 4;
    const totalCompressedSize = view.getUint32(offset, false);
    offset += 4;
    const majorVersion = view.getUint16(offset, false);
    offset += 2;
    const minorVersion = view.getUint16(offset, false);
    offset += 2;
    const metaOffset = view.getUint32(offset, false);
    offset += 4;
    const metaLength = view.getUint32(offset, false);
    offset += 4;
    const metaOrigLength = view.getUint32(offset, false);
    offset += 4;
    const privOffset = view.getUint32(offset, false);
    offset += 4;
    const privLength = view.getUint32(offset, false);
    offset += 4;

    // Read table directory
    const tables = [];
    for (let i = 0; i < numTables; i++) {
      const table = this.readTableDirectoryEntry(view, offset);
      tables.push(table);
      offset = table.nextOffset;
    }

    // Read compressed data
    const compressedDataOffset = offset;
    const compressedDataSize = totalCompressedSize;
    const compressedData = woff2Buffer.slice(compressedDataOffset, compressedDataOffset + compressedDataSize);

    // Decompress using Brotli
    let decompressedData;
    try {
      if (typeof DecompressionStream !== 'undefined') {
        // Modern browser with streaming decompression
        decompressedData = await this.decompressBrotli(compressedData);
      } else {
        throw new Error('Brotli decompression not available in this environment');
      }
    } catch (error) {
      throw new Error(`Brotli decompression failed: ${error.message}`);
    }

    // Reconstruct font
    return this.reconstructFont(flavor, tables, decompressedData, totalSfntSize);
  }

  /**
   * Read table directory entry
   */
  readTableDirectoryEntry(view, offset) {
    const flags = view.getUint8(offset);
    offset += 1;

    let tag;
    if ((flags & 0x3f) === 0x3f) {
      // Arbitrary tag
      tag = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      );
      offset += 4;
    } else {
      // Known tag
      const knownTags = [
        'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
        'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
        'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
        'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
        'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
        'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
        'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
        'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'
      ];
      tag = knownTags[flags & 0x3f] || 'unkn';
    }

    // Read origLength (base 128 encoded)
    let origLength = 0;
    let origLengthBytes = 0;
    for (let i = 0; i < 5; i++) {
      const byte = view.getUint8(offset + i);
      origLength = (origLength << 7) | (byte & 0x7f);
      origLengthBytes++;
      if ((byte & 0x80) === 0) break;
    }
    offset += origLengthBytes;

    // Read transformLength if needed
    let transformLength = origLength;
    if ((flags & 0x40) !== 0) {
      transformLength = 0;
      let transformLengthBytes = 0;
      for (let i = 0; i < 5; i++) {
        const byte = view.getUint8(offset + i);
        transformLength = (transformLength << 7) | (byte & 0x7f);
        transformLengthBytes++;
        if ((byte & 0x80) === 0) break;
      }
      offset += transformLengthBytes;
    }

    return {
      tag,
      flags,
      origLength,
      transformLength,
      nextOffset: offset
    };
  }

  /**
   * Decompress Brotli data
   */
  async decompressBrotli(compressedData) {
    try {
      // For now, try the streaming API available in modern browsers
      const stream = new Response(compressedData).body.pipeThrough(
        new DecompressionStream('br')
      );
      
      const response = new Response(stream);
      return await response.arrayBuffer();
    } catch (error) {
      // Fallback: return error for now
      throw new Error('Brotli decompression requires a modern browser with DecompressionStream support');
    }
  }

  /**
   * Reconstruct original font from decompressed tables
   */
  reconstructFont(flavor, tables, decompressedData, totalSfntSize) {
    // Create output buffer
    const output = new ArrayBuffer(totalSfntSize);
    const outputView = new DataView(output);
    let outputOffset = 0;

    // Write font header
    outputView.setUint32(outputOffset, flavor, false);
    outputOffset += 4;
    outputView.setUint16(outputOffset, tables.length, false);
    outputOffset += 2;

    // Calculate searchRange, entrySelector, rangeShift
    const maxPowerOf2 = Math.floor(Math.log2(tables.length));
    const searchRange = Math.pow(2, maxPowerOf2) * 16;
    const entrySelector = maxPowerOf2;
    const rangeShift = tables.length * 16 - searchRange;

    outputView.setUint16(outputOffset, searchRange, false);
    outputOffset += 2;
    outputView.setUint16(outputOffset, entrySelector, false);
    outputOffset += 2;
    outputView.setUint16(outputOffset, rangeShift, false);
    outputOffset += 2;

    // Calculate table offsets
    let currentTableOffset = 12 + tables.length * 16; // Header + table directory
    currentTableOffset = this.alignToFour(currentTableOffset);

    // Write table directory
    const decompressedView = new DataView(decompressedData);
    let decompressedOffset = 0;

    for (const table of tables) {
      // Write table directory entry
      const tagBytes = new TextEncoder().encode(table.tag.padEnd(4, '\0'));
      outputView.setUint8(outputOffset, tagBytes[0]);
      outputView.setUint8(outputOffset + 1, tagBytes[1]);
      outputView.setUint8(outputOffset + 2, tagBytes[2]);
      outputView.setUint8(outputOffset + 3, tagBytes[3]);
      outputOffset += 4;

      // Calculate checksum (simplified - should be proper checksum)
      outputView.setUint32(outputOffset, 0, false); // Placeholder checksum
      outputOffset += 4;

      outputView.setUint32(outputOffset, currentTableOffset, false);
      outputOffset += 4;

      outputView.setUint32(outputOffset, table.origLength, false);
      outputOffset += 4;

      // Copy table data
      const tableData = decompressedData.slice(decompressedOffset, decompressedOffset + table.transformLength);
      new Uint8Array(output, currentTableOffset, table.transformLength).set(new Uint8Array(tableData));

      decompressedOffset += table.transformLength;
      currentTableOffset += this.alignToFour(table.origLength);
    }

    return output;
  }

  alignToFour(value) {
    return (value + 3) & ~3;
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WOFF2Decoder;
}