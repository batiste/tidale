import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const container = document.querySelector('#box');
const w = Math.min(document.body.clientWidth - 30, 420);
const h = 460;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(w, h);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Neutral tone mapping keeps the printed colours faithful while taming highlights
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// Soft studio lighting and reflections from a generated room environment
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;

// Key light from the upper left, casting the shadow on the floor.
// It is attached to the camera (below) so the front stays lit when the box is rotated by hand.
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(-2, 6.5, -2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
key.shadow.radius = 12;
key.shadow.blurSamples = 16;
key.shadow.bias = -0.0005;

const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
camera.position.set(0, -0.5, 6);
camera.add(key);
scene.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableZoom = false;
controls.enableDamping = true;
controls.target.set(0, 0, 0);
controls.maxDistance = 9;
controls.minDistance = 4;
controls.update();

let noAnim = false;
let resumeAnim;
container.addEventListener('click', () => {
    noAnim = true;
    controls.enableZoom = true;
    clearTimeout(resumeAnim);
    resumeAnim = setTimeout(() => {
        noAnim = false;
        controls.enableZoom = false;
    }, 6000);
});

const texture = new THREE.TextureLoader().load('box/box.jpg');
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

// Satin-laminated cardboard: a matte base with a light clear coat for soft reflections
const material = new THREE.MeshPhysicalMaterial({
    map: texture,
    roughness: 0.6,
    metalness: 0.0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.35,
});
const hidden = new THREE.MeshBasicMaterial({ visible: false });

// All box artwork lives in a single 1500x1200 atlas (6 px/mm), generated from box-front.pdf and box-back.pdf:
// - left 900x1200: the lid's front face (100x150mm) surrounded by its four 25mm sides
// - top right 594x894: the base's back face (99x149mm)
const ATLAS_W = 1500, ATLAS_H = 1200, PX_PER_MM = 6;

// Rewrites a rounded box's UVs. uvFor(q, face) returns a pixel position (from the top-left) in the atlas,
// where q is the vertex position with the rounded edges unrolled flat, so the print wraps around them
// without seams. Faces follow BoxGeometry's order: +x, -x, +y, -y, +z (front), -z (back).
const FACE_AXIS = ['x', 'x', 'y', 'y', 'z', 'z'];

function mapUVs(geometry, size, radius, uvFor) {
    const pos = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const p = new THREE.Vector3(), n = new THREE.Vector3(), q = new THREE.Vector3();
    for (const group of geometry.groups) {
        const axis = FACE_AXIS[group.materialIndex];
        for (let i = group.start; i < group.start + group.count; i++) {
            p.fromBufferAttribute(pos, i);
            n.fromBufferAttribute(normal, i);
            q.copy(p);
            for (const u of ['x', 'y', 'z']) {
                const half = size[u] / 2;
                if (u === axis || Math.abs(p[u]) <= half - radius) continue;
                // On a rounded edge: each face owns half of the arc, up to the fold line
                const angle = Math.atan2(Math.abs(n[u]), Math.abs(n[axis]));
                q[u] = Math.sign(p[u]) * (half - radius + radius * Math.min(angle / (Math.PI / 4), 1));
            }
            const [px, py] = uvFor(q, group.materialIndex);
            uv.setXY(i, px / ATLAS_W, 1 - py / ATLAS_H);
        }
    }
    uv.needsUpdate = true;
}

// Lid: the outer shell, open at the back. Sizes in mm.
const W = 100, H = 150, D = 25, RADIUS = 1;
const lidGeometry = new RoundedBoxGeometry(W, H, D, 3, RADIUS);
mapUVs(lidGeometry, { x: W, y: H, z: D }, RADIUS, (q, face) => {
    // Position in the unfolded lid (mm from the top-left of the net)
    let x = D + W / 2 + q.x, y = D + H / 2 - q.y;
    if (face === 1) x = D / 2 + q.z;            // left side
    if (face === 0) x = D + W + D / 2 - q.z;    // right side
    if (face === 2) y = D / 2 + q.z;            // top side
    if (face === 3) y = D + H + D / 2 - q.z;    // bottom side
    return [x * PX_PER_MM, y * PX_PER_MM];
});

// Lid walls are T thick, and the base leaves a GAP all around inside the lid
const T = 1.2, GAP = 0.75;
const IW = W - 2 * T, IH = H - 2 * T, ID = D - T;

// Inside of the lid walls and the rim at the open back
// The rim is the printed wrap folded over the edge; the walls inside are in shadow
const cardboard = new THREE.MeshPhysicalMaterial({ color: 0x5a6680, roughness: 0.7 });
const insideWalls = new THREE.MeshPhysicalMaterial({ color: 0x141a26, roughness: 0.9, side: THREE.BackSide });
const inner = new THREE.Mesh(
    new THREE.BoxGeometry(IW, IH, ID),
    [insideWalls, insideWalls, insideWalls, insideWalls, insideWalls, hidden]
);
inner.position.z = -T / 2;

// The rim meets the rounded outer edge halfway round its arc
const rimInset = RADIUS * (1 - Math.SQRT1_2);
const rimShape = roundedRect(new THREE.Shape(), W / 2 - rimInset, H / 2 - rimInset, RADIUS - rimInset);
rimShape.holes.push(roundedRect(new THREE.Path(), IW / 2, IH / 2, 0));
const rim = new THREE.Mesh(new THREE.ShapeGeometry(rimShape, 4), cardboard);
rim.rotation.y = Math.PI;
rim.position.z = -D / 2 + rimInset;

function roundedRect(path, hw, hh, r) {
    path.moveTo(-hw + r, -hh);
    path.lineTo(hw - r, -hh);
    if (r) path.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0);
    path.lineTo(hw, hh - r);
    if (r) path.absarc(hw - r, hh - r, r, 0, Math.PI / 2);
    path.lineTo(-hw + r, hh);
    if (r) path.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI);
    path.lineTo(-hw, -hh + r);
    if (r) path.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5);
    return path;
}

// Base: sits inside the lid with a small gap and sticks out 1mm at the back
const BW = IW - 2 * GAP, BH = IH - 2 * GAP, BD = ID - 0.5;
const BASE_RADIUS = 0.8;
const baseGeometry = new RoundedBoxGeometry(BW, BH, BD, 3, BASE_RADIUS);
mapUVs(baseGeometry, { x: BW, y: BH, z: BD }, BASE_RADIUS, (q) => {
    // The base artwork is 99x149mm; seen from behind, +x is on the viewer's left
    const x = Math.min(Math.max(0.5 - q.x / BW, 0), 1) * 99;
    const y = Math.min(Math.max(0.5 - q.y / BH, 0), 1) * 149;
    return [900 + x * PX_PER_MM, y * PX_PER_MM];
});
const baseSides = new THREE.MeshPhysicalMaterial({ color: 0x1c2b3d, roughness: 0.6, clearcoat: 0.5, clearcoatRoughness: 0.35 });

const cube = new THREE.Mesh(lidGeometry, [material, material, material, material, material, hidden]);
const base = new THREE.Mesh(baseGeometry, [baseSides, baseSides, baseSides, baseSides, baseSides, material]);
base.position.z = -D / 2 - 1 + BD / 2;
cube.add(inner, rim, base);
cube.scale.setScalar(1 / 38);
scene.add(cube);

cube.traverse((mesh) => { mesh.castShadow = true; });

// Invisible floor that only shows the box's soft shadow
const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.18 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -150 / 38 / 2 - 0.15;
floor.receiveShadow = true;
scene.add(floor);

// Only render while the box is on screen
let visible = true;
new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(container);

const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);
    if (!visible) return;
    if (!noAnim) {
        cube.rotation.y += 0.3 * delta;
    }
    controls.update();
    // Keep reflections fixed relative to the viewer, like the key light
    scene.environmentRotation.copy(camera.rotation);
    renderer.render(scene, camera);
}

animate();
