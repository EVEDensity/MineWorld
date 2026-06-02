/**
 * Simplex 2D 噪声生成器
 * 基于 Stefan Gustavson 的 SimplexNoise 算法实现
 * 用于地形高度图生成，产生自然起伏的地貌
 */

// Simplex 噪声常量
const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

// 3D 梯度向量（用于2D噪声的点积计算）
const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
];

export class SimplexNoise {
  constructor(seed = 42) {
    // 初始化排列表，用种子进行 Fisher-Yates 洗牌
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;

    // 基于种子的伪随机数生成器（线性同余法）
    let s = seed;
    for (let i = 255; i > 0; i--) {
      s = (s * 16807 + 0) % 2147483647;
      const j = s % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }

    // 复制排列表以处理溢出
    for (let i = 0; i < 256; i++) {
      this.perm[i] = p[i];
      this.perm[i + 256] = p[i];
    }
  }

  /** 2D Simplex 噪声，返回值范围 [-1, 1] */
  noise2D(xin, yin) {
    const perm = this.perm;

    // 偏斜输入坐标到单纯形网格
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);

    // 单纯形原点的未偏斜坐标
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;

    // 确定所在的单纯形三角形
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } // 下三角
    else { i1 = 0; j1 = 1; }          // 上三角

    // 三个角的偏移量
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;

    // 哈希排列索引
    const ii = i & 255;
    const jj = j & 255;

    // 计算三个角的贡献
    let n0 = 0, n1 = 0, n2 = 0;

    // 角0的贡献
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi0 = perm[ii + perm[jj]] % 12;
      t0 *= t0;
      n0 = t0 * t0 * (GRAD3[gi0][0] * x0 + GRAD3[gi0][1] * y0);
    }

    // 角1的贡献
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi1 = perm[ii + i1 + perm[jj + j1]] % 12;
      t1 *= t1;
      n1 = t1 * t1 * (GRAD3[gi1][0] * x1 + GRAD3[gi1][1] * y1);
    }

    // 角2的贡献
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi2 = perm[ii + 1 + perm[jj + 1]] % 12;
      t2 *= t2;
      n2 = t2 * t2 * (GRAD3[gi2][0] * x2 + GRAD3[gi2][1] * y2);
    }

    // 缩放到 [-1, 1]
    return 70.0 * (n0 + n1 + n2);
  }

  /**
   * 分形布朗运动（FBM）
   * 叠加多个频率的噪声，生成更自然的地形
   * @returns 值范围约 [-1, 1]
   */
  fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise2D(x * frequency, y * frequency);
      maxValue += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }
}
