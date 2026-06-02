/**
 * 像素方块世界 - 游戏主模块
 * 包含：玩家控制、物理系统、射线检测、游戏循环
 */

import * as THREE from 'three';
import {
  World, Chunk, BlockType, BlockNames, isSolid,
  CHUNK_SIZE, CHUNK_HEIGHT, RENDER_DISTANCE, getBlockColor,
  isMobileDevice, getRenderDistance,
} from './voxel.js';
import { AnimalManager } from './animals.js';

/* ============================================
   玩家类 - 第一人称角色控制
   ============================================ */
class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;

    // 位置与速度
    this.position = new THREE.Vector3(5.4, -27.0, 22.6);
    this.velocity = new THREE.Vector3(0, 0, 0);

    // 视角旋转（欧拉角）
    this.pitch = 0;   // 上下俯仰
    this.yaw = 0;     // 左右偏航

    // 物理参数
    this.gravity = -25;
    this.jumpSpeed = 12;
    this.moveSpeed = 5.5;
    this.onGround = false;

    // 玩家碰撞体尺寸
    this.width = 0.6;
    this.height = 1.75;
    this.eyeHeight = 1.6;

    // 输入状态
    this.keys = {};
    this.mouseDX = 0;
    this.mouseDY = 0;

    // 交互参数
    this.reachDistance = 7;
    this.selectedBlock = BlockType.GRASS;

    // 射线检测结果缓存
    this.targetBlock = null;
    this.targetFace = null;
  }

  /** 处理鼠标移动（视角旋转） */
  onMouseMove(dx, dy) {
    const sensitivity = 0.002;
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    // 限制俯仰角范围
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
  }

  /** 每帧更新：物理、碰撞、视角 */
  update(dt) {
    // 限制最大帧间隔，防止穿墙
    dt = Math.min(dt, 0.05);

    // 计算移动方向（基于视角）
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw),
      0,
      -Math.cos(this.yaw)
    ).normalize();

    const right = new THREE.Vector3(
      Math.cos(this.yaw),
      0,
      -Math.sin(this.yaw)
    ).normalize();

    // 根据输入计算目标速度
    const moveDir = new THREE.Vector3(0, 0, 0);
    if (this.keys['KeyW'] || this.keys['ArrowUp']) moveDir.add(forward);
    if (this.keys['KeyS'] || this.keys['ArrowDown']) moveDir.sub(forward);
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) moveDir.sub(right);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) moveDir.add(right);

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
    }

    // 水平移动
    this.velocity.x = moveDir.x * this.moveSpeed;
    this.velocity.z = moveDir.z * this.moveSpeed;

    // === 水物理检测 ===
    const footBlock = this.world.getBlock(
      Math.floor(this.position.x),
      Math.floor(this.position.y),
      Math.floor(this.position.z)
    );
    const eyeBlock = this.world.getBlock(
      Math.floor(this.position.x),
      Math.floor(this.position.y + this.eyeHeight),
      Math.floor(this.position.z)
    );
    const inWater = (footBlock === BlockType.WATER || eyeBlock === BlockType.WATER);

    // 重力：水中大幅降低
    const effectiveGravity = inWater ? this.gravity * 0.15 : this.gravity;
    this.velocity.y += effectiveGravity * dt;

    // 水中游泳：按住空格上浮
    if (inWater && (this.keys['Space'] || this.keys['KeyK'])) {
      this.velocity.y = 3;
      this.onGround = false;
    }

    // 跳跃（仅在地面且不在水中）
    if (!inWater && (this.keys['Space'] || this.keys['KeyK']) && this.onGround) {
      this.velocity.y = this.jumpSpeed;
      this.onGround = false;
    }

    // 水中移动减速
    if (inWater) {
      this.velocity.x *= 0.5;
      this.velocity.z *= 0.5;
    }

    // 逐轴移动并进行碰撞检测
    this.onGround = false;

    // X轴
    this.position.x += this.velocity.x * dt;
    this._resolveCollision('x');

    // Y轴
    this.position.y += this.velocity.y * dt;
    this._resolveCollision('y');

    // Z轴
    this.position.z += this.velocity.z * dt;
    this._resolveCollision('z');

    // 防止掉出世界
    if (this.position.y < -10) {
      this.position.y = 50;
      this.velocity.y = 0;
    }

    // 更新相机
    this.camera.position.set(
      this.position.x,
      this.position.y + this.eyeHeight,
      this.position.z
    );

    // 更新相机朝向
    const lookDir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    this.camera.lookAt(
      this.camera.position.x + lookDir.x,
      this.camera.position.y + lookDir.y,
      this.camera.position.z + lookDir.z
    );

    // 射线检测（目标方块）
    this._raycast();
  }

  /**
   * AABB 碰撞检测与解决
   * 沿指定轴检测碰撞并推出
   */
  _resolveCollision(axis) {
    const halfW = this.width / 2;
    const min = new THREE.Vector3(
      this.position.x - halfW,
      this.position.y,
      this.position.z - halfW
    );
    const max = new THREE.Vector3(
      this.position.x + halfW,
      this.position.y + this.height,
      this.position.z + halfW
    );

    // 检测范围内所有可能的方块
    const startX = Math.floor(min.x);
    const endX = Math.floor(max.x);
    const startY = Math.floor(min.y);
    const endY = Math.floor(max.y);
    const startZ = Math.floor(min.z);
    const endZ = Math.floor(max.z);

    for (let bx = startX; bx <= endX; bx++) {
      for (let by = startY; by <= endY; by++) {
        for (let bz = startZ; bz <= endZ; bz++) {
          const blockType = this.world.getBlock(bx, by, bz);
          if (blockType === BlockType.AIR) continue;

          const isWater = blockType === BlockType.WATER;

          // 水方块特殊处理：仅在Y轴下落时充当"地面"
          if (isWater) {
            if (axis !== 'y' || this.velocity.y >= 0) continue;
            // 只有下落接触水面才阻挡
            const blockMinW = { x: bx, y: by, z: bz };
            const blockMaxW = { x: bx + 1, y: by + 1, z: bz + 1 };
            if (min.x < blockMaxW.x && max.x > blockMinW.x &&
                min.y < blockMaxW.y && max.y > blockMinW.y &&
                min.z < blockMaxW.z && max.z > blockMinW.z) {
              this.position.y = blockMaxW.y;
              this.velocity.y = 0;
              this.onGround = true;
              min.y = this.position.y;
              max.y = this.position.y + this.height;
            }
            continue;
          }

          // 固体方块的 AABB
          const blockMin = { x: bx, y: by, z: bz };
          const blockMax = { x: bx + 1, y: by + 1, z: bz + 1 };

          // 检测 AABB 重叠
          if (min.x < blockMax.x && max.x > blockMin.x &&
              min.y < blockMax.y && max.y > blockMin.y &&
              min.z < blockMax.z && max.z > blockMin.z) {

            // 沿指定轴推出
            if (axis === 'x') {
              if (this.velocity.x > 0) {
                this.position.x = blockMin.x - halfW;
              } else {
                this.position.x = blockMax.x + halfW;
              }
              this.velocity.x = 0;
            } else if (axis === 'y') {
              if (this.velocity.y > 0) {
                this.position.y = blockMin.y - this.height;
              } else {
                this.position.y = blockMax.y;
                this.onGround = true;
              }
              this.velocity.y = 0;
            } else if (axis === 'z') {
              if (this.velocity.z > 0) {
                this.position.z = blockMin.z - halfW;
              } else {
                this.position.z = blockMax.z + halfW;
              }
              this.velocity.z = 0;
            }

            // 更新碰撞体范围
            min.x = this.position.x - halfW;
            max.x = this.position.x + halfW;
            min.y = this.position.y;
            max.y = this.position.y + this.height;
            min.z = this.position.z - halfW;
            max.z = this.position.z + halfW;
          }
        }
      }
    }
  }

  /**
   * DDA 射线检测算法
   * 从相机位置沿视线方向步进，找到第一个实体方块
   */
  _raycast() {
    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();

    this.targetBlock = null;
    this.targetFace = null;

    // DDA 参数
    const step = 0.05;
    const maxSteps = this.reachDistance / step;
    let prevX = Math.floor(origin.x);
    let prevY = Math.floor(origin.y);
    let prevZ = Math.floor(origin.z);

    for (let i = 0; i < maxSteps; i++) {
      const t = i * step;
      const x = Math.floor(origin.x + direction.x * t);
      const y = Math.floor(origin.y + direction.y * t);
      const z = Math.floor(origin.z + direction.z * t);

      // 跳过相同方块
      if (x === prevX && y === prevY && z === prevZ) continue;

      const block = this.world.getBlock(x, y, z);
      if (isSolid(block)) {
        this.targetBlock = { x, y, z, type: block };

        // 计算命中面的法线（上一步与当前步的差值）
        this.targetFace = {
          x: prevX - x,
          y: prevY - y,
          z: prevZ - z,
        };
        return;
      }

      prevX = x;
      prevY = y;
      prevZ = z;
    }
  }

  /** 放置方块 */
  placeBlock() {
    if (!this.targetBlock || !this.targetFace) return false;

    const px = this.targetBlock.x + this.targetFace.x;
    const py = this.targetBlock.y + this.targetFace.y;
    const pz = this.targetBlock.z + this.targetFace.z;

    // 检查新方块是否与玩家碰撞
    const halfW = this.width / 2;
    const playerMin = {
      x: this.position.x - halfW, y: this.position.y, z: this.position.z - halfW
    };
    const playerMax = {
      x: this.position.x + halfW, y: this.position.y + this.height, z: this.position.z + halfW
    };

    if (px + 1 > playerMin.x && px < playerMax.x &&
        py + 1 > playerMin.y && py < playerMax.y &&
        pz + 1 > playerMin.z && pz < playerMax.z) {
      return false; // 不能在玩家位置放置
    }

    if (py < 0 || py >= CHUNK_HEIGHT) return false;
    if (this.world.getBlock(px, py, pz) !== BlockType.AIR) return false;

    this.world.setBlock(px, py, pz, this.selectedBlock);
    return true;
  }

  /** 破坏方块 */
  breakBlock() {
    if (!this.targetBlock) return false;

    const { x, y, z } = this.targetBlock;
    if (y < 0 || y >= CHUNK_HEIGHT) return false;

    this.world.setBlock(x, y, z, BlockType.AIR);
    return true;
  }
}

/* ============================================
   高亮方块线框
   ============================================ */
class BlockHighlight {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(1.005, 1.005, 1.005);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2, transparent: true, opacity: 0.6 });
    this.mesh = new THREE.LineSegments(edges, mat);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(targetBlock) {
    if (targetBlock) {
      this.mesh.position.set(targetBlock.x + 0.5, targetBlock.y + 0.5, targetBlock.z + 0.5);
      this.mesh.visible = true;
    } else {
      this.mesh.visible = false;
    }
  }
}

/* ============================================
   触摸控制器（移动端专用）
   ============================================ */
class TouchController {
  constructor(player, game) {
    this.player = player;
    this.game = game;
    this.moveX = 0;    // -1 ~ 1 左右
    this.moveZ = 0;    // -1 ~ 1 前后
    this._joystickId = null;
    this._lookTouchId = null;
    this._lastTouchX = 0;
    this._lastTouchY = 0;
    this._init();
  }

  _init() {
    const zone = document.getElementById('joystickZone');
    const thumb = document.getElementById('joystickThumb');
    const canvas = this.game.canvas;

    // 用 pointerId 区分摇杆触点和视角触点，支持多点同时操作
    this._joystickId = null;
    this._lookTouchId = null;

    // ----- 虚拟摇杆 -----
    const findJoystickTouch = (e) => {
      if (this._joystickId === null) return null;
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === this._joystickId) return e.touches[i];
      }
      return null;
    };

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this._joystickId === null) {
        this._joystickId = e.changedTouches[0].identifier;
      }
      const t = findJoystickTouch(e);
      if (t) this._updateJoystick(t, zone, thumb);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = findJoystickTouch(e);
      if (t) this._updateJoystick(t, zone, thumb);
    }, { passive: false });
    zone.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (this._joystickId === e.changedTouches[0].identifier) {
        this._joystickId = null;
      }
      this.moveX = 0;
      this.moveZ = 0;
      thumb.style.transform = 'translate(-50%, -50%)';
    });
    zone.addEventListener('touchcancel', (e) => {
      if (this._joystickId === e.changedTouches[0].identifier) {
        this._joystickId = null;
      }
      this.moveX = 0;
      this.moveZ = 0;
      thumb.style.transform = 'translate(-50%, -50%)';
    });

    // ----- 视角控制（右侧区域） -----
    // 找一个非摇杆触点用于视角
    const findLookTouch = (e) => {
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.identifier !== this._joystickId && t.clientX > window.innerWidth * 0.35) {
          return t;
        }
      }
      return null;
    };

    canvas.addEventListener('touchstart', (e) => {
      // 只在有新触点落在右侧区域时开启视角（排除UI按钮区域）
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        // 跳过落在操作按钮区域的触摸
        if (t.target && t.target.closest && t.target.closest('#actionButtons, #joystickZone, #mobileHotbar')) continue;
        if (t.identifier !== this._joystickId && t.clientX > window.innerWidth * 0.35) {
          this._lookTouchId = t.identifier;
          this._lastTouchX = t.clientX;
          this._lastTouchY = t.clientY;
          break;
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      if (this._lookTouchId === null) return;
      // 在全部触点中找到我们的视角触点
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.identifier === this._lookTouchId) {
          const dx = t.clientX - this._lastTouchX;
          const dy = t.clientY - this._lastTouchY;
          this.player.onMouseMove(dx * 1.8, dy * 1.8);
          this._lastTouchX = t.clientX;
          this._lastTouchY = t.clientY;
          break;
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this._lookTouchId) {
          this._lookTouchId = null;
          break;
        }
      }
    });
    canvas.addEventListener('touchcancel', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this._lookTouchId) {
          this._lookTouchId = null;
          break;
        }
      }
    });

    // ----- 操作按钮 -----
    const btnJump = document.getElementById('btnJump');
    const btnPlace = document.getElementById('btnPlace');
    const btnBreak = document.getElementById('btnBreak');

    // 按钮按下时的视觉反馈
    const _flashBtn = (btn, isError) => {
      if (!btn) return;
      const bg = isError ? 'rgba(255, 80, 80, 0.4)' : 'rgba(255, 255, 255, 0.35)';
      const border = isError ? 'rgba(255, 80, 80, 0.7)' : 'rgba(255, 255, 255, 0.6)';
      btn.style.background = bg;
      btn.style.borderColor = border;
      btn.style.transition = 'background 0.1s, border-color 0.1s';
      setTimeout(() => {
        btn.style.background = 'rgba(255, 255, 255, 0.12)';
        btn.style.borderColor = 'rgba(255, 255, 255, 0.25)';
      }, 150);
    };

    // 触觉反馈（设备支持时）
    const _haptic = (pattern) => {
      if (navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    };

    if (btnJump) {
      const _jumpDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.player.keys['Space'] = true;
        _flashBtn(btnJump);
      };
      const _jumpUp = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.player.keys['Space'] = false;
      };
      btnJump.addEventListener('pointerdown', _jumpDown);
      btnJump.addEventListener('pointerup', _jumpUp);
      btnJump.addEventListener('pointercancel', _jumpUp);
      btnJump.addEventListener('pointerleave', _jumpUp);
    }

    if (btnPlace) {
      const _placeDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = this.player.placeBlock();
        _flashBtn(btnPlace, !ok);
        if (!ok) _haptic(10);
      };
      btnPlace.addEventListener('pointerdown', _placeDown);
    }

    if (btnBreak) {
      const _breakDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = this.player.breakBlock();
        _flashBtn(btnBreak, !ok);
        if (!ok) _haptic(10);
      };
      btnBreak.addEventListener('pointerdown', _breakDown);
    }
  }

  _updateJoystick(touch, zone, thumb) {
    const rect = zone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width / 2 - 25;

    let dx = touch.clientX - cx;
    let dy = touch.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > maxR) {
      dx = dx / dist * maxR;
      dy = dy / dist * maxR;
    }

    this.moveX = dx / maxR;
    this.moveZ = dy / maxR;

    thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}

/* ============================================
   游戏主类
   ============================================ */
class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.isRunning = false;
    this.isPointerLocked = false;

    // 设备检测
    this.isMobile = isMobileDevice();
    this.renderDistance = getRenderDistance();

    // Three.js 核心对象
    this.scene = null;
    this.camera = null;
    this.renderer = null;

    // 游戏对象
    this.world = null;
    this.player = null;
    this.highlight = null;
    this.touchController = null;
    this.animalManager = null;

    // 帧率统计
    this.clock = new THREE.Clock();
    this.frameCount = 0;
    this.fpsTime = 0;
    this.fps = 0;

    // UI 元素
    this.ui = {
      crosshair: document.getElementById('crosshair'),
      hotbar: document.getElementById('hotbar'),
      selectedBlockName: document.getElementById('selectedBlockName'),
      debugInfo: document.getElementById('debugInfo'),
      blockHighlight: document.getElementById('blockHighlight'),
      startScreen: document.getElementById('startScreen'),
      pauseScreen: document.getElementById('pauseScreen'),
      loadingBar: document.getElementById('loadingBar'),
      loadingFill: document.getElementById('loadingFill'),
      controlsPanel: document.getElementById('controlsPanel'),
    };

    // 可选方块列表
    this.blockTypes = [
      BlockType.GRASS, BlockType.DIRT, BlockType.STONE,
      BlockType.SAND, BlockType.WOOD, BlockType.LEAVES,
    ];
    this.selectedSlot = 0;
  }

  /** 初始化游戏 */
  async init() {
    this._initRenderer();
    this._initScene();
    this._initPlayer();
    this._initHighlight();
    this._initHotbar();
    if (this.isMobile) this._initMobileHotbar();
    this._initEvents();

    // 设置预览视角：近距离平视"DENSITY"立墙
    this.camera.position.set(0, 23, 12);
    this.camera.lookAt(0, 25, 0);

    // 开始界面保持显示，背后渲染 3D 世界
    this.ui.loadingBar.style.display = 'block';

    const radius = this.renderDistance;

    // 按离世界中心距离排序，优先加载"DENSITY"立墙区域
    const chunksToLoad = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        chunksToLoad.push([dx, dz]);
      }
    }
    chunksToLoad.sort((a, b) => {
      const dA = a[0] * a[0] + a[1] * a[1];
      const dB = b[0] * b[0] + b[1] * b[1];
      return dA - dB;
    });

    const needed = chunksToLoad.length;
    let generated = 0;
    let firstFrameDone = false;

    for (const [cx, cz] of chunksToLoad) {
      const key = this.world.chunkKey(cx, cz);
      if (!this.world.chunks.has(key)) {
        const chunk = await this._createChunk(cx, cz);
        if (chunk.mesh) this.scene.add(chunk.mesh);
        if (chunk.waterMesh) this.scene.add(chunk.waterMesh);
        generated++;
        this.ui.loadingFill.style.width = `${(generated / needed * 100) | 0}%`;

        // 中心区块加载完毕后立即渲染首帧（确保"DENSITY"立墙可见）
        if (!firstFrameDone && cx * cx + cz * cz <= 4) {
          this.renderer.render(this.scene, this.camera);
          firstFrameDone = true;
        }

        this.renderer.render(this.scene, this.camera);
        if (generated % (this.isMobile ? 1 : 3) === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }

    // 出生在用户指定位置（仅设玩家数据，相机保持在立墙视角）
    this._spawnX = 5.4;
    this._spawnZ = 22.6;
    this._spawnY = -27.0;
    this.player.position.set(this._spawnX, this._spawnY, this._spawnZ);
    this.player.yaw = 0;              // 面朝正北，正对 DENSITY 文字立墙
    this.player.pitch = -0.3;         // 微俯视，观赏立墙全貌

    // 相机保持 DENSITY 立墙预览视角，等用户点击开始后再切到玩家视角
    // 不做 camera.position 移动，保持背景一直是游戏世界

    this.ui.loadingBar.style.display = 'none';

    // 在世界中生成小机器人
    this.animalManager.spawnAnimals();
  }

  /** 创建区块 */
  _createChunk(cx, cz) {
    const key = this.world.chunkKey(cx, cz);
    if (this.world.chunks.has(key)) return this.world.chunks.get(key);

    const chunk = new Chunk(cx, cz);
    this.world.generateChunkData(chunk);
    chunk.buildMesh((wx, wy, wz) => this.world.getBlock(wx, wy, wz), this.world.material, this.world.waterMaterial);
    this.world.chunks.set(key, chunk);
    return chunk;
  }

  /** 初始化渲染器 */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: this.isMobile ? 'low-power' : 'default',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // 移动端降低像素比以提升性能
    const maxPixelRatio = this.isMobile ? 1.2 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    this.renderer.setClearColor(0x87CEEB);
  }

  /** 初始化场景与灯光 */
  _initScene() {
    this.scene = new THREE.Scene();

    // 雾效：距离根据设备动态调整，移动端增加雾距避免近处物体泛蓝
    const fogFar = this.renderDistance * CHUNK_SIZE + 4;
    const fogNear = this.isMobile ? Math.max(25, fogFar - 20) : Math.max(15, fogFar - 40);
    this.scene.fog = new THREE.Fog(0x87CEEB, fogNear, fogFar);

    // 环境光
    const ambientLight = new THREE.AmbientLight(0xcccccc, 0.7);
    this.scene.add(ambientLight);

    // 方向光（模拟太阳）
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(50, 100, 30);
    this.scene.add(dirLight);

    // 半球光（天空+地面反射）
    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x556633, 0.3);
    this.scene.add(hemiLight);

    // 初始化世界并设置渲染距离
    this.world = new World(this.scene);
    this.world.renderDistance = this.renderDistance;
    this.world.init();

    // 初始化机器人生成管理器
    this.animalManager = new AnimalManager(this.scene, this.world, this.isMobile);

    // 相机：移动端更广视角（90°），桌面端默认（75°）
    this.defaultFov = this.isMobile ? 90 : 75;
    this.fov = this.defaultFov;
    this.fovMin = 15;
    this.fovMax = 130;
    this.camera = new THREE.PerspectiveCamera(
      this.fov, window.innerWidth / window.innerHeight, 0.1, 1000
    );
  }

  /** 初始化玩家 */
  _initPlayer() {
    this.player = new Player(this.camera, this.world);
  }

  /** 初始化方块高亮 */
  _initHighlight() {
    this.highlight = new BlockHighlight(this.scene);
  }

  /** 初始化物品栏UI */
  _initHotbar() {
    const hotbar = this.ui.hotbar;
    hotbar.innerHTML = '';

    this.blockTypes.forEach((type, i) => {
      const slot = document.createElement('div');
      slot.className = `hotbar-slot${i === 0 ? ' selected' : ''}`;
      slot.dataset.index = i;

      const preview = document.createElement('div');
      preview.className = 'block-preview';
      preview.style.background = getBlockColor(type);
      // 添加3D效果
      preview.style.boxShadow = 'inset -3px -3px 0 rgba(0,0,0,0.25), inset 3px 3px 0 rgba(255,255,255,0.15)';
      slot.appendChild(preview);

      const keyLabel = document.createElement('span');
      keyLabel.className = 'slot-key';
      keyLabel.textContent = i + 1;
      slot.appendChild(keyLabel);

      hotbar.appendChild(slot);
    });
  }

  /** 更新物品栏选中状态 */
  _updateHotbar() {
    const slots = this.ui.hotbar.querySelectorAll('.hotbar-slot');
    slots.forEach((slot, i) => {
      slot.classList.toggle('selected', i === this.selectedSlot);
    });
    this.player.selectedBlock = this.blockTypes[this.selectedSlot];

    // 更新选中方块名称提示（热键栏上方）
    const name = BlockNames[this.blockTypes[this.selectedSlot]] || '';
    const nameEl = this.ui.selectedBlockName;
    if (nameEl) {
      nameEl.textContent = name;
      // 切换时短暂放大动画
      nameEl.style.transform = 'translateX(-50%) scale(1.15)';
      nameEl.style.opacity = '1';
      setTimeout(() => {
        nameEl.style.transform = 'translateX(-50%) scale(1)';
      }, 120);
    }

    // 同步更新移动端物品栏
    if (this.isMobile) this._updateMobileHotbar();
  }

  /** 初始化移动端物品栏 */
  _initMobileHotbar() {
    const mobileHotbar = document.getElementById('mobileHotbar');
    if (!mobileHotbar) return;
    mobileHotbar.innerHTML = '';

    this.blockTypes.forEach((type, i) => {
      const slot = document.createElement('div');
      slot.className = `m-slot${i === 0 ? ' selected' : ''}`;
      slot.dataset.index = i;

      const preview = document.createElement('div');
      preview.className = 'm-block-preview';
      preview.style.background = getBlockColor(type);
      preview.style.boxShadow = 'inset -2px -2px 0 rgba(0,0,0,0.25), inset 2px 2px 0 rgba(255,255,255,0.15)';
      slot.appendChild(preview);

      slot.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.selectedSlot = i;
        this._updateHotbar();
      });

      mobileHotbar.appendChild(slot);
    });
  }

  /** 更新移动端物品栏选中状态 */
  _updateMobileHotbar() {
    const slots = document.querySelectorAll('#mobileHotbar .m-slot');
    slots.forEach((slot, i) => {
      slot.classList.toggle('selected', i === this.selectedSlot);
    });
  }

  /** 绑定事件监听 */
  _initEvents() {
    // 键盘事件（桌面端 + 移动端外接键盘通用）
    document.addEventListener('keydown', (e) => {
      this.player.keys[e.code] = true;

      // 数字键选择方块
      if (e.code >= 'Digit1' && e.code <= 'Digit9') {
        const idx = parseInt(e.code.charAt(5)) - 1;
        if (idx < this.blockTypes.length) {
          this.selectedSlot = idx;
          this._updateHotbar();
        }
      }

      // ESC 暂停（移动端也支持）
      if (e.code === 'Escape' && this.isRunning) {
        if (this.isMobile) {
          this.isRunning = false;
          this.ui.pauseScreen.style.display = 'flex';
          this._showGameUI(false);
        }
      }

      // 视野调整快捷键（= 放大/缩小视野，- 缩小/扩大视野）
      if (e.code === 'Equal') {           // = 放大画面 → 视野变窄
        this._adjustFOV(-5);
      }
      if (e.code === 'Minus') {           // - 缩小画面 → 视野变广
        this._adjustFOV(5);
      }
      if (e.code === 'Digit0' || e.code === 'Numpad0') {  // 0 重置视野
        this._resetFOV();
      }
    });

    document.addEventListener('keyup', (e) => {
      this.player.keys[e.code] = false;
    });

    // 鼠标移动（仅桌面端指针锁定后）
    document.addEventListener('mousemove', (e) => {
      if (!this.isPointerLocked) return;
      this.player.onMouseMove(e.movementX, e.movementY);
    });

    // 鼠标点击（仅桌面端指针锁定后）
    document.addEventListener('mousedown', (e) => {
      if (!this.isPointerLocked) return;
      if (e.button === 0) {
        this.player.placeBlock();
      } else if (e.button === 2) {
        this.player.breakBlock();
      }
    });

    // 禁用右键菜单
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // 滚轮切换方块（仅桌面端指针锁定后）
    document.addEventListener('wheel', (e) => {
      if (!this.isPointerLocked) return;

      // Ctrl + 滚轮 / 触控板双指缩放 → 调整视野
      // 捏合(deltaY>0) = 缩小画面 = 视野变广(FOV变大)；推开(deltaY<0) = 放大画面 = 视野变窄(FOV变小)
      if (e.ctrlKey) {
        this._adjustFOV(e.deltaY > 0 ? 5 : -5);
        return;
      }

      if (e.deltaY > 0) {
        this.selectedSlot = (this.selectedSlot + 1) % this.blockTypes.length;
      } else {
        this.selectedSlot = (this.selectedSlot - 1 + this.blockTypes.length) % this.blockTypes.length;
      }
      this._updateHotbar();
    });

    // ----- 桌面端：指针锁定逻辑 -----
    if (!this.isMobile) {
      document.addEventListener('pointerlockchange', () => {
        this.isPointerLocked = document.pointerLockElement === this.canvas;
        if (this.isPointerLocked) {
          this.ui.pauseScreen.style.display = 'none';
          this._showGameUI(true);
        } else if (this.isRunning) {
          this.ui.pauseScreen.style.display = 'flex';
        }
      });

      const requestLock = () => {
        if (!this.isPointerLocked && this.isRunning) {
          this.canvas.requestPointerLock();
        }
      };

      this.ui.startScreen.addEventListener('click', () => {
        this.isRunning = true;
        this.ui.startScreen.style.display = 'none';
        // 相机从 DENSITY 立墙预览切到玩家第一人称
        this.camera.position.set(this._spawnX, this._spawnY + this.player.eyeHeight, this._spawnZ);
        const lookDir = new THREE.Vector3(
          -Math.sin(this.player.yaw) * Math.cos(this.player.pitch),
          Math.sin(this.player.pitch),
          -Math.cos(this.player.yaw) * Math.cos(this.player.pitch)
        );
        this.camera.lookAt(
          this.camera.position.x + lookDir.x,
          this.camera.position.y + lookDir.y,
          this.camera.position.z + lookDir.z
        );
        requestLock();
      });

      this.ui.pauseScreen.addEventListener('click', requestLock);
      this.canvas.addEventListener('click', requestLock);
    }

    // ----- 移动端：直接进入游戏 + 触摸控制 -----
    if (this.isMobile) {
      this.ui.startScreen.addEventListener('click', () => {
        this.isRunning = true;
        this.ui.startScreen.style.display = 'none';
        // 相机从 DENSITY 立墙预览切到玩家第一人称
        this.camera.position.set(this._spawnX, this._spawnY + this.player.eyeHeight, this._spawnZ);
        const lookDir = new THREE.Vector3(
          -Math.sin(this.player.yaw) * Math.cos(this.player.pitch),
          Math.sin(this.player.pitch),
          -Math.cos(this.player.yaw) * Math.cos(this.player.pitch)
        );
        this.camera.lookAt(
          this.camera.position.x + lookDir.x,
          this.camera.position.y + lookDir.y,
          this.camera.position.z + lookDir.z
        );
        this._showGameUI(true);
      });

      this.ui.pauseScreen.addEventListener('click', () => {
        this.isRunning = true;
        this.ui.pauseScreen.style.display = 'none';
        this._showGameUI(true);
      });

      // 初始化触摸控制器
      this.touchController = new TouchController(this.player, this);
    }

    // 窗口尺寸变化
    window.addEventListener('resize', () => this._onResize());
  }

  /** 显示/隐藏游戏HUD */
  _showGameUI(show) {
    const display = show ? 'flex' : 'none';
    this.ui.crosshair.style.display = show ? 'block' : 'none';
    this.ui.selectedBlockName.style.display = show ? 'block' : 'none';
    this.ui.hotbar.style.display = this.isMobile ? 'none' : display; // 桌面端物品栏
    this.ui.debugInfo.style.display = show ? 'block' : 'none';
    this.ui.blockHighlight.style.display = 'none'; // 已禁用
    // 右上角操作说明面板（仅桌面端）
    if (!this.isMobile) {
      this.ui.controlsPanel.style.display = show ? 'flex' : 'none';
    }
    // 移动端控件：仅在移动端显示
    if (this.isMobile) {
      const mobileControls = document.getElementById('mobileControls');
      if (mobileControls) mobileControls.style.display = show ? 'block' : 'none';
    }
  }

  /** 窗口大小变化处理 */
  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** 调整视野角度（FOV） */
  _adjustFOV(delta) {
    this.fov = Math.max(this.fovMin, Math.min(this.fovMax, this.fov + delta));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this._showFOVHint();
  }

  /** 重置视野到默认值 */
  _resetFOV() {
    this._adjustFOV(this.defaultFov - this.fov);
  }

  /** 短暂显示 FOV 提示 */
  _showFOVHint() {
    if (this._fovHintTimer) clearTimeout(this._fovHintTimer);
    let hint = document.getElementById('fovHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'fovHint';
      hint.style.cssText =
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'color:#fff;font-size:28px;font-weight:bold;' +
        'text-shadow:0 2px 8px rgba(0,0,0,0.6);pointer-events:none;z-index:100;' +
        'transition:opacity 0.3s;';
      document.body.appendChild(hint);
    }
    hint.textContent = `FOV: ${this.fov.toFixed(0)}°`;
    hint.style.opacity = '1';
    this._fovHintTimer = setTimeout(() => {
      hint.style.opacity = '0';
    }, 1200);
  }

  /** 更新调试信息 */
  _updateDebugInfo() {
    const pos = this.player.position;
    const cx = Math.floor(pos.x / CHUNK_SIZE);
    const cz = Math.floor(pos.z / CHUNK_SIZE);
    const chunks = this.world.chunks.size;

    this.ui.debugInfo.innerHTML =
      `FPS: ${this.fps}<br>` +
      `FOV: ${this.fov.toFixed(0)}°<br>` +
      `XYZ: ${pos.x.toFixed(1)} / ${pos.y.toFixed(1)} / ${pos.z.toFixed(1)}<br>` +
      `区块: ${cx}, ${cz} | 已加载: ${chunks}<br>` +
      `机器人: ${this.animalManager ? this.animalManager.animals.length : 0} 只`;

    // 目标方块提示（已禁用）
    this.ui.blockHighlight.style.display = 'none';
  }

  /** 主游戏循环 */
  animate() {
    requestAnimationFrame(() => this.animate());

    const dt = this.clock.getDelta();

    // FPS 计算
    this.frameCount++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTime = 0;
    }

    // 移动端：从触控控制器注入键盘输入
    if (this.isMobile && this.touchController && this.isRunning) {
      const tc = this.touchController;
      const deadZone = 0.15;
      const absX = Math.abs(tc.moveX);
      const absZ = Math.abs(tc.moveZ);
      this.player.keys['KeyW'] = tc.moveZ < -deadZone;
      this.player.keys['KeyS'] = tc.moveZ > deadZone;
      this.player.keys['KeyA'] = tc.moveX < -deadZone;
      this.player.keys['KeyD'] = tc.moveX > deadZone;
    }

    // 桌面端指针锁定 或 移动端运行时更新游戏逻辑
    if (this.isPointerLocked || (this.isMobile && this.isRunning)) {
      this.player.update(dt);
      this.world.update(this.player.position.x, this.player.position.z);
      this.highlight.update(this.player.targetBlock);
    }

    // 更新机器人 AI（始终运行，即使暂停状态也让机器人有生命感）
    if (this.animalManager) {
      this.animalManager.update(dt);
    }

    // 渲染
    this.renderer.render(this.scene, this.camera);

    // 更新UI（降低更新频率）
    if (this.frameCount % 10 === 0) {
      this._updateDebugInfo();
    }
  }
}

/* ============================================
   启动游戏
   ============================================ */
window.addEventListener('DOMContentLoaded', async () => {
  const game = new Game();
  await game.init();
  game.animate();
});
