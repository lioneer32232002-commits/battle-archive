// 巴斯通地形 · 真實資產升級(docs/asset-pipeline-spec.md §3)
//
// terrain.js 先把程序化版本建起來(開場不等網路),本檔在資產到齊後**就地替換**:
//   ① 雪地 PBR:snow_02(高 repeat)當細節層,原本的程序化雪地 canvas 降為 macro 層(乘在 map 之後),
//      森林覆蓋處混入 forrest_ground_01;道路與車轍換 brown_mud_dry。細節貼花層(車轍、散兵坑、
//      彈坑、樹下暗斑)原封不動留著 —— 那一層是「位置對得上」的東西,平鋪貼圖取代不了。
//   ② 森林:Poly Haven fir_tree_01／pine_tree_01／pine_sapling_medium 的幾何餵 InstancedMesh,
//      沿用 terrain.js 原本那 520 個座標與旋轉(所以樹下暗斑仍然對位)。積雪靠頂點色 → shader 裡
//      mix 成雪色(針葉是深綠,單純乘頂點色永遠白不起來)。
//   ③ 房舍:Blender 的 house_ardennes.glb(含 snow_cap)、barn.glb、church.glb,依材質併成
//      shell／roof／snow／glass 四組餵 InstancedMesh,牆面與屋瓦套 Poly Haven PBR,
//      glass 那一組接手夜間窗光。巴斯通鎮與佛伊村共用同一批 InstancedMesh(靠 instanceColor 分色)。
//   ④ 樹爆落點放 dead_tree_trunk 斷木、陣地放彈藥箱與油桶。
//
// 所有替換都是「加上新的、把舊的 visible=false」,載入失敗時場景仍是完整的程序化版本。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { collectByGroup, geoMetrics, normalizeAttributes } from './assets.js';

// 針葉樹目標高度(單位;與 terrain.js 的程序化三層圓錐同尺度 10.8),再乘每棵的 scale。
// 稍微矮一點:讓 glb 的真樹幹露在圓錐樹冠下方,枝葉只在樹冠邊緣露出一圈輪廓。
const TREE_H = 10.4;
const GLB_NEAR = 240;        // 只有核心區的樹換 glb(見 upgradeForest 註)
const ENV_I = 0.85;          // glb 材質的 envMapIntensity(§3:各場次自訂)
const ROUGH_MIN = 0.35;      // §3:粗糙度下限,避免塑膠感

export async function applyTerrainAssets(art, assets) {
  await assets.ready;
  const done = { ground: false, forest: false, buildings: false, debris: false };
  try { done.ground = upgradeGround(art, assets); } catch (e) { console.warn('[bastogne] 雪地 PBR 失敗', e); }
  try { done.buildings = await upgradeBuildings(art, assets); } catch (e) { console.warn('[bastogne] 房舍替換失敗', e); }
  try { done.forest = await upgradeForest(art, assets); } catch (e) { console.warn('[bastogne] 森林替換失敗', e); }
  try { done.debris = await addDebris(art, assets); } catch (e) { console.warn('[bastogne] 斷木／道具失敗', e); }
  return done;
}

// ── ① 雪地 PBR ────────────────────────────────────────────
function upgradeGround(art, assets) {
  const { field, snowMat, detail, mobile, treeSpots, fieldW, fieldCZ } = art;
  const rep = mobile ? 56 : 120;                       // 1 tile ≈ 12／25 單位
  const snow = assets.pbr('snow_02', { repeat: rep });
  if (!snow.map) return false;

  const macro = snowMat.map;                           // 程序化雪地(髒雪、露土、彈坑暈染)
  macro.colorSpace = THREE.SRGBColorSpace;             // §9-3:當顏色用的 CanvasTexture 必須標 sRGB
  const forestRep = mobile ? 26 : 52;
  const fgTex = assets.texture('forrest_ground_01', 'diff', { repeat: forestRep });
  const maskTex = forestMaskTexture(treeSpots, fieldW, fieldCZ, mobile ? 256 : 512);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xf6f9fc,
    roughness: 0.74,                                   // 0.6–0.75:放晴時柔亮不刺眼(低於 0.7 會在太陽方向出現刺眼的濕滑反光)
    metalness: 0.0,
    ...snow,
  });
  if (mat.normalMap) mat.normalScale.set(0.6, 0.6);   // 再高在掠角會閃成濕滑的冰面
  mat.envMapIntensity = 0.6;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMacro = { value: macro };
    sh.uniforms.uForest = { value: fgTex ?? macro };
    sh.uniforms.uForestMask = { value: maskTex };
    sh.uniforms.uForestRep = { value: forestRep };
    sh.uniforms.uHasForest = { value: fgTex ? 1 : 0 };
    sh.vertexShader = 'varying vec2 vFieldUv;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n\tvFieldUv = uv;'
    );
    sh.fragmentShader = `
      uniform sampler2D uMacro; uniform sampler2D uForest; uniform sampler2D uForestMask;
      uniform float uForestRep; uniform float uHasForest; varying vec2 vFieldUv;
    ` + sh.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      {
        // 森林地面:樹群覆蓋處把雪面壓成針葉腐土(混,不是取代 —— 林間仍有積雪)
        float fm = texture2D(uForestMask, vFieldUv).r * uHasForest * 0.5;
        vec3 fg = texture2D(uForest, vFieldUv * uForestRep).rgb;
        fg = mix(vec3(dot(fg, vec3(0.33))), fg, 0.45) * 1.15;   // 去掉夏天的綠,留下針葉腐土的褐灰
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.62, fg, 0.7), fm);
        // macro 層:田塊尺度的髒雪／露土／彈坑暈染(平鋪貼圖做不出來的低頻變化)
        vec3 macro = texture2D(uMacro, vFieldUv * 10.0).rgb;
        diffuseColor.rgb *= (0.45 + 0.80 * macro);
      }
    `);
  };
  field.material = mat;
  snowMat.dispose?.();

  // 細節貼花層跟著改成 Standard,否則它不吃環境光,疊上去會像一層灰膜
  const dmat = new THREE.MeshStandardMaterial({
    map: detail.material.map, transparent: true, depthWrite: false,
    roughness: 0.85, metalness: 0, envMapIntensity: 0.5,
  });
  detail.material.dispose?.();
  detail.material = dmat;

  // 道路／車轍:壓實的雪泥(換成 Standard,才跟雪原吃同一套光)
  const road = assets.pbr('brown_mud_dry', { repeat: 6, repeatY: 46, maps: ['diff'] });
  if (road.map) {
    const roadMat = new THREE.MeshStandardMaterial({
      // 偏冷的灰乘上乾泥貼圖 → 壓實的雪泥,而不是一條夏天的土路
      color: 0x9fb3c2, roughness: 0.82, metalness: 0, envMapIntensity: 0.6, ...road,
    });
    const rutMat = new THREE.MeshStandardMaterial({
      color: 0x6f7580, roughness: 0.88, metalness: 0, envMapIntensity: 0.5, ...road,
    });
    for (const m of art.roadMeshes) m.material = roadMat;
    for (const m of art.rutMeshes) m.material = rutMat;
  }
  return true;
}

// 森林覆蓋遮罩:用實際的樹位置點出「林地」,與雪原平面 1:1 對位
function forestMaskTexture(treeSpots, fieldW, fieldCZ, S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const PX = S / fieldW;
  for (const t of treeSpots) {
    const px = (t.x + fieldW / 2) * PX;
    const py = (t.z - fieldCZ + fieldW / 2) * PX;
    const rad = Math.max(2, (7 + t.s * 7) * PX);
    const grad = g.createRadialGradient(px, py, rad * 0.15, px, py, rad);
    grad.addColorStop(0, 'rgba(255,255,255,0.72)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(px, py, rad, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;     // 遮罩是資料,不是顏色
  return t;
}

// ── ② 森林(Poly Haven 針葉樹 → InstancedMesh) ───────────────
// glb 裡三棵樹共用一份 twig／bark 幾何(座標分散在 x=0/6/12),所以要先依三角形重心切成變體。
async function upgradeForest(art, assets) {
  if (art.mobile) return false;                        // 手機保留程序化(§3 效能)
  const [fir, pine, sap] = await Promise.all([
    assets.model('fir_tree_01'), assets.model('pine_tree_01'), assets.model('pine_sapling_medium'),
  ]);
  if (!fir && !pine && !sap) return false;

  // ⚠ 這三個 glb 各裝了三棵樹,而且葉片幾何是三棵合在同一個 primitive 裡(x = 0/6/12 或 -6/1/8),
  //   所以要先依三角形重心切開;第一叢是活樹,另外兩叢是半枯的(枝葉稀、下半截光禿)。
  // ⚠⚠ 更關鍵的是:資產管線把樹壓到「整個 glb 三棵共 16.9k 面、貼圖 128²」,葉片卡被抽掉九成。
  //   單用 glb 的森林實測就是一地電線桿(截圖存證於本次施工報告)。所以這裡的作法是:
  //   程序化三層積雪圓錐**留著**當樹冠量體,glb 只在核心區疊上去補真樹幹與樹冠邊緣的枝葉輪廓;
  //   遠處的樹不換 glb(那個距離只看得到圓錐輪廓,換了只是白燒一百萬個三角形)。
  //   要真正換掉圓錐,得等樹的面數與貼圖預算放寬(≥ 512² 貼圖、每棵 ≥ 3 萬面)。
  const firV = fir ? splitTree(fir, [0, 6, 12]) : null;
  const pineV = pine ? splitTree(pine, [-6, 1, 8]) : null;
  const sapV = sap ? splitTree(sap, [0, 6, 12]) : null;
  const SLOTS = {
    fir: prep(firV?.[0] ?? pineV?.[0], 0.4),
    pine: prep(pineV?.[0] ?? firV?.[0], 0.36),
    sapling: prep(sapV?.[0] ?? firV?.[0], 0.42),
  };
  if (!SLOTS.fir) return false;
  SLOTS.pine ||= SLOTS.fir;
  SLOTS.sapling ||= SLOTS.fir;

  const NAME = ['fir', 'pine', 'sapling'];
  const bySlot = new Map();
  for (const t of art.treeSpots) {
    if (Math.hypot(t.x, t.z - 4) > GLB_NEAR) continue;      // 遠景維持程序化圓錐
    const k = NAME[t.v] ?? 'fir';
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push(t);
  }

  const dummy = new THREE.Object3D();
  const meshes = [];
  for (const [key, spots] of bySlot) {
    const variant = SLOTS[key];
    if (!variant || !spots.length) continue;
    const norm = TREE_H / Math.max(1e-3, variant.height);
    for (const p of [{ geo: variant.twig, mat: variant.twigM }, { geo: variant.bark, mat: variant.barkM }]) {
      if (!p.geo || !p.geo.attributes.position.count) continue;
      const im = new THREE.InstancedMesh(p.geo, p.mat, spots.length);
      spots.forEach((t, i) => {
        dummy.position.set(t.x, 0, t.z);
        dummy.rotation.set(0, t.ry, 0);
        dummy.scale.setScalar(t.s * norm);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;                 // 實例散佈全圖,單一包圍球沒有意義
      // 針葉不投影:alphaTest 的陰影 pass 等於整片森林再畫一次,而程序化圓錐已經在投影了
      if (art.shadows) { im.castShadow = p.mat !== variant.twigM; im.receiveShadow = true; }
      art.forest.add(im);
      meshes.push(im);
    }
  }
  if (!meshes.length) return false;
  for (const m of art.forestMeshes) m.visible = true;   // 疊加,不是取代(見上面的註)
  art.assetForest = meshes;
  return true;
}

// 一個變體 → 可直接餵 InstancedMesh 的「葉＋幹」兩份幾何與材質
// keep:葉片卡的保留比例(高面數的活樹要抽,不然 520 棵會爆到四百萬面)
function prep(variant, keep) {
  if (!variant || !variant.twig) return null;
  const twig = decimate(variant.twig, keep);
  paintSnow(twig);
  return {
    twig, bark: variant.bark, height: variant.height,
    twigM: snowyNeedleMaterial(variant.twigMat),
    barkM: barkMaterial(variant.barkMat),
  };
}

// 把一份 glb 樹(三棵共用幾何)依重心 x 切成三個變體,並各自歸零到原點、貼地
function splitTree(gltf, centers) {
  const buckets = centers.map(() => ({ twig: [], bark: [], twigMat: null, barkMat: null }));
  gltf.scene.updateWorldMatrix(true, true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const isTwig = /twig|leaf|leaves/i.test(mats[0]?.name ?? '');
    const geo = normalizeAttributes(o.geometry.clone());
    geo.applyMatrix4(o.matrixWorld);
    const parts = splitByCentroidX(geo, centers);
    parts.forEach((p, i) => {
      if (!p) return;
      buckets[i][isTwig ? 'twig' : 'bark'].push(p);
      const slot = isTwig ? 'twigMat' : 'barkMat';
      if (!buckets[i][slot]) buckets[i][slot] = mats[0];
    });
    geo.dispose();
  });
  return buckets.map((b, i) => {
    const shift = new THREE.Matrix4().makeTranslation(-centers[i], 0, 0);
    const join = (list) => {
      const ok = list.filter((x) => x && x.attributes.position.count);
      if (!ok.length) return null;
      const m = ok.length === 1 ? ok[0] : mergeGeometries(ok, false);
      if (!m) return null;
      m.applyMatrix4(shift);
      return m;
    };
    const twig = join(b.twig);
    const bark = join(b.bark);
    if (!twig && !bark) return null;
    // 貼地:以樹幹底為 y=0
    const minY = Math.min(twig ? geoMetrics(twig).minY : 0, bark ? geoMetrics(bark).minY : 0);
    const down = new THREE.Matrix4().makeTranslation(0, -minY, 0);
    twig?.applyMatrix4(down); bark?.applyMatrix4(down);
    const top = (g) => (g ? g.boundingBox.max.y : 0);
    twig?.computeBoundingBox(); bark?.computeBoundingBox();
    const height = Math.max(top(twig), top(bark));
    return { twig, bark, height, twigMat: b.twigMat, barkMat: b.barkMat ?? b.twigMat };
  });
}

// 依三角形重心的 x 分到最近的 center,並重建緊湊的頂點緩衝
function splitByCentroidX(geo, centers) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const count = idx ? idx.count : pos.count;
  const attrNames = ['position', 'normal', 'uv', 'color'].filter((n) => geo.attributes[n]);
  const out = centers.map(() => ({ remap: new Map(), verts: [], tris: [] }));
  for (let i = 0; i < count; i += 3) {
    const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    let best = 0, bd = Infinity;
    for (let k = 0; k < centers.length; k++) {
      const d = Math.abs(cx - centers[k]);
      if (d < bd) { bd = d; best = k; }
    }
    const bucket = out[best];
    for (const v of [a, b, c]) {
      let ni = bucket.remap.get(v);
      if (ni === undefined) { ni = bucket.verts.length; bucket.remap.set(v, ni); bucket.verts.push(v); }
      bucket.tris.push(ni);
    }
  }
  return out.map((bucket) => {
    if (!bucket.tris.length) return null;
    const g = new THREE.BufferGeometry();
    for (const name of attrNames) {
      const src = geo.attributes[name];
      const it = src.itemSize;
      const arr = new Float32Array(bucket.verts.length * it);
      bucket.verts.forEach((v, i) => { for (let k = 0; k < it; k++) arr[i * it + k] = src.getComponent(v, k); });
      g.setAttribute(name, new THREE.BufferAttribute(arr, it));
    }
    g.setIndex(bucket.tris);
    return g;
  });
}

// 抽掉一部分葉片卡(以「成對三角形＝一張卡」為單位,避免切出半張卡)
function decimate(geo, keep) {
  if (!geo || keep >= 0.999) return geo;
  const idx = geo.index;
  const quads = Math.floor(idx.count / 6);
  const out = [];
  for (let q = 0; q < quads; q++) {
    if ((q * keep) % 1 >= keep) continue;
    for (let k = 0; k < 6; k++) out.push(idx.getX(q * 6 + k));
  }
  for (let i = quads * 6; i < idx.count; i++) out.push(idx.getX(i));
  const g = geo.clone();
  g.setIndex(out);
  return g;
}

// 積雪:把「雪量」寫進頂點色的 r,shader 裡直接 mix 成雪色。
// (針葉貼圖是接近黑的深綠,乘任何頂點色都白不起來,只能 mix。)
function paintSnow(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const h = Math.max(1e-3, b.max.y - b.min.y);
  const n = pos.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const f = (pos.getY(i) - b.min.y) / h;
    const up = nor ? Math.max(0, nor.getY(i)) : 0.5;
    // 積雪要壓得夠重:葉片圖被壓到 128² 之後,深色針葉在雪原背景上只會變成一團黑點(像蒼蠅),
    // 壓成雪色才會跟程序化圓錐的積雪白裙連成一體,讀起來是「掛著雪的針葉」。
    let s = 0.30 + 0.34 * smooth(0.15, 1.0, f) + 0.30 * up * up;
    s = Math.min(0.88, s);
    col[i * 3] = s; col[i * 3 + 1] = s; col[i * 3 + 2] = s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const SNOW_COL = new THREE.Color(0xdbe5ee);
// 針葉材質:①頂點色的 r 當雪量,shader 裡 mix 成雪色(針葉近乎全黑,乘頂點色永遠白不起來)
//   ②葉片圖只有 128²,遠距離 mipmap 一縮,平均 alpha 直接掉到 0.5 以下 → 整片樹冠被 alphaTest
//   吃掉,只剩一根根電線桿。所以把 alpha 先放大再測,讓縮圖後的葉片卡活下來(標準的 alpha 銳化)。
function snowyNeedleMaterial(src) {
  const m = (src ? src.clone() : new THREE.MeshStandardMaterial({ color: 0x2f4a33 }));
  m.vertexColors = true;
  m.side = THREE.DoubleSide;
  m.transparent = false;
  m.alphaTest = 0.12;
  m.roughness = Math.max(ROUGH_MIN, m.roughness ?? 0.9);
  m.envMapIntensity = ENV_I;
  m.color.setScalar(1.7);            // 針葉貼圖偏黑,提亮成看得出來的深松綠
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSnow = { value: SNOW_COL };
    sh.fragmentShader = 'uniform vec3 uSnow;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', 'diffuseColor.rgb = mix( diffuseColor.rgb, uSnow, vColor.r );')
      .replace('#include <alphatest_fragment>', `
        #ifdef USE_ALPHATEST
          if ( clamp( diffuseColor.a * 1.9, 0.0, 1.0 ) < alphaTest ) discard;
        #endif
      `);
  };
  m.customProgramCacheKey = () => 'bastogne-snowneedle';
  return m;
}
function barkMaterial(src) {
  const m = (src ? src.clone() : new THREE.MeshStandardMaterial({ color: 0x3d2f20 }));
  m.roughness = Math.max(ROUGH_MIN, m.roughness ?? 0.95);
  m.envMapIntensity = ENV_I;
  return m;
}

// ── ③ 房舍(Blender glb) ──────────────────────────────────
const HOUSE_GROUPS = (name) => {
  if (name === 'snow') return 'snow';
  if (name === 'glass') return 'glass';
  if (name === 'roof_slate' || name === 'roof_tile') return 'roof';
  return 'shell';
};

async function upgradeBuildings(art, assets) {
  const [house, church, barn] = await Promise.all([
    assets.model('house_ardennes'), assets.model('church'), assets.model('barn'),
  ]);
  if (!house) return false;

  // 只取 diff:法線圖一張 300 KB 起跳,四張就吃掉首屏預算的四分之一,而房舍在畫面上只有幾十像素高。
  const wallPBR = assets.pbr('plastered_stone_wall', { repeat: 0.34, maps: ['diff'] });
  const stonePBR = assets.pbr('rustic_stone_wall_02', { repeat: 0.30, maps: ['diff'] });
  const slatePBR = assets.pbr('roof_slates_03', { repeat: 0.5, maps: ['diff'] });
  const tilePBR = assets.pbr('grey_roof_tiles_02', { repeat: 0.5, maps: ['diff'] });

  const mkMat = (kind, pbr) => {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0.0, envMapIntensity: ENV_I, ...pbr,
    });
    // glb 的 baseColorFactor 偏暗(石牆 0.39 linear),疊上貼圖會更暗 → 整體提亮回阿登石屋的灰白
    m.color.setScalar(kind === 'roof' ? 1.9 : 2.1);
    if (m.normalMap) m.normalScale.set(0.8, 0.8);
    return m;
  };
  const snowMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xdde7f0, roughness: 0.78, envMapIntensity: ENV_I });
  const glassMat = new THREE.MeshStandardMaterial({
    vertexColors: true, color: 0x1a1f26, roughness: 0.25, metalness: 0.2,
    emissive: 0xffb066, emissiveIntensity: 0,
  });

  const houseSpecs = art.houseSpecs.filter((h) => h.village === 'town' || h.village === 'foy');
  // 鎮上挑三棟最大的當穀倉(阿登村落的招牌:石屋之間夾著木構穀倉)
  const sorted = [...houseSpecs].filter((h) => h.village === 'town').sort((a, b) => b.w - a.w);
  const barnSpecs = barn ? sorted.slice(0, 3) : [];
  const barnSet = new Set(barnSpecs);
  const plainSpecs = houseSpecs.filter((h) => !barnSet.has(h));

  const added = [];
  added.push(...instanceBuilding(house, plainSpecs, {
    shell: mkMat('shell', wallPBR), roof: mkMat('roof', slatePBR), snow: snowMat, glass: glassMat,
  }, art));
  if (barn && barnSpecs.length) {
    added.push(...instanceBuilding(barn, barnSpecs, {
      shell: mkMat('shell', stonePBR), roof: mkMat('roof', tilePBR), snow: snowMat, glass: glassMat,
    }, art));
  }
  const churchSpec = art.houseSpecs.find((h) => h.village === 'church');
  if (church && churchSpec) {
    added.push(...instanceBuilding(church, [{ ...churchSpec, x: churchSpec.x - 5, heightRef: 30 }], {
      shell: mkMat('shell', stonePBR), roof: mkMat('roof', slatePBR), snow: snowMat, glass: glassMat,
    }, art));
  }
  if (!added.length) return false;

  for (const m of [art.townWalls, art.townRoofs, art.townSnow, art.foyWalls, art.foyRoofM, art.foySnowM]) {
    if (m) m.visible = false;                     // 程序化村落退場(fallback 留著)
  }
  // 夜間窗光改由 glass 那一組承接(圍城中的小鎮是燈火管制的,只給很弱的一點)
  art.nightHooks.push((k) => { glassMat.emissiveIntensity = k * 0.9; });
  art.assetBuildings = added;
  return true;
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _col = new THREE.Color();

function instanceBuilding(gltf, specs, mats, art) {
  const groups = collectByGroup(gltf.scene, HOUSE_GROUPS);
  const out = [];
  const merged = new Map();
  for (const [key, list] of groups) {
    const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (g) merged.set(key, g);
  }
  const shell = merged.get('shell');
  if (!shell) return out;
  let modelH = 0;
  for (const g of merged.values()) modelH = Math.max(modelH, geoMetrics(g).height);
  if (!modelH) return out;

  for (const [key, geo] of merged) {
    const mat = mats[key];
    if (!mat) continue;
    const im = new THREE.InstancedMesh(geo, mat, specs.length);
    specs.forEach((s, i) => {
      // 對齊既有程序化房舍的 bounding box:牆高 h ＋ 屋頂 0.7h
      const target = s.heightRef ?? (s.h * 1.7);
      const k = Math.max(0.8, Math.min(2.1, target / modelH));
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot);
      _m4.compose(_v.set(s.x, 0, s.z), _q, new THREE.Vector3(k, k, k));
      im.setMatrixAt(i, _m4);
      if (key === 'shell') im.setColorAt(i, _col.setHex(s.wallHex ?? 0xb4b0a6).multiplyScalar(1.25));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    if (art.shadows && key !== 'glass') { im.castShadow = true; im.receiveShadow = true; }
    art.group.add(im);
    out.push(im);
  }
  return out;
}

// ── ④ 樹爆斷木與陣地雜物 ────────────────────────────────────
async function addDebris(art, assets) {
  const [trunk, crate, barrel] = await Promise.all([
    assets.model('dead_tree_trunk'), assets.model('ammo_crate'), assets.model('wooden_crate_01'),
  ]);
  const dummy = new THREE.Object3D();
  const rng = mulberry(9021);
  let any = false;

  if (trunk) {
    // 樹爆落點:MLR 樹線前後散落的斷木(空爆把樹冠削下來的那些)
    const geos = collectByGroup(trunk.scene, () => 'all').get('all');
    const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    const met = geoMetrics(geo);
    const src = [];
    trunk.scene.traverse((o) => { if (o.isMesh && !src.length) src.push(o.material); });
    const mat = src[0] ? src[0].clone() : new THREE.MeshStandardMaterial({ color: 0x4a3a28 });
    mat.vertexColors = true;
    mat.roughness = Math.max(ROUGH_MIN, mat.roughness ?? 0.95);
    mat.envMapIntensity = ENV_I;
    const spots = art.treeSpots.filter((t) => t.mlr).slice(0, 18);
    const n = spots.length + 8;
    const im = new THREE.InstancedMesh(geo, mat, n);
    const k = 3.4 / Math.max(1e-3, met.length || met.width);   // 斷木長約 3.4 單位
    for (let i = 0; i < n; i++) {
      const s = spots[i % spots.length];
      const x = s.x + (rng() - 0.5) * 22;
      const z = s.z + (rng() - 0.5) * 16;
      dummy.position.set(x, 0.15, z);
      dummy.rotation.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.25);
      dummy.scale.setScalar(k * (0.8 + rng() * 0.7));
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    if (art.shadows) { im.castShadow = true; im.receiveShadow = true; }
    art.group.add(im);
    any = true;
  }

  // 交叉火網的機槍位置(tactics.baseOfFire):沙包＋MG42 的機槍巢。
  // 本役沒有 kind === 'mg' 的單位,所以 mg_nest.glb 掛在地形這一側,才對得上戰術疊圖的錐標。
  const nest = await assets.model('mg_nest');
  if (nest && art.baseOfFire?.length) {
    const list = collectByGroup(nest.scene, () => 'all').get('all');
    const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (geo) {
      const met = geoMetrics(geo);
      let m0 = null;
      nest.scene.traverse((o) => { if (o.isMesh && !m0) m0 = o.material; });
      const mat = m0 ? m0.clone() : new THREE.MeshStandardMaterial({ color: 0x8a7c52 });
      mat.vertexColors = true;
      mat.color.setScalar(2.0);
      mat.roughness = Math.max(ROUGH_MIN, mat.roughness ?? 0.95);
      mat.envMapIntensity = ENV_I;
      const im = new THREE.InstancedMesh(geo, mat, art.baseOfFire.length);
      const k = 6.0 / Math.max(1e-3, met.width);       // 對齊程序化沙包圈(半徑約 3 單位)
      art.baseOfFire.forEach((b, i) => {
        dummy.position.set(b.x, 0, b.z);
        dummy.rotation.set(0, Math.PI, 0);              // 槍口朝北(-z)的開闊雪原
        dummy.scale.setScalar(k);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      if (art.shadows) { im.castShadow = true; im.receiveShadow = true; }
      art.group.add(im);
      any = true;
    }
  }

  // 散兵坑線後方的補給堆:彈藥箱與木箱
  for (const [gltf, count, scale] of [[crate, 14, 1.6], [barrel, 8, 1.6]]) {
    if (!gltf) continue;
    const list = collectByGroup(gltf.scene, () => 'all').get('all');
    if (!list) continue;
    const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
    let mat0 = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !mat0) mat0 = o.material; });
    const mat = mat0 ? mat0.clone() : new THREE.MeshStandardMaterial({ color: 0x6a5638 });
    mat.vertexColors = true;
    mat.roughness = Math.max(ROUGH_MIN, mat.roughness ?? 0.9);
    mat.envMapIntensity = ENV_I;
    const im = new THREE.InstancedMesh(geo, mat, count);
    for (let i = 0; i < count; i++) {
      const hx = art.holeXs[Math.floor(rng() * art.holeXs.length)];
      dummy.position.set(hx + (rng() - 0.5) * 14, 0, 8 + rng() * 10);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.scale.setScalar(scale * (0.85 + rng() * 0.4));
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    if (art.shadows) { im.castShadow = true; im.receiveShadow = true; }
    art.group.add(im);
    any = true;
  }
  return any;
}

function mulberry(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
