const fs = require('fs');
const path = require('path');

function uniqueOutputPath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const stem = path.basename(targetPath, ext);
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${stem} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not find a free output filename after 1000 attempts');
}

function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  let s = n.toFixed(6);
  if (s.indexOf('.') >= 0) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}

function buildGroupNames(geometries) {
  const baseCounts = {};
  return geometries.map((g) => {
    const stripped = g.shaderName.replace(/^vehicle_/, '');
    const base = stripped || `g${g.shaderIndex}`;
    baseCounts[base] = (baseCounts[base] || 0) + 1;
    return baseCounts[base] === 1 ? base : `${base}_${baseCounts[base]}`;
  });
}

/**
 * Write geometries to an OBJ file.
 *
 * @param {object} options
 * @param {string} options.outputPath - desired output file path (may be auto-renamed)
 * @param {Array} options.geometries - parser output `geometries`
 * @param {boolean} [options.yUp=false] - if true, swap Z-up to Y-up
 * @param {string} [options.sourceName] - original yft filename for header comment
 * @returns {{ writtenPath: string, vertexCount: number, faceCount: number, groupNames: string[] }}
 */
const UV_CHANNEL = 1;

function writeObj(options) {
  const { geometries, yUp = false, sourceName = '' } = options;
  if (!geometries || geometries.length === 0) {
    throw new Error('No geometries to write');
  }
  const writtenPath = uniqueOutputPath(options.outputPath);
  const groupNames = buildGroupNames(geometries);
  const stream = fs.createWriteStream(writtenPath, { encoding: 'utf8' });

  stream.write(`# LiveryLab Shells - paint-only OBJ export\n`);
  if (sourceName) stream.write(`# Source: ${sourceName}\n`);
  stream.write(`# Coordinate system: Y-up\n`);
  stream.write(`# UV channel: TexCoord${UV_CHANNEL}\n`);
  stream.write(`# Geometries: ${geometries.length}\n\n`);

  let vertexOffset = 0;
  let normalOffset = 0;
  let uvOffset = 0;
  let totalVerts = 0;
  let totalFaces = 0;

  for (let gi = 0; gi < geometries.length; gi++) {
    const g = geometries[gi];
    const name = groupNames[gi];
    const vCount = g.positions.length / 3;
    const hasN = !!g.normals;
    const uvSource = g.texcoords && g.texcoords[UV_CHANNEL];
    const hasT = !!uvSource;

    stream.write(`g ${name}\n`);

    for (let i = 0; i < vCount; i++) {
      let x = g.positions[i * 3];
      let y = g.positions[i * 3 + 1];
      let z = g.positions[i * 3 + 2];
      if (yUp) {
        const ty = z;
        const tz = -y;
        y = ty;
        z = tz;
      }
      stream.write(`v ${fmt(x)} ${fmt(y)} ${fmt(z)}\n`);
    }
    if (hasN) {
      for (let i = 0; i < vCount; i++) {
        let nx = g.normals[i * 3];
        let ny = g.normals[i * 3 + 1];
        let nz = g.normals[i * 3 + 2];
        if (yUp) {
          const ty = nz;
          const tz = -ny;
          ny = ty;
          nz = tz;
        }
        stream.write(`vn ${fmt(nx)} ${fmt(ny)} ${fmt(nz)}\n`);
      }
    }
    if (hasT) {
      for (let i = 0; i < vCount; i++) {
        const u = uvSource[i * 2];
        const v = uvSource[i * 2 + 1];
        stream.write(`vt ${fmt(u)} ${fmt(v)}\n`);
      }
    }

    const idx = g.indices;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] + 1 + vertexOffset;
      const b = idx[i + 1] + 1 + vertexOffset;
      const c = idx[i + 2] + 1 + vertexOffset;
      const aN = idx[i] + 1 + normalOffset;
      const bN = idx[i + 1] + 1 + normalOffset;
      const cN = idx[i + 2] + 1 + normalOffset;
      const aT = idx[i] + 1 + uvOffset;
      const bT = idx[i + 1] + 1 + uvOffset;
      const cT = idx[i + 2] + 1 + uvOffset;
      if (hasN && hasT) {
        stream.write(`f ${a}/${aT}/${aN} ${b}/${bT}/${bN} ${c}/${cT}/${cN}\n`);
      } else if (hasN) {
        stream.write(`f ${a}//${aN} ${b}//${bN} ${c}//${cN}\n`);
      } else if (hasT) {
        stream.write(`f ${a}/${aT} ${b}/${bT} ${c}/${cT}\n`);
      } else {
        stream.write(`f ${a} ${b} ${c}\n`);
      }
    }

    vertexOffset += vCount;
    if (hasN) normalOffset += vCount;
    if (hasT) uvOffset += vCount;
    totalVerts += vCount;
    totalFaces += idx.length / 3;
    stream.write('\n');
  }

  return new Promise((resolve, reject) => {
    stream.end(() => resolve({ writtenPath, vertexCount: totalVerts, faceCount: totalFaces, groupNames }));
    stream.on('error', reject);
  });
}

module.exports = { writeObj, uniqueOutputPath };
