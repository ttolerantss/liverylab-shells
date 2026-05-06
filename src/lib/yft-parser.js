const { XMLParser } = require('fast-xml-parser');
const { DEFAULT_PAINT_SHADERS, normalizeShaderName } = require('./shaders');

const LAYOUT_COMPONENT_SIZES = {
  position: 3,
  normal: 3,
  tangent: 4,
  binormal: 3,
  blendweights: 4,
  blendindices: 4,
  colour0: 4, color0: 4,
  colour1: 4, color1: 4,
  texcoord0: 2,
  texcoord1: 2,
  texcoord2: 2,
  texcoord3: 2,
  texcoord4: 2,
  texcoord5: 2,
  texcoord6: 2,
  texcoord7: 2,
};

const LOD_KEYS = ['DrawableModelsHigh', 'DrawableModelsMed', 'DrawableModelsLow', 'DrawableModelsVeryLow'];

function asArray(node) {
  if (node === undefined || node === null) return [];
  return Array.isArray(node) ? node : [node];
}

function buildLayoutPlan(layoutNode) {
  if (!layoutNode || typeof layoutNode !== 'object') return null;
  const components = [];
  for (const key of Object.keys(layoutNode)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const lower = key.toLowerCase();
    const size = LAYOUT_COMPONENT_SIZES[lower];
    if (!size) return { error: `Unknown vertex layout component: ${key}` };
    components.push({ name: lower, size });
  }
  if (components.length === 0) return { error: 'Empty vertex layout' };
  const stride = components.reduce((a, c) => a + c.size, 0);
  const offsets = {};
  let off = 0;
  for (const c of components) {
    offsets[c.name] = off;
    off += c.size;
  }
  return { components, stride, offsets };
}

function parseVertexData(text, plan) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length % plan.stride !== 0) {
    throw new Error(`Vertex data token count ${tokens.length} not divisible by stride ${plan.stride}`);
  }
  const count = tokens.length / plan.stride;
  const positions = new Float32Array(count * 3);
  const hasNormal = plan.offsets.normal !== undefined;
  const normals = hasNormal ? new Float32Array(count * 3) : null;
  const hasUV = plan.offsets.texcoord0 !== undefined;
  const uvs = hasUV ? new Float32Array(count * 2) : null;

  const pOff = plan.offsets.position;
  const nOff = plan.offsets.normal;
  const tOff = plan.offsets.texcoord0;

  for (let i = 0; i < count; i++) {
    const base = i * plan.stride;
    positions[i * 3]     = parseFloat(tokens[base + pOff]);
    positions[i * 3 + 1] = parseFloat(tokens[base + pOff + 1]);
    positions[i * 3 + 2] = parseFloat(tokens[base + pOff + 2]);
    if (normals) {
      normals[i * 3]     = parseFloat(tokens[base + nOff]);
      normals[i * 3 + 1] = parseFloat(tokens[base + nOff + 1]);
      normals[i * 3 + 2] = parseFloat(tokens[base + nOff + 2]);
    }
    if (uvs) {
      uvs[i * 2]     = parseFloat(tokens[base + tOff]);
      uvs[i * 2 + 1] = parseFloat(tokens[base + tOff + 1]);
    }
  }
  return { count, positions, normals, uvs };
}

function parseIndexData(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length % 3 !== 0) {
    throw new Error(`Index data length ${tokens.length} not divisible by 3 (expected triangle list)`);
  }
  const indices = new Uint32Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) indices[i] = parseInt(tokens[i], 10) >>> 0;
  return indices;
}

function pickHighestLod(drawable) {
  for (const key of LOD_KEYS) {
    if (drawable[key]) return { key, node: drawable[key] };
  }
  return null;
}

function extractShaderNames(drawable) {
  const shaders = drawable?.ShaderGroup?.Shaders?.Item;
  return asArray(shaders).map((s) => normalizeShaderName(s?.Name ?? s?.FileName ?? ''));
}

/**
 * Parse a YFT XML string and return paint-only geometry chunks.
 *
 * @param {string} xmlText
 * @param {object} options
 * @param {string[]} options.shaderWhitelist - normalized shader names to keep
 * @param {(stage: string, info?: object) => void} [options.onProgress]
 * @returns {{
 *   shaders: string[],
 *   lodUsed: string,
 *   geometries: Array<{ shaderName: string, shaderIndex: number, positions: Float32Array, normals: Float32Array|null, uvs: Float32Array|null, indices: Uint32Array }>,
 *   discardedCount: number,
 *   warnings: string[]
 * }}
 */
function parseYft(xmlText, options = {}) {
  const whitelist = (options.shaderWhitelist || DEFAULT_PAINT_SHADERS).map(normalizeShaderName);
  const onProgress = options.onProgress || (() => {});
  const warnings = [];

  onProgress('parsing-xml');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    preserveOrder: false,
  });
  const doc = parser.parse(xmlText);

  const fragment = doc.Fragment;
  if (!fragment) throw new Error('Not a YFT file: <Fragment> root not found');
  const drawable = fragment.Drawable;
  if (!drawable) throw new Error('Not a YFT drawable: <Fragment>/<Drawable> not found');

  const shaders = extractShaderNames(drawable);
  if (shaders.length === 0) warnings.push('Shader group is empty');

  const lod = pickHighestLod(drawable);
  if (!lod) throw new Error('No DrawableModels (High/Med/Low/VeryLow) on the main drawable');
  if (lod.key !== 'DrawableModelsHigh') {
    warnings.push(`No High LOD found; using ${lod.key}`);
  }

  const models = asArray(lod.node.Item);
  onProgress('walking-geometries', { lod: lod.key, modelCount: models.length });

  const kept = [];
  let discarded = 0;

  for (const model of models) {
    const geometries = asArray(model?.Geometries?.Item);
    for (const geom of geometries) {
      const shaderIndex = parseInt(geom?.ShaderIndex?.['@_value'] ?? geom?.ShaderIndex ?? '-1', 10);
      const shaderName = shaders[shaderIndex] || '';
      if (!whitelist.includes(shaderName)) {
        discarded++;
        continue;
      }

      const plan = buildLayoutPlan(geom?.VertexBuffer?.Layout);
      if (!plan || plan.error) {
        warnings.push(`Skipped geometry (shader=${shaderName}, idx=${shaderIndex}): ${plan?.error || 'no Layout'}`);
        discarded++;
        continue;
      }

      const vData = geom?.VertexBuffer?.Data;
      const iData = geom?.IndexBuffer?.Data;
      if (typeof vData !== 'string' || typeof iData !== 'string') {
        warnings.push(`Skipped geometry (shader=${shaderName}, idx=${shaderIndex}): missing Data`);
        discarded++;
        continue;
      }

      try {
        const verts = parseVertexData(vData, plan);
        const indices = parseIndexData(iData);
        kept.push({
          shaderName,
          shaderIndex,
          positions: verts.positions,
          normals: verts.normals,
          uvs: verts.uvs,
          indices,
        });
      } catch (err) {
        warnings.push(`Skipped geometry (shader=${shaderName}, idx=${shaderIndex}): ${err.message}`);
        discarded++;
      }
    }
  }

  onProgress('done', { kept: kept.length, discarded });

  return {
    shaders,
    lodUsed: lod.key,
    geometries: kept,
    discardedCount: discarded,
    warnings,
  };
}

module.exports = { parseYft };
