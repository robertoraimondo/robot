import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";

const host = document.querySelector("#threeStage");
const notice = document.createElement("div");
notice.className = "model-notice";
notice.hidden = true;
notice.textContent = "";
host.appendChild(notice);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
camera.position.set(0, 1.55, 5.2);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xdff8ff, 0x0b0e14, 1.7));

const key = new THREE.DirectionalLight(0xffffff, 2.8);
key.position.set(3, 5, 4);
key.castShadow = true;
scene.add(key);

const rim = new THREE.PointLight(0x18d8ff, 5, 8);
rim.position.set(-2.4, 1.8, 2.4);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(3.2, 96),
  new THREE.MeshStandardMaterial({ color: 0x07151d, roughness: 0.38, metalness: 0.16 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1.25;
floor.receiveShadow = true;
scene.add(floor);

const loader = new GLTFLoader();
const clock = new THREE.Clock();
const actions = new Map();

let avatar = null;
let mixer = null;
let currentAction = null;
let motion = "idle";
let targetTurn = 0;
let currentTurn = 0;
let talking = false;
let outfitIndex = 0;

function resize() {
  const width = host.clientWidth || 480;
  const height = host.clientHeight || 640;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

window.addEventListener("resize", resize);
resize();

function setNotice(message) {
  notice.textContent = message;
  notice.hidden = !message;
}

function normalizeClipName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function chooseClip(names) {
  if (!mixer) {
    return null;
  }

  for (const [keyName, action] of actions.entries()) {
    if (names.some((name) => keyName.includes(name))) {
      return action;
    }
  }

  return actions.values().next().value || null;
}

function playClip(names) {
  const action = chooseClip(names);
  if (!action || action === currentAction) {
    return;
  }

  action.reset();
  action.enabled = true;
  action.fadeIn(0.22);
  action.play();

  if (currentAction) {
    currentAction.fadeOut(0.22);
  }

  currentAction = action;
}

function loadAvatar() {
  loader.load(
    "assets/aiva-avatar.glb",
    (gltf) => {
      avatar = gltf.scene;
      avatar.position.set(0, -1.22, 0);
      avatar.rotation.y = 0;
      avatar.traverse((child) => {
        if (!child.isMesh) {
          return;
        }
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material.roughness = Math.min(child.material.roughness ?? 0.5, 0.55);
        }
      });

      scene.add(avatar);
      document.body.classList.add("has-3d-avatar");
      mixer = new THREE.AnimationMixer(avatar);
      gltf.animations.forEach((clip) => {
        actions.set(normalizeClipName(clip.name), mixer.clipAction(clip));
      });

      setNotice("");
      playClip(["idle", "breath", "stand"]);
    },
    undefined,
    () => {
      setNotice("");
    }
  );
}

loadAvatar();

function applyMotion() {
  if (!avatar) {
    return;
  }

  if (motion === "dance") {
    playClip(["dance", "dancing"]);
  } else if (motion === "walk") {
    playClip(["walk", "walking"]);
  } else if (motion === "sit") {
    playClip(["sit", "sitting", "chair"]);
  } else if (motion === "wave") {
    playClip(["wave", "waving"]);
  } else if (motion === "sleep") {
    playClip(["sleep", "rest"]);
  } else {
    playClip(["idle", "breath", "stand"]);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;

  if (mixer) {
    mixer.update(delta);
  }

  if (avatar) {
    if (motion === "turn360") {
      currentTurn += delta * 1.8;
    } else {
      currentTurn += (targetTurn - currentTurn) * 0.08;
    }

    avatar.rotation.y = currentTurn;
    avatar.position.y = -1.22 + (motion === "dance" ? Math.sin(elapsed * 4) * 0.035 : 0);

    if (talking) {
      const jaw = avatar.getObjectByName("Jaw") || avatar.getObjectByName("jaw") || avatar.getObjectByName("Mouth");
      if (jaw) {
        jaw.rotation.x = Math.abs(Math.sin(elapsed * 18)) * 0.16;
      }
    }
  }

  renderer.render(scene, camera);
}

animate();

window.aiva3D = {
  setMotion(nextMotion) {
    motion = nextMotion;
    applyMotion();
  },
  setMood() {},
  setTurnAngle(angle) {
    targetTurn = THREE.MathUtils.degToRad(angle);
  },
  setTalking(value) {
    talking = Boolean(value);
  },
  changeOutfit() {
    outfitIndex = (outfitIndex + 1) % 4;
    if (!avatar) {
      return;
    }

    const colors = [0xffffff, 0xff9fce, 0x65d7ff, 0x1b1d27];
    avatar.traverse((child) => {
      if (child.isMesh && child.material?.color && /dress|skirt|cloth|body|suit/i.test(child.name)) {
        child.material.color.setHex(colors[outfitIndex]);
      }
    });
  },
  stop() {
    motion = "idle";
    targetTurn = 0;
    currentTurn = 0;
    talking = false;
    applyMotion();
  }
};

window.dispatchEvent(new CustomEvent("aiva3d-ready"));
