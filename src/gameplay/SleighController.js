import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MagicalFlightTrail } from './MagicalFlightTrail.js';

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
    this.speed = 3.0;

    // Movement & Non-Linear Aerodynamics Parameters
    this.baseCruiseSpeed = 3.0; // Gentle forward cruising speed calibrated for miniature rig
    this.maxSpeed = 5.2;        // Maximum speed during steep dives or boost
    this.minSpeed = 1.6;        // Minimum speed during steep climbs or tight turns
    this.turnSpeed = 1.9;
    this.climbSpeed = 3.5;
    this.bankMax = 0.42;

    // Controls input state
    this.inputs = {
      left: false,
      right: false,
      up: false,
      down: false,
      drop: false,
      boost: false
    };

    // Customizable key mappings (Desktop: A/D to steer, W/S for climb/dive, Space/E to drop gift, Shift to boost)
    this.keyMap = {
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      climb: ['KeyW', 'ArrowUp', 'Space'],
      descend: ['KeyS', 'ArrowDown'],
      drop: ['KeyE'],
      boost: ['ShiftLeft', 'ShiftRight', 'KeyF']
    };

    // Virtual analog joystick control: x = steering (yaw + banking roll), y = altitude (pitch + climb/dive)
    this.joystick = { x: 0, y: 0 };
    this.verticalInput = 0.0;

    // Configurable flight simulation dynamics
    this.climbRate = 3.5;
    this.descendRate = 3.2;
    this.verticalSpeed = 0.0;
    this.verticalAccel = 8.0;
    this.verticalDecel = 6.0;
    this.pitchMax = 0.35; // Max pitch angle (radians) during climb/dive

    // Dynamic Terrain-Relative Altitude Limits (meters above local terrain)
    this.minAltitudeAboveTerrain = 0.01; // Skims ground level with runners directly in the snow
    this.targetFlightAltitude = 0.40;    // Player-controlled cruising flight level above terrain (scaled for mini rig)
    this.maxAltitudeAboveTerrain = 1.40;  // Maximum ceiling for village flight
    this.altitudeSoftBuffer = 0.06;      // Distance from boundary where vertical damping begins

    // Sleigh & Reindeer Collision Bounds (meters)
    // Sleigh body + reindeer team total footprint calibrated for reduced scale
    this.collisionRadiusXZ = 0.14;
    this.collisionHalfHeight = 0.10;
    this.safetyMargin = 0.06; // Wall and roof clearance margin

    // Follow camera offset & sensitivity (calibrated close third-person follow camera for mini rig)
    this.camDistance = isMobile ? 1.05 : 0.82;
    this.camHeight = isMobile ? 0.42 : 0.32;
    this.camLag = 6.5; // Responsive smooth follow
    this.camTargetPos = new THREE.Vector3();
    this.camLookPos = new THREE.Vector3();

    // Reindeer leg / harness animation references
    this.animTime = 0.0;
    this.reindeerLegs = [];
    this.reindeers = [];
    this.mixers = []; // AnimationMixers for deer instances
    this.fairyLights = []; // Twinkling fairy light bulbs on antlers
    this.sleighLanterns = []; // Warm glowing lanterns on sleigh runners

    // Magical flight trail emitting stardust & icy crystals from reindeer hooves
    this.flightTrail = new MagicalFlightTrail(this.scene, this.isMobile);

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
      } else if (this.keyMap.boost.includes(code)) {
        this.inputs.boost = true;
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
      } else if (this.keyMap.boost.includes(code)) {
        this.inputs.boost = false;
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

    // Overall rig scale reduced by 50% for realistic miniature village flight proportions
    const MODEL_SCALE = 0.488;
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

    // Attach magical stardust emitters to all 16 reindeer hooves
    if (this.flightTrail && this.reindeers) {
      this.flightTrail.initReindeerEmitters(this.reindeers);
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

    const fairyLightsGroup = new THREE.Group();
    fairyLightsGroup.name = 'AntlerFairyLights';

    // Festive jewel tones: Warm Amber, Emerald Green, Ruby Red, Frosted Cyan, Amethyst Violet, Golden Candlelight
    const colors = [
      0xffaa22, // Warm Amber
      0x27ae60, // Emerald Green
      0xe74c3c, // Ruby Red
      0x00bcd4, // Frosted Cyan
      0x9b59b6, // Amethyst Violet
      0xf1c40f  // Golden Candlelight
    ];

    // High quality smooth teardrop/candle mini bulb geometry with brass socket
    const bulbGeo = new THREE.SphereGeometry(0.0028, 16, 12);
    bulbGeo.scale(1.0, 1.4, 1.0); // Natural classic Christmas bulb elongation
    const socketGeo = new THREE.CylinderGeometry(0.0015, 0.0017, 0.0022, 8);
    const socketMat = new THREE.MeshStandardMaterial({
      color: 0x273024, // Vintage green braided socket collar
      roughness: 0.6,
      metalness: 0.3
    });

    // Dark green twisted garland wire connecting the bulbs along the antlers (opaque to eliminate alpha depth-box artifacts)
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x1b3820,
      transparent: false,
      depthWrite: true
    });

    // Antler prong coordinate paths in head bone local space (smooth contouring along the main beam and tines)
    const leftBranch = [
      { x: -0.012, y: -0.038, z: -0.012, colorIdx: 0, phase: 0.0 },
      { x: -0.022, y: -0.048, z: -0.008, colorIdx: 1, phase: 1.2 },
      { x: -0.034, y: -0.058, z: -0.002, colorIdx: 2, phase: 2.4 },
      { x: -0.046, y: -0.068, z:  0.006, colorIdx: 3, phase: 3.6 },
      { x: -0.058, y: -0.076, z:  0.012, colorIdx: 4, phase: 4.8 },
      { x: -0.068, y: -0.062, z: -0.014, colorIdx: 5, phase: 0.8 },
      { x: -0.038, y: -0.082, z:  0.020, colorIdx: 0, phase: 1.6 }
    ];

    const rightBranch = [
      { x:  0.012, y: -0.038, z: -0.012, colorIdx: 2, phase: 0.6 },
      { x:  0.022, y: -0.048, z: -0.008, colorIdx: 0, phase: 1.8 },
      { x:  0.034, y: -0.058, z: -0.002, colorIdx: 4, phase: 3.0 },
      { x:  0.046, y: -0.068, z:  0.006, colorIdx: 1, phase: 4.2 },
      { x:  0.058, y: -0.076, z:  0.012, colorIdx: 3, phase: 5.4 },
      { x:  0.068, y: -0.062, z: -0.014, colorIdx: 2, phase: 1.0 },
      { x:  0.038, y: -0.082, z:  0.020, colorIdx: 5, phase: 2.2 }
    ];

    [leftBranch, rightBranch].forEach((branch) => {
      // Create connecting string wire between bulbs
      const wirePoints = branch.map(pt => new THREE.Vector3(pt.x, pt.y, pt.z));
      const wireCurve = new THREE.CatmullRomCurve3(wirePoints);
      const wireGeo = new THREE.BufferGeometry().setFromPoints(wireCurve.getPoints(24));
      const wireLine = new THREE.Line(wireGeo, wireMat);
      fairyLightsGroup.add(wireLine);

      // Create each individual candle mini bulb with metal socket
      branch.forEach((pt) => {
        const col = colors[pt.colorIdx];
        const mat = new THREE.MeshStandardMaterial({
          color: col,
          emissive: new THREE.Color(col),
          emissiveIntensity: 1.6,
          roughness: 0.15,
          metalness: 0.05
        });

        const bulbContainer = new THREE.Group();
        bulbContainer.position.set(pt.x, pt.y, pt.z);

        const socket = new THREE.Mesh(socketGeo, socketMat);
        socket.position.y = -0.002;
        bulbContainer.add(socket);

        const bulb = new THREE.Mesh(bulbGeo, mat);
        bulbContainer.add(bulb);

        fairyLightsGroup.add(bulbContainer);

        this.fairyLights.push({
          material: mat,
          baseIntensity: 1.6,
          freq: 1.8 + (pt.colorIdx % 3) * 1.2,
          phase: pt.phase + Math.random() * 0.4
        });
      });
    });

    // Front lead reindeer only get the festive antler lights for clean, elegant clarity
    const deerLeadPair = ['Reindeer_Lead_L', 'Reindeer_Lead_R'];
    if (deerLeadPair.includes(deerObject.name)) {
      headBone.add(fairyLightsGroup);
    }
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

    // Smooth interpolated rotation
    this.turnInput = turnInput;
    this.rotationY += turnInput * this.turnSpeed * delta;

    // Banking roll during turns (positive banking so inner side dips naturally into turn)
    const targetBank = turnInput * this.bankMax;
    this.bank += (targetBank - this.bank) * Math.min(delta * 5.5, 1.0);

    // 2. Vertical Flight (Smooth Look-Ahead Terrain Following & Gliding)
    let localGroundH = 0.5;
    let aheadGroundH = 0.5;
    let farAheadGroundH = 0.5;

    const heading = new THREE.Vector3(
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
    const maxAlt = this.maxAltitudeAboveTerrain;
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

    // Smooth soft-damping near min and max flight boundaries (no jarring snaps)
    let climbFactor = 1.0;
    let descendFactor = 1.0;

    if (currentAltitude > maxAlt - buffer) {
      // Approaching upper altitude limit: softly taper climb rate to zero
      climbFactor = Math.max(0.0, (maxAlt - currentAltitude) / buffer);
    }
    if (currentAltitude < minAlt + buffer) {
      // Approaching terrain: softly taper descend rate to zero
      descendFactor = Math.max(0.0, (currentAltitude - minAlt) / buffer);
    }

    let targetVertSpeed = 0.0;
    if (vertCommand > 0) {
      targetVertSpeed = this.climbRate * vertCommand * climbFactor;
      this.targetFlightAltitude = Math.min(maxAlt, this.targetFlightAltitude + this.climbRate * vertCommand * delta * 0.9);
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
    } else if (currentAltitude > maxAlt) {
      const overHeight = currentAltitude - maxAlt;
      targetVertSpeed = Math.min(targetVertSpeed, -overHeight * 2.8);
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

    // Pitch inclination while climbing or diving (smoothly proportional to vertical speed)
    const normVertRate = this.verticalSpeed / Math.max(this.climbRate, this.descendRate);
    const targetPitch = normVertRate * this.pitchMax;
    this.pitch += (targetPitch - this.pitch) * Math.min(delta * 5.5, 1.0);

    // 3. Dynamic Non-Linear Aerodynamic Flight Speed
    // Graceful base speed (~4.0 m/s) with organic response to diving, climbing, turns and boost
    let targetSpeed = this.baseCruiseSpeed;

    // Non-linear Dive Gravity Boost & Climb Drag:
    if (normVertRate < -0.05) {
      // Non-linear quadratic acceleration during dives (swooping momentum)
      const diveFactor = -normVertRate;
      targetSpeed += (diveFactor * diveFactor * 1.8 + diveFactor * 0.6);
    } else if (normVertRate > 0.05) {
      // Natural aerodynamic drag & gravity work during steep climbs
      const climbFactor = Math.min(normVertRate, 1.0);
      targetSpeed -= (climbFactor * 0.95);
    }

    // Induced Drag during Banked Turns (non-linear ease into turns):
    const bankRatio = Math.abs(this.bank) / (this.bankMax || 0.42);
    if (bankRatio > 0.1) {
      targetSpeed -= Math.pow(bankRatio, 1.6) * 0.75;
    }

    // Player Sprint / Boost (Shift or KeyF)
    if (this.inputs.boost) {
      targetSpeed += 1.8;
    }

    // Clamp target within dynamic flight envelope [minSpeed..maxSpeed]
    targetSpeed = THREE.MathUtils.clamp(targetSpeed, this.minSpeed, this.maxSpeed);

    // Asymptotic non-linear exponential damping (no robotic linear steps or hard corner clamps)
    const speedResponseRate = (targetSpeed > this.speed) ? 2.5 : 2.0;
    this.speed += (targetSpeed - this.speed) * (1.0 - Math.exp(-speedResponseRate * delta));

    // 4. Free 3D Displacement along X and Z
    this.position.addScaledVector(heading, this.speed * delta);

    // 5. House & Structure Collision Avoidance
    // Checks nearby building bounding boxes with safety margins and pushes sleigh smoothly outward
    this._resolveHouseCollisions();

    // 6. Apply Full 3D Transform to Sleigh Group
    this.group.position.copy(this.position);
    this.group.rotation.set(0, this.rotationY, 0, 'YXZ');
    this.group.rotation.x = this.pitch;
    this.group.rotation.z = this.bank;

    // 7. Gentle, Majestic Hover Bobbing (Silky smooth 1.2 Hz wave, 0.032m amplitude)
    this.animTime += delta * (2.0 + this.speed * 0.4);
    const gentleBob = Math.sin(this.animTime * 1.2) * 0.032;
    if (this.sleighMeshGroup) {
      this.sleighMeshGroup.position.y = gentleBob;
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

        // Dynamically update harness rein line connecting sleigh hitch to reindeer collar
        if (d.reinMesh && d.hitchPos) {
          const currentPos = d.mesh.position.clone().add(d.collarOffset);
          const dir = new THREE.Vector3().subVectors(currentPos, d.hitchPos);
          const len = dir.length();
          d.reinMesh.position.copy(d.hitchPos).addScaledVector(dir, 0.5);
          d.reinMesh.scale.set(1, len, 1);
          d.reinMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
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
        isBoosting: !!this.inputs.boost,
        pitch: this.pitch,
        bank: this.bank,
        heading: heading,
        animTime: this.animTime
      });
    }

    // 5. Update Follow Camera
    this._updateFollowCamera(delta);
  }

  _updateFollowCamera(delta) {
    // Position camera smoothly behind and slightly above the sleigh
    const backVec = new THREE.Vector3(
      Math.sin(this.rotationY),
      0,
      Math.cos(this.rotationY)
    );

    this.camTargetPos.copy(this.position)
      .addScaledVector(backVec, this.camDistance);
    this.camTargetPos.y = this.position.y + this.camHeight;

    // Look slightly ahead of the sleigh for great visibility
    const forwardVec = new THREE.Vector3(
      -Math.sin(this.rotationY),
      0,
      -Math.cos(this.rotationY)
    );
    this.camLookPos.copy(this.position).addScaledVector(forwardVec, 0.55);
    this.camLookPos.y = this.position.y + 0.10;

    // Smooth spring dampening camera lag
    const lerpRate = Math.min(delta * 5.5, 1.0);
    this.camera.position.lerp(this.camTargetPos, lerpRate);
    this.camera.lookAt(this.camLookPos);

    if (this.controls) {
      this.controls.target.copy(this.camLookPos);
    }
  }

  _resolveHouseCollisions() {
    if (!this.chunkSystem || !this.chunkSystem.getHouseCollidersNear) return;

    // Search for nearby house AABBs within 10 meters of Santa's sleigh
    const nearbyHouses = this.chunkSystem.getHouseCollidersNear(this.position.x, this.position.z, 10.0);
    if (!nearbyHouses || nearbyHouses.length === 0) return;

    // Sleigh collision volume modeled as 2 overlapping bounding spheres:
    // 1. Sleigh main chassis at position (x, y + 0.08, z)
    // 2. Reindeer lead team in front along heading vector (-sin(rotY), 0, -cos(rotY)) * 0.48
    const forwardX = -Math.sin(this.rotationY);
    const forwardZ = -Math.cos(this.rotationY);

    const collisionNodes = [
      {
        pos: new THREE.Vector3(this.position.x, this.position.y + 0.08, this.position.z),
        radius: 0.19,
        isChassis: true
      },
      {
        pos: new THREE.Vector3(
          this.position.x + forwardX * 0.48,
          this.position.y + 0.08,
          this.position.z + forwardZ * 0.48
        ),
        radius: 0.16,
        isChassis: false
      }
    ];

    const margin = this.safetyMargin;

    for (const houseBox of nearbyHouses) {
      // Expanded bounding box with safety margin
      const minX = houseBox.min.x - margin;
      const maxX = houseBox.max.x + margin;
      const minY = houseBox.min.y - margin;
      const maxY = houseBox.max.y + margin;
      const minZ = houseBox.min.z - margin;
      const maxZ = houseBox.max.z + margin;

      for (const node of collisionNodes) {
        // Find closest point on expanded box to sphere center
        const closestX = Math.max(minX, Math.min(node.pos.x, maxX));
        const closestY = Math.max(minY, Math.min(node.pos.y, maxY));
        const closestZ = Math.max(minZ, Math.min(node.pos.z, maxZ));

        const dx = node.pos.x - closestX;
        const dy = node.pos.y - closestY;
        const dz = node.pos.z - closestZ;
        const distSq = dx * dx + dy * dy + dz * dz;

        const effectiveRadius = node.radius;
        if (distSq < effectiveRadius * effectiveRadius) {
          const dist = Math.sqrt(distSq);
          let pushX = 0;
          let pushY = 0;
          let pushZ = 0;

          if (dist > 0.0001) {
            const overlap = effectiveRadius - dist;
            pushX = (dx / dist) * overlap;
            pushY = (dy / dist) * overlap;
            pushZ = (dz / dist) * overlap;
          } else {
            // Sleigh is fully inside box: push in direction of smallest penetration
            const dists = [
              { axis: 'x', dir: 1, val: maxX - node.pos.x },
              { axis: 'x', dir: -1, val: node.pos.x - minX },
              { axis: 'y', dir: 1, val: maxY - node.pos.y },
              { axis: 'y', dir: -1, val: node.pos.y - minY },
              { axis: 'z', dir: 1, val: maxZ - node.pos.z },
              { axis: 'z', dir: -1, val: node.pos.z - minZ }
            ];
            dists.sort((a, b) => a.val - b.val);
            const minEntry = dists[0];
            const pushDist = minEntry.val + effectiveRadius;
            if (minEntry.axis === 'x') pushX = minEntry.dir * pushDist;
            if (minEntry.axis === 'y') pushY = minEntry.dir * pushDist;
            if (minEntry.axis === 'z') pushZ = minEntry.dir * pushDist;
          }

          // Apply smooth push to actual sleigh position
          this.position.x += pushX;
          this.position.y += pushY;
          this.position.z += pushZ;

          // If pushed upward against roof, zero negative vertical speed
          if (pushY > 0.05 && this.verticalSpeed < 0) {
            this.verticalSpeed = 0;
          }
          // If pushed laterally against wall, gently dampen forward speed
          if (Math.hypot(pushX, pushZ) > 0.05 && this.speed > 0) {
            this.speed = Math.max(0, this.speed - 3.5 * (1.0 / 60.0));
          }

          // Update other node position with new displacement
          for (const other of collisionNodes) {
            other.pos.x += pushX;
            other.pos.y += pushY;
            other.pos.z += pushZ;
          }
        }
      }
    }
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
  }
}

