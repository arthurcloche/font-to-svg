import FontParser from "../font-parser.js";

(async () => {
  const parser = new FontParser();
  await parser.from("../fonts/Inter_28pt-Medium.ttf"); // swap font here

  // representative sample (Latin-1 + digits)
  const chars = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 " +
    "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß" +
    "àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ"
  ).trim();

  const fontSize = 60; // pixel height
  const scale = fontSize / parser.unitsPerEm;
  const perRow = 32;
  const cell = fontSize * 1.4;
  const rows = Math.ceil(chars.length / perRow);

  // create canvas
  const canvas = document.createElement("canvas");
  canvas.width = perRow * cell;
  canvas.height = rows * cell;
  canvas.style.border = "1px solid #ccc";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";
  ctx.lineWidth = 0.5;

  let col = 0,
    row = 0;
  for (const ch of chars) {
    const x = col * cell + fontSize * 0.2;
    const y = (row + 1) * cell - fontSize * 0.2;

    // draw glyph path using Path2D
    const pathString = parser.glyphToSVGPath(ch, {
      scale,
      flipY: true,
      offsetX: x,
      offsetY: y,
    });
    if (pathString) {
      const p2d = new Path2D(pathString);
      ctx.fill(p2d);

      // bounding box
      const bounds = parser.getGlyphBounds(ch, {
        scale,
        flipY: true,
        offsetX: x,
        offsetY: y,
      });
      if (bounds) {
        ctx.strokeStyle = "red";
        ctx.strokeRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
        // baseline
        ctx.strokeStyle = "blue";
        ctx.beginPath();
        ctx.moveTo(bounds.minX, y);
        ctx.lineTo(bounds.maxX, y);
        ctx.stroke();
      }
    }

    col++;
    if (col === perRow) {
      col = 0;
      row++;
    }
  }
})();
