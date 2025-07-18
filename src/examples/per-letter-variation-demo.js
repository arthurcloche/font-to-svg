import FontParser from "../font-parser.js";

(async () => {
  const parser = new FontParser();
  await parser.from("../fonts/Obviously-Variable.ttf");

  const axes = parser.isVariableFont ? parser.getAxes() : [];
  const text = "hello world";
  const fontSize = 120;
  const scale = fontSize / parser.unitsPerEm;
  const baselineY = fontSize * 1.2;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", 1000);
  svg.setAttribute("height", 300);
  svg.style.border = "1px solid #ccc";

  let currentX = 10;

  for (const ch of text) {
    // simple space handling
    if (ch === " ") {
      currentX += fontSize * 0.3;
      continue;
    }

    // Apply random variation per glyph
    if (parser.isVariableFont) {
      const randVals = {};
      axes.forEach((axis) => {
        randVals[axis.tag] = axis.min + Math.random() * (axis.max - axis.min);
      });
      parser.setVariation(randVals);
      console.log(`Variation for '${ch}':`, randVals);
    }

    const path = parser.glyphToSVGPath(ch, {
      scale,
      flipY: true,
      offsetX: currentX,
      offsetY: baselineY,
    });
    const pathEl = document.createElementNS(svgNS, "path");
    pathEl.setAttribute("d", path);
    pathEl.setAttribute("fill", "black");
    svg.appendChild(pathEl);

    const metrics = parser.getGlyphMetrics(parser.getGlyphId(ch));
    const advance = metrics.advanceWidth * scale;
    currentX += advance;
  }

  document.body.appendChild(svg);
})();
