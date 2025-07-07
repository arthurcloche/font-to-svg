# Bezier Connectivity Diagnostics

This toolkit provides comprehensive diagnostics for floating point precision issues in bezier curve connectivity that can cause SDF (Signed Distance Field) fill "leaking" artifacts.

## Problem Description

When converting font glyphs to bezier curves for SDF rendering, small gaps between adjacent segments can cause visual artifacts:

- **Strokes look good** - Line rendering is forgiving of small gaps
- **Fills have artifacts** - SDF fill algorithms are sensitive to connectivity breaks
- **Floating point precision** - Coordinate transformations can introduce tiny gaps
- **SVG path parsing** - Conversion from font data to SVG paths may lose precision

## Tools Overview

### 1. `bezier-connectivity-diagnostics.js`
**Command-line diagnostic tool** that analyzes font characters for connectivity issues.

**Features:**
- Analyzes segment-to-segment connectivity within contours
- Measures gaps between adjacent segment endpoints
- Configurable epsilon threshold for gap detection
- Comprehensive statistics and reporting
- JSON export for further analysis

**Usage:**
```bash
node bezier-connectivity-diagnostics.js
```

**Configuration Options:**
```javascript
const diagnostics = new BezierConnectivityDiagnostics({
  epsilon: 0.01,              // Gap threshold (smaller = more sensitive)
  testCharacters: ['A', 'B'], // Characters to analyze
  fontPath: '../fonts/Inter_28pt-Medium.ttf',
  enableDebugLogging: false,  // Verbose output
  outputFile: './report.json' // Results output
});
```

### 2. `connectivity-visualization.html`
**Interactive web-based visualization** for exploring connectivity issues.

**Features:**
- Visual representation of bezier segments
- Color-coded connectivity status (green = connected, red = gaps)
- Interactive controls for epsilon adjustment
- Real-time gap measurement and statistics
- Export capabilities for reports

**Usage:**
1. Open `connectivity-visualization.html` in a web browser
2. Select font and characters to analyze
3. Adjust epsilon threshold
4. Click "Run Diagnostics" to analyze
5. View visual results and statistics

### 3. `test-connectivity-with-gaps.js`
**Validation tool** that introduces artificial gaps to verify diagnostic accuracy.

**Features:**
- Creates controlled connectivity issues
- Validates that diagnostics detect introduced gaps
- Useful for testing and calibration

**Usage:**
```bash
node test-connectivity-with-gaps.js
```

## Understanding the Results

### Gap Statistics
- **Maximum Gap**: Largest gap found across all segments
- **Minimum Gap**: Smallest gap found (above threshold)
- **Average Gap**: Mean gap size for all detected issues
- **Gap Distribution**: Histogram of gap sizes by category

### Gap Categories
- **Tiny (0-0.001)**: Sub-pixel precision issues
- **Small (0.001-0.01)**: Minor floating point errors
- **Medium (0.01-0.1)**: Noticeable precision problems
- **Large (0.1-1.0)**: Significant connectivity breaks
- **Huge (1.0+)**: Major coordinate system issues

### Connectivity Analysis
For each character and contour:
- **Segment Count**: Number of bezier segments
- **Connectivity Issues**: Count of gaps above threshold
- **Winding Order**: Contour orientation (1 = outer, -1 = inner)
- **Closure Status**: Whether contour properly closes

## Interpreting Results

### ✅ No Issues Found
```
Total connectivity issues: 0
Characters with issues: 0.0%
```
- Font has good segment connectivity
- SDF rendering should work well
- No immediate fixes needed

### ⚠️ Minor Issues
```
Total connectivity issues: 5
Maximum gap found: 0.005
Average gap size: 0.003
```
- Small precision issues detected
- May cause minor SDF artifacts
- Consider implementing endpoint snapping

### 🚨 Major Issues
```
Total connectivity issues: 50
Maximum gap found: 0.5
Average gap size: 0.1
```
- Significant connectivity problems
- Will likely cause visible SDF artifacts
- Requires coordinate system review

## Recommended Fixes

### 1. Endpoint Snapping
```javascript
function snapEndpoints(segments, tolerance = 0.01) {
  for (let i = 0; i < segments.length; i++) {
    const current = segments[i];
    const next = segments[(i + 1) % segments.length];
    
    const gap = calculateGap(current.end, next.start);
    if (gap > 0 && gap <= tolerance) {
      // Snap to average position
      const midX = (current.end.x + next.start.x) / 2;
      const midY = (current.end.y + next.start.y) / 2;
      current.end.x = midX;
      current.end.y = midY;
      next.start.x = midX;
      next.start.y = midY;
    }
  }
}
```

### 2. Precision Tolerance
```javascript
function isConnected(point1, point2, tolerance = 0.01) {
  const dx = point1.x - point2.x;
  const dy = point1.y - point2.y;
  return Math.sqrt(dx * dx + dy * dy) <= tolerance;
}
```

### 3. SVG Path Precision
```javascript
function parseWithPrecision(pathString, precision = 6) {
  return pathString.replace(/[\d\.\-]+/g, (match) => {
    return parseFloat(match).toFixed(precision);
  });
}
```

## Configuration Guidelines

### Epsilon Threshold Selection
- **0.001**: Very sensitive, may show false positives
- **0.01**: Good balance for most fonts
- **0.1**: Only major issues, may miss smaller problems
- **1.0**: Only catastrophic coordinate system errors

### Test Character Selection
- **Simple shapes**: 'O', 'A', 'B' for basic testing
- **Complex shapes**: 'R', 'P', 'Q' for advanced cases
- **Lowercase**: 'a', 'b', 'o', 'p' for different scale issues
- **Variable fonts**: Test multiple axis values

### Font Type Considerations
- **TrueType**: Generally good connectivity
- **OpenType/CFF**: May have precision variations
- **Variable fonts**: Test multiple axis positions
- **Web fonts**: May have compression artifacts

## Performance Notes

### Large Character Sets
- Testing 100+ characters may take several seconds
- Consider batch processing for extensive analysis
- Use smaller epsilon values carefully (more computation)

### Memory Usage
- Each character analysis stores detailed segment data
- Large fonts with many segments may use significant memory
- Consider processing in batches for memory-constrained environments

## Troubleshooting

### Common Issues

**"No font loaded" Error:**
- Check font file path
- Ensure font file is accessible
- Verify file format is supported

**"No contours found" Error:**
- Character may not exist in font
- Check character encoding
- Try different test characters

**"Maximum call stack exceeded" Error:**
- Font may have corrupt glyph data
- Try different font file
- Reduce max segments limit

### Debug Mode
Enable verbose logging to see detailed analysis:
```javascript
const diagnostics = new BezierConnectivityDiagnostics({
  enableDebugLogging: true
});
```

## Integration with SDF Rendering

### Pre-processing
Run diagnostics before SDF generation:
```javascript
const analysis = await diagnostics.analyzeCharacter('A');
if (analysis.hasConnectivityIssues) {
  // Apply fixes before SDF generation
  fixConnectivityIssues(analysis);
}
```

### Runtime Tolerance
Use analysis results to configure SDF tolerance:
```javascript
const tolerance = Math.max(0.01, analysis.maxGap * 1.5);
sdfRenderer.setTolerance(tolerance);
```

## Export Formats

### JSON Report
```json
{
  "timestamp": "2025-01-01T00:00:00.000Z",
  "configuration": {
    "epsilon": 0.01,
    "testCharacters": ["A", "B"],
    "fontPath": "../fonts/font.ttf"
  },
  "statistics": {
    "totalCharacters": 2,
    "totalContours": 4,
    "totalSegments": 48,
    "connectivityIssues": 0
  },
  "analysis": {
    "A": {
      "character": "A",
      "contours": [...],
      "connectivityIssues": 0
    }
  }
}
```

### CSV Export (Custom)
For spreadsheet analysis, implement custom CSV export:
```javascript
function exportToCSV(analysis) {
  const rows = [];
  Object.values(analysis).forEach(char => {
    rows.push([
      char.character,
      char.contours.length,
      char.totalSegments,
      char.connectivityIssues,
      char.maxGap
    ]);
  });
  return rows.map(row => row.join(',')).join('\n');
}
```

## Future Enhancements

### Planned Features
- [ ] Automatic gap fixing algorithms
- [ ] Integration with font-sdf-extension
- [ ] Performance optimization for large fonts
- [ ] Advanced visualization modes
- [ ] Batch processing utilities

### Contribution Guidelines
- Follow existing code style and patterns
- Add comprehensive tests for new features
- Update documentation for any API changes
- Consider performance impact of new functionality

## License

This diagnostic toolkit is part of the font-to-svg project and follows the same licensing terms.