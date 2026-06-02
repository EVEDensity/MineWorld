/**
 * 像素方块世界 - 体素引擎核心模块
 * 包含：方块定义、纹理图集、区块管理、世界生成、DENSITY 文字立墙
 */

import * as THREE from 'three';
import { SimplexNoise } from './noise.js';

/* ============================================
   常量与配置
   ============================================ */
export const CHUNK_SIZE = 16;       // 区块XZ尺寸
export const CHUNK_HEIGHT = 48;     // 区块高度（移动端优化：从64降至48）
export const RENDER_DISTANCE = 4;   // 桌面端渲染距离（区块数）
export const MOBILE_RENDER_DISTANCE = 4; // 移动端渲染距离（与桌面端拉平）
export const SEA_LEVEL = 20;        // 海平面高度

/** 检测是否为移动端设备 */
export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent)
    || ('ontouchstart' in window && window.innerWidth < 1024);
}

/** 获取当前设备适用的渲染距离 */
export function getRenderDistance() {
  return isMobileDevice() ? MOBILE_RENDER_DISTANCE : RENDER_DISTANCE;
}

/* ============================================
   方块类型定义
   ============================================ */
export const BlockType = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  WATER: 7,
  COZE_CYAN: 8,         // 粉色（DENSITY 文字立墙）
};

// 方块名称映射（用于UI显示）
export const BlockNames = {
  [BlockType.GRASS]: '草地',
  [BlockType.DIRT]: '泥土',
  [BlockType.STONE]: '石头',
  [BlockType.SAND]: '沙子',
  [BlockType.WOOD]: '木头',
  [BlockType.LEAVES]: '树叶',
  [BlockType.WATER]: '水',
  [BlockType.COZE_CYAN]: '青色',
};

// 非固体方块（可穿过）
const NON_SOLID = new Set([BlockType.AIR, BlockType.WATER]);

// 方块是否为固体（用于碰撞检测）
export const isSolid = (type) => !NON_SOLID.has(type);

/* ============================================
   纹理图集系统
   每个方块面使用16x16像素贴图，排列在图集中
   ============================================ */
const TEX_SIZE = 16;         // 单个纹理尺寸
const ATLAS_COLS = 8;        // 图集列数
const ATLAS_ROWS = 2;        // 图集行数
const ATLAS_W = TEX_SIZE * ATLAS_COLS;  // 128px
const ATLAS_H = TEX_SIZE * ATLAS_ROWS;  // 32px

// 纹理索引定义
const TEX = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD_SIDE: 5,
  WOOD_TOP: 6,
  LEAVES: 7,
  WATER: 8,
  COZE_CYAN: 9,
};

// 每种方块的面纹理映射 { top, side, bottom }
const BLOCK_TEXTURES = {
  [BlockType.GRASS]:      { top: TEX.GRASS_TOP,    side: TEX.GRASS_SIDE, bottom: TEX.DIRT },
  [BlockType.DIRT]:       { top: TEX.DIRT,         side: TEX.DIRT,       bottom: TEX.DIRT },
  [BlockType.STONE]:      { top: TEX.STONE,        side: TEX.STONE,      bottom: TEX.STONE },
  [BlockType.SAND]:       { top: TEX.SAND,         side: TEX.SAND,       bottom: TEX.SAND },
  [BlockType.WOOD]:       { top: TEX.WOOD_TOP,     side: TEX.WOOD_SIDE,  bottom: TEX.WOOD_TOP },
  [BlockType.LEAVES]:     { top: TEX.LEAVES,       side: TEX.LEAVES,     bottom: TEX.LEAVES },
  [BlockType.WATER]:      { top: TEX.WATER,        side: TEX.WATER,      bottom: TEX.WATER },
  [BlockType.COZE_CYAN]:  { top: TEX.COZE_CYAN,    side: TEX.COZE_CYAN,  bottom: TEX.COZE_CYAN },
};

/** 伪随机数生成器（基于坐标，用于纹理像素变化） */
function hash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xff) / 255;
}

/** 在 canvas 上绘制单个16x16纹理 */
function drawTexture(ctx, index, drawFn) {
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  const x = col * TEX_SIZE;
  const y = row * TEX_SIZE;
  ctx.save();
  ctx.translate(x, y);
  drawFn(ctx);
  ctx.restore();
}

/** 填充基础色并添加噪声像素 */
function fillNoisy(ctx, baseR, baseG, baseB, noiseAmount = 20) {
  for (let py = 0; py < TEX_SIZE; py++) {
    for (let px = 0; px < TEX_SIZE; px++) {
      const n = (hash(px, py) - 0.5) * noiseAmount;
      const r = Math.max(0, Math.min(255, baseR + n));
      const g = Math.max(0, Math.min(255, baseG + n));
      const b = Math.max(0, Math.min(255, baseB + n));
      ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

/** 创建纹理图集 Canvas */
function createAtlasCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // 草地顶部 - 绿色带深绿斑点
  drawTexture(ctx, TEX.GRASS_TOP, (c) => {
    fillNoisy(c, 90, 160, 50, 30);
  });

  // 草地侧面 - 上部绿色，下部泥土色
  drawTexture(ctx, TEX.GRASS_SIDE, (c) => {
    fillNoisy(c, 134, 96, 67, 20);
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < TEX_SIZE; px++) {
        const n = (hash(px + 100, py + 100) - 0.5) * 30;
        const g = Math.max(0, Math.min(255, 140 + n));
        c.fillStyle = `rgb(${(70+n/2)|0},${g|0},${(40+n/3)|0})`;
        c.fillRect(px, py, 1, 1);
      }
    }
  });

  // 泥土
  drawTexture(ctx, TEX.DIRT, (c) => { fillNoisy(c, 134, 96, 67, 25); });

  // 石头
  drawTexture(ctx, TEX.STONE, (c) => {
    fillNoisy(c, 128, 128, 128, 25);
    for (let i = 0; i < 4; i++) {
      const sx = (hash(i, 42) * 14) | 0;
      const sy = (hash(i, 73) * 14) | 0;
      c.fillStyle = 'rgba(80,80,80,0.6)';
      c.fillRect(sx, sy, 2, 1);
      c.fillRect(sx + 1, sy + 1, 1, 1);
    }
  });

  // 沙子
  drawTexture(ctx, TEX.SAND, (c) => { fillNoisy(c, 220, 200, 130, 20); });

  // 木头侧面
  drawTexture(ctx, TEX.WOOD_SIDE, (c) => {
    fillNoisy(c, 120, 80, 50, 15);
    for (let px = 0; px < TEX_SIZE; px++) {
      if (hash(px, 999) > 0.6) {
        for (let py = 0; py < TEX_SIZE; py++) {
          c.fillStyle = 'rgba(80,55,30,0.4)';
          c.fillRect(px, py, 1, 1);
        }
      }
    }
  });

  // 木头顶部 - 年轮
  drawTexture(ctx, TEX.WOOD_TOP, (c) => {
    fillNoisy(c, 160, 120, 70, 15);
    const cx = 8, cy = 8;
    for (let py = 0; py < TEX_SIZE; py++) {
      for (let px = 0; px < TEX_SIZE; px++) {
        const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
        if ((dist | 0) % 3 === 0) {
          c.fillStyle = 'rgba(90,60,30,0.5)';
          c.fillRect(px, py, 1, 1);
        }
      }
    }
  });

  // 树叶
  drawTexture(ctx, TEX.LEAVES, (c) => {
    for (let py = 0; py < TEX_SIZE; py++) {
      for (let px = 0; px < TEX_SIZE; px++) {
        const n = hash(px + 50, py + 50);
        if (n > 0.15) {
          const v = 30 + (hash(px, py) * 40) | 0;
          c.fillStyle = `rgb(${(30+n*20)|0},${(100+v)|0},${(30+n*10)|0})`;
          c.fillRect(px, py, 1, 1);
        }
      }
    }
  });

  // 水
  drawTexture(ctx, TEX.WATER, (c) => {
    fillNoisy(c, 50, 130, 220, 15);
    for (let py = 2; py < TEX_SIZE; py += 4) {
      for (let px = 0; px < TEX_SIZE; px++) {
        const offset = ((hash(py, px + 200) * 3) | 0) - 1;
        const bx = px + offset;
        if (bx >= 0 && bx < TEX_SIZE) {
          c.fillStyle = 'rgba(80,170,255,0.4)';
          c.fillRect(bx, py, 1, 1);
        }
      }
    }
  });

  // === DENSITY 文字立墙粉色纹理 (#F46B95) ===
  drawTexture(ctx, TEX.COZE_CYAN, (c) => {
    fillNoisy(c, 244, 107, 149, 10);
  });

  return canvas;
}

/** 创建 Three.js 纹理 */
export function createBlockTexture() {
  const canvas = createAtlasCanvas();
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  return texture;
}

/** 获取方块预览颜色（用于物品栏显示） */
export function getBlockColor(type) {
  const colors = {
    [BlockType.GRASS]:      '#5a9e32',
    [BlockType.DIRT]:       '#866043',
    [BlockType.STONE]:      '#808080',
    [BlockType.SAND]:       '#dccc82',
    [BlockType.WOOD]:       '#78503a',
    [BlockType.LEAVES]:     '#2d6e1e',
    [BlockType.WATER]:      '#3388dd',
    [BlockType.COZE_CYAN]:  '#F46B95',
  };
  return colors[type] || '#ff00ff';
}

/** 获取纹理图集中某个纹理索引的UV范围 */
function getTexUV(texIndex) {
  const col = texIndex % ATLAS_COLS;
  const row = Math.floor(texIndex / ATLAS_COLS);
  const u0 = col / ATLAS_COLS;
  const u1 = (col + 1) / ATLAS_COLS;
  const v0 = row / ATLAS_ROWS;
  const v1 = (row + 1) / ATLAS_ROWS;
  return { u0, v0, u1, v1 };
}

/* ============================================
   六个面的几何定义
   ============================================ */
const FACES = [
  { dir: [1, 0, 0], face: 'side', corners: [
    { pos: [1, 0, 0], uv: [0, 0] }, { pos: [1, 1, 0], uv: [0, 1] },
    { pos: [1, 1, 1], uv: [1, 1] }, { pos: [1, 0, 1], uv: [1, 0] },
  ]},
  { dir: [-1, 0, 0], face: 'side', corners: [
    { pos: [0, 0, 1], uv: [0, 0] }, { pos: [0, 1, 1], uv: [0, 1] },
    { pos: [0, 1, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [1, 0] },
  ]},
  { dir: [0, 1, 0], face: 'top', corners: [
    { pos: [0, 1, 0], uv: [0, 0] }, { pos: [0, 1, 1], uv: [0, 1] },
    { pos: [1, 1, 1], uv: [1, 1] }, { pos: [1, 1, 0], uv: [1, 0] },
  ]},
  { dir: [0, -1, 0], face: 'bottom', corners: [
    { pos: [0, 0, 1], uv: [0, 0] }, { pos: [0, 0, 0], uv: [0, 1] },
    { pos: [1, 0, 0], uv: [1, 1] }, { pos: [1, 0, 1], uv: [1, 0] },
  ]},
  { dir: [0, 0, 1], face: 'side', corners: [
    { pos: [1, 0, 1], uv: [0, 0] }, { pos: [1, 1, 1], uv: [0, 1] },
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] },
  ]},
  { dir: [0, 0, -1], face: 'side', corners: [
    { pos: [0, 0, 0], uv: [0, 0] }, { pos: [0, 1, 0], uv: [0, 1] },
    { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] },
  ]},
];

/* ============================================
   区块类 (Chunk)
   ============================================ */
export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
    this.mesh = null;
    this.waterMesh = null;
    this.dirty = true;
  }

  getBlock(lx, ly, lz) {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) {
      return BlockType.AIR;
    }
    return this.blocks[lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE];
  }

  setBlock(lx, ly, lz, type) {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) return;
    this.blocks[lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE] = type;
    this.dirty = true;
  }

  buildMesh(getWorldBlock, material, waterMaterial) {
    let hasSolid = false;
    for (let i = 0; i < this.blocks.length; i++) {
      if (this.blocks[i] !== 0) { hasSolid = true; break; }
    }
    if (!hasSolid) {
      this._disposeMesh();
      this.dirty = false;
      return;
    }

    const wx0 = this.cx * CHUNK_SIZE;
    const wz0 = this.cz * CHUNK_SIZE;

    const sPositions = [];
    const sNormals = [];
    const sUvs = [];
    const sIndices = [];
    let sVc = 0;

    const wPositions = [];
    const wNormals = [];
    const wUvs = [];
    const wIndices = [];
    let wVc = 0;

    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const blockType = this.getBlock(lx, ly, lz);
          if (blockType === BlockType.AIR) continue;

          const texMapping = BLOCK_TEXTURES[blockType];
          if (!texMapping) continue;

          const isWater = blockType === BlockType.WATER;
          let positions, normals, uvs, indices, vertexCount;
          if (isWater) {
            positions = wPositions; normals = wNormals; uvs = wUvs; indices = wIndices; vertexCount = wVc;
          } else {
            positions = sPositions; normals = sNormals; uvs = sUvs; indices = sIndices; vertexCount = sVc;
          }

          for (const face of FACES) {
            const nx = lx + face.dir[0];
            const ny = ly + face.dir[1];
            const nz = lz + face.dir[2];

            let neighborType;
            if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE && ny >= 0 && ny < CHUNK_HEIGHT) {
              neighborType = this.getBlock(nx, ny, nz);
            } else {
              neighborType = getWorldBlock(wx0 + nx, ny, wz0 + nz);
            }

            if (neighborType !== BlockType.AIR && neighborType !== BlockType.WATER) continue;

            const texIdx = texMapping[face.face];
            const { u0, v0, u1, v1 } = getTexUV(texIdx);

            for (const corner of face.corners) {
              positions.push(lx + corner.pos[0], ly + corner.pos[1], lz + corner.pos[2]);
              normals.push(face.dir[0], face.dir[1], face.dir[2]);
              uvs.push(u0 + corner.uv[0] * (u1 - u0), v0 + corner.uv[1] * (v1 - v0));
            }

            indices.push(
              vertexCount, vertexCount + 1, vertexCount + 2,
              vertexCount, vertexCount + 2, vertexCount + 3
            );
            vertexCount += 4;
          }

          if (isWater) { wVc = vertexCount; } else { sVc = vertexCount; }
        }
      }
    }

    this._disposeMesh();

    if (sPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(sPositions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(sNormals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(sUvs, 2));
      geo.setIndex(sIndices);
      geo.computeBoundingSphere();
      this.mesh = new THREE.Mesh(geo, material);
      this.mesh.position.set(wx0, 0, wz0);
    }

    if (wPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(wPositions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(wNormals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(wUvs, 2));
      geo.setIndex(wIndices);
      geo.computeBoundingSphere();
      this.waterMesh = new THREE.Mesh(geo, waterMaterial);
      this.waterMesh.position.set(wx0, 0, wz0);
    }

    this.dirty = false;
  }

  _disposeMesh() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh = null;
    }
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      if (this.waterMesh.parent) this.waterMesh.parent.remove(this.waterMesh);
      this.waterMesh = null;
    }
  }

  dispose() {
    this._disposeMesh();
  }
}

/* ============================================
   世界类 (World)
   ============================================ */
export class World {
  constructor(scene, seed = 12345) {
    this.scene = scene;
    this.seed = seed;
    this.noise = new SimplexNoise(seed);
    this.treeNoise = new SimplexNoise(seed + 777);
    this.chunks = new Map();
    this.material = null;
    this.pendingChunks = [];
    this.renderDistance = RENDER_DISTANCE;
  }

  init() {
    const texture = createBlockTexture();
    this.material = new THREE.MeshLambertMaterial({
      map: texture,
      side: THREE.FrontSide,
      transparent: false,
      depthWrite: true,
    });
    this.waterMaterial = new THREE.MeshLambertMaterial({
      map: texture,
      side: THREE.FrontSide,
      transparent: false,
      depthWrite: true,
    });
  }

  chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return BlockType.AIR;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.chunkKey(cx, cz));
    if (!chunk) return BlockType.AIR;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.getBlock(lx, wy, lz);
  }

  setBlock(wx, wy, wz, type) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.chunkKey(cx, cz));
    if (!chunk) return;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunk.setBlock(lx, wy, lz, type);

    if (lx === 0) this._markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this._markDirty(cx + 1, cz);
    if (lz === 0) this._markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this._markDirty(cx, cz + 1);
  }

  _markDirty(cx, cz) {
    const chunk = this.chunks.get(this.chunkKey(cx, cz));
    if (chunk) chunk.dirty = true;
  }

  // ────────────── DENSITY 文字立墙（XY 平面，面朝南）──────────────
  // 每个字母 9×9 像素位图，立墙：row=Y(上→下), col=X(左→右)
  // 9×9 像素位图，row 0=字母顶部，row 8=字母底部
  static LETTERS = {
    D: [[1,1,1,1,1,1,0,0,0],[1,0,0,0,0,0,1,0,0],[1,0,0,0,0,0,0,1,0],[1,0,0,0,0,0,0,1,0],[1,0,0,0,0,0,0,1,0],[1,0,0,0,0,0,0,1,0],[1,0,0,0,0,0,0,1,0],[1,0,0,0,0,0,1,0,0],[1,1,1,1,1,1,0,0,0]],
    E: [[1,1,1,1,1,1,1,1,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,1,1,1,1,1,1,0,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,1,1,1,1,1,1,1,0]],
    N: [[1,0,0,0,0,0,0,0,1],[1,1,0,0,0,0,0,0,1],[1,0,1,0,0,0,0,0,1],[1,0,0,1,0,0,0,0,1],[1,0,0,0,1,0,0,0,1],[1,0,0,0,0,1,0,0,1],[1,0,0,0,0,0,1,0,1],[1,0,0,0,0,0,0,1,1],[1,0,0,0,0,0,0,0,1]],
    S: [[0,1,1,1,1,1,1,1,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[0,1,1,1,1,1,1,0,0],[0,0,0,0,0,0,0,1,0],[0,0,0,0,0,0,0,0,1],[0,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,0],[0,1,1,1,1,1,1,1,0]],
    I: [[1,1,1,1,1,1,1,1,1],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[1,1,1,1,1,1,1,1,1]],
    T: [[1,1,1,1,1,1,1,1,1],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0]],
    Y: [[1,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,1],[0,1,0,0,0,0,0,1,0],[0,0,1,0,0,0,1,0,0],[0,0,0,1,0,1,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,1,0,0,0,0]],
  };
  static WORD = ['D','E','N','S','I','T','Y'];
  static LETTER_SIZE = 9;
  static GAP = 2;
  static TEXT_GROUND_Y = 18;        // 沙质地面 Y（抬高4层）
  static TEXT_FLAT_RADIUS_X = 40;   // 平地 X 方向半径（7字母=75宽，覆盖±38）
  static TEXT_FLAT_RADIUS_Z = 10;   // 平地 Z 方向半径
  static TOTAL_W = 75;              // 9×7 + 2×6
  static TEXT_START_X = -37;        // -floor(75/2)
  static TEXT_BASE_Y = 19;          // 立墙底部 Y（在沙地上，跟随地面抬高）
  static TEXT_WALL_Z = 0;           // 立墙中心 Z
  static TEXT_WALL_DEPTH = 3;       // 立墙厚度

  /** 获取立墙文字方块（XY 平面） */
  _getTextBlock(wx, wy, wz) {
    // 立墙 Z 范围：中心 ± 1（3 格厚）
    const wallMinZ = World.TEXT_WALL_Z - 1;
    const wallMaxZ = World.TEXT_WALL_Z + 1;
    if (wz < wallMinZ || wz > wallMaxZ) return BlockType.AIR;

    // Y 范围：TEXT_BASE_Y ~ TEXT_BASE_Y + 8
    if (wy < World.TEXT_BASE_Y || wy > World.TEXT_BASE_Y + World.LETTER_SIZE - 1) return BlockType.AIR;

    const lx = wx - World.TEXT_START_X;
    // Y轴翻转：bitmap row 0 = 字母顶部 → 对应墙面最高处；row 8 = 底部 → 对应墙面最低处
    const ly = (World.TEXT_BASE_Y + World.LETTER_SIZE - 1) - wy;
    if (lx < 0 || ly < 0 || ly >= World.LETTER_SIZE) return BlockType.AIR;

    let off = 0;
    for (const ch of World.WORD) {
      if (lx >= off && lx < off + World.LETTER_SIZE) {
        return World.LETTERS[ch][ly][lx - off] ? BlockType.COZE_CYAN : BlockType.AIR;
      }
      off += World.LETTER_SIZE + World.GAP;
    }
    return BlockType.AIR;
  }

  _isInTextZone(cx, cz) {
    const x0 = cx * CHUNK_SIZE, x1 = x0 + 15;
    const z0 = cz * CHUNK_SIZE, z1 = z0 + 15;
    const RX = World.TEXT_FLAT_RADIUS_X;
    const RZ = World.TEXT_FLAT_RADIUS_Z;
    return x1 >= -RX && x0 <= RX && z1 >= -RZ && z0 <= RZ;
  }

  generateChunkData(chunk) {
    const { cx, cz } = chunk;
    const wx0 = cx * CHUNK_SIZE;
    const wz0 = cz * CHUNK_SIZE;
    const GY = World.TEXT_GROUND_Y;

    // === 文字区域：沙质平地 + 青色立墙 ===
    if (this._isInTextZone(cx, cz)) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const wx = wx0 + lx;
          const wz = wz0 + lz;
          for (let y = 0; y < CHUNK_HEIGHT; y++) {
            let b;
            if (y < GY - 5)              b = BlockType.STONE;
            else if (y < GY)             b = BlockType.DIRT;
            else if (y === GY)           b = BlockType.GRASS;
            else if (y >= World.TEXT_BASE_Y && y <= World.TEXT_BASE_Y + World.LETTER_SIZE - 1) {
              b = this._getTextBlock(wx, y, wz);
            } else                       b = BlockType.AIR;
            chunk.setBlock(lx, y, lz, b);
          }
        }
      }
      return;
    }

    // === 正常地形：噪声生成 ===
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = wx0 + lx;
        const wz = wz0 + lz;

        const scale = 0.02;
        const heightNoise = this.noise.fbm(wx * scale, wz * scale, 4, 2.0, 0.5);
        const height = Math.floor((heightNoise + 1) * 0.5 * 32 + 8);
        const clampedHeight = Math.max(1, Math.min(CHUNK_HEIGHT - 1, height));

        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          let blockType = BlockType.AIR;

          if (y <= clampedHeight) {
            if (y === clampedHeight) {
              blockType = clampedHeight <= SEA_LEVEL ? BlockType.SAND : BlockType.GRASS;
            } else if (y > clampedHeight - 4) {
              blockType = clampedHeight <= SEA_LEVEL ? BlockType.SAND : BlockType.DIRT;
            } else {
              blockType = BlockType.STONE;
            }
          }

          chunk.setBlock(lx, y, lz, blockType);
        }
      }
    }

    this._generateTrees(chunk);
  }

  /** 在区块中生成树木 */
  _generateTrees(chunk) {
    const { cx, cz } = chunk;
    const wx0 = cx * CHUNK_SIZE;
    const wz0 = cz * CHUNK_SIZE;

    for (let lz = 2; lz < CHUNK_SIZE - 2; lz++) {
      for (let lx = 2; lx < CHUNK_SIZE - 2; lx++) {
        const wx = wx0 + lx;
        const wz = wz0 + lz;

        const treeVal = this.treeNoise.noise2D(wx * 0.5, wz * 0.5);
        if (treeVal < 0.75) continue;

        let surfaceY = -1;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          if (chunk.getBlock(lx, y, lz) === BlockType.GRASS) {
            surfaceY = y;
            break;
          }
        }
        if (surfaceY < 0 || surfaceY > CHUNK_HEIGHT - 10) continue;

        const trunkHeight = 3 + ((hash(wx, wz) * 3) | 0);
        for (let ty = 1; ty <= trunkHeight; ty++) {
          chunk.setBlock(lx, surfaceY + ty, lz, BlockType.WOOD);
        }

        const canopyY = surfaceY + trunkHeight;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
              if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
              const bx = lx + dx;
              const bz = lz + dz;
              if (bx >= 0 && bx < CHUNK_SIZE && bz >= 0 && bz < CHUNK_SIZE) {
                if (chunk.getBlock(bx, canopyY + dy, bz) === BlockType.AIR) {
                  chunk.setBlock(bx, canopyY + dy, bz, BlockType.LEAVES);
                }
              }
            }
          }
        }
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
            const bx = lx + dx;
            const bz = lz + dz;
            if (bx >= 0 && bx < CHUNK_SIZE && bz >= 0 && bz < CHUNK_SIZE) {
              if (chunk.getBlock(bx, canopyY + 2, bz) === BlockType.AIR) {
                chunk.setBlock(bx, canopyY + 2, bz, BlockType.LEAVES);
              }
            }
          }
        }
      }
    }
  }

  update(playerX, playerZ) {
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);

    const neededChunks = new Set();
    const rd = this.renderDistance;
    for (let dx = -rd; dx <= rd; dx++) {
      for (let dz = -rd; dz <= rd; dz++) {
        if (dx * dx + dz * dz > rd * rd) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = this.chunkKey(cx, cz);
        neededChunks.add(key);

        if (!this.chunks.has(key)) {
          this.pendingChunks.push({ cx, cz, key });
        }
      }
    }

    for (const [key, chunk] of this.chunks) {
      if (!neededChunks.has(key)) {
        if (chunk.mesh) this.scene.remove(chunk.mesh);
        if (chunk.waterMesh) this.scene.remove(chunk.waterMesh);
        chunk.dispose();
        this.chunks.delete(key);
      }
    }

    const maxPerFrame = 2;
    let processed = 0;
    while (this.pendingChunks.length > 0 && processed < maxPerFrame) {
      const { cx, cz, key } = this.pendingChunks.shift();
      if (this.chunks.has(key)) continue;

      const chunk = new Chunk(cx, cz);
      this.generateChunkData(chunk);
      chunk.buildMesh((wx, wy, wz) => this.getBlock(wx, wy, wz), this.material, this.waterMaterial);
      this.chunks.set(key, chunk);

      if (chunk.mesh) this.scene.add(chunk.mesh);
      if (chunk.waterMesh) this.scene.add(chunk.waterMesh);
      processed++;
    }

    let rebuilt = 0;
    for (const [, chunk] of this.chunks) {
      if (chunk.dirty && rebuilt < 2) {
        if (chunk.mesh) this.scene.remove(chunk.mesh);
        if (chunk.waterMesh) this.scene.remove(chunk.waterMesh);
        chunk.buildMesh((wx, wy, wz) => this.getBlock(wx, wy, wz), this.material, this.waterMaterial);
        if (chunk.mesh && !chunk.mesh.parent) this.scene.add(chunk.mesh);
        if (chunk.waterMesh && !chunk.waterMesh.parent) this.scene.add(chunk.waterMesh);
        rebuilt++;
      }
    }
  }

  getSurfaceHeight(wx, wz) {
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      if (isSolid(this.getBlock(wx, y, wz))) {
        return y + 1;
      }
    }
    return SEA_LEVEL;
  }

  get pendingCount() {
    return this.pendingChunks.length;
  }
}