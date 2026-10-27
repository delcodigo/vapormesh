# VaporMesh project format (`.vmesh`)

A binary container, like glTF's `.glb`: a fixed header, a **JSON chunk** for structured data, and a
**binary chunk** for the bulk geometry. All integers and floats are little-endian.

```
offset  size  field
0       4     magic: "VMSH"
4       4     format version (uint32), currently 1
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
      "surfaces": [ { "name": "Default", "color": [r,g,b], "diffuse": 1, "luminosity": 0, "specular": 0,
                      "glossiness": 0.2, "smoothing": false, "smoothingAngle": 89, "doubleSided": false } ],
      "points": 8,                 // number of points
      "polygons": 6,               // number of polygons
      "indices": 24                // total point references over all polygons
    }
  ],
  "display": { "mode": "wire" | "shaded" | "shaded-wire",
               "retro": { "resolutionHeight": 240, "colorLevels": 32, "dither": 1 } },
  "editor": {                      // optional: how the editor was set up. Cosmetic, never fatal
    "selectMode": "points" | "polygons",
    "customPivot": [x, y, z] | null,
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

The layers' data follow one another, in the order of the `layers` array. For each layer:

| Section | Type | Count |
|---------|------|-------|
| point coordinates, x y z per point | float64 | `3 * points` |
| surface index of each polygon | uint32 | `polygons` |
| number of points in each polygon | uint32 | `polygons` |
| point indices of all polygons, concatenated | uint32 | `indices` |

A layer therefore takes `24*points + 8*polygons + 4*indices` bytes, and the chunk length is the sum
over all layers. Polygons list their points counter-clockwise as seen from the front face.

## Validation

A reader must check, before allocating, that the sizes in the JSON add up to the binary chunk length.
It must reject non-finite coordinates, polygons with no points, point indices >= `points`, and surface
indices >= the layer's surface count. VaporMesh does all of these and changes nothing on failure.

Changing the layout of the binary chunk requires a new format version.
