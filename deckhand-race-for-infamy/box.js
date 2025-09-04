
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const scene = new THREE.Scene();
scene.background = new THREE.Color( 0xffffff );
const w = Math.min(document.body.clientWidth - 30, 420)
const h = 460
const camera = new THREE.PerspectiveCamera( 50, w/h, 1, 2000 );

// THREE.ColorManagement.legacyMode = false;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(w, h);
document.querySelector("#box").appendChild( renderer.domElement );

let noAnim = false;
let resumeAnim;

renderer.outputColorSpace = THREE.SRGBColorSpace;

// const hemiLight = new THREE.HemisphereLight( 0xffffff, 0x8d8d8d );
// hemiLight.position.set( 0, 20, 0 );
// scene.add( hemiLight );

const light1 = new THREE.DirectionalLight( 0xffffff, 0.55 );
light1.position.set( 1, 3, 4 );
scene.add( light1 );

const light2 = new THREE.DirectionalLight( 0xffffff, 0.55 );
light2.position.set( -1, -3, -4 );
scene.add( light2 );

camera.position.z = 6;
camera.position.y = -0.5;

const controls = new OrbitControls( camera, renderer.domElement );
controls.enablePan = false;
controls.enableZoom = false;
controls.target.set( 0, 0, 0 );
controls.maxDistance = 9;
controls.minDistance = 4;
controls.update();

document.querySelector("#box").addEventListener('click', () => {
    noAnim = true;
    controls.enableZoom = true;
    clearTimeout(resumeAnim)
    resumeAnim = setTimeout(() => {
        noAnim = false;
        controls.enableZoom = false;
    }, 6000)
})

// camera.add(new THREE.PointLight(0xffffff, 3, Infinity));

const light = new THREE.AmbientLight( 0xffffff, 0.9 ); // soft white light
scene.add( light );

// White directional light at half intensity shining from the top.
// const directionalLight = new THREE.DirectionalLight( 0xffffff, 10 );
// scene.add( directionalLight );

const loader = new THREE.TextureLoader();
loader.setPath( 'box/' );
const front = loader.load('front.jpg')
const left = loader.load('left.jpg')
const right = loader.load('right.jpg')
const back = loader.load('back.jpg')
const top = loader.load('top.jpg')
const bottom = loader.load('bottom.jpg')

function getMaterial(text) {
    text.anisotropy = renderer.capabilities.getMaxAnisotropy();
    text.colorSpace = THREE.SRGBColorSpace;
    text.magFilter = THREE.NearestFilter;
    return new THREE.MeshStandardMaterial({ map: text, roughness: 0.35, metalness: 0.0, emissiveIntensity: 9 })
}

const frontMat = getMaterial(front)
const leftMat = getMaterial(left)
const rightMat = getMaterial(right)
const backMat = getMaterial(back)
const topMat = getMaterial(top)
const bottomMat = getMaterial(bottom)

const cubeMaterials = [
    rightMat, //right side
    leftMat, //left side
    topMat, //top side
    bottomMat, //bottom side
    frontMat, //front side
    backMat, //back side
];

const textureMaterial = new THREE.MeshBasicMaterial( { color: 0xF0F0F0, envMap: cubeMaterials } );

const ratio = 38

const geometry = new THREE.BoxGeometry( 100 / ratio, 150 / ratio, 25 / ratio );
const cube = new THREE.Mesh( geometry, cubeMaterials ); 
scene.add( cube );

cube.rotation.y = 0.1

function animate() {
	requestAnimationFrame( animate );

	// cube.rotation.x += 0.003;
    if (!noAnim) {
        cube.rotation.y += 0.005;
    }

	renderer.render( scene, camera );
}

animate();