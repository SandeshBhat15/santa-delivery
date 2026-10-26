import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MagicalFlightTrail } from './MagicalFlightTrail.js';
import { MagicTrail } from './MagicTrail.js';

// World-space anchor for the golden light ribbon: just behind the sleigh's
// rear rail and level with it (same convention as the dust plume).
const TRAIL_BACK_OFFSET = 0.11;
const TRAIL_UP_OFFSET = 0.035;

export class SleighController {
  constructor(scene, camera, controls, chunkSystem, isMobile = false) {
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.chunkSystem = chunkSystem;
    this.isMobile = isMobile;

    this.group = new THREE.Group();
    this.group.name = 'SantaSleighGroup';
    this.scene.add(this.group);

    // Initial position above starting village (low rooftop cruising height)
    this.position = new THREE.Vector3(0, 0.8, 8.0);
    this.rotationY = 0.0; // Heading north (-Z) toward village center
    this.pitch = 0.0;
    this.bank = 0.0;
    this.speed = 1.8;

    // Movement & Non-Linear Aerodynamics Parameters (Smooth, natural, magical flight)
    this.baseCruiseSpeed = 1.8;   // m/s: comfortable magical forward cruise
    this.minSpeed        = 0.9;   // m/s: lowest speed during steep climbs / heavy maneuvers
    this.maxSpeed        = 2.8;   // m/s: top natural speed during steep dives
    this.accelRate       = 1.5;   // gradual exponential acceleration momentum
    this.decelRate       = 1.2;   // gentle exponential coasting deceleration
    this.turnSpeed       = 1.55;  // smooth, predictable turning rate
    this.turnVelocity    = 0.0;   // smoothed rotational velocity for natural yaw inertia
    this.smoothTurnInput = 0.0;
    this.bankMax         = 0.38;  // subtle, majestic sleigh banking (radians)
    this.climbSpeed      = 3.2;

    // Controls input state (pure flight: no boost)
    this.inputs = {
      left: false,
      right: false,
      up: false,
      down: false,
      drop: false
    };

    // Clean key mappings (Desktop: A/D to steer, W/S for climb/dive, Space/E to drop gift)
    this.keyMap = {
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      climb: ['KeyW', 'ArrowUp'],
      descend: ['KeyS', 'ArrowDown'],
      drop: ['KeyE', 'Space']
    };

    // Virtual analog joystick control: x = steering (yaw + banking roll), y = altitude (pitch + climb/dive)
    this.joystick = { x: 0, y: 0 };
    this.verticalInput = 0.0;

    // Flight simulation dynamics: smooth, floaty, magical lift & descent
    this.climbRate = 1.7;
    this.descendRate = 1.5;
    this.verticalSpeed = 0.0;
    this.verticalAccel = 4.5; // gentle, non-snappy vertical acceleration
    this.verticalDecel = 3.8; // smooth vertical damping
    this.pitchMax = 0.32;     // natural pitch angle (radians) during climb/dive

    // Dynamic Terrain-Relative Altitude Limits (meters above local terrain)
    this.minAltitudeAboveTerrain = 0.01; // Skims ground level with runners directly in the snow
    this.targetFlightAltitude = 0.40;    // Player-controlled cruising flight level above terrain (scaled for mini rig)
    // NOTE: maxAltitudeAboveTerrain is intentionally removed — the sleigh can now climb freely.
    // Only the terrain floor (minAltitudeAboveTerrain) is enforced for safety.
    this.altitudeSoftBuffer = 0.06;      // Distance from ground floor where vertical damping begins

    // Sleigh & Reindeer Collision Bounds (meters)
    // Sleigh body + reindeer team total footprint calibrated for the half-size rig
    this.collisionRadiusXZ = 0.14;
    this.collisionHalfHeight = 0.10;
    this.safetyMargin = 0.03; // Wall and roof clearance margin
    this._hasCrashed = false;
    this._crashGraceUntil = 0;

    // Follow camera offset & sensitivity (calibrated close third-person follow camera for mini rig)
    this.camDistance = isMobile ? 1.05 : 0.82;
    this.camHeight = isMobile ? 0.42 : 0.32;
    this.camTargetPos = new THREE.Vector3();
    this.camLookPos = new THREE.Vector3();
    this._currentCamLookPos = new THREE.Vector3();
    this._camBackVec = new THREE.Vector3();
    this._camForwardVec = new THREE.Vector3();
    this._headingVec = new THREE.Vector3();
    this._reinDir = new THREE.Vector3();
    this._reinCollarPos = new THREE.Vector3();
    this._upVec = new THREE.Vector3(0, 1, 0);

    // Reindeer leg / harness animation references
    this.animTime = 0.0;
    this.reindeerLegs = [];
    this.reindeers = [];
    this.mixers = []; // AnimationMixers for deer instances
    this.fairyLights = []; // Twinkling fairy light bulbs on antlers
    this.sleighLanterns = []; // Warm glowing lanterns on sleigh runners

    // Sparse enchanted dust plume that follows the sleigh's world-space path
    this.flightTrail = new MagicalFlightTrail(this.scene, this.camera, this.isMobile);

    // Additive golden light ribbon layered over the dust, sampling the same
    // rear anchor. Tuned for this scene's mini rig (sleigh is ~0.28 m wide,
    // cruises 1.8-2.8 m/s), hence the widthScale down from the source file.
    this.magicTrail = new MagicTrail(this.scene, this.camera, {
      life: 1.0,
      minDist: 0.04,
      maxPoints: this.isMobile ? 240 : 420,
      widthScale: 0.05,
      gainScale: this.isMobile ? 0.42 : 0.5,
      streak: 0.6,
      glow: this.isMobile ? 0.85 : 1.0
    });
    this._magicAnchor = new THREE.Vector3();
    this._magicAnchorInit = false;
    this._magicAnchorSmooth = new THREE.Vector3();
    // Empty object parented to the sleigh rig: the ribbon emits from its rear underside
    this._trailAttach = new THREE.Object3D();
    this._trailAttach.name = 'MagicTrailAnchor';

    this._setupInputListeners();
    this._buildSleighAndReindeer();
  }

  _setupInputListeners() {
    window.addEventListener('keydown', (e) => {
      // Don't capture inputs if typing into an input field
      if (e.target && ['input', 'textarea'].includes(e.target.tagName?.toLowerCase())) return;

      const code = e.code;
      if (this.keyMap.left.includes(code)) {
        this.inputs.left = true;
      } else if (this.keyMap.right.includes(code)) {
        this.inputs.right = true;
      } else if (this.keyMap.climb.includes(code)) {
        e.preventDefault();
        this.inputs.up = true;
      } else if (this.keyMap.descend.includes(code)) {
        e.preventDefault();
        this.inputs.down = true;
      } else if (this.keyMap.drop.includes(code)) {
        this.inputs.drop = true;
        if (window.deliverySystem) window.deliverySystem.triggerDelivery();

      }
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code;
      if (this.keyMap.left.includes(code)) {
        this.inputs.left = false;
      } else if (this.keyMap.right.includes(code)) {
        this.inputs.right = false;
      } else if (this.keyMap.climb.includes(code)) {
        this.inputs.up = false;
      } else if (this.keyMap.descend.includes(code)) {
        this.inputs.down = false;
      } else if (this.keyMap.drop.includes(code)) {
        this.inputs.drop = false;

      }
    });
  }

  _buildSleighAndReindeer() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/libs/draco/gltf/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      '/assets/models/santa&deer.glb',
      (gltf) => {
        this._setupSantaAndDeerModel(gltf);
      },
      undefined,
      (err) => {
        console.warn('Could not load /assets/models/santa&deer.glb, falling back to procedural sleigh:', err);
        this._buildProceduralFallback();
      }
    );
  }

  _setupSantaAndDeerModel(gltf) {
    const rawScene = gltf.scene;
    const animations = gltf.animations || [];
    const runClip = animations.find(a => a.name === 'Run') || animations[0];

    // Master container for Santa, Sleigh, and Reindeer team
    // Rotate Math.PI around Y because model faces +Z whereas SleighController flies towards -Z
    const masterGroup = new THREE.Group();
    masterGroup.name = 'MasterSantaRig';
    masterGroup.rotation.y = Math.PI;

    // Overall rig scaled down again by 50% for miniature village flight proportions
    const MODEL_SCALE = 0.244;
    masterGroup.scale.setScalar(MODEL_SCALE);

    // Locate the three components in GLB
    let sledgeNode = null;
    let santaRigNode = null;
    let deerRigNode = null;

    rawScene.children.forEach(child => {
      const name = (child.name || '').toLowerCase();
      if (name.includes('sledge') || name.includes('sleigh')) {
        sledgeNode = child;
      } else if (name.includes('santa')) {
        santaRigNode = child;
      } else if (name.includes('horse') || name.includes('deer')) {
        deerRigNode = child;
      }
    });

    // Fallbacks if named differently
    if (!sledgeNode && rawScene.children[0]) sledgeNode = rawScene.children[0];
    if (!deerRigNode && rawScene.children[1]) deerRigNode = rawScene.children[1];
    if (!santaRigNode && rawScene.children[2]) santaRigNode = rawScene.children[2];

    // Enable shadows on all meshes
    rawScene.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // 1. Sleigh & Santa Group (with slight vertical hover bob)
    const sleighGroup = new THREE.Group();
    sleighGroup.name = 'SleighAndSantaGroup';
    if (sledgeNode) {
      sleighGroup.add(sledgeNode);
      this._attachSleighLanterns(sledgeNode);
    }
    if (santaRigNode) {
      sleighGroup.add(santaRigNode);
    }
    masterGroup.add(sleighGroup);
    this.sleighMeshGroup = sleighGroup;

    // Golden ribbon anchor: just behind/below the sleigh's rear (sledge-node space:
    // the artist's rear lanterns sit at x ±0.07, y 0.06, z ≈ -0.15).
    this._trailAttach.position.set(0, 0.015, -0.185);
    (sledgeNode || sleighGroup).add(this._trailAttach);

    // 2. 4-Reindeer Team (2 Front Leads + 2 Behind)
    // Cloned with SkeletonUtils and animated running clips
    this.mixers = [];
    if (deerRigNode && runClip) {
      // Offset configuration relative to single deer origin [x: -0.035, z: 0.416]:
      // Lead pair (front): z: +0.72 (further ahead)
      // Second pair (behind): z: +0.42 (just ahead of sleigh)
      // Side spacing: x: -0.075 (left) and +0.075 (right)
      const deerConfigs = [
        // Front Lead Pair
        { name: 'Reindeer_Lead_L', x: -0.075, z: 0.72, timeOffset: 0.0 },
        { name: 'Reindeer_Lead_R', x:  0.075, z: 0.72, timeOffset: 0.28 },
        // Second Pair (behind leads)
        { name: 'Reindeer_Back_L', x: -0.075, z: 0.42, timeOffset: 0.45 },
        { name: 'Reindeer_Back_R', x:  0.075, z: 0.42, timeOffset: 0.15 }
      ];

      // Play Santa driving animation if available in GLTF
      const santaRigActionClip = animations.find(a => a.name === 'santa_rigAction' || a.name.includes('santa'));
      if (santaRigNode && santaRigActionClip) {
        const santaMixer = new THREE.AnimationMixer(santaRigNode);
        const sAction = santaMixer.clipAction(santaRigActionClip);
        sAction.play();
        this.mixers.push(santaMixer);
      }

      // Harness lines container
      const reinMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        roughness: 0.35,
        metalness: 0.75
      });

      // Front sleigh hitch positions
      const hitchLeft = new THREE.Vector3(-0.045, 0.07, 0.16);
      const hitchRight = new THREE.Vector3(0.045, 0.07, 0.16);

      this.reindeers = [];
      const reinBaseGeo = new THREE.CylinderGeometry(0.0018, 0.0018, 1.0, 4);

      deerConfigs.forEach((cfg) => {
        const deerClone = SkeletonUtils.clone(deerRigNode);
        deerClone.name = cfg.name;
        // Apply position relative to original deer placement in GLB
        deerClone.position.set(cfg.x, 0, cfg.z);

        const mixer = new THREE.AnimationMixer(deerClone);
        const action = mixer.clipAction(runClip);
        action.play();
        mixer.setTime(cfg.timeOffset);
        this.mixers.push(mixer);

        // Attach fairy lights directly to the head bone so they sway with the deer's gallop stride
        this._attachAntlerFairyLights(deerClone);

        masterGroup.add(deerClone);

        // Connect reins from sleigh hitch to reindeer collar
        const hitch = cfg.x < 0 ? hitchLeft : hitchRight;
        const collarOffset = new THREE.Vector3(0, 0.12, 0.05);
        const collar = new THREE.Vector3(cfg.x, 0, cfg.z).add(collarOffset);
        const dir = new THREE.Vector3().subVectors(collar, hitch);
        const len = dir.length();
        const rein = new THREE.Mesh(reinBaseGeo.clone(), reinMat);
        rein.position.copy(hitch).addScaledVector(dir, 0.5);
        rein.scale.set(1, len, 1);
        rein.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        masterGroup.add(rein);

        this.reindeers.push({
          mesh: deerClone,
          isLead: cfg.name.includes('Lead'),
          baseX: cfg.x,
          baseY: 0,
          baseZ: cfg.z,
          timeOffset: cfg.timeOffset,
          hitchPos: hitch,
          collarOffset: collarOffset,
          reinMesh: rein
        });
      });
    } else if (deerRigNode) {
      this._attachAntlerFairyLights(deerRigNode);
      masterGroup.add(deerRigNode);
    }

    this.group.add(masterGroup);
  }

  /**
   * Builds festive, twinkling fairy lights string along reindeer antler prongs
   * Uses realistic high-fidelity micro-bulbs, brass sockets, and delicate wiring
   * Attached directly to the animated 'head' bone so lights gallop realistically.
   */
  _attachAntlerFairyLights(deerObject) {
    let headBone = null;
    deerObject.traverse((c) => {
      if (c.isBone && c.name === 'head') headBone = c;
    });
    if (!headBone) return;

    // Only front lead reindeer get fairy lights for clean visual clarity
    const deerLeadPair = ['Reindeer_Lead_L', 'Reindeer_Lead_R'];
    if (!deerLeadPair.includes(deerObject.name)) return;

    const fairyLightsGroup = new THREE.Group();
    fairyLightsGroup.name = 'AntlerFairyLights';

    const colors = [
      0xffaa22, // Warm Amber
      0x27ae60, // Emerald Green
      0xe74c3c, // Ruby Red
      0x00bcd4, // Frosted Cyan
      0x9b59b6, // Amethyst Violet
      0xf1c40f  // Golden Candlelight
    ];

    const leftBranch = [
      { x: -0.012, y: -0.038, z: -0.012, colorIdx: 0 },
      { x: -0.022, y: -0.048, z: -0.008, colorIdx: 1 },
      { x: -0.034, y: -0.058, z: -0.002, colorIdx: 2 },
      { x: -0.046, y: -0.068, z:  0.006, colorIdx: 3 },
      { x: -0.058, y: -0.076, z:  0.012, colorIdx: 4 },
      { x: -0.068, y: -0.062, z: -0.014, colorIdx: 5 },
      { x: -0.038, y: -0.082, z:  0.020, colorIdx: 0 }
    ];

    const rightBranch = [
      { x:  0.012, y: -0.038, z: -0.012, colorIdx: 2 },
      { x:  0.022, y: -0.048, z: -0.008, colorIdx: 0 },
      { x:  0.034, y: -0.058, z: -0.002, colorIdx: 4 },
      { x:  0.046, y: -0.068, z:  0.006, colorIdx: 1 },
      { x:  0.058, y: -0.076, z:  0.012, colorIdx: 3 },
      { x:  0.068, y: -0.062, z: -0.014, colorIdx: 2 },
      { x:  0.038, y: -0.082, z:  0.020, colorIdx: 5 }
    ];

    const allPts = [...leftBranch, ...rightBranch];
    const totalBulbs = allPts.length;

    // Single InstancedMesh for all bulbs with instance colors: collapses 28 draws into 1 draw call!
    const bulbGeo = new THREE.SphereGeometry(0.0028, 8, 6);
    bulbGeo.scale(1.0, 1.3, 1.0);
    const bulbMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      fog: false
    });
    const instBulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, totalBulbs);
    instBulbs.castShadow = false;
    instBulbs.receiveShadow = false;

    // Single InstancedMesh for all brass sockets: collapses 28 draws into 1 draw call!
    const socketGeo = new THREE.CylinderGeometry(0.0014, 0.0016, 0.0020, 6);
    const socketMat = new THREE.MeshBasicMaterial({ color: 0x273024 });
    const instSockets = new THREE.InstancedMesh(socketGeo, socketMat, totalBulbs);
    instSockets.castShadow = false;
    instSockets.receiveShadow = false;

    const dummy = new THREE.Object3D();
    const colHelper = new THREE.Color();

    allPts.forEach((pt, i) => {
      // Position bulb
      dummy.position.set(pt.x, pt.y, pt.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      instBulbs.setMatrixAt(i, dummy.matrix);
      colHelper.setHex(colors[pt.colorIdx]);
      instBulbs.setColorAt(i, colHelper);

      // Position socket
      dummy.position.set(pt.x, pt.y - 0.002, pt.z);
      dummy.updateMatrix();
      instSockets.setMatrixAt(i, dummy.matrix);
    });

    instBulbs.instanceMatrix.needsUpdate = true;
    if (instBulbs.instanceColor) instBulbs.instanceColor.needsUpdate = true;
    instSockets.instanceMatrix.needsUpdate = true;

    fairyLightsGroup.add(instSockets);
    fairyLightsGroup.add(instBulbs);

    // Connecting wires
    const wireMat = new THREE.LineBasicMaterial({ color: 0x1b3820 });
    [leftBranch, rightBranch].forEach((branch) => {
      const wirePoints = branch.map(pt => new THREE.Vector3(pt.x, pt.y, pt.z));
      const wireCurve = new THREE.CatmullRomCurve3(wirePoints);
      const wireGeo = new THREE.BufferGeometry().setFromPoints(wireCurve.getPoints(12));
      const wireLine = new THREE.Line(wireGeo, wireMat);
      fairyLightsGroup.add(wireLine);
    });

    headBone.add(fairyLightsGroup);
  }

  /**
   * Illuminates the 3D artist's vintage carriage lanterns built into the rear flanks of the sleigh model
   * Calibrated with gentle candle warmth that softly accents the sleigh without glaring.
   */
  _attachSleighLanterns(sledgeMesh) {
    const lanternGroup = new THREE.Group();
    lanternGroup.name = 'SleighLanterns';

    // Warm cozy candle/mantle glass core (scaled neatly to fit inside the lantern housing)
    const candleGeo = new THREE.SphereGeometry(0.0028, 8, 8);
    candleGeo.scale(0.8, 1.2, 0.8);

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xd48833,
      emissive: new THREE.Color(0xd47722),
      emissiveIntensity: 0.35,
      roughness: 0.3,
      metalness: 0.1
    });

    // Exact geometric centers of the artist's modeled vintage lanterns on the sledge mesh:
    // Left:  x: -0.068, y: 0.0605, z: -0.144
    // Right: x: +0.070, y: 0.0605, z: -0.150
    const mounts = [
      { x: -0.068, y: 0.0605, z: -0.144 },
      { x:  0.070, y: 0.0605, z: -0.150 }
    ];

    mounts.forEach((m, idx) => {
      const lamp = new THREE.Group();
      lamp.position.set(m.x, m.y, m.z);

      // Gentle glowing candle flame inside the lantern fixture
      const flame = new THREE.Mesh(candleGeo, glassMat);
      lamp.add(flame);

      // Soft warm illuminating point light casting subtle golden ambiance on the lantern rim
      const lanternLight = new THREE.PointLight(0xff9933, 0.015, 0.30, 2.0);
      lamp.add(lanternLight);

      this.sleighLanterns.push({
        material: glassMat,
        light: lanternLight,
        baseIntensity: 0.015,
        baseEmissive: 0.35,
        freq: 2.2 + idx * 0.7,
        phase: idx * 1.5
      });

      lanternGroup.add(lamp);
    });

    sledgeMesh.add(lanternGroup);
  }

  _buildProceduralFallback() {
    // Match the half-size GLB rig so the fallback sleigh is not oversized.
    this.group.scale.setScalar(0.244);

    // 1. Sleigh Body Materials
    const redMat = new THREE.MeshStandardMaterial({
      color: 0xc41e3a,
      roughness: 0.35,
      metalness: 0.15
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xf5b041,
      roughness: 0.25,
      metalness: 0.75
    });
    const runnerMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.2,
      metalness: 0.85
    });
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x4a2e18,
      roughness: 0.7,
      metalness: 0.05
    });
    const brownMat = new THREE.MeshStandardMaterial({
      color: 0x8b5a2b,
      roughness: 0.65,
      metalness: 0.05
    });
    const darkBrownMat = new THREE.MeshStandardMaterial({
      color: 0x4a2e1b,
      roughness: 0.7,
      metalness: 0.05
    });
    const redNoseMat = new THREE.MeshStandardMaterial({
      color: 0xff2222,
      emissive: 0xff1111,
      emissiveIntensity: 2.5,
      roughness: 0.2
    });

    // Sleigh container
    const sleighMeshGroup = new THREE.Group();
    sleighMeshGroup.name = 'SleighMesh';

    // Main sleigh tub
    const tubGeo = new THREE.BoxGeometry(1.2, 0.65, 1.8);
    const tub = new THREE.Mesh(tubGeo, redMat);
    tub.position.set(0, 0.45, 0);
    tub.castShadow = true;
    tub.receiveShadow = true;
    sleighMeshGroup.add(tub);

    // Gold trim around edges
    const trimGeo = new THREE.BoxGeometry(1.28, 0.08, 1.88);
    const trim = new THREE.Mesh(trimGeo, goldMat);
    trim.position.set(0, 0.78, 0);
    trim.castShadow = true;
    sleighMeshGroup.add(trim);

    // Front curl dashboard
    const dashGeo = new THREE.CylinderGeometry(0.65, 0.65, 1.2, 12, 1, false, 0, Math.PI);
    const dash = new THREE.Mesh(dashGeo, redMat);
    dash.rotation.z = Math.PI / 2;
    dash.position.set(0, 0.7, -0.9);
    dash.castShadow = true;
    sleighMeshGroup.add(dash);

    // Sleigh runners (left & right)
    [-0.68, 0.68].forEach((rx) => {
      const runnerGeo = new THREE.BoxGeometry(0.08, 0.08, 2.5);
      const runner = new THREE.Mesh(runnerGeo, runnerMat);
      runner.position.set(rx, 0.08, 0.05);
      runner.castShadow = true;
      sleighMeshGroup.add(runner);

      const curlGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.08, 8, 1, false, 0, Math.PI);
      const curl = new THREE.Mesh(curlGeo, runnerMat);
      curl.rotation.z = Math.PI / 2;
      curl.position.set(rx, 0.26, -1.25);
      sleighMeshGroup.add(curl);

      [-0.5, 0.4].forEach((sz) => {
        const strutGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6);
        const strut = new THREE.Mesh(strutGeo, runnerMat);
        strut.position.set(rx, 0.26, sz);
        sleighMeshGroup.add(strut);
      });
    });

    // Seat cushion & interior
    const seatGeo = new THREE.BoxGeometry(1.0, 0.25, 0.6);
    const seat = new THREE.Mesh(seatGeo, woodMat);
    seat.position.set(0, 0.45, 0.2);
    sleighMeshGroup.add(seat);

    // Bag of gifts in the back of the sleigh
    const sackGeo = new THREE.SphereGeometry(0.55, 10, 8);
    const sackMat = new THREE.MeshStandardMaterial({
      color: 0x935116,
      roughness: 0.8
    });
    const sack = new THREE.Mesh(sackGeo, sackMat);
    sack.scale.set(1.0, 0.85, 0.95);
    sack.position.set(0, 0.75, 0.55);
    sack.castShadow = true;
    sleighMeshGroup.add(sack);

    // Decorative gift peek out of sack
    const giftBoxGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    const giftMat = new THREE.MeshStandardMaterial({
      color: 0x27ae60,
      roughness: 0.4
    });
    const giftBox = new THREE.Mesh(giftBoxGeo, giftMat);
    giftBox.position.set(0.18, 1.05, 0.45);
    giftBox.rotation.set(0.2, 0.4, -0.1);
    sleighMeshGroup.add(giftBox);

    this.group.add(sleighMeshGroup);
    this.sleighMeshGroup = sleighMeshGroup;

    // Golden ribbon anchor at the fallback sleigh's rear underside
    this._trailAttach.position.set(0, 0.30, 0.75);
    sleighMeshGroup.add(this._trailAttach);

    // Build Stylized Santa
    this._buildStylizedSanta(sleighMeshGroup);

    // Build Reindeer Team
    this._buildReindeerTeam(brownMat, darkBrownMat, redNoseMat, goldMat);
  }

  _loadSantaOrFallback(parent) {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/libs/draco/gltf/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      '/assets/models/santa.glb',
      (gltf) => {
        const santa = gltf.scene;
        santa.name = 'SantaModel';
        // Compute bounding box to scale and seat properly in sleigh
        const box = new THREE.Box3().setFromObject(santa);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetHeight = 1.1;
        const scale = maxDim > 0 ? targetHeight / maxDim : 0.01;
        santa.scale.setScalar(scale);

        // Position on driver seat
        santa.position.set(0, 0.5, 0.05);
        santa.rotation.y = Math.PI; // Face forward

        santa.traverse((c) => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });
        parent.add(santa);
      },
      undefined,
      (err) => {
        console.warn('Could not load santa.glb, creating stylized low-poly Santa:', err);
        this._buildStylizedSanta(parent);
      }
    );
  }

  _buildStylizedSanta(parent) {
    const santaGroup = new THREE.Group();
    santaGroup.position.set(0, 0.5, 0.05);

    const redMat = new THREE.MeshStandardMaterial({ color: 0xd63031, roughness: 0.5 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f6fa, roughness: 0.4 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xfab1a0, roughness: 0.6 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x2d3436, roughness: 0.3 });

    // Body
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), redMat);
    body.position.y = 0.32;
    body.scale.set(1.1, 1.0, 0.95);
    santaGroup.add(body);

    // Belt
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.1, 12), blackMat);
    belt.position.y = 0.32;
    santaGroup.add(belt);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), skinMat);
    head.position.set(0, 0.65, 0.05);
    santaGroup.add(head);

    // Beard
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.3, 8), whiteMat);
    beard.rotation.x = -Math.PI / 2;
    beard.position.set(0, 0.58, -0.16);
    santaGroup.add(beard);

    // Hat
    const hatBase = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.08, 10), whiteMat);
    hatBase.position.set(0, 0.78, 0.05);
    santaGroup.add(hatBase);

    const hatCone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.38, 10), redMat);
    hatCone.position.set(0, 0.96, -0.04);
    hatCone.rotation.x = -0.3;
    santaGroup.add(hatCone);

    const pomPom = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), whiteMat);
    pomPom.position.set(0, 1.1, -0.14);
    santaGroup.add(pomPom);

    parent.add(santaGroup);
  }

  _buildReindeerTeam(brownMat, darkBrownMat, redNoseMat, goldMat) {
    const teamGroup = new THREE.Group();
    teamGroup.name = 'ReindeerTeam';

    // 2 Reindeers leading in front
    const reindeers = [
      { x: -0.65, z: -2.8, name: 'Prancer', isRudolph: false },
      { x: 0.65, z: -2.8, name: 'Rudolph', isRudolph: true }
    ];

    reindeers.forEach((rData) => {
      const rGroup = new THREE.Group();
      rGroup.position.set(rData.x, 0.45, rData.z);

      // Torso
      const bodyGeo = new THREE.BoxGeometry(0.5, 0.5, 1.1);
      const body = new THREE.Mesh(bodyGeo, brownMat);
      body.castShadow = true;
      rGroup.add(body);

      // Neck & Head
      const neckGeo = new THREE.BoxGeometry(0.28, 0.55, 0.32);
      const neck = new THREE.Mesh(neckGeo, brownMat);
      neck.position.set(0, 0.42, -0.42);
      neck.rotation.x = 0.35;
      rGroup.add(neck);

      const headGeo = new THREE.BoxGeometry(0.28, 0.32, 0.42);
      const head = new THREE.Mesh(headGeo, brownMat);
      head.position.set(0, 0.65, -0.6);
      rGroup.add(head);

      // Nose (Rudolph has glowing red nose)
      const noseGeo = new THREE.SphereGeometry(0.09, 8, 8);
      const nose = new THREE.Mesh(noseGeo, rData.isRudolph ? redNoseMat : darkBrownMat);
      nose.position.set(0, 0.62, -0.83);
      rGroup.add(nose);

      // Antlers
      [-0.14, 0.14].forEach((ax) => {
        const antlerGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.45, 5);
        const antler = new THREE.Mesh(antlerGeo, darkBrownMat);
        antler.position.set(ax, 0.92, -0.55);
        antler.rotation.z = ax > 0 ? 0.35 : -0.35;
        rGroup.add(antler);

        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 5), darkBrownMat);
        branch.position.set(ax * 1.5, 0.98, -0.6);
        branch.rotation.z = ax > 0 ? 0.75 : -0.75;
        rGroup.add(branch);
      });

      // 4 Legs with pivot points for galloping animation
      const legs = [];
      const legOffsets = [
        { x: -0.18, z: -0.35, isFront: true },
        { x: 0.18, z: -0.35, isFront: true },
        { x: -0.18, z: 0.35, isFront: false },
        { x: 0.18, z: 0.35, isFront: false }
      ];

      legOffsets.forEach((lOff, legIdx) => {
        const pivot = new THREE.Group();
        pivot.position.set(lOff.x, -0.15, lOff.z);

        const legGeo = new THREE.BoxGeometry(0.12, 0.55, 0.12);
        const legMesh = new THREE.Mesh(legGeo, darkBrownMat);
        legMesh.position.y = -0.25;
        pivot.add(legMesh);

        rGroup.add(pivot);
        legs.push({ pivot, isFront: lOff.isFront, legIdx });
      });

      this.reindeerLegs.push(...legs);

      // Harness & reins connecting to sleigh
      const harnessGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.8, 4);
      const harness = new THREE.Mesh(harnessGeo, goldMat);
      harness.position.set(0, 0.05, 1.0);
      harness.rotation.x = Math.PI / 2;
      rGroup.add(harness);

      teamGroup.add(rGroup);
      this.reindeers.push(rGroup);
    });

    this.group.add(teamGroup);
  }

  setJoystickInput(x, y) {
    this.joystick.x = x;
    this.joystick.y = y;
  }

  setVerticalInput(v) {
    // v: [-1..1], positive = climb, negative = descend
    this.verticalInput = Math.max(-1.0, Math.min(1.0, v));
  }

  update(delta, elapsedTime) {
    if (delta <= 0) return;

    // 1. Analog Joystick & Keyboard Steering & Altitude
    let joyX = this.joystick.x; // Horizontal steering [-1..1]
    let joyY = this.joystick.y; // Vertical altitude [-1..1] (negative = up/climb, positive = down/dive)

    // Dead zone check for analog joystick
    const deadZone = 0.12;
    const joyMag = Math.hypot(joyX, joyY);
    if (joyMag < deadZone) {
      joyX = 0;
      joyY = 0;
    }

    // Steering / Turning (left / right)
    let turnInput = 0.0;
    if (this.inputs.left) turnInput += 1.0;
    if (this.inputs.right) turnInput -= 1.0;

    if (Math.abs(joyX) > deadZone) {
      const normalizedTurn = (Math.abs(joyX) - deadZone) / (1.0 - deadZone);
      const sign = joyX < 0 ? 1.0 : -1.0; // Left is positive rotationY, right is negative
      turnInput = sign * Math.min(Math.max(normalizedTurn, 0), 1.0);
    }

    // Smooth second-order turning with natural rotational momentum
    const targetTurnVel = turnInput * this.turnSpeed;
    const turnResponsiveness = (turnInput !== 0.0) ? 5.2 : 4.0;
    this.turnVelocity += (targetTurnVel - this.turnVelocity) * (1.0 - Math.exp(-turnResponsiveness * delta));
    this.rotationY += this.turnVelocity * delta;

    this.smoothTurnInput += (turnInput - this.smoothTurnInput) * (1.0 - Math.exp(-5.0 * delta));
    this.turnInput = this.smoothTurnInput;

    // Subtle sleigh banking roll: tilts naturally into turn with smooth spring recovery
    const targetBank = (this.turnVelocity / this.turnSpeed) * this.bankMax;
    this.bank += (targetBank - this.bank) * (1.0 - Math.exp(-4.2 * delta));

    // 2. Vertical Flight (Smooth Look-Ahead Terrain Following & Gliding)
    let localGroundH = 0.5;
    let aheadGroundH = 0.5;
    let farAheadGroundH = 0.5;

    const heading = this._headingVec.set(
      -Math.sin(this.rotationY),
      0,
      -Math.cos(this.rotationY)
    );

    if (this.chunkSystem && this.chunkSystem.getHeight) {
      localGroundH = this.chunkSystem.getHeight(this.position.x, this.position.z);
      // Predictive terrain look-ahead along forward vector (scaled for mini rig)
      aheadGroundH = this.chunkSystem.getHeight(
        this.position.x + heading.x * 0.7,
        this.position.z + heading.z * 0.7
      );
      farAheadGroundH = this.chunkSystem.getHeight(
        this.position.x + heading.x * 1.4,
        this.position.z + heading.z * 1.4
      );
    }

    // Effective terrain envelope accounts for approaching hills ahead of time
    const effectiveTerrainH = Math.max(localGroundH, aheadGroundH * 0.9 + localGroundH * 0.1, farAheadGroundH * 0.75);

    const currentAltitude = this.position.y - localGroundH;
    const minAlt = this.minAltitudeAboveTerrain;
    const buffer = this.altitudeSoftBuffer;

    let vertCommand = 0.0;
    if (this.inputs.up) vertCommand += 1.0;
    if (this.inputs.down) vertCommand -= 1.0;

    // Joystick Y controls altitude: pushing forward/up (-joyY) climbs, pulling back (+joyY) descends
    if (Math.abs(joyY) > deadZone) {
      const normY = (-joyY - Math.sign(-joyY) * deadZone) / (1.0 - deadZone);
      vertCommand += normY;
    }
    vertCommand = Math.max(-1.0, Math.min(1.0, vertCommand));

    // Smooth soft-damping near the ground floor only (no upper ceiling)
    let descendFactor = 1.0;

    if (currentAltitude < minAlt + buffer) {
      // Approaching terrain: softly taper descend rate to zero
      descendFactor = Math.max(0.0, (currentAltitude - minAlt) / buffer);
    }

    let targetVertSpeed = 0.0;
    if (vertCommand > 0) {
      // Climb freely — no ceiling clamp
      targetVertSpeed = this.climbRate * vertCommand;
      this.targetFlightAltitude = this.targetFlightAltitude + this.climbRate * vertCommand * delta * 0.9;
    } else if (vertCommand < 0) {
      targetVertSpeed = -this.descendRate * Math.abs(vertCommand) * descendFactor;
      this.targetFlightAltitude = Math.max(minAlt, this.targetFlightAltitude - this.descendRate * Math.abs(vertCommand) * delta * 0.9);
    } else {
      // Smoothly track the player's chosen flight level (whether ground-level skimming or rooftop height)
      const altDelta = this.targetFlightAltitude - currentAltitude;
      targetVertSpeed = THREE.MathUtils.clamp(altDelta * 2.2, -this.descendRate * 0.6, this.climbRate * 0.6);
    }

    // Predictive smooth contour lift: naturally glide up hills before hitting them
    const terrainClimbDeficit = (effectiveTerrainH + minAlt) - this.position.y;
    if (terrainClimbDeficit > 0) {
      // Smooth proportional lift avoids sudden velocity shocks
      const predictiveClimb = terrainClimbDeficit * 4.5;
      targetVertSpeed = Math.max(targetVertSpeed, predictiveClimb);
    }

    // Smooth vertical acceleration / deceleration with critically damped spring
    if (this.verticalSpeed < targetVertSpeed) {
      this.verticalSpeed = Math.min(this.verticalSpeed + this.verticalAccel * delta, targetVertSpeed);
    } else if (this.verticalSpeed > targetVertSpeed) {
      this.verticalSpeed = Math.max(this.verticalSpeed - this.verticalDecel * delta, targetVertSpeed);
    }

    this.position.y += this.verticalSpeed * delta;

    // Solid physical ground level floor (runners skim directly atop the snow)
    const absoluteFloor = localGroundH + minAlt;
    if (this.position.y < absoluteFloor) {
      this.position.y += (absoluteFloor - this.position.y) * Math.min(delta * 16.0, 1.0);
      if (this.verticalSpeed < 0) this.verticalSpeed = 0;
    }

    // Natural pitch inclination while climbing or diving (smooth exponential ease)
    const normVertRate = this.verticalSpeed / Math.max(this.climbRate, this.descendRate);
    const targetPitch = normVertRate * this.pitchMax;
    this.pitch += (targetPitch - this.pitch) * (1.0 - Math.exp(-4.8 * delta));

    // 3. Dynamic Aerodynamic Flight Speed & Momentum
    // Magical cruising momentum with gradual acceleration when swooping down and natural drag during climbs/turns
    let targetSpeed = this.baseCruiseSpeed;

    if (normVertRate < -0.05) {
      // Gentle gravity swooping momentum when descending
      const diveFactor = -normVertRate;
      targetSpeed += (diveFactor * 0.55 + diveFactor * diveFactor * 0.35);
    } else if (normVertRate > 0.05) {
      // Natural aerodynamic resistance during climbs
      const climbFactor = Math.min(normVertRate, 1.0);
      targetSpeed -= climbFactor * 0.38;
    }

    // Induced drag during banked turns
    const bankRatio = Math.abs(this.bank) / (this.bankMax || 0.38);
    if (bankRatio > 0.1) {
      targetSpeed -= Math.pow(bankRatio, 1.5) * 0.35;
    }

    targetSpeed = THREE.MathUtils.clamp(targetSpeed, this.minSpeed, this.maxSpeed);

    // Gradual acceleration and gentle deceleration momentum
    const speedRate = targetSpeed > this.speed ? this.accelRate : this.decelRate;
    this.speed += (targetSpeed - this.speed) * (1.0 - Math.exp(-speedRate * delta));

    // 4. Free 3D Displacement along X and Z
    if (!this.isPaused) {
      this.position.addScaledVector(heading, this.speed * delta);
    }

    // 5. House & Structure Collision Avoidance
    // Direct player-controlled flight (no automatic obstacle altitude updraft/correction);
    // soft sliding collision resolution prevents intersecting structures.
    this._resolveHouseCollisions();

    // 6. Apply Full 3D Transform to Sleigh Group
    this.group.position.copy(this.position);
    this.group.rotation.set(0, this.rotationY, 0, 'YXZ');
    this.group.rotation.x = this.pitch;
    this.group.rotation.z = this.bank;

    // 7. Restrained Vertical Bobbing & Subtle Flight Motion
    // Multi-frequency harmonic wave (0.016m primary + 0.006m secondary) gives a delicate, floating carriage feel without sea-sickness
    this.animTime += delta * (1.6 + this.speed * 0.35);
    const primaryBob = Math.sin(this.animTime * 1.35) * 0.018;
    const secondaryBob = Math.sin(this.animTime * 2.7 + 0.8) * 0.006;
    const subtleRollMotion = Math.sin(this.animTime * 0.9) * 0.012;
    const subtlePitchMotion = Math.cos(this.animTime * 1.1) * 0.010;

    if (this.sleighMeshGroup) {
      this.sleighMeshGroup.position.y = primaryBob + secondaryBob;
      this.sleighMeshGroup.rotation.z = subtleRollMotion;
      this.sleighMeshGroup.rotation.x = subtlePitchMotion;
    }

    // 8. Update Fairy Lights & Sleigh Lanterns Twinkle Animation
    if (this.fairyLights && this.fairyLights.length > 0) {
      for (let i = 0; i < this.fairyLights.length; i++) {
        const fl = this.fairyLights[i];
        const twinkle = Math.sin(this.animTime * fl.freq + fl.phase) * 0.35 + 0.95;
        fl.material.emissiveIntensity = fl.baseIntensity * Math.max(0.2, twinkle);
      }
    }

    if (this.sleighLanterns && this.sleighLanterns.length > 0) {
      for (let i = 0; i < this.sleighLanterns.length; i++) {
        const sl = this.sleighLanterns[i];
        const flicker = Math.sin(this.animTime * sl.freq + sl.phase) * 0.05 + 0.97;
        sl.material.emissiveIntensity = (sl.baseEmissive || 0.35) * flicker;
        if (sl.light) sl.light.intensity = sl.baseIntensity * flicker;
      }
    }

    // Update skeletal AnimationMixers for all reindeer instances
    if (this.mixers && this.mixers.length > 0) {
      // Speed up deer galloping animation when flying faster, gentle trot when hovering
      const animSpeed = 1.0 + Math.max(0, this.speed) * 0.18;
      for (let i = 0; i < this.mixers.length; i++) {
        this.mixers[i].update(delta * animSpeed);
      }
    }

    // Fallback procedural galloping legs if fallback model used
    this.reindeerLegs.forEach((leg) => {
      const phase = leg.isFront ? 0.0 : Math.PI;
      const angle = Math.sin(this.animTime * 4.0 + phase + leg.legIdx * 0.5) * 0.55;
      leg.pivot.rotation.x = angle;
    });

    // 9. Dynamic Reindeer Lead Steering, Climb Pitch & Dynamic Reins
    if (this.reindeers && this.reindeers.length > 0) {
      const normVert = THREE.MathUtils.clamp(this.verticalSpeed / Math.max(this.climbRate, this.descendRate), -1.0, 1.0);
      const climbPitchLead = -normVert * 0.24; // Negative X rotation tilts +Z nose upward into climb
      const turnYawLead = -(this.turnInput || 0.0) * 0.28; // Negative Y rotation heads into left turn

      for (let i = 0; i < this.reindeers.length; i++) {
        const d = this.reindeers[i];
        if (!d.mesh) continue;
        const leadFactor = d.isLead ? 1.0 : 0.65;

        // Dynamic orientation: Lead yaw into turns, climb pitch upward into climbs, and gentle gallop sway
        const gallopBob = Math.sin(this.animTime * 3.5 + (d.timeOffset || 0) * 8.0) * 0.016;
        const gallopSway = Math.sin(this.animTime * 3.0 + i) * 0.02;

        d.mesh.position.y = (d.baseY || 0) + gallopBob;
        d.mesh.rotation.y = turnYawLead * leadFactor + gallopSway;
        d.mesh.rotation.x = climbPitchLead * leadFactor;
        d.mesh.rotation.z = -(this.turnInput || 0.0) * 0.15 * leadFactor;

        // Dynamically update harness rein line connecting sleigh hitch to reindeer collar (zero per-frame allocation)
        if (d.reinMesh && d.hitchPos) {
          this._reinCollarPos.copy(d.mesh.position).add(d.collarOffset);
          this._reinDir.subVectors(this._reinCollarPos, d.hitchPos);
          const len = this._reinDir.length();
          d.reinMesh.position.copy(d.hitchPos).addScaledVector(this._reinDir, 0.5);
          d.reinMesh.scale.set(1, len, 1);
          if (len > 0.001) {
            this._reinDir.multiplyScalar(1.0 / len);
            d.reinMesh.quaternion.setFromUnitVectors(this._upVec, this._reinDir);
          }
        }
      }
    }

    // 10. Update Magical Reindeer Flight Trail
    if (this.flightTrail) {
      this.flightTrail.update(delta, {
        speed: this.speed,
        minSpeed: this.minSpeed,
        maxSpeed: this.maxSpeed,
        verticalSpeed: this.verticalSpeed,
        climbRate: this.climbRate,
        descendRate: this.descendRate,
        isBoosting: false,
        pitch: this.pitch,
        bank: this.bank,
        position: this.position,
        heading: heading,
        animTime: this.animTime
      });
    }

    // 10b. Golden light ribbon riding the same rear anchor as the dust plume
    if (this.magicTrail) {
      // Smooth the anchor so terrain-height steps and frame-to-frame drift
      // don't shake the ribbon; snap on the first frame or after a teleport.
      if (this._trailAttach.parent) {
        // Anchor rides the sleigh rig itself (rear underside), so the ribbon
        // stays welded to the body through bob, pitch and bank.
        this._trailAttach.getWorldPosition(this._magicAnchor);
        this._magicAnchor.addScaledVector(heading, -TRAIL_BACK_OFFSET);
      } else {
        // Rig not loaded yet: approximate from the controller position.
        this._magicAnchor.set(
          this.position.x - heading.x * TRAIL_BACK_OFFSET,
          this.position.y + TRAIL_UP_OFFSET,
          this.position.z - heading.z * TRAIL_BACK_OFFSET
        );
      }
      if (!this._magicAnchorInit) {
        this._magicAnchorInit = true;
        this._magicAnchorSmooth.copy(this._magicAnchor);
      } else {
        const k = 1 - Math.exp(-22 * delta);
        this._magicAnchorSmooth.lerp(this._magicAnchor, k);
        if (this._magicAnchorSmooth.distanceToSquared(this._magicAnchor) > 1.0) {
          this._magicAnchorSmooth.copy(this._magicAnchor); // teleport / reset
        }
        this._magicAnchor.copy(this._magicAnchorSmooth);
      }
      this.magicTrail.update(elapsedTime, this._magicAnchor, heading);
    }

    // 5. Update Follow Camera
    this._updateFollowCamera(delta);
  }

  _updateFollowCamera(delta) {
    if (this.cameraOverride) {
      this.camera.position.copy(this.cameraOverride.pos);
      this.camera.lookAt(this.cameraOverride.lookAt);
      if (this.controls) {
        this.controls.target.copy(this.cameraOverride.lookAt);
      }
      return;
    }

    // Camera trailing offset behind sleigh (zero per-frame allocation)
    this._camBackVec.set(
      Math.sin(this.rotationY),
      0,
      Math.cos(this.rotationY)
    );

    // Target camera position behind and above sleigh
    this.camTargetPos.copy(this.position).addScaledVector(this._camBackVec, this.camDistance);
    this.camTargetPos.y = this.position.y + this.camHeight;

    // Target look-at point ahead of sleigh for clear forward visibility
    this._camForwardVec.set(
      -Math.sin(this.rotationY),
      0,
      -Math.cos(this.rotationY)
    );
    this.camLookPos.copy(this.position).addScaledVector(this._camForwardVec, 0.65);
    this.camLookPos.y = this.position.y + 0.12;

    // First frame initialization of look target
    if (!this._camLookInitialized) {
      this._currentCamLookPos.copy(this.camLookPos);
      this.camera.position.copy(this.camTargetPos);
      this._camLookInitialized = true;
    }

    // Natural exponential easing behind the sleigh (5.5 / s) eliminates camera hitching and prevents motion sickness
    const posEase = 1.0 - Math.exp(-5.5 * delta);
    this.camera.position.lerp(this.camTargetPos, posEase);

    // Look-at point eases smoothly with slightly higher responsiveness (7.5 / s) to keep flight direction centered
    const lookEase = 1.0 - Math.exp(-7.5 * delta);
    this._currentCamLookPos.lerp(this.camLookPos, lookEase);
    this.camera.lookAt(this._currentCamLookPos);

    if (this.controls) {
      this.controls.target.copy(this._currentCamLookPos);
    }
  }

  _applyGentleObstacleAvoidance(delta, heading) {
    if (!this.chunkSystem || !this.chunkSystem.getHouseCollidersNear || this.isPaused) return;

    // Probe slightly ahead of the sleigh so rooftops are cleared before impact.
    const probeX = this.position.x + heading.x * 0.9;
    const probeZ = this.position.z + heading.z * 0.9;
    const nearbyHouses = this.chunkSystem.getHouseCollidersNear(probeX, probeZ, 1.5);
    if (!nearbyHouses || nearbyHouses.length === 0) return;

    const activeTarget = window.deliverySystem && window.deliverySystem.activeTarget;
    let lift = 0;

    for (const box of nearbyHouses) {
      const centerX = (box.min.x + box.max.x) * 0.5;
      const centerZ = (box.min.z + box.max.z) * 0.5;

      // Never auto-lift inside the drop window around the highlighted house:
      // altitude control there belongs to the player.
      if (activeTarget && activeTarget.worldPos) {
        const adx = activeTarget.worldPos.x - this.position.x;
        const adz = activeTarget.worldPos.z - this.position.z;
        if (adx * adx + adz * adz < 2.4 * 2.4) continue;
      }

      // Only assist when the sleigh is within the structure's vertical band.
      if (this.position.y > box.max.y + 0.28 || this.position.y < box.min.y - 0.22) continue;

      const dx = this.position.x - centerX;
      const dz = this.position.z - centerZ;
      const horizontalDist = Math.hypot(dx, dz);
      const reach = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5 + 0.62;
      if (horizontalDist > reach) continue;

      const clearance = (box.max.y + 0.14) - this.position.y;
      if (clearance > lift) lift = clearance;
    }

    if (lift <= 0) return;

    const groundY = this.chunkSystem.getHeight
      ? this.chunkSystem.getHeight(this.position.x, this.position.z)
      : 0.5;
    // No artificial altitude ceiling — obstacle updraft can lift the sleigh as needed.
    // Smooth, bounded lift (max ~1.5 m/s) so it feels like a guiding updraft.
    const step = Math.min(lift, 1.5 * delta);
    this.position.y = this.position.y + step;
    this.verticalSpeed = Math.max(
      this.verticalSpeed,
      (step / Math.max(delta, 1e-4)) * 0.35
    );
  }

  armHouseCollisionDetection(graceMs = 1500) {
    this._hasCrashed = false;
    this._crashGraceUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + graceMs;
  }

  _reportHouseCrash() {
    if (this._hasCrashed) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now < this._crashGraceUntil) return;

    this._hasCrashed = true;
    if (window.deliverySystem && typeof window.deliverySystem.handleHouseCrash === 'function') {
      window.deliverySystem.handleHouseCrash();
    }
  }

  _resolveHouseCollisions() {
    if (!this.chunkSystem || !this.chunkSystem.getHouseCollidersNear) return;

    // Search for nearby house AABBs within 6 meters of Santa's sleigh
    const nearbyHouses = this.chunkSystem.getHouseCollidersNear(this.position.x, this.position.z, 6.0);
    if (!nearbyHouses || nearbyHouses.length === 0) return;

    const forwardX = -Math.sin(this.rotationY);
    const forwardZ = -Math.cos(this.rotationY);

    // Collision spheres calibrated for the sleigh chassis & reindeer lead team
    const collisionNodes = [
      // Sleigh chassis center
      {
        offset: new THREE.Vector3(0, 0.05, 0),
        radius: 0.14
      },
      // Sleigh rear / sack
      {
        offset: new THREE.Vector3(-forwardX * 0.15, 0.07, -forwardZ * 0.15),
        radius: 0.12
      },
      // Lead reindeer (Rudolph & team)
      {
        offset: new THREE.Vector3(forwardX * 0.35, 0.05, forwardZ * 0.35),
        radius: 0.12
      }
    ];

    let collidedAny = false;

    for (const houseBox of nearbyHouses) {
      for (const node of collisionNodes) {
        const nodeWorldX = this.position.x + node.offset.x;
        const nodeWorldY = this.position.y + node.offset.y;
        const nodeWorldZ = this.position.z + node.offset.z;

        // Closest point on house AABB
        const closestX = Math.max(houseBox.min.x, Math.min(nodeWorldX, houseBox.max.x));
        const closestY = Math.max(houseBox.min.y, Math.min(nodeWorldY, houseBox.max.y));
        const closestZ = Math.max(houseBox.min.z, Math.min(nodeWorldZ, houseBox.max.z));

        const dx = nodeWorldX - closestX;
        const dy = nodeWorldY - closestY;
        const dz = nodeWorldZ - closestZ;
        const distSq = dx * dx + dy * dy + dz * dz;

        const r = node.radius;
        if (distSq < r * r) {
          collidedAny = true;
          const dist = Math.sqrt(distSq);
          let pushX = 0;
          let pushY = 0;
          let pushZ = 0;

          if (dist > 0.0001) {
            const penetration = r - dist;
            pushX = (dx / dist) * penetration;
            pushY = (dy / dist) * penetration;
            pushZ = (dz / dist) * penetration;
          } else {
            // Sleigh is fully inside: push up towards roof peak
            pushY = (houseBox.max.y + r) - nodeWorldY;
          }

          // Displace sleigh smoothly out of house volume
          this.position.x += pushX;
          this.position.y += pushY;
          this.position.z += pushZ;

          // 1. Rooftop gliding & landing:
          if (nodeWorldY >= houseBox.max.y - 0.10) {
            // Santa is on or skimming the roof: firmly maintain minimum roof height
            const roofCeil = houseBox.max.y + 0.04;
            if (this.position.y < roofCeil) {
              this.position.y = roofCeil;
            }
            if (this.verticalSpeed < 0) {
              this.verticalSpeed = 0;
            }
          }

          // 2. Lateral wall sliding (never stick or stop completely):
          const pushLenHoriz = Math.hypot(pushX, pushZ);
          if (pushLenHoriz > 0.001) {
            const nX = pushX / pushLenHoriz;
            const nZ = pushZ / pushLenHoriz;
            const intoWall = forwardX * nX + forwardZ * nZ;
            if (intoWall < 0) {
              // Redirect velocity along the wall surface (sliding deflect) with a gentle upward glide
              this.position.x += nX * 0.02;
              this.position.z += nZ * 0.02;
              this.position.y += 0.02; // Guiding lift up over the edge
              // Maintain healthy forward cruise speed so Santa never gets pinned or stuck
              this.speed = Math.max(1.0, this.speed * 0.94);
            }
          }
        }
      }
    }

    // Trigger crash failure if configured
    if (collidedAny) {
      this._reportHouseCrash();
    }
  }

  resetFlight() {
    // Re-center the sleigh at the start of a fresh run without rebuilding it.
    this.position.set(0, 0.8, 8.0);
    this.rotationY = 0;
    this.pitch = 0;
    this.bank = 0;
    this.speed = this.baseCruiseSpeed;
    this.verticalSpeed = 0;
    this.targetFlightAltitude = 0.40;
    this.verticalInput = 0;
    this.isPaused = false;

    if (this.joystick) {
      this.joystick.x = 0;
      this.joystick.y = 0;
    }
    if (this.inputs) {
      Object.keys(this.inputs).forEach((key) => { this.inputs[key] = false; });
    }

    this.group.position.copy(this.position);
    this.group.rotation.set(0, 0, 0, 'YXZ');

    // Snap the follow camera behind the sleigh so replay does not pan across the world.
    if (this.camera) {
      const heading = new THREE.Vector3(-Math.sin(this.rotationY), 0, -Math.cos(this.rotationY));
      this.camera.position.set(
        this.position.x - heading.x * this.camDistance,
        this.position.y + this.camHeight,
        this.position.z - heading.z * this.camDistance
      );
      const lookAt = new THREE.Vector3(this.position.x, this.position.y + 0.12, this.position.z);
      this._currentCamLookPos.copy(lookAt);
      this.camera.lookAt(lookAt);
      if (this.controls && this.controls.target) this.controls.target.copy(lookAt);
    }

    if (this.flightTrail && typeof this.flightTrail.reset === 'function') {
      this.flightTrail.reset();
    }

    // Drop the ribbon samples too, so the new run never inherits a stale streak.
    if (this.magicTrail) {
      this.magicTrail.reset();
    }

    // Re-arm crash detection for the new run after the spawn grace period.
    this._hasCrashed = false;
    this.armHouseCollisionDetection(1500);
  }

  getDropOrigin() {
    // Returns world position under the sleigh for gift release
    const p = new THREE.Vector3(0, -0.05, 0);
    this.group.localToWorld(p);
    return p;
  }

  dispose() {
    if (this.flightTrail) {
      this.flightTrail.dispose();
      this.flightTrail = null;
    }
    if (this.magicTrail) {
      this.magicTrail.dispose();
      this.magicTrail = null;
    }
  }
}

