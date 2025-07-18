import FontParser from "../font-parser.js";

(async () => {
  const parser = new FontParser();
  await parser.from("../fonts/Obviously-Variable.ttf");

  const axes = parser.isVariableFont ? parser.getAxes() : [];
  const text = "hello world";
  const fontSize = 120;
  const scale = fontSize / parser.unitsPerEm;
  const baselineY = fontSize * 1.2;

  // canvas setup
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 300;
  canvas.style.border = "1px solid #ccc";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";

  let currentX = 10;

  for (const ch of text) {
    if (ch === " ") {
      currentX += fontSize * 0.3;
      continue;
    }

    if (parser.isVariableFont) {
      const randVals = {};
      axes.forEach((axis) => {
        randVals[axis.tag] = axis.min + Math.random() * (axis.max - axis.min);
      });
      parser.setVariation(randVals);
      console.log(`Variation for '${ch}':`, randVals);
    }

    const pathString = parser.glyphToSVGPath(ch, {
      scale,
      flipY: true,
      offsetX: currentX,
      offsetY: baselineY,
    });

    if (pathString) {
      ctx.fill(new Path2D(pathString));
    }

    const metrics = parser.getGlyphMetrics(parser.getGlyphId(ch));
    const advance = metrics.advanceWidth * scale;
    currentX += advance;
  }
})();
