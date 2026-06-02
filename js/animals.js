/**
 * 像素方块世界 - 机器人实体系统
 * 包含：ScoutBot（轻型侦察机器人）、HeavyBot（重型机器人）的体素模型、AI 行为、生成管理
 */
import * as THREE from 'three';
import { BlockType, isSolid, CHUNK_SIZE } from './voxel.js';

/* ============================================
   常量配置
   ============================================ */
const SCOUT_COUNT = 5;        // 轻型机器人数量（替换牛）
const HEAVY_COUNT = 3;        // 重型机器人数量（替换马）
const MOBILE_SCOUT_COUNT = 2;
const MOBILE_HEAVY_COUNT = 1;
const SPAWN_RADIUS = 25;
const MIN_SPAWN_DIST = 4;
const WANDER_RANGE = 20;

/* ============================================
   工具函数
   ============================================ */
function randRange(min, max) {
  return min + Math.random() * (max - min);
}

/** 伪随机（基于种子坐标） */
function seedRand(x, z) {
  let h = (x * 374761393 + z * 668265263) ^ 1274126177;
  h = ((h ^ (h >> 13)) * 1274126177);
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
}

/* ============================================
   机器人基类
   ============================================ */
class Robot {
  constructor(scene, world, x, y, z) {
    this.scene = scene;
    this.world = world;
    this.position = new THREE.Vector3(x, y, z);
    this.rotation = randRange(0, Math.PI * 2);
    this.targetRotation = this.rotation;

    // 碰撞体尺寸（子类可覆盖）
    this.collisionWidth = 0.7;
    this.collisionHeight = 0.9;

    // AI 状态
    this.state = 'idle';
    this.stateTimer = randRange(1, 3);
    this.wanderDir = new THREE.Vector3(0, 0, 1);
    this.wanderSpeed = 1.5;
    this.turnSpeed = 3.0;
    this.bobPhase = Math.random() * Math.PI * 2;

    // Three.js 群组
    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this.group.rotation.y = this.rotation;
    this.scene.add(this.group);

    // 动画部件（子类填充：按 [前左, 前右, 后左, 后右] 顺序）
    this._animParts = [];
  }

  _buildModel() {}

  get footY() {
    return this.position.y;
  }

  _getGroundY(wx, wz) {
    for (let wy = 48 - 1; wy >= 0; wy--) {
      const block = this.world.getBlock(Math.floor(wx), wy, Math.floor(wz));
      if (isSolid(block) && block !== BlockType.LEAVES) {
        return wy + 1;
      }
    }
    return 0;
  }

  /** 检测指定位置是否有实体方块阻挡 */
  _isBlocked(wx, wy, wz) {
    const hw = this.collisionWidth / 2;
    const hh = this.collisionHeight;
    for (let bx = Math.floor(wx - hw); bx <= Math.floor(wx + hw); bx++) {
      for (let by = Math.floor(wy); by < Math.floor(wy + hh); by++) {
        for (let bz = Math.floor(wz - hw); bz <= Math.floor(wz + hw); bz++) {
          const block = this.world.getBlock(bx, by, bz);
          if (isSolid(block) && block !== BlockType.LEAVES) {
            return true;
          }
        }
      }
    }
    return false;
  }

  _isSafeStep(wx, wy, wz) {
    // 检查脚下是否有支撑
    const below = this.world.getBlock(Math.floor(wx), Math.floor(wy) - 1, Math.floor(wz));
    if (!isSolid(below) || below === BlockType.LEAVES) return false;
    // 检查是否踩水
    const atFeet = this.world.getBlock(Math.floor(wx), Math.floor(wy), Math.floor(wz));
    if (atFeet === BlockType.WATER) return false;
    // 检查地面落差
    const groundAhead = this._getGroundY(wx, wz);
    if (Math.abs(groundAhead - wy) > 2) return false;
    // 检查是否有实体方块阻挡
    if (this._isBlocked(wx, wy, wz)) return false;
    return true;
  }

  /** 四肢摆动动画 */
  _animateLimbs(dt) {
    if (this._animParts.length === 0) return;
    const swingAngle = Math.sin(this.bobPhase) * 0.45;
    for (let i = 0; i < this._animParts.length; i++) {
      const part = this._animParts[i];
      // 对腿：前左+后右 相位与 前右+后左 相反
      // _animParts 顺序：[前左, 前右, 后左, 后右]（4条腿）
      //             或 [左臂, 右臂]（2条手臂）
      const phaseSign = (i % 2 === 0) ? 1 : -1;
      part.rotation.x = swingAngle * phaseSign;
    }
  }

  /** 重置四肢到默认角度 */
  _resetLimbs() {
    for (const part of this._animParts) {
      part.rotation.x *= 0.85; // 平滑回位
    }
  }

  update(dt, spawnCenter) {
    dt = Math.min(dt, 0.1);
    this.stateTimer -= dt;
    this.bobPhase += dt * (this.state === 'wander' ? 5 : 1.5);

    switch (this.state) {
      case 'idle':
        this._updateIdle(dt, spawnCenter);
        this._resetLimbs();
        break;
      case 'wander':
        this._updateWander(dt, spawnCenter);
        this._animateLimbs(dt);
        break;
    }

    // 平滑旋转
    const rDiff = this.targetRotation - this.rotation;
    let shortDiff = ((rDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
    this.rotation += shortDiff * Math.min(this.turnSpeed * dt, 1);
    this.group.rotation.y = this.rotation;

    // 行走时上下轻微摆动
    const bob = this.state === 'wander' ? Math.sin(this.bobPhase) * 0.04 : 0;
    this.group.position.set(this.position.x, this.position.y + bob, this.position.z);

    // 天线摆动（子类实现）
    this._animateAntenna(dt);
  }

  _animateAntenna(dt) {
    // 子类可覆盖
  }

  _updateIdle(dt, spawnCenter) {
    if (Math.random() < dt * 0.5) {
      this.targetRotation += randRange(-0.5, 0.5);
    }
    if (this.stateTimer <= 0) {
      this.state = 'wander';
      this.stateTimer = randRange(2, 5);
      this.wanderDir.set(
        Math.cos(this.targetRotation), 0, Math.sin(this.targetRotation)
      ).normalize();
    }
  }

  _updateWander(dt, spawnCenter) {
    const step = this.wanderSpeed * dt;
    const nx = this.position.x + this.wanderDir.x * step;
    const nz = this.position.z + this.wanderDir.z * step;
    const ny = this._getGroundY(nx, nz);

    const distFromCenter = Math.sqrt(
      (nx - spawnCenter.x) ** 2 + (nz - spawnCenter.z) ** 2
    );

    if (this._isSafeStep(nx, ny, nz) && distFromCenter < WANDER_RANGE) {
      this.position.x = nx;
      this.position.z = nz;
      this.position.y = ny;
      this.targetRotation = Math.atan2(this.wanderDir.z, this.wanderDir.x);
    } else {
      this.targetRotation += randRange(Math.PI * 0.4, Math.PI * 0.8) * (Math.random() > 0.5 ? 1 : -1);
      this.wanderDir.set(Math.cos(this.targetRotation), 0, Math.sin(this.targetRotation)).normalize();
      this.stateTimer = Math.max(this.stateTimer, 0.5);
    }

    if (Math.random() < dt * 0.3) {
      this.targetRotation += randRange(-0.8, 0.8);
      this.wanderDir.set(Math.cos(this.targetRotation), 0, Math.sin(this.targetRotation)).normalize();
    }

    if (this.stateTimer <= 0) {
      this.state = 'idle';
      this.stateTimer = randRange(1, 4);
    }
  }

  dispose() {
    if (this.group) {
      this.group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.scene.remove(this.group);
    }
  }
}

/* ============================================
   轻型侦察机器人 (ScoutBot) — 替换牛
   小巧灵活，蓝色眼睛，单天线
   ============================================ */
class ScoutBot extends Robot {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.collisionWidth = 0.7;
    this.collisionHeight = 1.0;
    this.wanderSpeed = 1.4;
    this.turnSpeed = 2.8;
    this.antennaAngle = 0;
    this._buildModel();
  }

  _buildModel() {
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xB0B8C0 });    // 银灰
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x3A3E44 });    // 深灰
    const accentMat = new THREE.MeshLambertMaterial({ color: 0x4A90D9 });  // 蓝色点缀
    const redMat = new THREE.MeshLambertMaterial({ color: 0xFF4444 });     // 红色指示灯
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x66D9FF });       // 发光蓝眼睛

    // ── 身体（主躯干）──
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.9), bodyMat);
    body.position.set(0, 0.45, 0);
    this.group.add(body);

    // 胸甲面板
    const chestPanel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.06), accentMat);
    chestPanel.position.set(0, 0.5, 0.48);
    this.group.add(chestPanel);

    // 核心指示灯（胸口发光点）
    const coreLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.04), eyeMat);
    coreLight.position.set(0, 0.5, 0.52);
    this.group.add(coreLight);

    // ── 头部 ──
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 0.45), bodyMat);
    head.position.set(0, 0.85, 0.35);
    this.group.add(head);

    // 面罩（深色面板）
    const faceplate = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.28, 0.04), darkMat);
    faceplate.position.set(0, 0.85, 0.58);
    this.group.add(faceplate);

    // 眼睛（两个蓝色发光方块）
    const eyeGeo = new THREE.BoxGeometry(0.1, 0.08, 0.03);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(0.1, 0.92, 0.6);
    this.group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(-0.1, 0.92, 0.6);
    this.group.add(eyeR);

    // ── 天线（一根金属棒 + 红色小球）──
    const antennaPole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.06), darkMat);
    antennaPole.position.set(0, 1.15, 0.3);
    this.group.add(antennaPole);
    const antennaBall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), redMat);
    antennaBall.position.set(0, 1.28, 0.3);
    antennaBall.name = 'antennaBall';
    this.group.add(antennaBall);

    // ── 侧面板（手臂位置）──
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.2), darkMat);
    sideL.position.set(0.42, 0.45, 0);
    this.group.add(sideL);
    const sideR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.2), darkMat);
    sideR.position.set(-0.42, 0.45, 0);
    this.group.add(sideR);

    // ── 腿部（四条机械腿）──
    const legGeo = new THREE.BoxGeometry(0.16, 0.35, 0.16);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x6B7280 });
    const legs = [
      [0.18, 0.17, 0.28], [-0.18, 0.17, 0.28],
      [0.18, 0.17, -0.28], [-0.18, 0.17, -0.28],
    ];
    for (const [lx, ly, lz] of legs) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, ly, lz);
      this.group.add(leg);
      this._animParts.push(leg);
    }
  }

  _animateAntenna(dt) {
    this.antennaAngle += dt * 2;
    const ball = this.group.getObjectByName('antennaBall');
    if (ball) {
      ball.position.x = Math.sin(this.antennaAngle) * 0.04;
    }
  }
}

/* ============================================
   重型机器人 (HeavyBot) — 替换马
   更大更强壮，橙色眼睛，双天线，履带式腿
   ============================================ */
class HeavyBot extends Robot {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.collisionWidth = 0.85;
    this.collisionHeight = 1.15;
    this.wanderSpeed = 1.0;
    this.turnSpeed = 2.0;
    this.antennaAngle = 0;
    this._buildModel();
  }

  _buildModel() {
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x889098 });    // 深银灰
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x2D3136 });    // 暗灰
    const accentMat = new THREE.MeshLambertMaterial({ color: 0xE8833A });  // 橙色点缀
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xFFB866 });       // 发光橙黄眼睛
    const redMat = new THREE.MeshLambertMaterial({ color: 0xFF3333 });

    // ── 身体（重型躯干）──
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.65, 1.2), bodyMat);
    body.position.set(0, 0.55, 0);
    this.group.add(body);

    // 肩部装甲
    const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.3), darkMat);
    shoulderL.position.set(0.5, 0.7, 0.2);
    this.group.add(shoulderL);
    const shoulderR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.3), darkMat);
    shoulderR.position.set(-0.5, 0.7, 0.2);
    this.group.add(shoulderR);

    // 胸部面板 + 指示灯
    const chestPanel = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.06), accentMat);
    chestPanel.position.set(0, 0.6, 0.63);
    this.group.add(chestPanel);
    const coreLight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.04), eyeMat);
    coreLight.position.set(0, 0.6, 0.67);
    this.group.add(coreLight);

    // ── 头部 ──
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), bodyMat);
    head.position.set(0, 0.95, 0.45);
    this.group.add(head);

    // 面罩
    const faceplate = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.3, 0.04), darkMat);
    faceplate.position.set(0, 0.95, 0.71);
    this.group.add(faceplate);

    // 眼睛（两个橙色发光方块，稍大）
    const eyeGeo = new THREE.BoxGeometry(0.12, 0.1, 0.03);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(0.12, 1.03, 0.73);
    this.group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(-0.12, 1.03, 0.73);
    this.group.add(eyeR);

    // ── 双天线 ──
    const antGeo = new THREE.BoxGeometry(0.06, 0.28, 0.06);
    const antL = new THREE.Mesh(antGeo, darkMat);
    antL.position.set(0.1, 1.25, 0.4);
    this.group.add(antL);
    const antR = new THREE.Mesh(antGeo, darkMat);
    antR.position.set(-0.1, 1.25, 0.4);
    this.group.add(antR);
    const ballL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), redMat);
    ballL.position.set(0.1, 1.4, 0.4);
    ballL.name = 'antennaBallL';
    this.group.add(ballL);
    const ballR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), redMat);
    ballR.position.set(-0.1, 1.4, 0.4);
    ballR.name = 'antennaBallR';
    this.group.add(ballR);

    // ── 手臂（重型机械臂）──
    const armGeo = new THREE.BoxGeometry(0.18, 0.4, 0.2);
    const armMat = new THREE.MeshLambertMaterial({ color: 0x5A6068 });
    const armL = new THREE.Mesh(armGeo, armMat);
    armL.position.set(0.5, 0.5, 0.15);
    this.group.add(armL);
    this._animParts.push(armL);
    const armR = new THREE.Mesh(armGeo, armMat);
    armR.position.set(-0.5, 0.5, 0.15);
    this.group.add(armR);
    this._animParts.push(armR);

    // ── 履带式腿部（两块大方块模拟履带）──
    const treadGeo = new THREE.BoxGeometry(0.3, 0.25, 0.9);
    const treadMat = new THREE.MeshLambertMaterial({ color: 0x3A3E44 });
    const treadL = new THREE.Mesh(treadGeo, treadMat);
    treadL.position.set(0.3, 0.12, 0);
    this.group.add(treadL);
    const treadR = new THREE.Mesh(treadGeo, treadMat);
    treadR.position.set(-0.3, 0.12, 0);
    this.group.add(treadR);

    // 履带纹理细节（小方块模拟履带片）
    for (let i = -2; i <= 2; i++) {
      const detailGeo = new THREE.BoxGeometry(0.34, 0.04, 0.1);
      const detailL = new THREE.Mesh(detailGeo, accentMat);
      detailL.position.set(0.3, 0.02, i * 0.28);
      this.group.add(detailL);
      const detailR = new THREE.Mesh(detailGeo, accentMat);
      detailR.position.set(-0.3, 0.02, i * 0.28);
      this.group.add(detailR);
      // 顶部履带片
      const detailTL = new THREE.Mesh(detailGeo, accentMat);
      detailTL.position.set(0.3, 0.24, i * 0.28);
      this.group.add(detailTL);
      const detailTR = new THREE.Mesh(detailGeo, accentMat);
      detailTR.position.set(-0.3, 0.24, i * 0.28);
      this.group.add(detailTR);
    }
  }

  _animateAntenna(dt) {
    this.antennaAngle += dt * 1.8;
    const ballL = this.group.getObjectByName('antennaBallL');
    const ballR = this.group.getObjectByName('antennaBallR');
    const offset = Math.sin(this.antennaAngle) * 0.05;
    if (ballL) ballL.position.x = 0.1 + offset;
    if (ballR) ballR.position.x = -0.1 - offset;
  }
}

/* ============================================
   机器人生成管理器
   ============================================ */
export class AnimalManager {
  constructor(scene, world, isMobile = false) {
    this.scene = scene;
    this.world = world;
    this.isMobile = isMobile;
    this.robots = [];
    this.spawnCenter = new THREE.Vector3(0, 0, 0);
    this._spawned = false;
  }

  get animals() {
    return this.robots;
  }

  spawnAnimals() {
    if (this._spawned) return;
    this._spawned = true;

    const scoutCount = this.isMobile ? MOBILE_SCOUT_COUNT : SCOUT_COUNT;
    const heavyCount = this.isMobile ? MOBILE_HEAVY_COUNT : HEAVY_COUNT;
    const usedPositions = [];

    const trySpawn = (type) => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = randRange(5, SPAWN_RADIUS);
        const sx = this.spawnCenter.x + Math.cos(angle) * dist;
        const sz = this.spawnCenter.z + Math.sin(angle) * dist;

        const groundBlock = this.world.getBlock(
          Math.floor(sx), Math.floor(this._getGroundY(sx, sz) - 1), Math.floor(sz)
        );
        if (groundBlock !== BlockType.GRASS && groundBlock !== BlockType.SAND) continue;

        const gy = this._getGroundY(sx, sz);
        if (gy < 1 || gy > 40) continue;

        let tooClose = false;
        for (const p of usedPositions) {
          const d = Math.sqrt((sx - p.x) ** 2 + (sz - p.z) ** 2);
          if (d < MIN_SPAWN_DIST) { tooClose = true; break; }
        }
        if (tooClose) continue;

        usedPositions.push({ x: sx, z: sz });
        let robot;
        if (type === 'scout') {
          robot = new ScoutBot(this.scene, this.world, sx, gy, sz);
        } else {
          robot = new HeavyBot(this.scene, this.world, sx, gy, sz);
        }
        this.robots.push(robot);
        return;
      }
    };

    // 先生成重型机器人，再生成轻型侦察机器人
    for (let i = 0; i < heavyCount; i++) trySpawn('heavy');
    for (let i = 0; i < scoutCount; i++) trySpawn('scout');
  }

  _getGroundY(wx, wz) {
    for (let wy = 48 - 1; wy >= 0; wy--) {
      const block = this.world.getBlock(Math.floor(wx), wy, Math.floor(wz));
      if (isSolid(block) && block !== BlockType.LEAVES) {
        return wy + 1;
      }
    }
    return 1;
  }

  update(dt) {
    for (const robot of this.robots) {
      robot.update(dt, this.spawnCenter);
    }
  }

  dispose() {
    for (const robot of this.robots) {
      robot.dispose();
    }
    this.robots = [];
  }
}