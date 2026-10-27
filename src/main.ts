import './style.css';
import * as THREE from 'three';
import { box } from '@/modeler';
import { Viewport, type ViewKind } from '@/render';

const VIEWS: [ViewKind, string][] = [
  ['perspective', 'Perspective'],
  ['top', 'Top'],
  ['front', 'Front'],
  ['right', 'Right'],
];

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="menubar">WebWave 3D &nbsp; | &nbsp; Modeler &nbsp; Layout</div>
  <div class="workspace">
    <div class="toolpanel">Tools</div>
    <div class="viewports">
      ${VIEWS.map(([, n]) => `<div class="viewport"><canvas></canvas><span class="label">${n}</span></div>`)
        .join('')}
    </div>
  </div>
  <div class="statusbar">Ready</div>`;

const mesh = box(1, 1, 1);
const positions = mesh.polygons.flatMap((p) =>
  [[0, 1, 2], [0, 2, 3]].flatMap((t) => t.flatMap((i) => mesh.points[p.points[i]!]!)),
);
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
geo.computeVertexNormals();

const viewports = [...document.querySelectorAll('canvas')].map((c, i) => {
  const vp = new Viewport(c, VIEWS[i]![0]);
  vp.scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true })));
  return vp;
});

function frame() {
  for (const vp of viewports) {
    vp.resize();
    vp.render();
  }
  requestAnimationFrame(frame);
}
frame();
