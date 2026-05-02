'use strict';

// ═══════════════════════════════════════════════════════════════
//  CONFIG — every tuneable value in one place.
//  To adjust difficulty, see the HITBOXES section below.
// ═══════════════════════════════════════════════════════════════
const CFG = {

  // ── Lanes (X positions; street runs toward -Z) ──────────────
  LANE_X:     [-2.2, 0.0, 2.2],
  LANE_NAMES: ['Left', 'Middle', 'Right'],

  // ── Camera / player ─────────────────────────────────────────
  EYE_HEIGHT:     1.72,
  FORWARD_SPEED:  5.5,
  SLOW_SPEED:     1.5,
  SLOW_DURATION:  2.0,
  LANE_SMOOTH:    0.13,
  LANE_COOL:      0.22,
  BOB_FREQ:       1.9,
  BOB_AMP:        0.046,

  // ── Win condition ────────────────────────────────────────────
  DEST_Z: -155,

  // ── Pedestrians ──────────────────────────────────────────────
  PED_COUNT:     9,
  PED_AHEAD:     80,
  PED_STAGGER:   40,
  PED_SPEED_MIN: 2.5,
  PED_SPEED_MAX: 4.8,

  // ── Obstacle spawner ─────────────────────────────────────────
  OBS_INTERVAL:    0.8,
  OBS_AHEAD:        50,
  OBS_START_DELAY:  0.0,

  // ── Obstacle speeds ──────────────────────────────────────────
  TOURIST_SPEED:  2.5,
  BIKE_SPEED:    12.0,

  // ┌───────────────────────────────────────────────────────────┐
  // │              COLLISION HITBOXES — TUNE HERE               │
  // │  x = left/right half-width   z = forward/back half-depth  │
  // │  LARGER → easier to hit → harder game                     │
  // │  SMALLER → harder to hit → more forgiving                 │
  // └───────────────────────────────────────────────────────────┘
  HITBOXES: {
    manhole: { x: 0.85, z: 0.85 },
    dogpoo:  { x: 0.40, z: 0.40 },
    tourist: { x: 0.65, z: 0.75 },
    bike:    { x: 0.45, z: 1.10 },
  },

  // ── Game ─────────────────────────────────────────────────────
  GAME_TIME: 45,

  // ── Colour palettes ──────────────────────────────────────────
  PED_TOPS:        [0xf4a261,0x2ec4b6,0xe9c46a,0xa8dadc,0xff6b6b,0x457b9d,0x8ecae6,0x6a4c93,0x52b788],
  PED_TOPS_TOURIST:[0xff6b35,0xf7c59f,0xffd700,0x90ee90,0xff69b4,0xffa500],
  PED_SKIN:        [0xffd6aa,0xd4a373,0xc68642,0x8d5524],
  PED_PANTS:       [0x222233,0x3a2a1a,0x1a2a3a],
  PED_HAIR:        [0x1a0800,0xc0892a,0x8b0a0a,0xeeeeee,0x111111,0xe8c56e],
  BLDG:            [0x2d3561,0x1e2d45,0x253553,0x344e7a,0x1a2035,0x2a1e3a],
};


// ═══════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════
const pick  = arr      => arr[Math.floor(Math.random() * arr.length)];
const rand  = (a, b)   => a + Math.random() * (b - a);
const lerp  = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// flatMat — used on world geometry (buildings, ground). Keeps the low-poly city look.
const flatMat   = color => new THREE.MeshLambertMaterial({ color, flatShading: true });

// smoothMat — used on characters and obstacles. Phong shading gives rounded, 3-D highlights.
// The shininess value controls how shiny the specular spot looks (0 = matte, 100 = glossy).
const smoothMat = (color, shininess = 45) =>
  new THREE.MeshPhongMaterial({ color, shininess, flatShading: false });


// ═══════════════════════════════════════════════════════════════
//  OBSTACLE BASE CLASS
// ═══════════════════════════════════════════════════════════════
class Obstacle {
  constructor(scene, laneIndex, cameraZ, type) {
    this.scene      = scene;
    this.laneIndex  = laneIndex;
    this.type       = type;
    this.hit        = false;
    this.speed      = 0;
    this.effect     = 'slowdown';
    this.label      = '';
    this.laneX      = CFG.LANE_X[laneIndex];
    this.spawnZ     = cameraZ - CFG.OBS_AHEAD;
    this.group      = new THREE.Group();
  }

  // Stationary obstacles sit in place; the camera walks into them.
  // Moving obstacles also push toward +Z so the combined closing speed
  // = FORWARD_SPEED + obstacle.speed.
  update(delta) {
    this.group.position.z += this.speed * delta;
  }

  isPastPlayer(cameraZ) { return this.group.position.z > cameraZ + 5; }
  getWorldX() { return this.group.position.x; }
  getWorldZ() { return this.group.position.z; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(obj => {
      if (obj.isMesh) { obj.geometry.dispose(); obj.material.dispose(); }
    });
  }
}


// ═══════════════════════════════════════════════════════════════
//  MANHOLE  —  instant game over
//  Dark disc + glowing orange rim, smooth shading for depth.
// ═══════════════════════════════════════════════════════════════
class Manhole extends Obstacle {
  constructor(scene, laneIndex, cameraZ) {
    super(scene, laneIndex, cameraZ, 'manhole');
    this.effect = 'gameover';
    this.label  = '🕳️ Fell in a manhole!';

    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.90, 0.90, 0.04, 24),
      new THREE.MeshBasicMaterial({ color: 0xff8c00 })
    );
    rim.position.y = 0.02;

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.82, 0.82, 0.07, 24),
      smoothMat(0x1a1a1a, 80)   // dark, slightly glossy — looks like a real cover
    );
    disc.position.y = 0.04;

    // Bolt pattern on top — four tiny raised dots
    const boltMat = smoothMat(0x333333, 30);
    for (let i = 0; i < 4; i++) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 6), boltMat);
      const a = (i / 4) * Math.PI * 2;
      bolt.position.set(Math.cos(a) * 0.50, 0.08, Math.sin(a) * 0.50);
      this.group.add(bolt);
    }

    this.group.add(rim, disc);
    this.group.position.set(this.laneX, 0, this.spawnZ);
    scene.add(this.group);
  }
}


// ═══════════════════════════════════════════════════════════════
//  DOG POO  —  slow down
//  Low-poly brown pyramid — flat shading is intentional (comedy).
// ═══════════════════════════════════════════════════════════════
class DogPoo extends Obstacle {
  constructor(scene, laneIndex, cameraZ) {
    super(scene, laneIndex, cameraZ, 'dogpoo');
    this.effect = 'slowdown';
    this.label  = '💩 Stepped in dog poo!';

    // Dark shadow puddle underneath
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.26, 0.03, 10),
      flatMat(0x2a1106)
    );
    base.position.y = 0.015;

    // Three stacked blobs — wide at bottom, tapers to a swirl at top
    const blob1 = new THREE.Mesh(
      new THREE.SphereGeometry(0.20, 9, 7),
      smoothMat(0x6b3010, 18)
    );
    blob1.scale.y = 0.52;
    blob1.position.y = 0.10;

    const blob2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 9, 7),
      smoothMat(0x7a3d18, 22)
    );
    blob2.scale.y = 0.60;
    blob2.position.y = 0.24;

    const blob3 = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 9, 7),
      smoothMat(0x8a4820, 28)
    );
    blob3.scale.y = 0.65;
    blob3.position.y = 0.35;

    // Tiny rounded tip — the iconic swirl point
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.048, 7, 5),
      smoothMat(0x9a5228, 35)
    );
    tip.position.y = 0.43;

    this.group.add(base, blob1, blob2, blob3, tip);
    this.group.position.set(this.laneX, 0, this.spawnZ);
    scene.add(this.group);
  }
}


// ═══════════════════════════════════════════════════════════════
//  TOURIST OBSTACLE  —  slow down
//  Blue cylinder body with smooth shading so they look rounder.
// ═══════════════════════════════════════════════════════════════
class Tourist extends Obstacle {
  constructor(scene, laneIndex, cameraZ) {
    super(scene, laneIndex, cameraZ, 'tourist');
    this.speed  = CFG.TOURIST_SPEED;
    this.effect = 'slowdown';
    this.label  = '📸 Walked into a tourist!';

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.30, 1.40, 10),
      smoothMat(0x4a90d9, 60)   // tourist blue, visible highlight
    );
    body.position.y = 0.70;

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.32, 0.30),
      smoothMat(0xffd6aa, 30)
    );
    head.position.y = 1.56;

    // Camera held up at face (they're always shooting)
    const cam = new THREE.Mesh(
      new THREE.BoxGeometry(0.20, 0.13, 0.11),
      smoothMat(0x222222, 80)
    );
    cam.position.set(0, 1.48, -0.24);

    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.05, 8),
      new THREE.MeshBasicMaterial({ color: 0x1133aa })
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 1.48, -0.30);

    this.group.add(body, head, cam, lens);
    this.group.position.set(this.laneX, 0, this.spawnZ);
    scene.add(this.group);
  }
}


// ═══════════════════════════════════════════════════════════════
//  BIKE MESSENGER  —  instant game over
//  Red box body, smooth shading, two visible wheels.
// ═══════════════════════════════════════════════════════════════
class BikeMessenger extends Obstacle {
  constructor(scene, laneIndex, cameraZ) {
    super(scene, laneIndex, cameraZ, 'bike');
    this.speed  = CFG.BIKE_SPEED;
    this.effect = 'gameover';
    this.label  = '🚴 Hit by a bike messenger!';

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.50, 1.10, 0.70),
      smoothMat(0xe63946, 70)   // alarm red with gloss
    );
    body.position.y = 0.80;

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.28, 0.28),
      smoothMat(0xffd6aa, 30)
    );
    head.position.y = 1.54;

    // Helmet
    const helmet = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.18, 0.32),
      smoothMat(0xffcc00, 60)   // yellow helmet
    );
    helmet.position.y = 1.68;

    const wheelGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.09, 14);
    const wheelMat = smoothMat(0x111111, 20);
    const wheelF = new THREE.Mesh(wheelGeo, wheelMat);
    wheelF.rotation.x = Math.PI / 2;
    wheelF.position.set(0, 0.30, -0.44);
    const wheelB = wheelF.clone();
    wheelB.position.z = 0.44;

    this.group.add(body, head, helmet, wheelF, wheelB);
    this.group.position.set(this.laneX, 0, this.spawnZ);
    scene.add(this.group);
  }
}


// ═══════════════════════════════════════════════════════════════
//  OBSTACLE SPAWNER
// ═══════════════════════════════════════════════════════════════
class ObstacleSpawner {
  constructor(scene) {
    this.scene     = scene;
    this.timer     = 0;
    this.obstacles = [];
    this._types = [
      'manhole', 'manhole',
      'dogpoo',  'dogpoo',  'dogpoo',
      'tourist', 'tourist', 'tourist',
      'bike',    'bike',
    ];
  }

  update(delta, cameraZ) {
    this.timer += delta;
    if (this.timer >= CFG.OBS_INTERVAL) {
      this.timer = 0;
      this._spawn(cameraZ);
    }
    const alive = [];
    for (const obs of this.obstacles) {
      obs.update(delta);
      if (obs.isPastPlayer(cameraZ)) { obs.dispose(); }
      else { alive.push(obs); }
    }
    this.obstacles = alive;
  }

  _spawn(cameraZ) {
    const type      = pick(this._types);
    const laneIndex = Math.floor(Math.random() * 3);
    let obs;
    switch (type) {
      case 'manhole': obs = new Manhole      (this.scene, laneIndex, cameraZ); break;
      case 'dogpoo':  obs = new DogPoo       (this.scene, laneIndex, cameraZ); break;
      case 'tourist': obs = new Tourist      (this.scene, laneIndex, cameraZ); break;
      case 'bike':    obs = new BikeMessenger(this.scene, laneIndex, cameraZ); break;
    }
    this.obstacles.push(obs);
  }
}


// ═══════════════════════════════════════════════════════════════
//  PEDESTRIAN CLASS
//
//  Three types of ambient crowd member:
//
//  'default'     — normal NYC walker, varied colors and random size
//  'phoneZombie' — slow, hunched, face buried in glowing phone
//  'slowTourist' — very slow, white hat, camera around neck,
//                  STOPS mid-sidewalk every few seconds to take a photo
// ═══════════════════════════════════════════════════════════════
class Pedestrian {
  constructor(scene, cameraZ, forcedType = null) {
    this.scene = scene;
    this.hit   = false;
    this.lane  = pick(CFG.LANE_NAMES);

    // Type distribution: 50% normal, 25% phone zombie, 25% slow tourist
    this.pedType = forcedType || pick([
      'default', 'default', 'default',
      'phoneZombie', 'phoneZombie',
      'slowTourist', 'slowTourist',
    ]);

    // Each type walks at a different pace
    switch (this.pedType) {
      case 'phoneZombie': this.speed = rand(1.2, 2.2); break;
      case 'slowTourist': this.speed = rand(0.8, 1.8); break;
      default:            this.speed = rand(CFG.PED_SPEED_MIN, CFG.PED_SPEED_MAX);
    }
    this.baseSpeed  = this.speed;
    this.stopTimer  = 0;     // counts down while tourist is stopped for a photo

    this.group = new THREE.Group();
    this._buildGeometry();
    this._applyColors();

    // Size variety — every pedestrian is a slightly different height/build
    const s = rand(0.84, 1.22);
    this.group.scale.set(s, s, s);

    this._placeAtSpawn(cameraZ);
    scene.add(this.group);
  }

  update(delta) {
    // ── Slow tourists stop to take photos ──────────────────
    if (this.pedType === 'slowTourist') {
      if (this.stopTimer > 0) {
        // Currently stopped — tick down and wiggle slightly (panning for a shot)
        this.stopTimer -= delta;
        this.speed = 0;
        this.group.rotation.y = Math.sin(Date.now() * 0.0015) * 0.35;
        if (this.stopTimer <= 0) {
          this.speed = this.baseSpeed;   // resume walking
          this.group.rotation.y = 0;
        }
      } else if (Math.random() < delta * 0.18) {
        // ~18% chance per second of deciding to stop
        this.stopTimer = rand(1.2, 2.8);
      }
    }

    this.group.position.z -= this.speed * delta;
    // Walk bob — flatlines when stopped so they don't bounce in place
    if (this.speed > 0.1) {
      this.group.position.y = Math.abs(Math.sin(Date.now() * 0.005 * this.speed)) * 0.03;
    }
  }

  isPastPlayer(cameraZ) { return this.group.position.z > cameraZ + 3; }
  getWorldX()    { return this.group.position.x; }
  getWorldZ()    { return this.group.position.z; }
  getLaneIndex() { return CFG.LANE_NAMES.indexOf(this.lane); }

  respawn(cameraZ) {
    // Re-roll type and speed, rebuild geometry in place (no new scene.add needed)
    this.pedType = pick(['default','default','default','phoneZombie','phoneZombie','slowTourist','slowTourist']);
    switch (this.pedType) {
      case 'phoneZombie': this.speed = rand(1.2, 2.2); break;
      case 'slowTourist': this.speed = rand(0.8, 1.8); break;
      default:            this.speed = rand(CFG.PED_SPEED_MIN, CFG.PED_SPEED_MAX);
    }
    this.baseSpeed = this.speed;
    this.stopTimer = 0;
    this.lane = pick(CFG.LANE_NAMES);
    this.hit  = false;
    this.group.rotation.y = 0;

    // Clear old meshes and rebuild with the new type
    while (this.group.children.length) {
      const c = this.group.children[0];
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
      this.group.remove(c);
    }
    this._buildGeometry();
    this._applyColors();
    const s = rand(0.84, 1.22);
    this.group.scale.set(s, s, s);
    this._placeAtSpawn(cameraZ);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(obj => {
      if (obj.isMesh) { obj.geometry.dispose(); obj.material.dispose(); }
    });
  }

  _placeAtSpawn(cameraZ) {
    this.group.position.set(
      CFG.LANE_X[this.getLaneIndex()],
      0,
      cameraZ - CFG.PED_AHEAD - Math.random() * CFG.PED_STAGGER
    );
  }

  _buildGeometry() {
    // ── Base humanoid body (shared by all three types) ──────
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.60, 0.24), smoothMat(0xffffff));
    this.torso.position.y = 0.97;

    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.56, 0.21), smoothMat(0xffffff));
    this.legL.position.set(-0.125, 0.37, 0);
    this.legR = this.legL.clone(); this.legR.position.x = 0.125;

    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.50, 0.19), smoothMat(0xffffff));
    this.armL.position.set(-0.30, 0.92, 0);
    this.armR = this.armL.clone(); this.armR.position.x = 0.30;

    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.31), smoothMat(0xffffff));
    this.head.position.y = 1.45;

    this.hair = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.11, 0.33), smoothMat(0xffffff));
    this.hair.position.y = 1.67;

    this.group.add(this.torso, this.legL, this.legR, this.armL, this.armR, this.head, this.hair);

    // ── Face — eyes and mouth on every pedestrian type ──────
    // MeshBasicMaterial so they're always dark regardless of lighting
    const faceMat  = new THREE.MeshBasicMaterial({ color: 0x1a0a04 });
    const eyeGeo   = new THREE.BoxGeometry(0.072, 0.065, 0.018);
    const eyeL     = new THREE.Mesh(eyeGeo, faceMat);
    const eyeR     = new THREE.Mesh(eyeGeo, faceMat);
    // Head centre is y=1.45; front face is z=−0.155. Place eyes just proud of surface.
    eyeL.position.set(-0.088, 1.50, -0.168);
    eyeR.position.set( 0.088, 1.50, -0.168);

    const mouthGeo  = new THREE.BoxGeometry(0.10, 0.024, 0.018);
    const mouth     = new THREE.Mesh(mouthGeo, faceMat);
    mouth.position.set(0, 1.37, -0.168);

    this.group.add(eyeL, eyeR, mouth);

    // ── Phone zombie accessories ────────────────────────────
    if (this.pedType === 'phoneZombie') {
      // Glowing phone held at face height — always-bright blue screen
      const phone = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.28, 0.04),
        new THREE.MeshBasicMaterial({ color: 0x1199ff })
      );
      phone.position.set(0, 1.42, -0.22);

      const screen = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.21, 0.01),
        new THREE.MeshBasicMaterial({ color: 0xaaddff })  // bright inner screen
      );
      screen.position.set(0, 1.42, -0.245);

      this.group.add(phone, screen);

      // Subtle forward hunch — head and torso tilted toward the screen
      this.torso.rotation.x = 0.18;
      this.head.rotation.x  = 0.28;
      this.head.position.z  = -0.06;
    }

    // ── Slow tourist accessories ────────────────────────────
    if (this.pedType === 'slowTourist') {
      // Wide sun hat (brim + crown)
      const hatBrim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.40, 0.40, 0.05, 12),
        smoothMat(0xf5e6c8, 20)
      );
      hatBrim.position.y = 1.73;

      const hatCrown = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.28, 0.22, 12),
        smoothMat(0xf5e6c8, 20)
      );
      hatCrown.position.y = 1.87;

      // Camera body hanging at chest
      const camBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.15, 0.11),
        smoothMat(0x1a1a1a, 90)   // glossy black camera
      );
      camBody.position.set(0, 1.04, -0.20);

      // Camera lens
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.07, 10),
        new THREE.MeshBasicMaterial({ color: 0x0a0a33 })
      );
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 1.04, -0.28);

      this.group.add(hatBrim, hatCrown, camBody, lens);
    }
  }

  _applyColors() {
    const skin  = pick(CFG.PED_SKIN);
    const pants = pick(CFG.PED_PANTS);
    const hair  = pick(CFG.PED_HAIR);

    // Top color varies by type
    let topColor;
    if (this.pedType === 'phoneZombie') {
      topColor = pick([0x888888, 0x777777, 0x999999, 0x555566]); // muted, distracted
    } else if (this.pedType === 'slowTourist') {
      topColor = pick(CFG.PED_TOPS_TOURIST); // bright holiday colours
    } else {
      topColor = pick(CFG.PED_TOPS);
    }

    this.torso.material = smoothMat(topColor);
    this.armL.material  = smoothMat(topColor);
    this.armR.material  = smoothMat(topColor);
    this.legL.material  = smoothMat(pants);
    this.legR.material  = smoothMat(pants);
    this.head.material  = smoothMat(skin);
    this.hair.material  = smoothMat(hair);
  }
}


// ═══════════════════════════════════════════════════════════════
//  TOURIST CLUSTER
//
//  Spawns 2 slow tourists side-by-side, blocking 2 out of 3 lanes.
//  One lane is always left open as the escape route — the player
//  has to read which lane is free and move into it in time.
//  The two tourists are slightly staggered in Z so a fast player
//  can also weave between them.
// ═══════════════════════════════════════════════════════════════
class TouristCluster {
  constructor(scene, cameraZ) {
    this.scene = scene;

    // Leave one random lane open; block the other two
    const openLane     = Math.floor(Math.random() * 3);
    const blockedLanes = [0, 1, 2].filter(i => i !== openLane);

    this.peds = blockedLanes.map((laneIdx, i) => {
      const p       = new Pedestrian(scene, cameraZ, 'slowTourist');
      p.lane        = CFG.LANE_NAMES[laneIdx];
      p.speed       = rand(0.5, 1.2);
      p.baseSpeed   = p.speed;
      p.group.position.x = CFG.LANE_X[laneIdx];
      // Slight Z stagger so they're not perfectly side-by-side
      p.group.position.z = cameraZ - CFG.PED_AHEAD - i * rand(0.8, 2.5);
      return p;
    });
  }

  update(delta) { this.peds.forEach(p => p.update(delta)); }

  // Past the player when both pedestrians have passed
  isPastPlayer(cameraZ) { return this.peds.every(p => p.isPastPlayer(cameraZ)); }

  dispose() { this.peds.forEach(p => p.dispose()); }
}


// ═══════════════════════════════════════════════════════════════
//  WORLD BUILDER
// ═══════════════════════════════════════════════════════════════
function buildWorld(scene) {
  const gnd = new THREE.Mesh(new THREE.BoxGeometry(10, 0.12, 320), flatMat(0xb0a090));
  gnd.position.set(0, -0.06, -160);
  scene.add(gnd);

  const curbMat = flatMat(0x7a6a5a);
  for (const x of [-5.3, 5.3]) {
    const k = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 320), curbMat);
    k.position.set(x, 0.03, -160);
    scene.add(k);
  }

  const dashMat = flatMat(0xc8b8a8);
  for (const x of [-1.1, 1.1]) {
    for (let z = -4; z > -310; z -= 6) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 2.4), dashMat);
      d.position.set(x, 0.07, z);
      scene.add(d);
    }
  }

  _buildBuildings(scene, -1);
  _buildBuildings(scene, +1);
  _buildDestination(scene);

  const sky = new THREE.Mesh(new THREE.PlaneGeometry(400, 120),
    new THREE.MeshBasicMaterial({ color: 0x1a0a30, side: THREE.DoubleSide }));
  sky.position.set(0, 35, -170);
  scene.add(sky);

  const glow = new THREE.Mesh(new THREE.PlaneGeometry(400, 10),
    new THREE.MeshBasicMaterial({ color: 0xff6b2e, side: THREE.DoubleSide }));
  glow.position.set(0, 2.5, -169);
  scene.add(glow);
}

function _buildBuildings(scene, side) {
  for (let i = 0; i < 24; i++) {
    const h = rand(10, 32), w = rand(4, 8), d = rand(5, 9);
    const bldg = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flatMat(pick(CFG.BLDG)));
    bldg.position.set(side * (5.5 + w / 2 + rand(0, 1.5)), h / 2, -(i * 12 + rand(0, 5) + 6));
    scene.add(bldg);
    _addWindows(scene, bldg.position, w, h, d, side);
  }
}

function _addWindows(scene, bp, bW, bH, bD, side) {
  const winMat = new THREE.MeshBasicMaterial({ color: 0xf4e04d });
  const rows = Math.floor(bH / 3.2), cols = Math.floor(bD / 2.0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() > 0.42) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.55, 0.80), winMat);
        w.position.set(
          bp.x - side * (bW / 2 + 0.02),
          bp.y - bH / 2 + 1.6 + r * 3.0,
          bp.z - bD / 2 + 1.0 + c * 1.9
        );
        scene.add(w);
      }
    }
  }
}

function _buildDestination(scene) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xf4e04d });
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 0.4), mat);
  const bar    = new THREE.Mesh(new THREE.BoxGeometry(11, 0.4, 0.4), mat);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.2),
    new THREE.MeshBasicMaterial({ color: 0xff8c42, side: THREE.DoubleSide }));
  const p2 = pillar.clone();
  pillar.position.set(-5, 2.5, CFG.DEST_Z);
  p2.position.set(     5, 2.5, CFG.DEST_Z);
  bar.position.set(    0, 5.2, CFG.DEST_Z);
  banner.position.set( 0, 4.3, CFG.DEST_Z + 0.1);
  scene.add(pillar, p2, bar, banner);
}

function addLights(scene) {
  scene.add(new THREE.AmbientLight(0x2a1a3a, 0.55));
  scene.add(new THREE.HemisphereLight(0x4b2060, 0x6b4a20, 0.78));
  const sun = new THREE.DirectionalLight(0xff8c42, 1.5);
  sun.position.set(-6, 3, 8);
  scene.add(sun);
}


// ═══════════════════════════════════════════════════════════════
//  GAME  —  main controller
// ═══════════════════════════════════════════════════════════════
class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x1a0a2e, 40, 125);

    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 230);
    this.camera.position.set(CFG.LANE_X[1], CFG.EYE_HEIGHT, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    document.body.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();

    this.laneIndex    = 1;
    this.cameraX      = CFG.LANE_X[1];
    this.targetX      = CFG.LANE_X[1];
    this.laneCool     = 0;
    this.bobTimer     = 0;
    this.slowTimer    = 0;
    this.currentSpeed = CFG.FORWARD_SPEED;

    this.timeLeft    = CFG.GAME_TIME;
    this.pedestrians = [];   // holds Pedestrian and TouristCluster instances
    this.gameOver    = false;
    this.started     = false;

    addLights(this.scene);
    buildWorld(this.scene);
    this.spawner = new ObstacleSpawner(this.scene);

    this.timerEl    = document.getElementById('timer');
    this.lanesEl    = document.getElementById('lanes');
    this.progressEl = document.getElementById('progress');
    this.barFillEl  = document.getElementById('bar-fill');

    const startScreen = document.getElementById('start-screen');
    const begin = () => {
      startScreen.style.display = 'none';
      document.getElementById('hud').style.display      = 'flex';
      document.getElementById('hint').style.display     = 'block';
      document.getElementById('bar-wrap').style.display = 'block';
      this.started = true;
      const z = this.camera.position.z;
      for (let i = 0; i < CFG.PED_COUNT; i++) {
        this.pedestrians.push(new Pedestrian(this.scene, z));
      }
    };
    startScreen.addEventListener('click', begin);
    window.addEventListener('keydown', e => {
      if (!this.started && (e.code === 'Space' || e.code === 'Enter')) begin();
    });

    this.keys = {};
    window.addEventListener('keydown', e => { this.keys[e.code] = true; });
    window.addEventListener('keyup',   e => { this.keys[e.code] = false; });
    window.addEventListener('resize',  () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    this._loop();
  }

  _handleInput(delta) {
    this.laneCool -= delta;
    if (this.laneCool > 0) return;
    const L = this.keys['ArrowLeft']  || this.keys['KeyA'];
    const R = this.keys['ArrowRight'] || this.keys['KeyD'];
    if (L && this.laneIndex > 0) {
      this.laneIndex--; this.targetX = CFG.LANE_X[this.laneIndex];
      this.laneCool = CFG.LANE_COOL; this._lean(-0.06);
    } else if (R && this.laneIndex < 2) {
      this.laneIndex++; this.targetX = CFG.LANE_X[this.laneIndex];
      this.laneCool = CFG.LANE_COOL; this._lean(+0.06);
    }
  }

  _lean(angle) {
    this.camera.rotation.z = angle;
    setTimeout(() => { this.camera.rotation.z = 0; }, 200);
  }

  // ── Collision detection ──────────────────────────────────
  //  Hit-zone sizes live in CFG.HITBOXES — adjust those to change difficulty.
  //  Location: Game._checkObstacleCollisions()
  _checkObstacleCollisions() {
    const cz = this.camera.position.z;
    const cx = this.cameraX;
    for (const obs of this.spawner.obstacles) {
      if (obs.hit) continue;
      const box = CFG.HITBOXES[obs.type];
      const dz  = Math.abs(obs.getWorldZ() - cz);
      const dx  = Math.abs(obs.getWorldX() - cx);
      if (dz < box.z && dx < box.x) {
        obs.hit = true;
        if (obs.effect === 'gameover') {
          this._endGame(false, obs.label + '\nOnly in New York. 🗽');
        } else {
          this._triggerSlowDown(obs.label);
        }
      }
    }
  }

  _triggerSlowDown(label) {
    this.slowTimer = CFG.SLOW_DURATION;
    this.camera.rotation.z = 0.10;
    setTimeout(() => { this.camera.rotation.z = 0; }, 280);
    const c = this.renderer.domElement;
    c.style.boxShadow = 'inset 0 0 0 8px #f4a261';
    setTimeout(() => { c.style.boxShadow = ''; }, 400);
    this._toast(`${label} — slowing down! 🐌`, '#f4a261');
  }

  _toast(msg, color = '#ff4444') {
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, {
      position: 'fixed', top: '38%', left: '50%',
      transform: 'translateX(-50%)',
      fontSize: '24px', fontFamily: 'Arial Black, Arial',
      color, pointerEvents: 'none',
      textShadow: '0 2px 8px rgba(0,0,0,.85)',
      transition: 'opacity 0.85s', zIndex: '50',
      textAlign: 'center', whiteSpace: 'nowrap',
    });
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 500);
    setTimeout(() => { el.remove(); }, 1400);
  }

  _updateHUD() {
    const s = Math.ceil(this.timeLeft);
    this.timerEl.textContent = `⏱ ${s}s`;
    this.timerEl.style.color  = s <= 10 ? '#ff4444' : '#ffffff';
    this.lanesEl.textContent  = [0,1,2].map(i => i === this.laneIndex ? '■' : '□').join('  ');
    const pct = clamp(this.camera.position.z / CFG.DEST_Z, 0, 1);
    this.barFillEl.style.width  = (pct * 100).toFixed(1) + '%';
    this.progressEl.textContent = Math.round(pct * 100) + '% there';
  }

  _endGame(win, reason) {
    if (this.gameOver) return;
    this.gameOver = true;
    const hint = document.getElementById('hint');
    if (hint) hint.remove();
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed', inset: '0', zIndex: '200',
      background: 'rgba(0,0,0,0.86)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Arial Black, Arial', color: '#fff', textAlign: 'center',
    });
    panel.innerHTML = `
      <div style="font-size:64px;margin-bottom:18px">${win ? '🎉' : '💀'}</div>
      <div style="font-size:40px;color:${win ? '#f4a261' : '#ff4444'};margin-bottom:14px">
        ${win ? 'YOU MADE IT!' : 'GAME OVER'}
      </div>
      <div style="font-size:19px;font-weight:normal;color:#a8dadc;margin-bottom:40px;
                  white-space:pre-line;line-height:1.6">
        ${win ? `True New Yorker. 🗽\nTime left: ${Math.ceil(this.timeLeft)}s`
              : (reason || 'Better luck next time.')}
      </div>
      <button onclick="location.reload()" style="
        padding:14px 46px;font-size:18px;font-family:Arial Black,Arial;
        font-weight:bold;background:#f4a261;border:none;
        border-radius:6px;cursor:pointer;color:#111;">RESTART</button>
    `;
    document.body.appendChild(panel);
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    this.renderer.render(this.scene, this.camera);
    if (!this.started || this.gameOver) return;

    const delta   = Math.min(this.clock.getDelta(), 0.1);
    const cameraZ = this.camera.position.z;

    this.timeLeft -= delta;
    if (this.timeLeft <= 0) { this.timeLeft = 0; this._endGame(false, "Time's up!\nNew York waits for no one."); return; }

    if (this.slowTimer > 0) {
      this.slowTimer   -= delta;
      this.currentSpeed = CFG.SLOW_SPEED;
    } else {
      this.currentSpeed = CFG.FORWARD_SPEED;
    }

    this.camera.position.z -= this.currentSpeed * delta;
    if (this.camera.position.z <= CFG.DEST_Z) { this._endGame(true); return; }

    this._handleInput(delta);
    this.cameraX = lerp(this.cameraX, this.targetX, CFG.LANE_SMOOTH);
    this.camera.position.x = this.cameraX;

    this.bobTimer += delta;
    this.camera.position.y = CFG.EYE_HEIGHT
      + Math.sin(this.bobTimer * CFG.BOB_FREQ * Math.PI * 2) * CFG.BOB_AMP;

    // Obstacles
    this.obsDelay = (this.obsDelay ?? CFG.OBS_START_DELAY) - delta;
    if (this.obsDelay <= 0) {
      this.spawner.update(delta, cameraZ);
      this._checkObstacleCollisions();
    }

    // Pedestrians — includes Pedestrian and TouristCluster instances
    const nextPeds = [];
    for (const ped of this.pedestrians) {
      ped.update(delta);
      if (ped.isPastPlayer(cameraZ)) {
        ped.dispose();
        // ~18% chance to spawn a tourist cluster instead of a single pedestrian
        nextPeds.push(
          Math.random() < 0.18
            ? new TouristCluster(this.scene, cameraZ)
            : new Pedestrian(this.scene, cameraZ)
        );
      } else {
        nextPeds.push(ped);
      }
    }
    this.pedestrians = nextPeds;

    this._updateHUD();
  }
}

new Game();
