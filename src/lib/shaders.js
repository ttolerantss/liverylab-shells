const DEFAULT_PAINT_SHADERS = [
  'vehicle_paint',
  'vehicle_paint_generic',
  'vehicle_paint1',
  'vehicle_paint2',
  'vehicle_paint3',
  'vehicle_paint4',
  'vehicle_paint5',
  'vehicle_paint6',
  'vehicle_paint7',
  'vehicle_paint8',
  'vehicle_paint9',
];

function normalizeShaderName(name) {
  if (!name) return '';
  return String(name).trim().toLowerCase().replace(/\.sps$/i, '');
}

module.exports = {
  DEFAULT_PAINT_SHADERS,
  normalizeShaderName,
};
