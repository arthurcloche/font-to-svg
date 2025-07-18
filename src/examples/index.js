import FontParser from "../font-parser.js";

function displaySVG(pathData) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", pathData.viewBox);
  svg.setAttribute("width", "1000");
  svg.setAttribute("height", "200");
  svg.style.border = "1px solid #ccc";

  const pathElement = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );
  pathElement.setAttribute(
    "d",
    pathData.characters.map((c) => c.path).join(" ")
  );
  pathElement.setAttribute("fill", "black");

  svg.appendChild(pathElement);
  document.body.appendChild(svg);
}

// Debug specific character
function debugCharacter(parser, char) {
  console.log(`\n=== DEBUGGING CHARACTER '${char}' ===`);
  const glyphId = parser.getGlyphId(char);
  console.log(`Glyph ID: ${glyphId}`);

  const glyph = parser.parseGlyph(glyphId);
  console.log(`Number of contours: ${glyph?.contours?.length || 0}`);

  return glyph;
}

// Debug specific glyph by ID
function debugGlyphById(parser, glyphId) {
  console.log(`\n=== DEBUGGING GLYPH ID ${glyphId} ===`);
  const glyph = parser.parseGlyph(glyphId);
  console.log(`Number of contours: ${glyph?.contours?.length || 0}`);

  if (glyph?.contours) {
    glyph.contours.forEach((contour, i) => {
      console.log(`Contour ${i}: ${contour.length} points`);
      if (i < 5) {
        // Only show first 5 contours to avoid spam
        console.log(`  First few points:`, contour.slice(0, 3));
      }
    });
  }

  return glyph;
}

const demo = async () => {
  const parser = new FontParser();
  await parser.from("../fonts/BebasNeue-Regular.ttf"); // swap font here

  // If variable font, set random variation values
  if (parser.isVariableFont) {
    const axes = parser.getAxes();
    const randomVals = {};
    axes.forEach((axis) => {
      const rand = axis.min + Math.random() * (axis.max - axis.min);
      randomVals[axis.tag] = rand;
    });
    parser.setVariation(randomVals);
    console.log("Applied random variation:", randomVals);
  }

  // a representative sample (Latin-1 + digits)
  const chars = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 " +
    "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß" +
    "àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ"
  ).trim();

  const fontSize = 60; // desired pixel height
  const scale = fontSize / parser.unitsPerEm;
  const perRow = 32;
  const cell = fontSize * 1.4;
  const rows = Math.ceil(chars.length / perRow);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", perRow * cell);
  svg.setAttribute("height", rows * cell);
  svg.style.border = "1px solid #ccc";

  let col = 0,
    row = 0;
  for (const ch of chars) {
    const path = parser.glyphToSVGPath(ch, { scale });
    const pathEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path"
    );
    pathEl.setAttribute("d", path);
    pathEl.setAttribute("fill", "black");
    const x = col * cell + fontSize * 0.2;
    const y = (row + 1) * cell - fontSize * 0.2;
    pathEl.setAttribute("transform", `translate(${x},${y})`);
    svg.appendChild(pathEl);

    // Draw bounding box and baseline
    const bounds = parser.getGlyphBounds(ch, { scale });
    if (bounds) {
      const rect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect"
      );
      rect.setAttribute("x", x + bounds.minX);
      rect.setAttribute("y", y + bounds.minY);
      rect.setAttribute("width", bounds.width);
      rect.setAttribute("height", bounds.height);
      rect.setAttribute("fill", "none");
      rect.setAttribute("stroke", "red");
      rect.setAttribute("stroke-width", "0.5");
      svg.appendChild(rect);

      const baseline = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line"
      );
      baseline.setAttribute("x1", x + bounds.minX);
      baseline.setAttribute("x2", x + bounds.maxX);
      baseline.setAttribute("y1", y);
      baseline.setAttribute("y2", y);
      baseline.setAttribute("stroke", "blue");
      baseline.setAttribute("stroke-width", "0.5");
      svg.appendChild(baseline);
    }

    col++;
    if (col === perRow) {
      col = 0;
      row++;
    }
  }
  document.body.appendChild(svg);
};
demo();
