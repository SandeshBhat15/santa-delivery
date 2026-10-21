import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

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
    this.position = new THREE.Vector3(0, 2.4, 8.0);
    this.rotationY = 0.0; // Heading north (-Z) toward village center
    this.pitch = 0.0;
    this.bank = 0.0;
    this.speed = 0.0;

    // Movement parameters
    this.cruiseSpeed = 8.5; // Automatic forward flight speed
    this.maxSpeed = 12.0;
    this.minSpeed = 0.0;
    this.accel = 8.0;
    this.decel = 6.0;
    this.turnSpeed = 1.9;
    this.climbSpeed = 6.0;
    this.bankMax = 0.42;

    // Controls input state
    this.inputs = {
      left: false,
      right: false,
      up: false,
      down: false,
      drop: false
    };

    // Customizable key mappings (Desktop: A/D or Left/Right to steer, W/S or Up/Down for climb/dive, Space/E to drop gift)
    this.keyMap = {
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      climb: ['KeyW', 'ArrowUp', 'Space'],
      descend: ['KeyS', 'ArrowDown'],
      drop: ['KeyE']
    };

    // Virtual analog joystick control: x = steering (yaw + banking roll), y = altitude (pitch + climb/dive)
    this.joystick = { x: 0, y: 0 };
    this.verticalInput = 0.0;

    // Configurable flight simulation dynamics
    this.climbRate = 6.0;
    this.descendRate = 5.5;
    this.verticalSpeed = 0.0;
    this.verticalAccel = 12.0;
    this.verticalDecel = 9.0;
    this.pitchMax = 0.35; // Max pitch angle (radians) during climb/dive

    // Dynamic Terrain-Relative Altitude Limits (meters above local terrain)
    this.minAltitudeAboveTerrain = 0.85; // Low-skimming over the snow
    this.maxAltitudeAboveTerrain = 8.5;  // Low-to-medium rooftop flight vista
    this.altitudeSoftBuffer = 1.5;       // Distance from boundary where vertical damping begins

    // Sleigh & Reindeer Collision Bounds (meters)
    // Sleigh body + reindeer team total footprint calibrated for new scale
    this.collisionRadiusXZ = 0.85;
    this.collisionHalfHeight = 0.65;
    this.safetyMargin = 0.3; // Wall and roof clearance margin

    // Follow camera offset & sensitivity (closer third-person follow camera)
    this.camDistance = isMobile ? 5.6 : 4.8;
    this.camHeight = isMobile ? 2.4 : 1.9;
    this.camLag = 6.5; // Responsive smooth follow
    this.camTargetPos = new THREE.Vector3();
    this.camLookPos = new THREE.Vector3();

    // Reindeer leg / harness animation references
    this.animTime = 0.0;
    this.reindeerLegs = [];
    this.reindeers = [];
    this.mixers = []; // AnimationMixers for deer instances

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

    // Scale calibrated to match terrain and house proportions (~35% smaller than before)
    const MODEL_SCALE = 3.9;
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
    if (sledgeNode) sleighGroup.add(sledgeNode);
    if (santaRigNode) sleighGroup.add(santaRigNode);
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

      // Harness lines container
      const reinMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        roughness: 0.35,
        metalness: 0.75
      });

      // Front sleigh hitch positions
      const hitchLeft = new THREE.Vector3(-0.045, 0.07, 0.16);
      const hitchRight = new THREE.Vector3(0.045, 0.07, 0.16);

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

        masterGroup.add(deerClone);

        // Connect reins from sleigh hitch to reindeer collar
        const hitch = cfg.x < 0 ? hitchLeft : hitchRight;
        const collar = new THREE.Vector3(cfg.x, 0.12, cfg.z + 0.05);
        const dir = new THREE.Vector3().subVectors(collar, hitch);
        const len = dir.length();
        const reinGeo = new THREE.CylinderGeometry(0.0018, 0.0018, len, 4);
        const rein = new THREE.Mesh(reinGeo, reinMat);
        rein.position.copy(hitch).addScaledVector(dir, 0.5);
        rein.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        masterGroup.add(rein);
      });
    } else if (deerRigNode) {
      masterGroup.add(deerRigNode);
    }

    this.group.add(masterGroup);
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

    // 1. Automatic Continuous Forward Flight with Smooth Acceleration
    // Santa is always cruising forward smoothly
    const targetSpeed = this.cruiseSpeed;
    if (this.speed < targetSpeed) {
      this.speed = Math.min(this.speed + this.accel * delta, targetSpeed);
    } else if (this.speed > targetSpeed) {
      this.speed = Math.max(this.speed - this.decel * delta, targetSpeed);
    }

    // 2. Analog Joystick & Keyboard Steering & Altitude
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
    this.rotationY += turnInput * this.turnSpeed * delta;

    // Banking roll during turns (smooth aerodynamic tilt)
    const targetBank = -turnInput * this.bankMax;
    this.bank += (targetBank - this.bank) * Math.min(delta * 5.5, 1.0);

    // 3. Vertical Flight (Climbing & Descending via Joystick Y or W/S/Space Keys)
    let localGroundH = 0.5;
    if (this.chunkSystem && this.chunkSystem.getHeight) {
      localGroundH = this.chunkSystem.getHeight(this.position.x, this.position.z);
    }

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
    } else if (vertCommand < 0) {
      targetVertSpeed = -this.descendRate * Math.abs(vertCommand) * descendFactor;
    }

    // Auto-cushioning recovery if terrain rises beneath the sleigh
    if (currentAltitude < minAlt) {
      const liftDeficit = minAlt - currentAltitude;
      targetVertSpeed = Math.max(targetVertSpeed, liftDeficit * 5.0);
    } else if (currentAltitude > maxAlt) {
      const overHeight = currentAltitude - maxAlt;
      targetVertSpeed = Math.min(targetVertSpeed, -overHeight * 3.5);
    }

    // Smooth vertical acceleration / deceleration
    if (this.verticalSpeed < targetVertSpeed) {
      this.verticalSpeed = Math.min(this.verticalSpeed + this.verticalAccel * delta, targetVertSpeed);
    } else if (this.verticalSpeed > targetVertSpeed) {
      this.verticalSpeed = Math.max(this.verticalSpeed - this.verticalDecel * delta, targetVertSpeed);
    }

    this.position.y += this.verticalSpeed * delta;

    // Safety hard clamp strictly prevents dipping below absolute terrain floor
    if (this.position.y < localGroundH + minAlt * 0.75) {
      this.position.y = localGroundH + minAlt * 0.75;
      if (this.verticalSpeed < 0) this.verticalSpeed = 0;
    }

    // Pitch inclination while climbing or diving (smoothly proportional to vertical speed)
    const normVertRate = this.verticalSpeed / Math.max(this.climbRate, this.descendRate);
    const targetPitch = normVertRate * this.pitchMax;
    this.pitch += (targetPitch - this.pitch) * Math.min(delta * 5.5, 1.0);

    // 3. Free 3D Displacement along X and Z
    const heading = new THREE.Vector3(
      -Math.sin(this.rotationY),
      0,
      -Math.cos(this.rotationY)
    );
    this.position.addScaledVector(heading, this.speed * delta);

    // 4. House & Structure Collision Avoidance
    // Checks nearby building bounding boxes with safety margins and pushes sleigh smoothly outward
    this._resolveHouseCollisions();

    // 5. Apply Full 3D Transform to Sleigh Group
    this.group.position.copy(this.position);
    this.group.rotation.set(0, this.rotationY, 0, 'YXZ');
    this.group.rotation.x = this.pitch;
    this.group.rotation.z = this.bank;

    // 4. Subtle Bobbing, Tilting & Reindeer Gallop Animations
    this.animTime += delta * (3.0 + this.speed * 0.8);
    const bob = Math.sin(this.animTime * 2.5) * 0.08;
    if (this.sleighMeshGroup) {
      this.sleighMeshGroup.position.y = bob;
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

    // Reindeer spine rhythm
    this.reindeers.forEach((rMesh, i) => {
      rMesh.position.y = 0.45 + Math.sin(this.animTime * 3.5 + i * 0.7) * 0.06;
      rMesh.rotation.z = Math.sin(this.animTime * 2.5 + i) * 0.04;
    });

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
    this.camLookPos.copy(this.position).addScaledVector(forwardVec, 3.5);
    this.camLookPos.y = this.position.y + 0.6;

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

    // Search for nearby house AABBs within 14 meters of Santa's sleigh
    const nearbyHouses = this.chunkSystem.getHouseCollidersNear(this.position.x, this.position.z, 14.0);
    if (!nearbyHouses || nearbyHouses.length === 0) return;

    // Sleigh collision volume modeled as 2 overlapping bounding spheres:
    // 1. Sleigh main chassis at position (x, y + 0.35, z)
    // 2. Reindeer lead team in front along heading vector (-sin(rotY), 0, -cos(rotY)) * 2.2
    const forwardX = -Math.sin(this.rotationY);
    const forwardZ = -Math.cos(this.rotationY);

    const collisionNodes = [
      {
        pos: new THREE.Vector3(this.position.x, this.position.y + 0.35, this.position.z),
        radius: 0.95,
        isChassis: true
      },
      {
        pos: new THREE.Vector3(
          this.position.x + forwardX * 2.1,
          this.position.y + 0.35,
          this.position.z + forwardZ * 2.1
        ),
        radius: 0.85,
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
    const p = new THREE.Vector3(0, -0.4, 0);
    this.group.localToWorld(p);
    return p;
  }
}

