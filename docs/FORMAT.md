# VaporMesh project format (`.vmesh`)

A binary container, like glTF's `.glb`: a fixed header, a **JSON chunk** for structured data, and a
**binary chunk** for the bulk geometry. All integers and floats are little-endian.

```
offset  size  field
0       4     magic: "VMSH"
4       4     format version (uint32), currently 2
8       4     JSON chunk length in bytes (uint32)
12      4     binary chunk length in bytes (uint32)
16      J     JSON chunk (UTF-8)
16+J    B     binary chunk
```

The file length must equal `16 + J + B` exactly. The JSON chunk is plain text, so
`head -c 600 file.vmesh` shows the layer table, surfaces and settings.

## JSON chunk

```jsonc
{
  "app": "VaporMesh",
  "activeLayer": 0,
  "layers": [                      // at most 10, in layer order
    {
      "surfaces": [ { "name": "Default", "colorIndex": 12, "diffuse": 1, "luminosity": 0, "specular": 0,
                      "glossiness": 0.2, "smoothing": false, "smoothingAngle": 89, "doubleSided": false,
                      "texture": "Checker" | null, "wrap": "repeat" | "clamp", "transparent": false } ],
      "points": 8,                 // number of points
      "polygons": 6,               // number of polygons
      "indices": 24,               // total point references over all polygons
      "uvs": true                  // v2: the layer has a (u, v) for every polygon corner
    }
  ],
  "palette": true,                 // v2: the binary chunk holds the project palette
  "images": [                      // v2: indexed images, in the order their pixels appear
    { "name": "Checker", "width": 64, "height": 64 }
  ],
  "display": { "mode": "wire" | "shaded" | "shaded-wire",
               "retro": { "resolutionHeight": 240, "colorLevels": 32, "dither": 1, "usePalette": true } },
  "editor": {                      // optional: how the editor was set up. Cosmetic, never fatal
    "selectMode": "points" | "polygons",
    "customPivot": [x, y, z] | null,
    "hiddenLayers": [2, 5],        // optional: layers (0-based) that are not drawn

    "views": {                     // any subset of: perspective, top, face, left
      "perspective": { "target": [x,y,z], "radius": 6, "theta": 0.64, "phi": 1.0 },
      "top":         { "target": [x,y,z], "orthoSize": 4 }
    }
  }
}
```

`target` is the point a view is centred on. Orthographic views save `orthoSize` (world units visible
vertically); the Perspective view saves its orbit as `radius`, `theta` (azimuth) and `phi` (polar angle
from +Y), in radians. Selection and panel positions are not saved.

Readers fill in defaults for surface or display fields they don't find and ignore ones they don't
know, so adding a field does not need a new format version.

## Binary chunk

The layers' data come first, one after another in the order of the `layers` array. For each layer:

| Section | Type | Count |
|---------|------|-------|
| point coordinates, x y z per point | float64 | `3 * points` |
| surface index of each polygon | uint32 | `polygons` |
| number of points in each polygon | uint32 | `polygons` |
| point indices of all polygons, concatenated | uint32 | `indices` |
| *v2, only if the layer has `"uvs": true`:* u, v for each entry of the index list above | float64 | `2 * indices` |

A layer therefore takes `24*points + 8*polygons + 4*indices` bytes, plus `16*indices` with UVs.

After all the layers, in version 2:

| Section | Type | Count |
|---------|------|-------|
| the project palette, r g b per colour (only if `"palette": true`) | uint8 | `768` (256 colours) |
| the pixels of each image, in the order of `images`, row 0 first | uint8 palette indices | `width * height` each |

The chunk length is the sum of all of it. Polygons list their points counter-clockwise as seen from the
front face.

### UVs and images

- UVs are **per polygon corner**, parallel to the polygon's point list, so a face can sit anywhere in a
  shared atlas. The origin is the top-left of the image and v grows downward, like the image rows and glTF.
  They are normalised: 0..1 covers the image, whatever its size.
- A layer with any UVs writes them for every polygon; a polygon with none gets (0, 0) at each corner.
- A surface names its image in `texture`. A name with no matching image is allowed and draws as a plain colour.
- Image sides are powers of two from 8 to 256. Pixels are indices into the palette; there is one palette for
  the whole project.

### Surface colours

A surface's base colour is `colorIndex`, an index (0..255) into the project palette, so editing the palette
recolours every surface that uses it. Files written before this carried `"color": [r, g, b]` (0..1) instead;
a reader maps those to the nearest entry of the file's palette (the default palette for version 1 files).
`colorIndex` wins if both are present, and an invalid index falls back to 12.

### Version history

- **1:** layers only. Readers of version 2 load these files and supply the default palette and starter images.
- **2:** adds UVs, the palette and images, `surface.texture`/`wrap`, `retro.usePalette` and `surface.colorIndex` (replacing the RGB `color`; no version bump, since the JSON is read leniently).

## Validation

A reader must check, before allocating, that the sizes in the JSON (layers, UVs, palette, images) add up to
the binary chunk length. It must reject non-finite coordinates or UVs, polygons with no points, point
indices >= `points`, surface indices >= the layer's surface count, duplicate image names, and image sides
that are not powers of two from 8 to 256. VaporMesh does all of these and changes nothing on failure.

Changing the layout of the binary chunk requires a new format version.
