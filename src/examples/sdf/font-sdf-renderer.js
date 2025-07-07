/**
 * Font SDF Renderer
 *
 * Converts font bezier curves to SDF data for WebGL shader rendering.
 * Handles multiple contours with proper inside/outside determination.
 */

class FontSDFRenderer {
  constructor(fontParser) {
    this.fontParser = fontParser;
    this.maxBezierSegments = 128; // Maximum bezier segments per glyph (increased for complex variable font characters)
    this.maxContours = 8; // Maximum contours per glyph (increased for complex letters)
    this.fontType = fontParser.fontType; // 'truetype' or 'cff'
  }

  /**
   * Extract bezier curves from a character and convert to SDF data
   * @param {string} character - Character to process
   * @param {Object} options - Rendering options
   * @returns {Object} SDF data ready for shader injection
   */
  extractSDFData(character, options = {}) {
    // Apply variable font settings if provided
    if (options.variable && this.fontParser.data.isVariable) {
      this.fontParser.setVariation(options.variable);
      console.log(`Applied font variation for SDF:`, options.variable);
      console.log(`Current variation:`, this.fontParser.getVariation());
    }

    const glyphId = this.fontParser.getGlyphId(character);
    const glyph = this.fontParser.parseGlyph(glyphId);

    if (!glyph?.contours?.length) {
      return this.createEmptySDFData();
    }

    // Calculate bounds and flip Y coordinates to match the Y-flipped control points
    const rawBounds = this.calculateBounds(glyph.contours);
    const flippedBounds = {
      minX: rawBounds.minX,
      minY: -rawBounds.maxY, // Flip Y
      maxX: rawBounds.maxX,
      maxY: -rawBounds.minY, // Flip Y
      width: rawBounds.width,
      height: rawBounds.height,
    };

    const sdfData = {
      contours: [],
      bounds: flippedBounds,
      character: character,
      glyphId: glyphId,
    };

    // Classify contours by area to determine outer shapes vs holes
    const contourClassification = this.classifyContours(glyph.contours);

    // Process each contour with debug logging
    for (let i = 0; i < glyph.contours.length && i < this.maxContours; i++) {
      const contour = glyph.contours[i];
      const classification = contourClassification.find((c) => c.index === i);

      console.log(
        `Processing contour ${i} for "${character}": ${
          contour.length
        } points, area=${classification.area.toFixed(0)}, isOuter=${
          classification.isOuter
        }`
      );

      const contourData = this.processContour(contour, i, classification);
      console.log(
        `Generated ${contourData.segments.length} segments for contour ${i}`
      );
      sdfData.contours.push(contourData);
    }

    return sdfData;
  }

  /**
   * Process a single contour into bezier segments
   * @private
   */
  processContour(contour, contourIndex, classification = null) {
    const segments = [];
    const points = [...contour];

    if (points.length === 0) {
      return {
        index: contourIndex,
        segments: segments,
        segmentCount: segments.length,
        windingOrder: 1,
      };
    }

    // Find the first on-curve point to start from
    let startIndex = 0;
    for (let i = 0; i < points.length; i++) {
      if (points[i].onCurve) {
        startIndex = i;
        break;
      }
    }

    // Rotate array to start from first on-curve point
    const rotatedPoints = [
      ...points.slice(startIndex),
      ...points.slice(0, startIndex),
    ];

    let lastOnCurvePoint = rotatedPoints[0];

    // Process all points in the contour, including the closing segment
    for (let i = 0; i < rotatedPoints.length; i++) {
      // Safety check to prevent infinite segments
      if (segments.length >= this.maxBezierSegments) {
        console.warn(
          `⚠️ SEGMENT LIMIT REACHED: ${this.maxBezierSegments} segments for contour ${contourIndex}`
        );
        console.warn(
          `   Point ${i}/${rotatedPoints.length} - This may cause incomplete letters!`
        );
        console.warn(
          `   Consider increasing maxBezierSegments from ${
            this.maxBezierSegments
          } to ${this.maxBezierSegments * 2}`
        );
        break;
      }
      const current = rotatedPoints[i];
      const next = rotatedPoints[(i + 1) % rotatedPoints.length];

      if (current.cubic) {
        // Cubic bezier - convert to quadratic
        const segment = this.createCubicBezierSegment(current, next);
        segments.push(segment);
        lastOnCurvePoint = next.onCurve ? next : current;
      } else if (!current.onCurve && !next.onCurve) {
        // Two consecutive off-curve points - create implicit on-curve point
        const implicit = {
          x: (current.x + next.x) / 2,
          y: (current.y + next.y) / 2,
          onCurve: true,
        };
        const segment = this.createQuadraticBezierSegment(
          lastOnCurvePoint,
          current,
          implicit
        );
        segments.push(segment);
        lastOnCurvePoint = implicit;
      } else if (!current.onCurve) {
        // Quadratic bezier
        const segment = this.createQuadraticBezierSegment(
          lastOnCurvePoint,
          current,
          next
        );
        segments.push(segment);
        lastOnCurvePoint = next.onCurve ? next : current;
      } else if (current.onCurve && next.onCurve) {
        // Linear segment
        const segment = this.createLinearSegment(current, next);
        segments.push(segment);
        lastOnCurvePoint = next;
      } else if (current.onCurve) {
        // Update tracking point but don't create segment yet
        lastOnCurvePoint = current;
      }
    }

    return {
      index: contourIndex,
      segments: segments,
      segmentCount: segments.length,
      windingOrder: classification ? (classification.isOuter ? 1 : -1) : 1,
    };
  }

  /**
   * Create a quadratic bezier segment
   * @private
   */
  createQuadraticBezierSegment(start, control, end) {
    return {
      type: "quadratic",
      start: { x: start.x, y: start.y },
      control: { x: control.x, y: control.y },
      end: { x: end.x, y: end.y },
    };
  }

  /**
   * Check if cubic bezier is actually a straight line
   * @private
   */
  isCubicLinear(P0, P1, P2, P3, tolerance = 2.0) {
    // Check if control points lie on the line between start and end
    const lineLength = Math.sqrt((P3.x - P0.x) ** 2 + (P3.y - P0.y) ** 2);
    if (lineLength < 0.1) return true; // Degenerate case

    // Calculate perpendicular distance from control points to line P0-P3
    const lineDx = P3.x - P0.x;
    const lineDy = P3.y - P0.y;

    const dist1 =
      Math.abs(lineDy * P1.x - lineDx * P1.y + P3.x * P0.y - P3.y * P0.x) /
      lineLength;
    const dist2 =
      Math.abs(lineDy * P2.x - lineDx * P2.y + P3.x * P0.y - P3.y * P0.x) /
      lineLength;

    return dist1 < tolerance && dist2 < tolerance;
  }

  /**
   * Create a cubic bezier segment (simplified to quadratic for now)
   * @private
   */
  createCubicBezierSegment(current, next) {
    // Handle different font types - CFF vs TrueType may have different control point ordering
    let P0, P1, P2, P3;

    if (this.fontType === "cff") {
      // CFF fonts: cubic bezier points are in current.x1, current.x2, next.x, next.y
      // But the control point order might be different
      P0 = { x: current.x, y: current.y };
      P1 = { x: current.x1, y: current.y1 };
      P2 = { x: current.x2, y: current.y2 };
      P3 = { x: next.x, y: next.y };

      // Debug CFF cubic curves
      console.log(
        `CFF Cubic: P0(${P0.x.toFixed(1)},${P0.y.toFixed(1)}) P1(${P1.x.toFixed(
          1
        )},${P1.y.toFixed(1)}) P2(${P2.x.toFixed(1)},${P2.y.toFixed(
          1
        )}) P3(${P3.x.toFixed(1)},${P3.y.toFixed(1)})`
      );
    } else {
      // TrueType fonts: standard cubic bezier handling
      P0 = { x: current.x, y: current.y };
      P1 = { x: current.x1, y: current.y1 };
      P2 = { x: current.x2, y: current.y2 };
      P3 = { x: next.x, y: next.y };
    }

    // Check if this is actually a straight line first
    if (this.isCubicLinear(P0, P1, P2, P3)) {
      console.log(`Cubic bezier detected as linear, using line segment`);
      return {
        type: "linear",
        start: P0,
        control: { x: (P0.x + P3.x) / 2, y: (P0.y + P3.y) / 2 }, // Midpoint for shader
        end: P3,
      };
    }

    // Check if this is actually a degenerate quadratic
    const midpoint = {
      x: (P1.x + P2.x) / 2,
      y: (P1.y + P2.y) / 2,
    };

    // Use optimal quadratic approximation
    // Q1 = (3*P1 + 3*P2 - P0 - P3) / 4
    const control = {
      x: (3 * P1.x + 3 * P2.x - P0.x - P3.x) / 4,
      y: (3 * P1.y + 3 * P2.y - P0.y - P3.y) / 4,
    };

    // Fallback to midpoint if control point is invalid
    if (!isFinite(control.x) || !isFinite(control.y)) {
      control.x = midpoint.x;
      control.y = midpoint.y;
    }

    // Advanced validation and correction for CFF fonts
    if (this.fontType === "cff") {
      // Check if the optimal control point is reasonable
      const distance = Math.sqrt(
        (control.x - midpoint.x) ** 2 + (control.y - midpoint.y) ** 2
      );

      // Check if control point is outside reasonable bounds
      const segmentLength = Math.sqrt((P3.x - P0.x) ** 2 + (P3.y - P0.y) ** 2);
      const maxReasonableDeviation = segmentLength * 0.5; // 50% of segment length

      if (
        distance > maxReasonableDeviation ||
        !isFinite(control.x) ||
        !isFinite(control.y)
      ) {
        console.warn(
          `⚠️ CFF cubic-to-quad: unreasonable control point, distance=${distance.toFixed(
            1
          )}, segment=${segmentLength.toFixed(1)}`
        );

        // Try multiple alternative approaches
        const alternatives = [
          // Simple midpoint of control points
          { x: (P1.x + P2.x) / 2, y: (P1.y + P2.y) / 2, name: "midpoint" },

          // Weighted toward P1 (common in font design)
          {
            x: P1.x * 0.75 + P2.x * 0.25,
            y: P1.y * 0.75 + P2.y * 0.25,
            name: "P1-weighted",
          },

          // Weighted toward P2
          {
            x: P1.x * 0.25 + P2.x * 0.75,
            y: P1.y * 0.25 + P2.y * 0.75,
            name: "P2-weighted",
          },

          // Point on line segment P0-P3 at 1/3
          {
            x: P0.x + (P3.x - P0.x) * 0.33,
            y: P0.y + (P3.y - P0.y) * 0.33,
            name: "line-1/3",
          },

          // Point on line segment P0-P3 at 2/3
          {
            x: P0.x + (P3.x - P0.x) * 0.67,
            y: P0.y + (P3.y - P0.y) * 0.67,
            name: "line-2/3",
          },
        ];

        // Choose the alternative closest to the original cubic curve behavior
        let bestAlt = alternatives[0];
        let bestScore = Infinity;

        for (const alt of alternatives) {
          // Score based on distance from midpoint and finiteness
          const altDistance = Math.sqrt(
            (alt.x - midpoint.x) ** 2 + (alt.y - midpoint.y) ** 2
          );
          const score =
            isFinite(alt.x) && isFinite(alt.y) ? altDistance : Infinity;

          if (score < bestScore) {
            bestScore = score;
            bestAlt = alt;
          }
        }

        console.log(
          `   Using ${bestAlt.name} alternative: (${bestAlt.x.toFixed(
            1
          )},${bestAlt.y.toFixed(1)})`
        );

        return {
          type: "quadratic",
          start: P0,
          control: { x: bestAlt.x, y: bestAlt.y },
          end: P3,
        };
      }
    }

    return {
      type: "quadratic",
      start: P0,
      control: control,
      end: P3,
    };
  }

  /**
   * Create a linear segment (represented as degenerate quadratic)
   * @private
   */
  createLinearSegment(start, end) {
    const control = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
    return {
      type: "linear",
      start: { x: start.x, y: start.y },
      control: control,
      end: { x: end.x, y: end.y },
    };
  }

  /**
   * Calculate signed area for contour classification
   * @private
   */
  calculateWindingOrder(contour) {
    let area = 0;
    for (let i = 0; i < contour.length; i++) {
      const current = contour[i];
      const next = contour[(i + 1) % contour.length];
      area += (next.x - current.x) * (next.y + current.y);
    }
    return area; // Return raw signed area for classification
  }

  /**
   * Classify contours as outer shapes vs holes based on area
   * @private
   */
  classifyContours(contours) {
    // Calculate areas and sort by absolute area (largest first)
    const contourData = contours
      .map((contour, index) => ({
        index,
        area: this.calculateWindingOrder(contour),
        absArea: Math.abs(this.calculateWindingOrder(contour)),
      }))
      .sort((a, b) => b.absArea - a.absArea);

    // Classify: largest contour is outer, others are holes
    return contourData.map((data, sortedIndex) => ({
      ...data,
      isOuter: sortedIndex === 0, // First (largest) is outer shape
    }));
  }

  /**
   * Calculate bounds for the entire glyph
   * @private
   */
  calculateBounds(contours) {
    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;

    for (const contour of contours) {
      for (const point of contour) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);

        if (point.cubic) {
          minX = Math.min(minX, point.x1, point.x2);
          minY = Math.min(minY, point.y1, point.y2);
          maxX = Math.max(maxX, point.x1, point.x2);
          maxY = Math.max(maxY, point.y1, point.y2);
        }
      }
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

  /**
   * Create empty SDF data for missing glyphs
   * @private
   */
  createEmptySDFData() {
    return {
      contours: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      character: "",
      glyphId: 0,
    };
  }

  /**
   * Convert SDF data to shader-ready format
   * @param {Object} sdfData - SDF data from extractSDFData
   * @returns {Object} Shader uniform data
   */
  prepareShaderData(sdfData) {
    const maxSegments = this.maxBezierSegments;
    const maxContours = this.maxContours;

    // Flatten all segments into arrays for shader uniforms (WebGL 1.0 compatible)
    const segmentData = {
      // Bezier control points - flattened to single array for WebGL 1.0
      controlPoints: new Float32Array(maxSegments * 6), // 3 points * 2 coords per segment
      // Contour data - flattened
      contourInfo: new Float32Array(maxContours * 3), // segmentStart, segmentCount, windingOrder
      // Bounds - already Y-flipped in extractSDFData
      bounds: new Float32Array([
        sdfData.bounds.minX,
        sdfData.bounds.minY,
        sdfData.bounds.maxX,
        sdfData.bounds.maxY,
      ]),
      // Counts
      totalSegments: 0,
      totalContours: Math.min(sdfData.contours.length, maxContours),
    };

    let segmentIndex = 0;

    // Process each contour (limit to maxContours)
    for (
      let contourIdx = 0;
      contourIdx < Math.min(sdfData.contours.length, maxContours);
      contourIdx++
    ) {
      const contour = sdfData.contours[contourIdx];
      const segmentStart = segmentIndex;
      const segmentCount = Math.min(
        contour.segments.length,
        maxSegments - segmentIndex
      );

      // Store contour info
      segmentData.contourInfo[contourIdx * 3] = segmentStart;
      segmentData.contourInfo[contourIdx * 3 + 1] = segmentCount;
      segmentData.contourInfo[contourIdx * 3 + 2] = contour.windingOrder;

      // Process segments in this contour
      for (let i = 0; i < segmentCount; i++) {
        const segment = contour.segments[i];

        // Store control points in flattened array with Y-flip for proper orientation
        const pointOffset = segmentIndex * 6;
        segmentData.controlPoints[pointOffset] = segment.start.x;
        segmentData.controlPoints[pointOffset + 1] = -segment.start.y; // Flip Y
        segmentData.controlPoints[pointOffset + 2] = segment.control.x;
        segmentData.controlPoints[pointOffset + 3] = -segment.control.y; // Flip Y
        segmentData.controlPoints[pointOffset + 4] = segment.end.x;
        segmentData.controlPoints[pointOffset + 5] = -segment.end.y; // Flip Y

        segmentIndex++;
        if (segmentIndex >= maxSegments) break;
      }

      if (segmentIndex >= maxSegments) break;
    }

    segmentData.totalSegments = segmentIndex;
    return segmentData;
  }

  /**
   * Generate GLSL shader code for SDF calculation
   * @returns {string} GLSL shader fragment code
   */
  generateShaderCode() {
    return `
            precision highp float;
            
            // Configuration - increased for complex variable font characters
            #define MAX_SEGMENTS 128
            #define MAX_CONTOURS 8
            
            // Uniforms - increased for complex variable font characters
            uniform float u_controlPoints[768]; // MAX_SEGMENTS * 3 * 2 = 128 * 3 * 2 = 768
            uniform float u_contourInfo[24]; // MAX_CONTOURS * 3 = 8 * 3 = 24
            uniform vec4 u_bounds; // minX, minY, maxX, maxY
            uniform int u_totalSegments;
            uniform int u_totalContours;
            
            // Utility functions
            float dot2(vec2 v) { 
                return dot(v, v); 
            }
            
            // Get control point from flattened array - WebGL 1.0 compatible
            vec2 getControlPoint(int index) {
                // Use constant lookups for WebGL 1.0 compatibility
                if (index == 0) return vec2(u_controlPoints[0], u_controlPoints[1]);
                if (index == 1) return vec2(u_controlPoints[2], u_controlPoints[3]);
                if (index == 2) return vec2(u_controlPoints[4], u_controlPoints[5]);
                if (index == 3) return vec2(u_controlPoints[6], u_controlPoints[7]);
                if (index == 4) return vec2(u_controlPoints[8], u_controlPoints[9]);
                if (index == 5) return vec2(u_controlPoints[10], u_controlPoints[11]);
                if (index == 6) return vec2(u_controlPoints[12], u_controlPoints[13]);
                if (index == 7) return vec2(u_controlPoints[14], u_controlPoints[15]);
                if (index == 8) return vec2(u_controlPoints[16], u_controlPoints[17]);
                if (index == 9) return vec2(u_controlPoints[18], u_controlPoints[19]);
                if (index == 10) return vec2(u_controlPoints[20], u_controlPoints[21]);
                if (index == 11) return vec2(u_controlPoints[22], u_controlPoints[23]);
                if (index == 12) return vec2(u_controlPoints[24], u_controlPoints[25]);
                if (index == 13) return vec2(u_controlPoints[26], u_controlPoints[27]);
                if (index == 14) return vec2(u_controlPoints[28], u_controlPoints[29]);
                if (index == 15) return vec2(u_controlPoints[30], u_controlPoints[31]);
                if (index == 16) return vec2(u_controlPoints[32], u_controlPoints[33]);
                if (index == 17) return vec2(u_controlPoints[34], u_controlPoints[35]);
                if (index == 18) return vec2(u_controlPoints[36], u_controlPoints[37]);
                if (index == 19) return vec2(u_controlPoints[38], u_controlPoints[39]);
                if (index == 20) return vec2(u_controlPoints[40], u_controlPoints[41]);
                if (index == 21) return vec2(u_controlPoints[42], u_controlPoints[43]);
                if (index == 22) return vec2(u_controlPoints[44], u_controlPoints[45]);
                if (index == 23) return vec2(u_controlPoints[46], u_controlPoints[47]);
                if (index == 24) return vec2(u_controlPoints[48], u_controlPoints[49]);
                if (index == 25) return vec2(u_controlPoints[50], u_controlPoints[51]);
                if (index == 26) return vec2(u_controlPoints[52], u_controlPoints[53]);
                if (index == 27) return vec2(u_controlPoints[54], u_controlPoints[55]);
                if (index == 28) return vec2(u_controlPoints[56], u_controlPoints[57]);
                if (index == 29) return vec2(u_controlPoints[58], u_controlPoints[59]);
                if (index == 30) return vec2(u_controlPoints[60], u_controlPoints[61]);
                if (index == 31) return vec2(u_controlPoints[62], u_controlPoints[63]);
                if (index == 32) return vec2(u_controlPoints[64], u_controlPoints[65]);
                if (index == 33) return vec2(u_controlPoints[66], u_controlPoints[67]);
                if (index == 34) return vec2(u_controlPoints[68], u_controlPoints[69]);
                if (index == 35) return vec2(u_controlPoints[70], u_controlPoints[71]);
                if (index == 36) return vec2(u_controlPoints[72], u_controlPoints[73]);
                if (index == 37) return vec2(u_controlPoints[74], u_controlPoints[75]);
                if (index == 38) return vec2(u_controlPoints[76], u_controlPoints[77]);
                if (index == 39) return vec2(u_controlPoints[78], u_controlPoints[79]);
                if (index == 40) return vec2(u_controlPoints[80], u_controlPoints[81]);
                if (index == 41) return vec2(u_controlPoints[82], u_controlPoints[83]);
                if (index == 42) return vec2(u_controlPoints[84], u_controlPoints[85]);
                if (index == 43) return vec2(u_controlPoints[86], u_controlPoints[87]);
                if (index == 44) return vec2(u_controlPoints[88], u_controlPoints[89]);
                if (index == 45) return vec2(u_controlPoints[90], u_controlPoints[91]);
                if (index == 46) return vec2(u_controlPoints[92], u_controlPoints[93]);
                if (index == 47) return vec2(u_controlPoints[94], u_controlPoints[95]);
                if (index == 48) return vec2(u_controlPoints[96], u_controlPoints[97]);
                if (index == 49) return vec2(u_controlPoints[98], u_controlPoints[99]);
                if (index == 50) return vec2(u_controlPoints[100], u_controlPoints[101]);
                if (index == 51) return vec2(u_controlPoints[102], u_controlPoints[103]);
                if (index == 52) return vec2(u_controlPoints[104], u_controlPoints[105]);
                if (index == 53) return vec2(u_controlPoints[106], u_controlPoints[107]);
                if (index == 54) return vec2(u_controlPoints[108], u_controlPoints[109]);
                if (index == 55) return vec2(u_controlPoints[110], u_controlPoints[111]);
                if (index == 56) return vec2(u_controlPoints[112], u_controlPoints[113]);
                if (index == 57) return vec2(u_controlPoints[114], u_controlPoints[115]);
                if (index == 58) return vec2(u_controlPoints[116], u_controlPoints[117]);
                if (index == 59) return vec2(u_controlPoints[118], u_controlPoints[119]);
                if (index == 60) return vec2(u_controlPoints[120], u_controlPoints[121]);
                if (index == 61) return vec2(u_controlPoints[122], u_controlPoints[123]);
                if (index == 62) return vec2(u_controlPoints[124], u_controlPoints[125]);
                if (index == 63) return vec2(u_controlPoints[126], u_controlPoints[127]);
                if (index == 64) return vec2(u_controlPoints[128], u_controlPoints[129]);
                if (index == 65) return vec2(u_controlPoints[130], u_controlPoints[131]);
                if (index == 66) return vec2(u_controlPoints[132], u_controlPoints[133]);
                if (index == 67) return vec2(u_controlPoints[134], u_controlPoints[135]);
                if (index == 68) return vec2(u_controlPoints[136], u_controlPoints[137]);
                if (index == 69) return vec2(u_controlPoints[138], u_controlPoints[139]);
                if (index == 70) return vec2(u_controlPoints[140], u_controlPoints[141]);
                if (index == 71) return vec2(u_controlPoints[142], u_controlPoints[143]);
                if (index == 72) return vec2(u_controlPoints[144], u_controlPoints[145]);
                if (index == 73) return vec2(u_controlPoints[146], u_controlPoints[147]);
                if (index == 74) return vec2(u_controlPoints[148], u_controlPoints[149]);
                if (index == 75) return vec2(u_controlPoints[150], u_controlPoints[151]);
                if (index == 76) return vec2(u_controlPoints[152], u_controlPoints[153]);
                if (index == 77) return vec2(u_controlPoints[154], u_controlPoints[155]);
                if (index == 78) return vec2(u_controlPoints[156], u_controlPoints[157]);
                if (index == 79) return vec2(u_controlPoints[158], u_controlPoints[159]);
                if (index == 80) return vec2(u_controlPoints[160], u_controlPoints[161]);
                if (index == 81) return vec2(u_controlPoints[162], u_controlPoints[163]);
                if (index == 82) return vec2(u_controlPoints[164], u_controlPoints[165]);
                if (index == 83) return vec2(u_controlPoints[166], u_controlPoints[167]);
                if (index == 84) return vec2(u_controlPoints[168], u_controlPoints[169]);
                if (index == 85) return vec2(u_controlPoints[170], u_controlPoints[171]);
                if (index == 86) return vec2(u_controlPoints[172], u_controlPoints[173]);
                if (index == 87) return vec2(u_controlPoints[174], u_controlPoints[175]);
                if (index == 88) return vec2(u_controlPoints[176], u_controlPoints[177]);
                if (index == 89) return vec2(u_controlPoints[178], u_controlPoints[179]);
                if (index == 90) return vec2(u_controlPoints[180], u_controlPoints[181]);
                if (index == 91) return vec2(u_controlPoints[182], u_controlPoints[183]);
                if (index == 92) return vec2(u_controlPoints[184], u_controlPoints[185]);
                if (index == 93) return vec2(u_controlPoints[186], u_controlPoints[187]);
                if (index == 94) return vec2(u_controlPoints[188], u_controlPoints[189]);
                if (index == 95) return vec2(u_controlPoints[190], u_controlPoints[191]);
                if (index == 96) return vec2(u_controlPoints[192], u_controlPoints[193]);
                if (index == 97) return vec2(u_controlPoints[194], u_controlPoints[195]);
                if (index == 98) return vec2(u_controlPoints[196], u_controlPoints[197]);
                if (index == 99) return vec2(u_controlPoints[198], u_controlPoints[199]);
                if (index == 100) return vec2(u_controlPoints[200], u_controlPoints[201]);
                if (index == 101) return vec2(u_controlPoints[202], u_controlPoints[203]);
                if (index == 102) return vec2(u_controlPoints[204], u_controlPoints[205]);
                if (index == 103) return vec2(u_controlPoints[206], u_controlPoints[207]);
                if (index == 104) return vec2(u_controlPoints[208], u_controlPoints[209]);
                if (index == 105) return vec2(u_controlPoints[210], u_controlPoints[211]);
                if (index == 106) return vec2(u_controlPoints[212], u_controlPoints[213]);
                if (index == 107) return vec2(u_controlPoints[214], u_controlPoints[215]);
                if (index == 108) return vec2(u_controlPoints[216], u_controlPoints[217]);
                if (index == 109) return vec2(u_controlPoints[218], u_controlPoints[219]);
                if (index == 110) return vec2(u_controlPoints[220], u_controlPoints[221]);
                if (index == 111) return vec2(u_controlPoints[222], u_controlPoints[223]);
                if (index == 112) return vec2(u_controlPoints[224], u_controlPoints[225]);
                if (index == 113) return vec2(u_controlPoints[226], u_controlPoints[227]);
                if (index == 114) return vec2(u_controlPoints[228], u_controlPoints[229]);
                if (index == 115) return vec2(u_controlPoints[230], u_controlPoints[231]);
                if (index == 116) return vec2(u_controlPoints[232], u_controlPoints[233]);
                if (index == 117) return vec2(u_controlPoints[234], u_controlPoints[235]);
                if (index == 118) return vec2(u_controlPoints[236], u_controlPoints[237]);
                if (index == 119) return vec2(u_controlPoints[238], u_controlPoints[239]);
                if (index == 120) return vec2(u_controlPoints[240], u_controlPoints[241]);
                if (index == 121) return vec2(u_controlPoints[242], u_controlPoints[243]);
                if (index == 122) return vec2(u_controlPoints[244], u_controlPoints[245]);
                if (index == 123) return vec2(u_controlPoints[246], u_controlPoints[247]);
                if (index == 124) return vec2(u_controlPoints[248], u_controlPoints[249]);
                if (index == 125) return vec2(u_controlPoints[250], u_controlPoints[251]);
                if (index == 126) return vec2(u_controlPoints[252], u_controlPoints[253]);
                if (index == 127) return vec2(u_controlPoints[254], u_controlPoints[255]);
                if (index == 128) return vec2(u_controlPoints[256], u_controlPoints[257]);
                if (index == 129) return vec2(u_controlPoints[258], u_controlPoints[259]);
                if (index == 130) return vec2(u_controlPoints[260], u_controlPoints[261]);
                if (index == 131) return vec2(u_controlPoints[262], u_controlPoints[263]);
                if (index == 132) return vec2(u_controlPoints[264], u_controlPoints[265]);
                if (index == 133) return vec2(u_controlPoints[266], u_controlPoints[267]);
                if (index == 134) return vec2(u_controlPoints[268], u_controlPoints[269]);
                if (index == 135) return vec2(u_controlPoints[270], u_controlPoints[271]);
                if (index == 136) return vec2(u_controlPoints[272], u_controlPoints[273]);
                if (index == 137) return vec2(u_controlPoints[274], u_controlPoints[275]);
                if (index == 138) return vec2(u_controlPoints[276], u_controlPoints[277]);
                if (index == 139) return vec2(u_controlPoints[278], u_controlPoints[279]);
                if (index == 140) return vec2(u_controlPoints[280], u_controlPoints[281]);
                if (index == 141) return vec2(u_controlPoints[282], u_controlPoints[283]);
                if (index == 142) return vec2(u_controlPoints[284], u_controlPoints[285]);
                if (index == 143) return vec2(u_controlPoints[286], u_controlPoints[287]);
                if (index == 144) return vec2(u_controlPoints[288], u_controlPoints[289]);
                if (index == 145) return vec2(u_controlPoints[290], u_controlPoints[291]);
                if (index == 146) return vec2(u_controlPoints[292], u_controlPoints[293]);
                if (index == 147) return vec2(u_controlPoints[294], u_controlPoints[295]);
                if (index == 148) return vec2(u_controlPoints[296], u_controlPoints[297]);
                if (index == 149) return vec2(u_controlPoints[298], u_controlPoints[299]);
                if (index == 150) return vec2(u_controlPoints[300], u_controlPoints[301]);
                if (index == 151) return vec2(u_controlPoints[302], u_controlPoints[303]);
                if (index == 152) return vec2(u_controlPoints[304], u_controlPoints[305]);
                if (index == 153) return vec2(u_controlPoints[306], u_controlPoints[307]);
                if (index == 154) return vec2(u_controlPoints[308], u_controlPoints[309]);
                if (index == 155) return vec2(u_controlPoints[310], u_controlPoints[311]);
                if (index == 156) return vec2(u_controlPoints[312], u_controlPoints[313]);
                if (index == 157) return vec2(u_controlPoints[314], u_controlPoints[315]);
                if (index == 158) return vec2(u_controlPoints[316], u_controlPoints[317]);
                if (index == 159) return vec2(u_controlPoints[318], u_controlPoints[319]);
                if (index == 160) return vec2(u_controlPoints[320], u_controlPoints[321]);
                if (index == 161) return vec2(u_controlPoints[322], u_controlPoints[323]);
                if (index == 162) return vec2(u_controlPoints[324], u_controlPoints[325]);
                if (index == 163) return vec2(u_controlPoints[326], u_controlPoints[327]);
                if (index == 164) return vec2(u_controlPoints[328], u_controlPoints[329]);
                if (index == 165) return vec2(u_controlPoints[330], u_controlPoints[331]);
                if (index == 166) return vec2(u_controlPoints[332], u_controlPoints[333]);
                if (index == 167) return vec2(u_controlPoints[334], u_controlPoints[335]);
                if (index == 168) return vec2(u_controlPoints[336], u_controlPoints[337]);
                if (index == 169) return vec2(u_controlPoints[338], u_controlPoints[339]);
                if (index == 170) return vec2(u_controlPoints[340], u_controlPoints[341]);
                if (index == 171) return vec2(u_controlPoints[342], u_controlPoints[343]);
                if (index == 172) return vec2(u_controlPoints[344], u_controlPoints[345]);
                if (index == 173) return vec2(u_controlPoints[346], u_controlPoints[347]);
                if (index == 174) return vec2(u_controlPoints[348], u_controlPoints[349]);
                if (index == 175) return vec2(u_controlPoints[350], u_controlPoints[351]);
                if (index == 176) return vec2(u_controlPoints[352], u_controlPoints[353]);
                if (index == 177) return vec2(u_controlPoints[354], u_controlPoints[355]);
                if (index == 178) return vec2(u_controlPoints[356], u_controlPoints[357]);
                if (index == 179) return vec2(u_controlPoints[358], u_controlPoints[359]);
                if (index == 180) return vec2(u_controlPoints[360], u_controlPoints[361]);
                if (index == 181) return vec2(u_controlPoints[362], u_controlPoints[363]);
                if (index == 182) return vec2(u_controlPoints[364], u_controlPoints[365]);
                if (index == 183) return vec2(u_controlPoints[366], u_controlPoints[367]);
                if (index == 184) return vec2(u_controlPoints[368], u_controlPoints[369]);
                if (index == 185) return vec2(u_controlPoints[370], u_controlPoints[371]);
                if (index == 186) return vec2(u_controlPoints[372], u_controlPoints[373]);
                if (index == 187) return vec2(u_controlPoints[374], u_controlPoints[375]);
                if (index == 188) return vec2(u_controlPoints[376], u_controlPoints[377]);
                if (index == 189) return vec2(u_controlPoints[378], u_controlPoints[379]);
                if (index == 190) return vec2(u_controlPoints[380], u_controlPoints[381]);
                if (index == 191) return vec2(u_controlPoints[382], u_controlPoints[383]);
                // Extended for 128 segments (indices 192-383)
                if (index == 192) return vec2(u_controlPoints[384], u_controlPoints[385]);
                if (index == 193) return vec2(u_controlPoints[386], u_controlPoints[387]);
                if (index == 194) return vec2(u_controlPoints[388], u_controlPoints[389]);
                if (index == 195) return vec2(u_controlPoints[390], u_controlPoints[391]);
                if (index == 196) return vec2(u_controlPoints[392], u_controlPoints[393]);
                if (index == 197) return vec2(u_controlPoints[394], u_controlPoints[395]);
                if (index == 198) return vec2(u_controlPoints[396], u_controlPoints[397]);
                if (index == 199) return vec2(u_controlPoints[398], u_controlPoints[399]);
                if (index == 200) return vec2(u_controlPoints[400], u_controlPoints[401]);
                if (index == 201) return vec2(u_controlPoints[402], u_controlPoints[403]);
                if (index == 202) return vec2(u_controlPoints[404], u_controlPoints[405]);
                if (index == 203) return vec2(u_controlPoints[406], u_controlPoints[407]);
                if (index == 204) return vec2(u_controlPoints[408], u_controlPoints[409]);
                if (index == 205) return vec2(u_controlPoints[410], u_controlPoints[411]);
                if (index == 206) return vec2(u_controlPoints[412], u_controlPoints[413]);
                if (index == 207) return vec2(u_controlPoints[414], u_controlPoints[415]);
                if (index == 208) return vec2(u_controlPoints[416], u_controlPoints[417]);
                if (index == 209) return vec2(u_controlPoints[418], u_controlPoints[419]);
                if (index == 210) return vec2(u_controlPoints[420], u_controlPoints[421]);
                if (index == 211) return vec2(u_controlPoints[422], u_controlPoints[423]);
                if (index == 212) return vec2(u_controlPoints[424], u_controlPoints[425]);
                if (index == 213) return vec2(u_controlPoints[426], u_controlPoints[427]);
                if (index == 214) return vec2(u_controlPoints[428], u_controlPoints[429]);
                if (index == 215) return vec2(u_controlPoints[430], u_controlPoints[431]);
                if (index == 216) return vec2(u_controlPoints[432], u_controlPoints[433]);
                if (index == 217) return vec2(u_controlPoints[434], u_controlPoints[435]);
                if (index == 218) return vec2(u_controlPoints[436], u_controlPoints[437]);
                if (index == 219) return vec2(u_controlPoints[438], u_controlPoints[439]);
                if (index == 220) return vec2(u_controlPoints[440], u_controlPoints[441]);
                if (index == 221) return vec2(u_controlPoints[442], u_controlPoints[443]);
                if (index == 222) return vec2(u_controlPoints[444], u_controlPoints[445]);
                if (index == 223) return vec2(u_controlPoints[446], u_controlPoints[447]);
                if (index == 224) return vec2(u_controlPoints[448], u_controlPoints[449]);
                if (index == 225) return vec2(u_controlPoints[450], u_controlPoints[451]);
                if (index == 226) return vec2(u_controlPoints[452], u_controlPoints[453]);
                if (index == 227) return vec2(u_controlPoints[454], u_controlPoints[455]);
                if (index == 228) return vec2(u_controlPoints[456], u_controlPoints[457]);
                if (index == 229) return vec2(u_controlPoints[458], u_controlPoints[459]);
                if (index == 230) return vec2(u_controlPoints[460], u_controlPoints[461]);
                if (index == 231) return vec2(u_controlPoints[462], u_controlPoints[463]);
                if (index == 232) return vec2(u_controlPoints[464], u_controlPoints[465]);
                if (index == 233) return vec2(u_controlPoints[466], u_controlPoints[467]);
                if (index == 234) return vec2(u_controlPoints[468], u_controlPoints[469]);
                if (index == 235) return vec2(u_controlPoints[470], u_controlPoints[471]);
                if (index == 236) return vec2(u_controlPoints[472], u_controlPoints[473]);
                if (index == 237) return vec2(u_controlPoints[474], u_controlPoints[475]);
                if (index == 238) return vec2(u_controlPoints[476], u_controlPoints[477]);
                if (index == 239) return vec2(u_controlPoints[478], u_controlPoints[479]);
                if (index == 240) return vec2(u_controlPoints[480], u_controlPoints[481]);
                if (index == 241) return vec2(u_controlPoints[482], u_controlPoints[483]);
                if (index == 242) return vec2(u_controlPoints[484], u_controlPoints[485]);
                if (index == 243) return vec2(u_controlPoints[486], u_controlPoints[487]);
                if (index == 244) return vec2(u_controlPoints[488], u_controlPoints[489]);
                if (index == 245) return vec2(u_controlPoints[490], u_controlPoints[491]);
                if (index == 246) return vec2(u_controlPoints[492], u_controlPoints[493]);
                if (index == 247) return vec2(u_controlPoints[494], u_controlPoints[495]);
                if (index == 248) return vec2(u_controlPoints[496], u_controlPoints[497]);
                if (index == 249) return vec2(u_controlPoints[498], u_controlPoints[499]);
                if (index == 250) return vec2(u_controlPoints[500], u_controlPoints[501]);
                if (index == 251) return vec2(u_controlPoints[502], u_controlPoints[503]);
                if (index == 252) return vec2(u_controlPoints[504], u_controlPoints[505]);
                if (index == 253) return vec2(u_controlPoints[506], u_controlPoints[507]);
                if (index == 254) return vec2(u_controlPoints[508], u_controlPoints[509]);
                if (index == 255) return vec2(u_controlPoints[510], u_controlPoints[511]);
                if (index == 256) return vec2(u_controlPoints[512], u_controlPoints[513]);
                if (index == 257) return vec2(u_controlPoints[514], u_controlPoints[515]);
                if (index == 258) return vec2(u_controlPoints[516], u_controlPoints[517]);
                if (index == 259) return vec2(u_controlPoints[518], u_controlPoints[519]);
                if (index == 260) return vec2(u_controlPoints[520], u_controlPoints[521]);
                if (index == 261) return vec2(u_controlPoints[522], u_controlPoints[523]);
                if (index == 262) return vec2(u_controlPoints[524], u_controlPoints[525]);
                if (index == 263) return vec2(u_controlPoints[526], u_controlPoints[527]);
                if (index == 264) return vec2(u_controlPoints[528], u_controlPoints[529]);
                if (index == 265) return vec2(u_controlPoints[530], u_controlPoints[531]);
                if (index == 266) return vec2(u_controlPoints[532], u_controlPoints[533]);
                if (index == 267) return vec2(u_controlPoints[534], u_controlPoints[535]);
                if (index == 268) return vec2(u_controlPoints[536], u_controlPoints[537]);
                if (index == 269) return vec2(u_controlPoints[538], u_controlPoints[539]);
                if (index == 270) return vec2(u_controlPoints[540], u_controlPoints[541]);
                if (index == 271) return vec2(u_controlPoints[542], u_controlPoints[543]);
                if (index == 272) return vec2(u_controlPoints[544], u_controlPoints[545]);
                if (index == 273) return vec2(u_controlPoints[546], u_controlPoints[547]);
                if (index == 274) return vec2(u_controlPoints[548], u_controlPoints[549]);
                if (index == 275) return vec2(u_controlPoints[550], u_controlPoints[551]);
                if (index == 276) return vec2(u_controlPoints[552], u_controlPoints[553]);
                if (index == 277) return vec2(u_controlPoints[554], u_controlPoints[555]);
                if (index == 278) return vec2(u_controlPoints[556], u_controlPoints[557]);
                if (index == 279) return vec2(u_controlPoints[558], u_controlPoints[559]);
                if (index == 280) return vec2(u_controlPoints[560], u_controlPoints[561]);
                if (index == 281) return vec2(u_controlPoints[562], u_controlPoints[563]);
                if (index == 282) return vec2(u_controlPoints[564], u_controlPoints[565]);
                if (index == 283) return vec2(u_controlPoints[566], u_controlPoints[567]);
                if (index == 284) return vec2(u_controlPoints[568], u_controlPoints[569]);
                if (index == 285) return vec2(u_controlPoints[570], u_controlPoints[571]);
                if (index == 286) return vec2(u_controlPoints[572], u_controlPoints[573]);
                if (index == 287) return vec2(u_controlPoints[574], u_controlPoints[575]);
                if (index == 288) return vec2(u_controlPoints[576], u_controlPoints[577]);
                if (index == 289) return vec2(u_controlPoints[578], u_controlPoints[579]);
                if (index == 290) return vec2(u_controlPoints[580], u_controlPoints[581]);
                if (index == 291) return vec2(u_controlPoints[582], u_controlPoints[583]);
                if (index == 292) return vec2(u_controlPoints[584], u_controlPoints[585]);
                if (index == 293) return vec2(u_controlPoints[586], u_controlPoints[587]);
                if (index == 294) return vec2(u_controlPoints[588], u_controlPoints[589]);
                if (index == 295) return vec2(u_controlPoints[590], u_controlPoints[591]);
                if (index == 296) return vec2(u_controlPoints[592], u_controlPoints[593]);
                if (index == 297) return vec2(u_controlPoints[594], u_controlPoints[595]);
                if (index == 298) return vec2(u_controlPoints[596], u_controlPoints[597]);
                if (index == 299) return vec2(u_controlPoints[598], u_controlPoints[599]);
                if (index == 300) return vec2(u_controlPoints[600], u_controlPoints[601]);
                if (index == 301) return vec2(u_controlPoints[602], u_controlPoints[603]);
                if (index == 302) return vec2(u_controlPoints[604], u_controlPoints[605]);
                if (index == 303) return vec2(u_controlPoints[606], u_controlPoints[607]);
                if (index == 304) return vec2(u_controlPoints[608], u_controlPoints[609]);
                if (index == 305) return vec2(u_controlPoints[610], u_controlPoints[611]);
                if (index == 306) return vec2(u_controlPoints[612], u_controlPoints[613]);
                if (index == 307) return vec2(u_controlPoints[614], u_controlPoints[615]);
                if (index == 308) return vec2(u_controlPoints[616], u_controlPoints[617]);
                if (index == 309) return vec2(u_controlPoints[618], u_controlPoints[619]);
                if (index == 310) return vec2(u_controlPoints[620], u_controlPoints[621]);
                if (index == 311) return vec2(u_controlPoints[622], u_controlPoints[623]);
                if (index == 312) return vec2(u_controlPoints[624], u_controlPoints[625]);
                if (index == 313) return vec2(u_controlPoints[626], u_controlPoints[627]);
                if (index == 314) return vec2(u_controlPoints[628], u_controlPoints[629]);
                if (index == 315) return vec2(u_controlPoints[630], u_controlPoints[631]);
                if (index == 316) return vec2(u_controlPoints[632], u_controlPoints[633]);
                if (index == 317) return vec2(u_controlPoints[634], u_controlPoints[635]);
                if (index == 318) return vec2(u_controlPoints[636], u_controlPoints[637]);
                if (index == 319) return vec2(u_controlPoints[638], u_controlPoints[639]);
                if (index == 320) return vec2(u_controlPoints[640], u_controlPoints[641]);
                if (index == 321) return vec2(u_controlPoints[642], u_controlPoints[643]);
                if (index == 322) return vec2(u_controlPoints[644], u_controlPoints[645]);
                if (index == 323) return vec2(u_controlPoints[646], u_controlPoints[647]);
                if (index == 324) return vec2(u_controlPoints[648], u_controlPoints[649]);
                if (index == 325) return vec2(u_controlPoints[650], u_controlPoints[651]);
                if (index == 326) return vec2(u_controlPoints[652], u_controlPoints[653]);
                if (index == 327) return vec2(u_controlPoints[654], u_controlPoints[655]);
                if (index == 328) return vec2(u_controlPoints[656], u_controlPoints[657]);
                if (index == 329) return vec2(u_controlPoints[658], u_controlPoints[659]);
                if (index == 330) return vec2(u_controlPoints[660], u_controlPoints[661]);
                if (index == 331) return vec2(u_controlPoints[662], u_controlPoints[663]);
                if (index == 332) return vec2(u_controlPoints[664], u_controlPoints[665]);
                if (index == 333) return vec2(u_controlPoints[666], u_controlPoints[667]);
                if (index == 334) return vec2(u_controlPoints[668], u_controlPoints[669]);
                if (index == 335) return vec2(u_controlPoints[670], u_controlPoints[671]);
                if (index == 336) return vec2(u_controlPoints[672], u_controlPoints[673]);
                if (index == 337) return vec2(u_controlPoints[674], u_controlPoints[675]);
                if (index == 338) return vec2(u_controlPoints[676], u_controlPoints[677]);
                if (index == 339) return vec2(u_controlPoints[678], u_controlPoints[679]);
                if (index == 340) return vec2(u_controlPoints[680], u_controlPoints[681]);
                if (index == 341) return vec2(u_controlPoints[682], u_controlPoints[683]);
                if (index == 342) return vec2(u_controlPoints[684], u_controlPoints[685]);
                if (index == 343) return vec2(u_controlPoints[686], u_controlPoints[687]);
                if (index == 344) return vec2(u_controlPoints[688], u_controlPoints[689]);
                if (index == 345) return vec2(u_controlPoints[690], u_controlPoints[691]);
                if (index == 346) return vec2(u_controlPoints[692], u_controlPoints[693]);
                if (index == 347) return vec2(u_controlPoints[694], u_controlPoints[695]);
                if (index == 348) return vec2(u_controlPoints[696], u_controlPoints[697]);
                if (index == 349) return vec2(u_controlPoints[698], u_controlPoints[699]);
                if (index == 350) return vec2(u_controlPoints[700], u_controlPoints[701]);
                if (index == 351) return vec2(u_controlPoints[702], u_controlPoints[703]);
                if (index == 352) return vec2(u_controlPoints[704], u_controlPoints[705]);
                if (index == 353) return vec2(u_controlPoints[706], u_controlPoints[707]);
                if (index == 354) return vec2(u_controlPoints[708], u_controlPoints[709]);
                if (index == 355) return vec2(u_controlPoints[710], u_controlPoints[711]);
                if (index == 356) return vec2(u_controlPoints[712], u_controlPoints[713]);
                if (index == 357) return vec2(u_controlPoints[714], u_controlPoints[715]);
                if (index == 358) return vec2(u_controlPoints[716], u_controlPoints[717]);
                if (index == 359) return vec2(u_controlPoints[718], u_controlPoints[719]);
                if (index == 360) return vec2(u_controlPoints[720], u_controlPoints[721]);
                if (index == 361) return vec2(u_controlPoints[722], u_controlPoints[723]);
                if (index == 362) return vec2(u_controlPoints[724], u_controlPoints[725]);
                if (index == 363) return vec2(u_controlPoints[726], u_controlPoints[727]);
                if (index == 364) return vec2(u_controlPoints[728], u_controlPoints[729]);
                if (index == 365) return vec2(u_controlPoints[730], u_controlPoints[731]);
                if (index == 366) return vec2(u_controlPoints[732], u_controlPoints[733]);
                if (index == 367) return vec2(u_controlPoints[734], u_controlPoints[735]);
                if (index == 368) return vec2(u_controlPoints[736], u_controlPoints[737]);
                if (index == 369) return vec2(u_controlPoints[738], u_controlPoints[739]);
                if (index == 370) return vec2(u_controlPoints[740], u_controlPoints[741]);
                if (index == 371) return vec2(u_controlPoints[742], u_controlPoints[743]);
                if (index == 372) return vec2(u_controlPoints[744], u_controlPoints[745]);
                if (index == 373) return vec2(u_controlPoints[746], u_controlPoints[747]);
                if (index == 374) return vec2(u_controlPoints[748], u_controlPoints[749]);
                if (index == 375) return vec2(u_controlPoints[750], u_controlPoints[751]);
                if (index == 376) return vec2(u_controlPoints[752], u_controlPoints[753]);
                if (index == 377) return vec2(u_controlPoints[754], u_controlPoints[755]);
                if (index == 378) return vec2(u_controlPoints[756], u_controlPoints[757]);
                if (index == 379) return vec2(u_controlPoints[758], u_controlPoints[759]);
                if (index == 380) return vec2(u_controlPoints[760], u_controlPoints[761]);
                if (index == 381) return vec2(u_controlPoints[762], u_controlPoints[763]);
                if (index == 382) return vec2(u_controlPoints[764], u_controlPoints[765]);
                if (index == 383) return vec2(u_controlPoints[766], u_controlPoints[767]);
                return vec2(0.0, 0.0); // fallback
            }
            
            // Bezier distance function (from your existing code)
            float bezierDistance(vec2 pos, vec2 A, vec2 B, vec2 C) {    
                vec2 a = B - A;
                vec2 b = A - 2.0*B + C;
                vec2 c = a * 2.0;
                vec2 d = A - pos;
                
                // Handle degenerate cases
                if (dot(b, b) < 0.0001) {
                    // Linear case
                    vec2 pa = pos - A;
                    vec2 ba = C - A;
                    float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                    return length(pa - ba * t);
                }
                
                float kk = 1.0/dot(b,b);
                float kx = kk * dot(a,b);
                float ky = kk * (2.0*dot(a,a)+dot(d,b)) / 3.0;
                float kz = kk * dot(d,a);      
                float res = 0.0;
                float p = ky - kx*kx;
                float p3 = p*p*p;
                float q = kx*(2.0*kx*kx-3.0*ky) + kz;
                float h = q*q + 4.0*p3;
                if (h >= 0.0) { 
                    h = sqrt(h);
                    vec2 x = (vec2(h,-h)-q)/2.0;
                    vec2 uv = sign(x)*pow(abs(x), vec2(1.0/3.0));
                    float t = clamp( uv.x+uv.y-kx, 0.0, 1.0 );
                    res = dot2(d + (c + b*t)*t);
                } else {
                    float z = sqrt(-p);
                    float v = acos( q/(p*z*2.0) ) / 3.0;
                    float m = cos(v);
                    float n = sin(v)*1.732050808;
                    vec3  t = clamp(vec3(m+m,-n-m,n-m)*z-kx,0.0,1.0);
                    res = min( dot2(d+(c+b*t.x)*t.x),
                                     dot2(d+(c+b*t.y)*t.y) );
                }
                return sqrt( res );
            }
            
            // Calculate exact winding contribution of a quadratic bezier curve
            float bezierWinding(vec2 pos, vec2 A, vec2 B, vec2 C) {
                // Translate curve so pos is at origin
                A -= pos;
                B -= pos;
                C -= pos;
                
                // Early exit if curve doesn't cross horizontal axis
                float minY = min(min(A.y, B.y), C.y);
                float maxY = max(max(A.y, B.y), C.y);
                if (maxY <= 0.0 || minY > 0.0) return 0.0;
                
                // Check if this is essentially a straight line
                // Distance from control point to line A-C
                vec2 AC = C - A;
                float lineLength = length(AC);
                if (lineLength < 1e-6) return 0.0; // Degenerate case
                
                // Project B onto line AC and find distance
                float t_proj = dot(B - A, AC) / dot(AC, AC);
                vec2 B_proj = A + t_proj * AC;
                float controlDist = length(B - B_proj);
                
                // If control point is very close to the line, treat as linear
                if (controlDist < 1.0) {
                    // Simple line segment winding
                    if ((A.y <= 0.0 && C.y > 0.0) || (A.y > 0.0 && C.y <= 0.0)) {
                        float t = -A.y / (C.y - A.y);
                        if (t >= 0.0 && t <= 1.0) {
                            float x = A.x + t * (C.x - A.x);
                            if (x > 0.0) {
                                return (C.y > A.y) ? 1.0 : -1.0;
                            }
                        }
                    }
                    return 0.0;
                }
                
                // True quadratic curve - solve for intersections
                // Quadratic bezier: P(t) = (1-t)²A + 2(1-t)tB + t²C
                // For y-component: (1-t)²A.y + 2(1-t)tB.y + t²C.y = 0
                // Expanding: A.y - 2t*A.y + t²*A.y + 2t*B.y - 2t²*B.y + t²*C.y = 0
                // Collecting: (A.y - 2B.y + C.y)t² + 2(B.y - A.y)t + A.y = 0
                
                float a = A.y - 2.0*B.y + C.y;
                float b = 2.0*(B.y - A.y);
                float c = A.y;
                
                float winding = 0.0;
                
                if (abs(a) < 1e-6) {
                    // Nearly linear case: solve bt + c = 0
                    if (abs(b) > 1e-6) {
                        float t = -c / b;
                        if (t >= 0.0 && t <= 1.0) {
                            // Calculate x-coordinate at intersection
                            float s = 1.0 - t;
                            float x = s*s*A.x + 2.0*s*t*B.x + t*t*C.x;
                            if (x > 0.0) {
                                // Determine direction from derivative dy/dt = 2s(B.y - A.y) + 2t(C.y - B.y)
                                float dydt = 2.0*(1.0-t)*(B.y - A.y) + 2.0*t*(C.y - B.y);
                                winding += (dydt > 0.0) ? 1.0 : -1.0;
                            }
                        }
                    }
                } else {
                    // Quadratic case: solve at² + bt + c = 0
                    float discriminant = b*b - 4.0*a*c;
                    if (discriminant >= 0.0) {
                        float sqrtDisc = sqrt(discriminant);
                        float t1 = (-b - sqrtDisc) / (2.0*a);
                        float t2 = (-b + sqrtDisc) / (2.0*a);
                        
                        // Check each root
                        for (int i = 0; i < 2; i++) {
                            float t = (i == 0) ? t1 : t2;
                            if (t >= 0.0 && t <= 1.0) {
                                // Calculate x-coordinate at intersection
                                float s = 1.0 - t;
                                float x = s*s*A.x + 2.0*s*t*B.x + t*t*C.x;
                                if (x > 0.0) {
                                    // Determine direction from derivative
                                    float dydt = 2.0*s*(B.y - A.y) + 2.0*t*(C.y - B.y);
                                    winding += (dydt > 0.0) ? 1.0 : -1.0;
                                }
                            }
                        }
                    }
                }
                
                return winding;
            }
            
            // Calculate if point is inside contour using proper winding number
            float isInsideContour(vec2 pos, float segmentStart, float segmentCount) {
                float winding = 0.0;
                
                for (int i = 0; i < 128; i++) {
                    if (float(i) >= segmentCount) break;
                    
                    int segmentIdx = int(segmentStart) + i;
                    if (segmentIdx >= u_totalSegments) break;
                    
                    vec2 A = getControlPoint(segmentIdx * 3);
                    vec2 B = getControlPoint(segmentIdx * 3 + 1);
                    vec2 C = getControlPoint(segmentIdx * 3 + 2);
                    
                    // Add winding contribution from this bezier segment
                    winding += bezierWinding(pos, A, B, C);
                }
                
                // Point is inside if winding number is non-zero (with tolerance)
                return abs(winding) > 0.5 ? 1.0 : 0.0;
            }
            
            // Calculate signed distance for font glyph - WebGL 1.0 compatible
            float fontSDF(vec2 pos) {
                float result = 1e6; // Start with "far outside"
                
                // Collect all contour distances and inside/outside states
                float contourDistances[8];
                float contourInside[8];
                float contourWindings[8];
                
                for (int contourIdx = 0; contourIdx < 8; contourIdx++) {
                    if (contourIdx >= u_totalContours) {
                        contourDistances[contourIdx] = 1e6;
                        contourInside[contourIdx] = 0.0;
                        contourWindings[contourIdx] = 1.0;
                        continue;
                    }
                    
                    // WebGL 1.0 compatible constant indexing
                    float segmentStart = 0.0;
                    float segmentCount = 0.0;
                    float windingOrder = 1.0;
                    
                    if (contourIdx == 0) {
                        segmentStart = u_contourInfo[0];
                        segmentCount = u_contourInfo[1];
                        windingOrder = u_contourInfo[2];
                    } else if (contourIdx == 1) {
                        segmentStart = u_contourInfo[3];
                        segmentCount = u_contourInfo[4];
                        windingOrder = u_contourInfo[5];
                    } else if (contourIdx == 2) {
                        segmentStart = u_contourInfo[6];
                        segmentCount = u_contourInfo[7];
                        windingOrder = u_contourInfo[8];
                    } else if (contourIdx == 3) {
                        segmentStart = u_contourInfo[9];
                        segmentCount = u_contourInfo[10];
                        windingOrder = u_contourInfo[11];
                    } else if (contourIdx == 4) {
                        segmentStart = u_contourInfo[12];
                        segmentCount = u_contourInfo[13];
                        windingOrder = u_contourInfo[14];
                    } else if (contourIdx == 5) {
                        segmentStart = u_contourInfo[15];
                        segmentCount = u_contourInfo[16];
                        windingOrder = u_contourInfo[17];
                    } else if (contourIdx == 6) {
                        segmentStart = u_contourInfo[18];
                        segmentCount = u_contourInfo[19];
                        windingOrder = u_contourInfo[20];
                    } else if (contourIdx == 7) {
                        segmentStart = u_contourInfo[21];
                        segmentCount = u_contourInfo[22];
                        windingOrder = u_contourInfo[23];
                    }
                    
                    // Find minimum distance to this contour
                    float contourMinDistance = 1e6;
                    for (int i = 0; i < 128; i++) {
                        if (float(i) >= segmentCount) break;
                        
                        int segmentIdx = int(segmentStart) + i;
                        if (segmentIdx >= u_totalSegments) break;
                        
                        vec2 A = getControlPoint(segmentIdx * 3);
                        vec2 B = getControlPoint(segmentIdx * 3 + 1);
                        vec2 C = getControlPoint(segmentIdx * 3 + 2);
                        
                        float dist = bezierDistance(pos, A, B, C);
                        contourMinDistance = min(contourMinDistance, dist);
                    }
                    
                    // Check if point is inside this contour
                    float inside = isInsideContour(pos, segmentStart, segmentCount);
                    
                    contourDistances[contourIdx] = contourMinDistance;
                    contourInside[contourIdx] = inside;
                    contourWindings[contourIdx] = windingOrder;
                }
                
                // Now apply the proper boolean operations
                // Start with the first outer contour
                bool foundOuter = false;
                for (int i = 0; i < 8; i++) {
                    if (i >= u_totalContours) break;
                    
                    if (contourWindings[i] > 0.0) { // Outer contour
                        float sdf = (contourInside[i] > 0.5) ? -contourDistances[i] : contourDistances[i];
                        if (!foundOuter) {
                            result = sdf;
                            foundOuter = true;
                        } else {
                            // Union with other outer contours
                            result = min(result, sdf);
                        }
                    }
                }
                
                // Then subtract holes
                for (int i = 0; i < 8; i++) {
                    if (i >= u_totalContours) break;
                    
                    if (contourWindings[i] < 0.0 && foundOuter) { // Hole contour
                        float holeSDF = (contourInside[i] > 0.5) ? -contourDistances[i] : contourDistances[i];
                        // SDF subtraction: max(base, -hole)
                        result = max(result, -holeSDF);
                    }
                }
                
                return result;
            }
        `;
  }
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = FontSDFRenderer;
} else if (typeof window !== "undefined") {
  window.FontSDFRenderer = FontSDFRenderer;
}
