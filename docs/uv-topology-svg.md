# UV Topology → SVG

A self-contained technique for rendering a mesh's UV layout as a flat SVG image. Useful for:

- **Comparing a mesh's UVs to a livery template** to confirm panels line up where the artist intended
- **Diagnosing which UV channel** holds the diffuse vs the dirt / spec / damage layout (without round-tripping through Blender)
- **Validating UV unwraps** after importing or re-unwrapping a model
- **Side-by-side channel comparisons** — render TexCoord0 and TexCoord1 to separate SVGs and eyeball which one matches the template

The output is a single `.svg` file that opens in any browser, scales infinitely, and can be overlaid on the template image in any image editor.

---

## The algorithm

The UV space is `[0,1]²`. Each triangle in the mesh has three vertices, and each vertex has a `(u, v)` UV coordinate. Walk every triangle, treat its three UVs as 2D points, and emit one SVG `<polygon>` per triangle. That's it — no projection, no transformation, no shading. Just connect the dots in UV space.

```
for each triangle (a, b, c):
    Pa = (uvs[a].u * size, mapY(uvs[a].v) * size)
    Pb = (uvs[b].u * size, mapY(uvs[b].v) * size)
    Pc = (uvs[c].u * size, mapY(uvs[c].v) * size)
    emit <polygon points="Pa Pb Pc" stroke="..." fill="none"/>
```

The only nuance is the `mapY` step.

---

## V-axis convention (the only thing that matters)

SVG and image formats both use **Y down, origin top-left**. UVs do not. Two common conventions exist:

| Source | V=0 means | What `mapY(v)` should do |
|---|---|---|
| **OpenGL / OBJ / raw YFT from CodeWalker** | bottom of the texture | `mapY(v) = 1 - v` (flip) |
| **glTF / .glb / image format** | top of the texture | `mapY(v) = v` (no flip) |

If the SVG comes out vertically mirrored compared to the template, you've got the wrong `mapY`. Flip it.

A quick way to know which you have: load the geometry, check a vertex you can identify (e.g. the front-bumper-center vertex). If its V value is small and the template paints the bumper near the bottom of the image, V=0 is at the bottom (OpenGL) — flip. If it's small and the template paints the bumper near the top, V=0 is at the top (glTF) — don't flip.

---

## Reference implementation (Node, reads parsed YFT)

This is what `LiveryLab Shells` shipped as a one-off diagnostic. Input is the parser's output (`geometries[]` with `texcoords` keyed by channel index, plus `indices` as a `Uint32Array`).

```js
const SIZE = 1024;

function uvLayoutToSvg(uvs, indices, label) {
  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" style="background:#1a1a1a">`);
  lines.push(`<rect width="${SIZE}" height="${SIZE}" fill="#1a1a1a"/>`);
  lines.push(`<text x="10" y="24" font-family="monospace" font-size="14" fill="#888">${label}</text>`);

  // YFT V is OpenGL convention (V=0 at bottom) → flip for image-natural orientation
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i+1], c = indices[i+2];
    const ax = uvs[a*2]   * SIZE, ay = (1 - uvs[a*2+1])   * SIZE;
    const bx = uvs[b*2]   * SIZE, by = (1 - uvs[b*2+1])   * SIZE;
    const cx = uvs[c*2]   * SIZE, cy = (1 - uvs[c*2+1])   * SIZE;
    lines.push(
      `<polygon points="${ax.toFixed(1)},${ay.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}" fill="none" stroke="#4a9eff" stroke-width="0.4"/>`
    );
  }

  lines.push('</svg>');
  return lines.join('\n');
}
```

Call once per `(geometry, channel)` pair you want to visualise, write to disk, open in a browser.

---

## Browser / Three.js implementation (for livery-viewer)

If you load a `.glb` with `GLTFLoader`, the `BufferGeometry`'s `attributes.uv.array` already uses glTF V semantics (V=0 at top). **No flip needed.**

```js
function uvLayoutToSvg(geometry, { size = 1024, attribute = 'uv', label = '' } = {}) {
  const uvs = geometry.attributes[attribute]?.array;
  if (!uvs) throw new Error(`Geometry has no ${attribute} attribute`);
  const index = geometry.index ? geometry.index.array : null;
  const triCount = (index ? index.length : uvs.length / 2) / 3;

  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" style="background:#1a1a1a">`,
    `<rect width="${size}" height="${size}" fill="#1a1a1a"/>`,
    label && `<text x="10" y="24" font-family="monospace" font-size="14" fill="#888">${label}</text>`,
  ];

  for (let t = 0; t < triCount; t++) {
    const a = index ? index[t*3]   : t*3;
    const b = index ? index[t*3+1] : t*3+1;
    const c = index ? index[t*3+2] : t*3+2;

    // glTF V is image-natural (V=0 at top) → no flip
    const ax = uvs[a*2] * size, ay = uvs[a*2+1] * size;
    const bx = uvs[b*2] * size, by = uvs[b*2+1] * size;
    const cx = uvs[c*2] * size, cy = uvs[c*2+1] * size;

    lines.push(
      `<polygon points="${ax.toFixed(1)},${ay.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}" fill="none" stroke="#4a9eff" stroke-width="0.4"/>`
    );
  }

  lines.push('</svg>');
  return lines.filter(Boolean).join('\n');
}
```

To render in-page rather than download:

```js
const svgText = uvLayoutToSvg(paintMesh.geometry, { label: 'paint UVs' });
const blob = new Blob([svgText], { type: 'image/svg+xml' });
const url = URL.createObjectURL(blob);
img.src = url; // <img id="img"> in your DOM
```

To download:

```js
const a = document.createElement('a');
a.href = url;
a.download = 'uv-layout.svg';
a.click();
URL.revokeObjectURL(url);
```

For multiple UV channels, BufferGeometry exposes them as `attributes.uv`, `attributes.uv1`, `attributes.uv2`, etc. — pass the attribute name:

```js
uvLayoutToSvg(geo, { attribute: 'uv',  label: 'TC0' });
uvLayoutToSvg(geo, { attribute: 'uv1', label: 'TC1' });
```

---

## Overlaying on a template image

To visually verify alignment, overlay the SVG on the template PNG in any image editor (or in CSS):

```html
<div style="position:relative; width:1024px; height:1024px">
  <img src="livery-template.png" style="position:absolute; inset:0; width:100%; height:100%; opacity:0.5"/>
  <img src="uv-layout.svg"      style="position:absolute; inset:0; width:100%; height:100%"/>
</div>
```

If the wireframe traces the panel boundaries drawn on the template, the UV channel and V-flip are correct. If it traces somewhere else, the channel is wrong, the V-flip is wrong, or the template was authored against a different unwrap.

---

## Possible enhancements

- **Per-island colouring** — flood-fill connected triangles in UV space and assign a hue per island so seams pop visually.
- **Vertex / edge highlight** — show selected vertices or seams on top of the wireframe by drawing them as larger circles or thicker lines.
- **Density heatmap** — fill each triangle with an opacity proportional to its UV-space area divided by its 3D area, exposing UV stretching.
- **Multi-mesh stack** — render every mesh of a model into the same `<svg>` with one colour per mesh, so you can see whether they share the same UV atlas or not.
- **PNG rasterization** — pipe the SVG through `<canvas>` and `toBlob('image/png')` for fixed-resolution exports embeddable elsewhere.
