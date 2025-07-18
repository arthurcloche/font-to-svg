import FontParser from "../font-parser.js";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const demo = async () => {
  const parser = new FontParser();
  const fontPath = path.join(__dirname, "../fonts/SigmaSerif-Headline.otf");
  const buffer = readFileSync(fontPath);
  parser.fromBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

  // Debug glyph 77 ('l')
  const glyphId = 77;
  console.log(`\nDebugging glyph ${glyphId}:`);
  
  const charString = parser.cffCharStrings[glyphId];
  console.log(`CharString length: ${charString?.length}`);
  console.log(`CharString bytes:`, charString);
  
  // Create a simple state and try to draw
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
  
  // Add debug to drawCFF temporarily
  const originalDrawCFF = parser.drawCFF.bind(parser);
  parser.drawCFF = function(charString, state) {
    console.log("\nDrawing charString:");
    let i = 0;
    while (i < charString.length) {
      const b = charString[i];
      let op = b;
      if (b === 12) {
        op = (b << 8) | charString[i + 1];
      }
      
      if (b <= 21 || (b === 12 && charString[i + 1] <= 37)) {
        // It's an operator
        const opName = getOperatorName(op);
        console.log(`  [${i}] Operator: ${opName} (${op}), stack: [${state.stack.join(', ')}]`);
      } else if (b >= 32) {
        // It's an operand
        const operand = this.readCharStringOperand(charString, i);
        console.log(`  [${i}] Operand: ${operand.value}`);
        i = operand.nextIndex - 1;
      }
      i++;
    }
    
    // Now call the original
    return originalDrawCFF.call(this, charString, state);
  };
  
  try {
    parser.drawCFF(charString, state);
    console.log("\nResulting path commands:", state.path.length);
    state.path.forEach((cmd, i) => {
      console.log(`  ${i}: ${cmd.type} ${JSON.stringify(cmd)}`);
    });
  } catch (e) {
    console.error("Error:", e.message);
  }
};

function getOperatorName(op) {
  const ops = {
    1: "hstem",
    3: "vstem",
    4: "vmoveto",
    5: "rlineto",
    6: "hlineto",
    7: "vlineto",
    8: "rrcurveto",
    10: "callsubr",
    11: "return",
    14: "endchar",
    18: "hstemhm",
    19: "hintmask",
    20: "cntrmask",
    21: "rmoveto",
    22: "hmoveto",
    23: "vstemhm",
    29: "callgsubr",
    30: "vhcurveto",
    31: "hvcurveto",
  };
  
  // Two-byte operators
  if (op === ((12 << 8) | 34)) return "hflex";
  if (op === ((12 << 8) | 35)) return "flex";
  if (op === ((12 << 8) | 36)) return "hflex1";
  if (op === ((12 << 8) | 37)) return "flex1";
  
  return ops[op] || `unknown(${op})`;
}

demo().catch(console.error);