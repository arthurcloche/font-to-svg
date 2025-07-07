/**
 * Font SDF Extension
 *
 * Provides SDF (Signed Distance Field) functionality as an extension
 * to the core FontParser without modifying or bloating it.
 *
 * This approach allows:
 * - Clean separation of concerns
 * - Independent SDF algorithm improvements
 * - Multiple SDF strategies
 * - Core parser remains untouched
 *
 * Usage:
 *   const parser = new FontParser();
 *   await parser.from('font.ttf');
 *   const sdfExt = new FontSDFExtension(parser);
 *   const sdfData = sdfExt.extractSDFData('A');
 */

/**
 * FontSDFExtension - Simple SVG-to-Bezier approach
 *
 * Instead of trying to extract bezier curves directly from font data,
 * this approach uses the font parser's proven SVG generation, then
 * converts the SVG path to bezier segments. This eliminates:
 * - Font type differences (TrueType vs CFF)
 * - Coordinate system issues
 * - Complex contour processing
 * - Winding order problems
 */
class FontSDFExtension {
  constructor(fontParser, options = {}) {
    this.fontParser = fontParser;
    this.maxBezierSegments = options.maxBezierSegments || 128; // Increased for complex variable font characters
    this.maxContours = options.maxContours || 8;
    this.enableDebugLogging = options.enableDebugLogging || false;

    // SVG path parser regex patterns
    this.pathCommandRegex =
      /([MmLlHhVvCcSsQqTtAaZz])((?:\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*,?\s*)*)/g;
    this.numberRegex = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  }

  /**
   * Extract SDF data by parsing SVG path from font parser
   */
  extractSDFData(character, options = {}) {
    const glyphId = this.fontParser.getGlyphId(character);

    // CRITICAL: Block known problematic glyphs that cause browser crashes
    const problematicGlyphs = [685, 686, 687, 689, 691, 692, 693, 719];
    if (problematicGlyphs.includes(glyphId)) {
      if (this.enableDebugLogging) {
        console.warn(`Blocking problematic glyph ${glyphId} (character "${character}") to prevent browser crash`);
      }
      return this.createEmptySDFData(character, glyphId);
    }

    if (this.enableDebugLogging) {
      console.log(`=== SVG-to-SDF EXTRACTION FOR "${character}" ===`);
      console.log(`Font Type: ${this.fontParser.fontType}`);
      console.log(`Glyph ID: ${glyphId}`);
    }

    // Apply variable font settings if provided
    if (options.variable && this.fontParser.data.isVariable) {
      this.fontParser.setVariation(options.variable);
      if (this.enableDebugLogging) {
        console.log(`Applied font variation:`, options.variable);
        console.log(`Current variation:`, this.fontParser.getVariation());
      }
    }

    // Get SVG path from font parser - use font-type-specific Y-flip
    // TrueType: needs flipY: true (native Y-up → SVG Y-down)
    // CFF: needs flipY: false (native Y-down → SVG Y-down, no flip)
    const flipY = this.fontParser.fontType === "truetype";
    
    let svgPath;
    try {
      svgPath = this.fontParser.glyphToSVGPath(character, {
        scale: 1,
        flipY: flipY,
        offsetX: 0,
        offsetY: 0,
      });
    } catch (svgError) {
      if (svgError.message.includes('stack') || svgError.message.includes('Maximum call stack')) {
        if (this.enableDebugLogging) {
          console.log(`Stack overflow in SVG generation for "${character}", returning empty`);
        }
        return this.createEmptySDFData(character, glyphId);
      }
      throw svgError; // Re-throw other errors
    }

    if (this.enableDebugLogging) {
      console.log(
        `Font-type-specific flipY: ${flipY} (${this.fontParser.fontType})`
      );
    }

    if (!svgPath) {
      return this.createEmptySDFData(character, glyphId);
    }

    if (this.enableDebugLogging) {
      console.log(
        `SVG Path: ${svgPath.substring(0, 100)}${
          svgPath.length > 100 ? "..." : ""
        }`
      );
    }

    // ROBUST EXTRACTION STRATEGY: Try direct bezier first, fallback to SVG
    let contours = [];

    try {
      // First attempt: Direct bezier extraction (most accurate)
      // Apply variable font settings before direct extraction
      if (options.variable && this.fontParser.data.isVariable) {
        this.fontParser.setVariation(options.variable);
        if (this.enableDebugLogging) {
          console.log(`Applied variation for direct extraction:`, options.variable);
        }
      }
      
      contours = this.extractFromDirectGlyph(character);
      
      if (this.enableDebugLogging) {
        console.log(`Direct bezier extraction: ${contours.length} contours`);
      }
      
      // If direct extraction fails or returns empty, fall back to SVG
      if (contours.length === 0) {
        if (this.enableDebugLogging) {
          console.log('Direct extraction returned no contours, falling back to SVG');
        }
        contours = this.parseSVGPath(svgPath);
      }
    } catch (directError) {
      if (this.enableDebugLogging) {
        console.log(`Direct extraction failed: ${directError.message}, using SVG fallback`);
      }
      contours = this.parseSVGPath(svgPath);
    }

    if (this.enableDebugLogging) {
      console.log(
        `${this.fontParser.fontType.toUpperCase()}: final extraction result: ${
          contours.length
        } contours`
      );
    }

    // Calculate bounds from the parsed contours
    const bounds = this.calculateBounds(contours);

    // Filter out tiny artifacts before hole detection
    const filteredContours = this.filterArtifacts(contours);
    
    // Apply proper hole detection for nested contours
    const contoursWithCorrectWinding = this.detectHoles(filteredContours);

    const sdfData = {
      contours: contoursWithCorrectWinding.slice(0, this.maxContours), // Limit contours
      bounds: bounds,
      character: character,
      glyphId: glyphId,
    };

    if (this.enableDebugLogging) {
      console.log(`Extracted ${sdfData.contours.length} contours`);
      sdfData.contours.forEach((contour, i) => {
        console.log(
          `  Contour ${i}: ${contour.segments.length} segments, winding: ${contour.windingOrder}`
        );
      });
      console.log(`=== END SVG-to-SDF EXTRACTION ===\n`);
    }

    return sdfData;
  }

  /**
   * Extract contours using direct glyph parsing (good for TrueType fonts)
   */
  extractFromDirectGlyph(character) {
    const glyphId = this.fontParser.getGlyphId(character);

    if (this.enableDebugLogging) {
      console.log(
        `Direct glyph extraction for "${character}" (glyphId: ${glyphId})`
      );
    }

    // Stack overflow protection for problematic glyphs
    let glyph;
    try {
      glyph = this.fontParser.parseGlyph(glyphId);
    } catch (error) {
      if (error.message.includes('stack') || error.message.includes('Maximum call stack')) {
        if (this.enableDebugLogging) {
          console.log(`Stack overflow detected for glyph ${glyphId}, skipping direct extraction`);
        }
        return []; // Return empty array to trigger SVG fallback
      }
      throw error; // Re-throw other errors
    }

    if (!glyph) {
      if (this.enableDebugLogging) {
        console.log(`No glyph data returned for glyphId ${glyphId}`);
      }
      return [];
    }

    if (!glyph.contours || glyph.contours.length === 0) {
      if (this.enableDebugLogging) {
        console.log(`Glyph has no contours: ${JSON.stringify(glyph)}`);
      }
      return [];
    }

    if (this.enableDebugLogging) {
      console.log(`Direct glyph: ${glyph.contours.length} raw contours`);
      console.log(
        `Glyph bounds: xMin=${glyph.xMin}, yMin=${glyph.yMin}, xMax=${glyph.xMax}, yMax=${glyph.yMax}`
      );
    }

    // Convert glyph contours to SDF format
    const sdfContours = [];

    for (
      let contourIndex = 0;
      contourIndex < glyph.contours.length && contourIndex < this.maxContours;
      contourIndex++
    ) {
      const contour = glyph.contours[contourIndex];
      if (contour.length === 0) {
        if (this.enableDebugLogging) {
          console.log(`Skipping empty contour ${contourIndex}`);
        }
        continue;
      }

      if (this.enableDebugLogging) {
        console.log(
          `Processing contour ${contourIndex} with ${contour.length} points`
        );
      }

      // Apply Y-flip for TrueType fonts to match SVG coordinate system
      const applyYFlip = this.fontParser.fontType === "truetype";
      const segments = this.convertGlyphContourToSegments(contour, applyYFlip);
      if (segments.length > 0) {
        const windingOrder = this.calculateWindingOrder(segments);
        sdfContours.push({
          index: contourIndex,
          segments: segments,
          segmentCount: segments.length,
          windingOrder: windingOrder,
        });

        if (this.enableDebugLogging) {
          console.log(
            `Contour ${contourIndex}: ${segments.length} segments, winding: ${windingOrder}`
          );
        }
      } else {
        if (this.enableDebugLogging) {
          console.log(`Contour ${contourIndex} produced no segments`);
        }
      }
    }

    if (this.enableDebugLogging) {
      console.log(`Direct extraction result: ${sdfContours.length} contours`);
    }

    return sdfContours;
  }

  /**
   * Convert a glyph contour (array of points) to bezier segments (using old renderer logic)
   */
  convertGlyphContourToSegments(contour, applyYFlip = false) {
    const segments = [];
    const points = [...contour];

    if (points.length === 0) {
      return segments;
    }

    // Helper function to transform coordinates based on font type
    const transformPoint = (point) => {
      if (applyYFlip) {
        return { x: point.x, y: -point.y, onCurve: point.onCurve };
      }
      return point;
    };

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

    let lastOnCurvePoint = transformPoint(rotatedPoints[0]);

    // Process all points in the contour, including the closing segment
    for (let i = 0; i < rotatedPoints.length; i++) {
      // Safety check to prevent infinite segments
      if (segments.length >= this.maxBezierSegments) {
        if (this.enableDebugLogging) {
          console.warn(
            `⚠️ SEGMENT LIMIT REACHED: ${this.maxBezierSegments} segments`
          );
        }
        break;
      }

      const current = transformPoint(rotatedPoints[i]);
      const next = transformPoint(rotatedPoints[(i + 1) % rotatedPoints.length]);

      if (current.cubic) {
        // Cubic bezier - convert to quadratic
        const segment = this.convertCubicToQuadratic(current, next);
        if (segment) {
          segments.push(segment);
        }
        lastOnCurvePoint = next.onCurve ? next : current;
      } else if (!current.onCurve && !next.onCurve) {
        // Two consecutive off-curve points - create implicit on-curve point
        const implicit = {
          x: (current.x + next.x) / 2,
          y: (current.y + next.y) / 2,
          onCurve: true,
        };
        const segment = {
          type: "quadratic",
          start: { x: lastOnCurvePoint.x, y: lastOnCurvePoint.y },
          control: { x: current.x, y: current.y },
          end: { x: implicit.x, y: implicit.y },
        };
        segments.push(segment);
        lastOnCurvePoint = implicit;
      } else if (!current.onCurve) {
        // Quadratic bezier
        const segment = {
          type: "quadratic",
          start: { x: lastOnCurvePoint.x, y: lastOnCurvePoint.y },
          control: { x: current.x, y: current.y },
          end: { x: next.x, y: next.y },
        };
        segments.push(segment);
        lastOnCurvePoint = next.onCurve ? next : current;
      } else if (current.onCurve && next.onCurve) {
        // Linear segment
        const segment = {
          type: "linear",
          start: { x: current.x, y: current.y },
          control: {
            x: (current.x + next.x) / 2,
            y: (current.y + next.y) / 2,
          },
          end: { x: next.x, y: next.y },
        };
        segments.push(segment);
        lastOnCurvePoint = next;
      } else if (current.onCurve) {
        // Update tracking point but don't create segment yet
        lastOnCurvePoint = current;
      }
    }

    if (this.enableDebugLogging) {
      console.log(`Converted contour to ${segments.length} segments`);
    }

    return segments;
  }

  /**
   * Convert cubic bezier to quadratic (from old renderer)
   */
  convertCubicToQuadratic(current, next) {
    const P0 = { x: current.x, y: current.y };
    const P1 = { x: current.x1, y: current.y1 };
    const P2 = { x: current.x2, y: current.y2 };
    const P3 = { x: next.x, y: next.y };

    // Use optimal quadratic approximation
    const control = {
      x: (3 * P1.x + 3 * P2.x - P0.x - P3.x) / 4,
      y: (3 * P1.y + 3 * P2.y - P0.y - P3.y) / 4,
    };

    // Fallback to midpoint if control point is invalid
    if (!isFinite(control.x) || !isFinite(control.y)) {
      control.x = (P1.x + P2.x) / 2;
      control.y = (P1.y + P2.y) / 2;
    }

    return {
      type: "quadratic",
      start: P0,
      control: control,
      end: P3,
    };
  }

  /**
   * Extract contours from WOFF fonts
   */
  extractWOFFContours(character, svgPath) {
    // TODO: Implement WOFF-specific extraction
    // For now, fall back to SVG parsing
    if (this.enableDebugLogging) {
      console.log("WOFF extraction not yet implemented, using SVG fallback");
    }
    return this.parseSVGPath(svgPath);
  }

  /**
   * Extract contours from WOFF2 fonts
   */
  extractWOFF2Contours(character, svgPath) {
    // TODO: Implement WOFF2-specific extraction
    // For now, fall back to SVG parsing
    if (this.enableDebugLogging) {
      console.log("WOFF2 extraction not yet implemented, using SVG fallback");
    }
    return this.parseSVGPath(svgPath);
  }

  /**
   * Parse SVG path string into contours with bezier segments
   */
  parseSVGPath(pathString) {
    const contours = [];
    let currentContour = null;
    let currentPoint = { x: 0, y: 0 };
    let subpathStart = { x: 0, y: 0 };
    let segmentCount = 0;

    if (this.enableDebugLogging) {
      console.log(`Parsing SVG path: ${pathString.substring(0, 200)}...`);
      console.log(`Full SVG path length: ${pathString.length}`);
      // Count different command types
      const commandCounts = {};
      const commandMatches = pathString.match(/[MmLlHhVvCcSsQqTtAaZz]/g);
      if (commandMatches) {
        commandMatches.forEach((cmd) => {
          commandCounts[cmd] = (commandCounts[cmd] || 0) + 1;
        });
        console.log("SVG path commands:", commandCounts);
      }
    }

    // Reset regex
    this.pathCommandRegex.lastIndex = 0;

    let match;
    let commandCount = 0;
    while (
      (match = this.pathCommandRegex.exec(pathString)) !== null &&
      contours.length < this.maxContours
    ) {
      const command = match[1];
      const argsString = match[2];
      const args = this.parseNumbers(argsString);

      if (this.enableDebugLogging && commandCount < 10) {
        console.log(
          `Command ${commandCount}: "${command}" args: [${args
            .slice(0, 6)
            .join(", ")}${args.length > 6 ? "..." : ""}]`
        );
      }
      commandCount++;

      switch (command.toLowerCase()) {
        case "m": // moveto
          if (currentContour && currentContour.segments.length > 0) {
            // Calculate winding order for the previous contour before pushing
            currentContour.windingOrder = this.calculateWindingOrder(
              currentContour.segments
            );
            currentContour.segmentCount = currentContour.segments.length;
            contours.push(currentContour);
          }

          const movePoint =
            command === "M"
              ? { x: args[0], y: args[1] }
              : { x: currentPoint.x + args[0], y: currentPoint.y + args[1] };

          currentPoint = movePoint;
          subpathStart = { ...movePoint };

          currentContour = {
            index: contours.length,
            segments: [],
            segmentCount: 0,
            windingOrder: 1, // Will be calculated later
          };
          segmentCount = 0; // Reset segment count for new contour
          break;

        case "l": // lineto
          // Handle multiple coordinate pairs (L can have multiple x,y pairs)
          for (let i = 0; i < args.length - 1; i += 2) {
            if (currentContour && segmentCount < this.maxBezierSegments) {
              const endPoint =
                command === "L"
                  ? { x: args[i], y: args[i + 1] }
                  : {
                      x: currentPoint.x + args[i],
                      y: currentPoint.y + args[i + 1],
                    };

              // Convert line to quadratic bezier with control point at midpoint
              const segment = {
                type: "linear",
                start: { ...currentPoint },
                control: {
                  x: (currentPoint.x + endPoint.x) / 2,
                  y: (currentPoint.y + endPoint.y) / 2,
                },
                end: endPoint,
              };

              currentContour.segments.push(segment);
              segmentCount++;
              currentPoint = endPoint;
            }
          }
          break;

        case "q": // quadratic bezier
          // Handle multiple quadratic curves (Q can have multiple control+end pairs)
          for (let i = 0; i < args.length - 3; i += 4) {
            if (currentContour && segmentCount < this.maxBezierSegments) {
              const controlPoint =
                command === "Q"
                  ? { x: args[i], y: args[i + 1] }
                  : {
                      x: currentPoint.x + args[i],
                      y: currentPoint.y + args[i + 1],
                    };

              const endPoint =
                command === "Q"
                  ? { x: args[i + 2], y: args[i + 3] }
                  : {
                      x: currentPoint.x + args[i + 2],
                      y: currentPoint.y + args[i + 3],
                    };

              const segment = {
                type: "quadratic",
                start: { ...currentPoint },
                control: controlPoint,
                end: endPoint,
              };

              currentContour.segments.push(segment);
              segmentCount++;
              currentPoint = endPoint;
            }
          }
          break;

        case "c": // cubic bezier
          // Handle multiple cubic curves (C can have multiple cp1+cp2+end sets)
          for (let i = 0; i < args.length - 5; i += 6) {
            if (currentContour && segmentCount < this.maxBezierSegments) {
              const cp1 =
                command === "C"
                  ? { x: args[i], y: args[i + 1] }
                  : {
                      x: currentPoint.x + args[i],
                      y: currentPoint.y + args[i + 1],
                    };

              const cp2 =
                command === "C"
                  ? { x: args[i + 2], y: args[i + 3] }
                  : {
                      x: currentPoint.x + args[i + 2],
                      y: currentPoint.y + args[i + 3],
                    };

              const endPoint =
                command === "C"
                  ? { x: args[i + 4], y: args[i + 5] }
                  : {
                      x: currentPoint.x + args[i + 4],
                      y: currentPoint.y + args[i + 5],
                    };

              // Convert cubic to quadratic using optimal approximation
              const quadControl = {
                x: (3 * cp1.x + 3 * cp2.x - currentPoint.x - endPoint.x) / 4,
                y: (3 * cp1.y + 3 * cp2.y - currentPoint.y - endPoint.y) / 4,
              };

              const segment = {
                type: "quadratic",
                start: { ...currentPoint },
                control: quadControl,
                end: endPoint,
              };

              currentContour.segments.push(segment);
              segmentCount++;
              currentPoint = endPoint;
            }
          }
          break;

        case "h": // horizontal lineto
          for (let i = 0; i < args.length; i++) {
            if (currentContour && segmentCount < this.maxBezierSegments) {
              const endPoint =
                command === "H"
                  ? { x: args[i], y: currentPoint.y }
                  : { x: currentPoint.x + args[i], y: currentPoint.y };

              const segment = {
                type: "linear",
                start: { ...currentPoint },
                control: {
                  x: (currentPoint.x + endPoint.x) / 2,
                  y: (currentPoint.y + endPoint.y) / 2,
                },
                end: endPoint,
              };

              currentContour.segments.push(segment);
              segmentCount++;
              currentPoint = endPoint;
            }
          }
          break;

        case "v": // vertical lineto
          for (let i = 0; i < args.length; i++) {
            if (currentContour && segmentCount < this.maxBezierSegments) {
              const endPoint =
                command === "V"
                  ? { x: currentPoint.x, y: args[i] }
                  : { x: currentPoint.x, y: currentPoint.y + args[i] };

              const segment = {
                type: "linear",
                start: { ...currentPoint },
                control: {
                  x: (currentPoint.x + endPoint.x) / 2,
                  y: (currentPoint.y + endPoint.y) / 2,
                },
                end: endPoint,
              };

              currentContour.segments.push(segment);
              segmentCount++;
              currentPoint = endPoint;
            }
          }
          break;

        case "z": // closepath
          if (currentContour) {
            // Add closing segment if needed
            if (
              Math.abs(currentPoint.x - subpathStart.x) > 0.1 ||
              Math.abs(currentPoint.y - subpathStart.y) > 0.1
            ) {
              if (segmentCount < this.maxBezierSegments) {
                const segment = {
                  type: "linear",
                  start: { ...currentPoint },
                  control: {
                    x: (currentPoint.x + subpathStart.x) / 2,
                    y: (currentPoint.y + subpathStart.y) / 2,
                  },
                  end: { ...subpathStart },
                };
                currentContour.segments.push(segment);
                segmentCount++;
              }
            }

            // Calculate winding order for this contour
            currentContour.windingOrder = this.calculateWindingOrder(
              currentContour.segments
            );
            currentContour.segmentCount = currentContour.segments.length;

            contours.push(currentContour);
            currentContour = null;
            segmentCount = 0;
          }
          break;

        default:
          if (this.enableDebugLogging) {
            console.warn(
              `Unhandled SVG path command: "${command}" with args: [${args
                .slice(0, 6)
                .join(", ")}${args.length > 6 ? "..." : ""}]`
            );
          }
          break;
      }
    }

    // Close any remaining contour
    if (currentContour && currentContour.segments.length > 0) {
      currentContour.windingOrder = this.calculateWindingOrder(
        currentContour.segments
      );
      currentContour.segmentCount = currentContour.segments.length;
      contours.push(currentContour);
    }

    if (this.enableDebugLogging) {
      console.log(
        `SVG parsing result: ${contours.length} contours, ${commandCount} commands processed`
      );
      contours.forEach((contour, i) => {
        console.log(`  Contour ${i}: ${contour.segments.length} segments`);
      });
    }

    return contours;
  }

  /**
   * Parse numbers from SVG path string
   */
  parseNumbers(str) {
    if (!str) return [];
    const matches = str.match(this.numberRegex);
    return matches ? matches.map((n) => parseFloat(n)) : [];
  }

  /**
   * Calculate winding order using signed area
   */
  calculateWindingOrder(segments) {
    let area = 0;

    for (const segment of segments) {
      // Use start and end points for area calculation
      area +=
        (segment.end.x - segment.start.x) * (segment.end.y + segment.start.y);
    }

    // Return 1 for counter-clockwise (outer), -1 for clockwise (inner)
    // Fixed: positive area = counter-clockwise = outer shape
    return area > 0 ? 1 : -1;
  }

  /**
   * Filter out tiny artifacts and noise contours
   */
  filterArtifacts(contours) {
    if (contours.length <= 1) {
      return contours; // Don't filter if we only have one contour
    }
    
    const filteredContours = [];
    
    for (const contour of contours) {
      const bounds = this.calculateBounds([contour]);
      const area = Math.abs(this.calculateSignedArea(contour.segments));
      
      // Filter criteria for artifacts
      const isTinyArea = area < 500; // Very small area (likely hinting artifacts)
      const isTinyDimension = bounds.width < 15 || bounds.height < 15; // Very small dimensions
      const isNearSquareArtifact = (
        bounds.width < 20 && bounds.height < 20 && 
        Math.abs(bounds.width - bounds.height) < 5 && 
        contour.segments.length <= 4
      ); // Small square artifacts from pixel hinting
      
      // Keep contour unless it's clearly an artifact
      if (!(isTinyArea && isTinyDimension) && !isNearSquareArtifact) {
        filteredContours.push(contour);
      } else if (this.enableDebugLogging) {
        console.log(`Filtered artifact: ${bounds.width.toFixed(1)}x${bounds.height.toFixed(1)}, area: ${area.toFixed(1)}, segments: ${contour.segments.length}`);
      }
    }
    
    if (this.enableDebugLogging && filteredContours.length !== contours.length) {
      console.log(`Filtered ${contours.length - filteredContours.length} artifacts, ${filteredContours.length} contours remaining`);
    }
    
    return filteredContours;
  }

  /**
   * Detect holes by testing containment and applying proper winding orders
   * Enhanced to distinguish between actual holes and crossbars/separate shapes
   * Includes fixes for variable font cast artifacts
   */
  detectHoles(contours) {
    if (contours.length <= 1) {
      // Single contour is always outer
      return contours.map(contour => ({
        ...contour,
        windingOrder: 1
      }));
    }

    // Calculate areas, bounds, and geometric properties for each contour
    const contourData = contours.map((contour, index) => {
      const area = this.calculateSignedArea(contour.segments);
      const bounds = this.calculateBounds([contour]);
      const aspectRatio = bounds.height > 0 ? bounds.width / bounds.height : 1;
      
      return {
        index,
        contour,
        area: Math.abs(area),
        signedArea: area,
        bounds,
        aspectRatio,
        isCrossbar: this.isCrossbarShape(bounds, aspectRatio),
        isVariableFontArtifact: this.isVariableFontCastArtifact(contour, bounds, aspectRatio),
        isHole: false
      };
    });

    // Sort by area (largest first)
    contourData.sort((a, b) => b.area - a.area);

    // The largest contour is always outer
    contourData[0].isHole = false;

    // For each smaller contour, determine if it's a hole or outer shape
    for (let i = 1; i < contourData.length; i++) {
      const current = contourData[i];
      let isHole = false;

      // Check if this looks like a crossbar - if so, treat as outer shape
      if (current.isCrossbar) {
        isHole = false;
        if (this.enableDebugLogging) {
          console.log(`Contour ${current.index}: detected as crossbar (aspect ratio: ${current.aspectRatio.toFixed(2)}) - treating as outer shape`);
        }
      } else if (current.isVariableFontArtifact) {
        // Variable font cast artifacts: contours with wrong winding order
        isHole = false;
        if (this.enableDebugLogging) {
          console.log(`Contour ${current.index}: detected as variable font cast artifact - correcting to outer shape`);
        }
      } else {
        // Use containment logic for non-crossbar contours
        for (let j = 0; j < i; j++) {
          const larger = contourData[j];
          if (this.isContourInside(current, larger)) {
            // If the larger contour is an outer shape, this is a hole
            // If the larger contour is a hole, this becomes an outer shape again
            isHole = !larger.isHole;
            if (this.enableDebugLogging) {
              console.log(`Contour ${current.index}: inside contour ${larger.index} (${larger.isHole ? 'hole' : 'outer'}) - marking as ${isHole ? 'hole' : 'outer'}`);
            }
            break;
          }
        }
      }

      current.isHole = isHole;
    }

    // Apply correct winding orders and return
    const finalContours = contourData
      .sort((a, b) => a.index - b.index) // Restore original order
      .map(data => ({
        ...data.contour,
        windingOrder: data.isHole ? -1 : 1
      }));

    // Apply precision cleanup for better SDF accuracy
    return this.applyPrecisionCleanup(finalContours);
  }

  /**
   * Detect if a contour looks like a crossbar based on geometric properties
   */
  isCrossbarShape(bounds, aspectRatio) {
    // Crossbars are characterized by:
    // 1. Extremely wide and thin (much more extreme than regular holes)
    // 2. Reasonable minimum dimensions
    // 3. Not too large (actual character holes can be big)
    const isVeryWideAndThin = aspectRatio > 8.0; // Width > 8x height (much more conservative)
    const hasReasonableSize = bounds.width > 50 && bounds.height > 5; // Larger minimum size
    const notTooLarge = bounds.width < 500 && bounds.height < 100; // Prevent large holes being crossbars
    
    // Additional check: crossbars are typically horizontal rectangles
    const isHorizontalRectangle = bounds.width > bounds.height * 6;
    
    return isVeryWideAndThin && hasReasonableSize && notTooLarge && isHorizontalRectangle;
  }

  /**
   * Detect variable font cast artifacts - contours that should be outer shapes
   * but have incorrect negative winding order from variable font generation issues
   */
  isVariableFontCastArtifact(contour, bounds, aspectRatio) {
    // Check if this contour has negative winding order (marked as hole)
    if (contour.windingOrder >= 0) {
      return false; // Already positive winding, not an artifact
    }

    // Improved detection: only flag artifacts for very specific patterns
    
    // Pattern 1: Very large area "holes" that are clearly substantial shapes
    const hasVeryLargeArea = bounds.width * bounds.height > 250000;
    
    // Pattern 2: Diagonal-like shapes (like K arms) with substantial size
    const isDiagonalShape = aspectRatio > 0.6 && aspectRatio < 1.8 && 
                           bounds.width > 500 && bounds.height > 500;
    
    // Pattern 3: Wide crossbar-like shapes marked as holes (suspicious)
    const isCrossbarMarkedAsHole = aspectRatio > 6.0 && bounds.height < 150 && 
                                   bounds.width > 300;
    
    // Pattern 4: Large rectangular shapes that should obviously be outer
    const isLargeRectangularShape = (aspectRatio > 2.5 || aspectRatio < 0.4) && 
                                   bounds.width > 400 && bounds.height > 400;
    
    // Only flag as artifact if it matches very specific suspicious patterns
    return hasVeryLargeArea || isDiagonalShape || isCrossbarMarkedAsHole || isLargeRectangularShape;
  }

  /**
   * Apply precision cleanup to contours for better SDF accuracy
   * Addresses micro-gaps and floating-point precision issues
   */
  applyPrecisionCleanup(contours) {
    return contours.map(contour => ({
      ...contour,
      segments: this.cleanupSegmentPrecision(contour.segments)
    }));
  }

  /**
   * Clean up segment precision to prevent SDF leaks
   */
  cleanupSegmentPrecision(segments) {
    const cleaned = [];
    const tolerance = 0.001; // Very tight tolerance for precision

    for (let i = 0; i < segments.length; i++) {
      const current = segments[i];
      const next = segments[(i + 1) % segments.length];
      
      // Create a copy of the current segment
      const cleanedSegment = {
        ...current,
        start: { ...current.start },
        end: { ...current.end },
        control: current.control ? { ...current.control } : undefined
      };

      // Snap endpoint to next segment's start point if very close
      const endToNextStartDist = Math.sqrt(
        Math.pow(current.end.x - next.start.x, 2) + 
        Math.pow(current.end.y - next.start.y, 2)
      );

      if (endToNextStartDist < tolerance) {
        // Snap to the midpoint for best precision
        const midX = (current.end.x + next.start.x) / 2;
        const midY = (current.end.y + next.start.y) / 2;
        
        cleanedSegment.end.x = midX;
        cleanedSegment.end.y = midY;
        
        // Update next segment's start point to match (will be handled in next iteration)
        if (i < segments.length - 1) {
          next.start.x = midX;
          next.start.y = midY;
        }
      }

      // Round coordinates to prevent floating-point precision drift
      cleanedSegment.start.x = Math.round(cleanedSegment.start.x * 1000) / 1000;
      cleanedSegment.start.y = Math.round(cleanedSegment.start.y * 1000) / 1000;
      cleanedSegment.end.x = Math.round(cleanedSegment.end.x * 1000) / 1000;
      cleanedSegment.end.y = Math.round(cleanedSegment.end.y * 1000) / 1000;

      if (cleanedSegment.control) {
        cleanedSegment.control.x = Math.round(cleanedSegment.control.x * 1000) / 1000;
        cleanedSegment.control.y = Math.round(cleanedSegment.control.y * 1000) / 1000;
      }

      // Skip segments that are too small (degenerate)
      const segmentLength = Math.sqrt(
        Math.pow(cleanedSegment.end.x - cleanedSegment.start.x, 2) + 
        Math.pow(cleanedSegment.end.y - cleanedSegment.start.y, 2)
      );

      if (segmentLength >= 0.1) { // Minimum segment length
        cleaned.push(cleanedSegment);
      }
    }

    return cleaned;
  }

  /**
   * Calculate signed area for hole detection
   */
  calculateSignedArea(segments) {
    let area = 0;
    for (const segment of segments) {
      area += (segment.end.x - segment.start.x) * (segment.end.y + segment.start.y);
    }
    return area / 2;
  }

  /**
   * Test if one contour is inside another
   */
  isContourInside(innerContour, outerContour) {
    // Simple test: check if the first point of inner contour is inside outer contour bounds
    if (innerContour.contour.segments.length === 0) return false;
    
    const testPoint = innerContour.contour.segments[0].start;
    
    // First check bounding box
    if (testPoint.x < outerContour.bounds.minX || testPoint.x > outerContour.bounds.maxX ||
        testPoint.y < outerContour.bounds.minY || testPoint.y > outerContour.bounds.maxY) {
      return false;
    }

    // Use a simple point-in-polygon test
    return this.pointInPolygon(testPoint, outerContour.contour.segments);
  }

  /**
   * Point-in-polygon test using ray casting
   */
  pointInPolygon(point, segments) {
    let inside = false;
    
    for (const segment of segments) {
      const x1 = segment.start.x;
      const y1 = segment.start.y;
      const x2 = segment.end.x;
      const y2 = segment.end.y;
      
      if (((y1 > point.y) !== (y2 > point.y)) &&
          (point.x < (x2 - x1) * (point.y - y1) / (y2 - y1) + x1)) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  /**
   * Calculate bounds from contour segments
   */
  calculateBounds(contours) {
    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;

    for (const contour of contours) {
      for (const segment of contour.segments) {
        // Check all points in segment
        const points = [segment.start, segment.control, segment.end];

        for (const point of points) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
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
   * Create empty SDF data for characters with no glyph
   */
  createEmptySDFData(character, glyphId) {
    return {
      contours: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      character: character,
      glyphId: glyphId,
    };
  }

  /**
   * Convert SDF data to shader-ready format
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
      // Bounds - keep original coordinates, no Y-flip
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

        // Store control points in flattened array - no Y-flip since we kept original coordinates
        const pointOffset = segmentIndex * 6;
        segmentData.controlPoints[pointOffset] = segment.start.x;
        segmentData.controlPoints[pointOffset + 1] = segment.start.y; // No Y-flip
        segmentData.controlPoints[pointOffset + 2] = segment.control.x;
        segmentData.controlPoints[pointOffset + 3] = segment.control.y; // No Y-flip
        segmentData.controlPoints[pointOffset + 4] = segment.end.x;
        segmentData.controlPoints[pointOffset + 5] = segment.end.y; // No Y-flip

        segmentIndex++;
        if (segmentIndex >= maxSegments) break;
      }

      if (segmentIndex >= maxSegments) break;
    }

    segmentData.totalSegments = segmentIndex;
    return segmentData;
  }
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = FontSDFExtension;
}
