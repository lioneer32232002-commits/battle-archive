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
import { collectByGroup, geoMetrics } from './assets.js';

// 針葉樹目標高度(單位):對齊 terrain.js 程序化三層圓錐的 10.8,樹的分佈與尺度感才不會跳。
// 再乘每棵原有的 scale(0.85–1.55) → 實際 9–17 單位。
const TREE_H = 10.8;
const GLB_NEAR = 190;        // 核心區半徑:這圈以內才換 glb(見 upgradeForest 註)
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
  const snow = assets.pbr('snow_02', { repeat: rep, norSize: 'mobile' });
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
// 2026-09-12 第二輪:資產已重出成「單棵、原點在底部中心、位移歸零」,並多了桌機高規版
//   fir_tree_01_hi / pine_tree_01_hi(512² 貼圖、約 4.6–4.8 萬面)。第一輪那套「依三角形重心
//   把三棵切開」的分割器因此退場。
//
// 分層(桌機):
//   hero = MLR 樹線那一排 ＋ 散兵坑線 90 單位內 → _hi 版,**完整取代**程序化圓錐(三個驗收鏡頭的主角森林)
//   mid  = 核心區其餘的樹(≤ GLB_NEAR) → 同一份 _hi 幾何再抽稀一次(不必多載一個檔)
//   far  = 核心區以外 → 維持程序化圓錐(那個距離只看得到輪廓,換成真樹只是白燒三角形)
// 程序化圓錐不是整組關掉,而是把 InstancedMesh 的矩陣重建成「只剩 far 的那些」再縮 count,
// 所以 fallback 仍然完整(手機、載入失敗時照樣是 520 棵)。
//
// §R5.2 畫質分級:hero 的抽稀比例(heroKeep)、mid 的數量(midFraction)、針葉是否投影
//   都由 quality 決定;low 直接不走這條(heroTrees === 'procedural'),整片維持程序化圓錐。
const HERO_NEAR = 110;       // hero 圈半徑(MLR 樹線不論遠近一律 hero)
async function upgradeForest(art, assets) {
  if (art.mobile) return false;                        // 手機保留程序化(§3 效能)
  const Q = art.quality ?? {};
  if (Q.heroTrees === 'procedural') return false;      // low:glb 森林整組不建
  const [fir, pine] = await Promise.all([
    assets.model('fir_tree_01', { hi: true }),
    assets.model('pine_tree_01', { hi: true }),
  ]);
  if (!fir && !pine) return false;

  // keep = 針葉保留比例。_hi 一棵 4.5 萬面,220 棵原封不動就是一千萬面。
  // 有了螢幕空間保底寬度(見 withNeedleCenters)之後,抽稀的分寸不再由「遠處看不看得見」決定,
  // 而是純粹的面數預算:hero 0.34 ≈ 1.5 萬面／棵,mid 0.12 ≈ 5.4 千面／棵,全場樹約 190 萬面。
  const heroKeep = Q.heroKeep ?? 0.34;
  const midKeep = Q.midKeep ?? 0.12;
  const firHero = prepTree(fir ?? pine, heroKeep);
  const pineHero = prepTree(pine ?? fir, heroKeep);
  const firMid = prepTree(fir ?? pine, midKeep);
  const pineMid = prepTree(pine ?? fir, midKeep);
  if (!firHero || !firMid) return false;

  // 樹種:沿用 terrain.js 原本的三變體索引(v),佈局座標與旋轉完全不動 → 樹下暗斑貼花仍對位
  const heroOf = [firHero, pineHero ?? firHero, pineHero ?? firHero];
  const midOf = [firMid, pineMid ?? firMid, pineMid ?? firMid];
  const sizeOf = [1.0, 1.0, 0.68];                     // v2 原本是幼松 → 用同一份幾何縮小當林下層

  const hero = [[], [], []];
  const mid = [[], [], []];
  const far = [[], [], []];
  const midFrac = Q.midFraction ?? 1;
  let midSeen = 0;
  for (const t of art.treeSpots) {
    const d = Math.hypot(t.x, t.z - 4);
    let bucket = (t.mlr || d < HERO_NEAR) ? hero : d <= GLB_NEAR ? mid : far;
    // medium:mid 圈只換一半,另一半留給程序化圓錐(密度不變,面數減半)
    if (bucket === mid && midFrac < 1 && (midSeen++ % 2) === 1) bucket = far;
    bucket[t.v].push(t);
  }

  const dummy = new THREE.Object3D();
  const meshes = [];
  const build = (variant, spots, sizeK) => {
    if (!variant || !spots.length) return;
    const norm = (TREE_H / Math.max(1e-3, variant.height)) * sizeK;
    for (const p of [{ geo: variant.twig, mat: variant.twigM, twig: true }, { geo: variant.bark, mat: variant.barkM }]) {
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
      // 針葉不投影(見下方 addCrownShadows 的實測說明:一根針一個三角形,在陰影圖裡根本取樣不到)
      if (art.shadows) { im.castShadow = !p.twig; im.receiveShadow = true; }
      art.forest.add(im);
      meshes.push(im);
    }
  };
  for (let v = 0; v < 3; v++) {
    build(heroOf[v], hero[v], sizeOf[v]);
    build(midOf[v], mid[v], sizeOf[v]);
  }
  if (!meshes.length) return false;

  // R6:雪地要看得到樹的投影
  if (art.shadows && Q.crownShadows) {
    addCrownShadows(art, Q.crownShadows === 'all' ? [hero, mid] : [hero]);
  }

  // 程序化圓錐:只留下核心區以外的那些(重建矩陣＋縮 count,幾何與材質原封不動)
  art.forestMeshes.forEach((im, v) => {
    const spots = far[v] ?? [];
    spots.forEach((t, i) => {
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, t.ry, 0);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.count = spots.length;
    im.instanceMatrix.needsUpdate = true;
    im.visible = spots.length > 0;
  });

  art.assetForest = meshes;
  art.forestTiers = { hero: hero.flat().length, mid: mid.flat().length, far: far.flat().length };
  return true;
}

// ── 樹冠投影代理(R6:「雪地要看得到樹與房舍的投影」) ────────────────────
// ⚠ 實測:讓 glb 的針葉自己投影是**無效**的。針葉是「一根針一個三角形」,陰影 pass 走的是
//   three 自動生成的 MeshDepthMaterial —— 它不會跑我們在 snowyNeedleMaterial 裡加的
//   「依距離沿重心把三角形撐胖」那段 vertex hook,所以在 2048² 的 cascade 陰影圖裡,
//   每根針都遠小於一個 texel,整棵樹只投出樹幹那幾根線(雪原上就是一排電線桿的影子)。
//   而且開了針葉投影還要整片森林多跑一次 alphaTest 的深度 pass,貴得莫名其妙。
// 解法:用**程序化圓錐**(terrain.js 本來就有、遠景 far 那批還在用的那份幾何)當
//   「只投影不顯示」的代理 —— colorWrite/depthWrite 都關掉,castShadow 開著。
//   深度 pass 便宜、樹形正確,畫面上完全看不到它。
//   ⚠ 它必須掛 userData.noAO:GTAO 的 G-buffer 是用 overrideMaterial 重畫一次場景,
//     override 材質的 depthWrite 是 true,不擋的話雪原上會多出一片看不見的圓錐擋住 AO。
function addCrownShadows(art, buckets) {
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const dummy = new THREE.Object3D();
  const out = [];
  for (let v = 0; v < 3; v++) {
    const geo = art.forestMeshes[v]?.geometry;
    if (!geo) continue;
    const list = buckets.flatMap((b) => b[v] ?? []);
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => {
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, t.ry, 0);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    im.castShadow = true;
    im.receiveShadow = false;
    im.userData.noAO = true;
    im.renderOrder = -20;
    art.forest.add(im);
    out.push(im);
  }
  art.crownShadows = out;
  return out;
}

// 一棵 glb 樹 → 可直接餵 InstancedMesh 的「葉＋幹」兩份幾何與材質。
// 葉(alphaTest)與幹(不透明)一定要分開:混在一起就得整棵吃 alphaTest,樹幹會被啃出破洞。
function prepTree(gltf, keep) {
  if (!gltf) return null;
  const groups = collectByGroup(gltf.scene, (name) => (/twig|leaf|leaves/i.test(name) ? 'twig' : 'bark'));
  const mats = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const k = /twig|leaf|leaves/i.test(m?.name ?? '') ? 'twig' : 'bark';
    if (!mats[k]) mats[k] = m;
  });
  const join = (list) => {
    if (!list || !list.length) return null;
    return list.length === 1 ? list[0] : mergeGeometries(list, false);
  };
  let twig = join(groups.get('twig'));
  const bark = join(groups.get('bark'));
  if (!twig && !bark) return null;
  if (twig) { twig = withNeedleCenters(decimate(twig, keep), 1.5); paintSnow(twig); }
  twig?.computeBoundingBox(); bark?.computeBoundingBox();
  const top = (g) => (g ? g.boundingBox.max.y : 0);
  return {
    twig, bark, height: Math.max(top(twig), top(bark)),
    twigM: twig ? snowyNeedleMaterial(mats.twig) : null,
    barkM: bark ? barkMaterial(mats.bark ?? mats.twig) : null,
  };
}

// 抽稀針葉。⚠ 實測過的事實:Poly Haven 這兩棵樹的葉片**一根針一個三角形**
// (union-find 算過:fir_hi 44.7k 面 = 32.3k 個連通元件、中位數 1 面),
// 不是「一張卡兩個三角形」。所以按三角形抽就等於按針葉抽,不會切出半張卡;
// 第一輪那版假設成對三角形,反而讓分佈變得不均勻。
function decimate(geo, keep) {
  if (!geo || keep >= 0.999) return geo;
  const idx = geo.index;
  const tris = Math.floor(idx.count / 3);
  const out = [];
  let acc = 0;
  for (let t = 0; t < tris; t++) {
    acc += keep;
    if (acc < 1) continue;          // 均勻取樣:累加到 1 就留一根
    acc -= 1;
    out.push(idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2));
  }
  const g = geo.clone();
  g.setIndex(out);
  return g;
}

// 針葉的螢幕空間保底寬度(本輪最關鍵的一件事)。
// ⚠ 實測過程:Poly Haven 的葉片是「一根針一個三角形」—— union-find 算過,fir_hi 的 44.7k 面
//   分成 32.3k 個連通元件、中位數 1 面。一根針在 15 單位外就只剩次像素寬,而次像素三角形
//   常常連光柵化都整個被丟掉:把材質換成**純紅色不透明** MeshBasicMaterial 實測同樣看不見,
//   所以跟 alphaTest、mipmap、貼圖解析度全都無關,是純粹的取樣問題。
//   症狀就是「近看是漂亮的冷杉,退到 50 單位外整片森林變成一排電線桿」。
// 解法:把每個三角形的重心烘成 aNeedleCenter 屬性,在 vertex shader 裡依到鏡頭的距離
//   沿重心放大三角形,讓每根針在畫面上維持大致固定的寬度(近處不動,遠處補回透視縮小的量)。
//   代價是零:一個三角形都沒有多,只是把已經有的三角形畫到夠大、能被取樣到。
// 先轉成非索引:每個三角形要能獨立變形,不能被共用頂點綁住。
function withNeedleCenters(geo, baseFatten) {
  if (!geo) return geo;
  const g = geo.toNonIndexed();
  const pos = g.attributes.position;
  const a = pos.array;
  const centers = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 9) {
    const cx = (a[i] + a[i + 3] + a[i + 6]) / 3;
    const cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3;
    const cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
    for (let v = 0; v < 3; v++) {
      const o = i + v * 3;
      a[o] = cx + (a[o] - cx) * baseFatten;
      a[o + 1] = cy + (a[o + 1] - cy) * baseFatten;
      a[o + 2] = cz + (a[o + 2] - cz) * baseFatten;
      centers[o] = cx; centers[o + 1] = cy; centers[o + 2] = cz;
    }
  }
  pos.needsUpdate = true;
  g.setAttribute('aNeedleCenter', new THREE.BufferAttribute(centers, 3));
  geo.dispose();
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
    // 雪壓在朝上的枝面與樹冠上半。⚠ 分寸很重要:第一輪為了讓稀疏的葉片在雪原上看得見,把雪量
    // 拉到 0.3–0.88,結果換成高規樹、樹冠有量體之後,整棵變成白的、在霧與雪原背景裡直接消失。
    let s = 0.08 + 0.24 * smooth(0.2, 1.0, f) + 0.26 * up * up;
    s = Math.min(0.52, s);
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
  m.alphaTest = 0.2;
  m.alphaToCoverage = true;   // 配合 postfx 的 MSAA:次像素寬的針葉靠覆蓋率活下來,不是被 alphaTest 判死
  m.roughness = Math.max(ROUGH_MIN, m.roughness ?? 0.9);
  m.envMapIntensity = ENV_I;
  m.color.setScalar(1.7);            // 針葉貼圖偏黑,提亮成看得出來的深松綠
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSnow = { value: SNOW_COL };
    sh.uniforms.uNeedleRef = { value: 9.0 };   // 這個距離以內維持原本的針葉粗細
    sh.uniforms.uNeedleMax = { value: 14.0 };    // 放大上限(再遠交給霧與遠景樹線剪影)
    sh.vertexShader = `
      attribute vec3 aNeedleCenter;
      uniform float uNeedleRef;
      uniform float uNeedleMax;
    ` + sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      {
        #ifdef USE_INSTANCING
          mat4 needleWorld = modelMatrix * instanceMatrix;
        #else
          mat4 needleWorld = modelMatrix;
        #endif
        vec3 nc = ( needleWorld * vec4( aNeedleCenter, 1.0 ) ).xyz;
        float instScale = max( length( needleWorld[ 0 ].xyz ), 1e-4 );
        float grow = clamp( distance( cameraPosition, nc ) / ( uNeedleRef * instScale ), 1.0, uNeedleMax );
        transformed = aNeedleCenter + ( transformed - aNeedleCenter ) * grow;
      }
    `);
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

// R2 烘焙版房舍:單一材質＋ basecolor／normal／ORM 三張貼圖,**不烘頂點色、不疊 Poly Haven 牆面**。
// 分組只剩「snow_cap 一組、其餘一組」(兩個節點名),雪帽仍然是獨立的 InstancedMesh。
// 夜間窗光仍要:烘焙版把玻璃併進單一材質了(沒有 glass 那一組),所以額外載一份 17 KB 的
// 平塗 house_ardennes.glb,只取它的 glass 幾何來承接 emissive —— 比整套 PBR 牆面便宜得多。
const BAKED_GROUPS = (name, o) => (o?.name === 'snow_cap' ? 'snow' : 'shell');
const GLASS_ONLY = (name) => (name === 'glass' ? 'glass' : null);

function bakedMaterial(gltf) {
  let src = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !src) src = Array.isArray(o.material) ? o.material[0] : o.material; });
  if (!src) return null;
  const m = src.clone();
  m.vertexColors = false;
  m.roughness = Math.max(ROUGH_MIN, m.roughness ?? 0.9);
  m.envMapIntensity = ENV_I;
  return m;
}
function modelHeight(gltf) {
  const b = new THREE.Box3().setFromObject(gltf.scene);
  return Math.max(1e-3, b.max.y - b.min.y);
}

async function upgradeBuildingsBaked(art, assets) {
  const [house, church, barn, plain] = await Promise.all([
    assets.model('house_ardennes_baked'), assets.model('church_baked'),
    assets.model('barn_baked'), assets.model('house_ardennes'),
  ]);
  if (!house) return false;
  const houseMat = bakedMaterial(house);
  if (!houseMat) return false;
  const glassMat = new THREE.MeshStandardMaterial({
    vertexColors: true, color: 0x1a1f26, roughness: 0.25, metalness: 0.2,
    emissive: 0xffb066, emissiveIntensity: 0,
  });

  const { plainSpecs, barnSpecs, churchSpec } = houseLayout(art, !!barn);
  const houseH = modelHeight(house);
  const added = [];
  added.push(...instanceBuilding(house, plainSpecs, { shell: houseMat, snow: houseMat }, art,
    { groupOf: BAKED_GROUPS, tint: false, modelH: houseH }));
  if (plain) {
    added.push(...instanceBuilding(plain, plainSpecs, { glass: glassMat }, art,
      { groupOf: GLASS_ONLY, tint: false, modelH: houseH }));
  }
  if (barn && barnSpecs.length) {
    const barnMat = bakedMaterial(barn);
    if (barnMat) {
      added.push(...instanceBuilding(barn, barnSpecs, { shell: barnMat, snow: barnMat }, art,
        { groupOf: BAKED_GROUPS, tint: false, modelH: modelHeight(barn) }));
    }
  }
  if (church && churchSpec) {
    const churchMat = bakedMaterial(church);
    if (churchMat) {
      added.push(...instanceBuilding(church, [{ ...churchSpec, x: churchSpec.x - 5, heightRef: 30 }],
        { shell: churchMat, snow: churchMat }, art,
        { groupOf: BAKED_GROUPS, tint: false, modelH: modelHeight(church) }));
    }
  }
  if (!added.length) return false;
  hideProceduralVillages(art);
  art.nightHooks.push((k) => { glassMat.emissiveIntensity = k * 0.9; });
  art.assetBuildings = added;
  art.bakedBuildings = true;
  return true;
}

// 鎮上挑三棟最大的當穀倉(阿登村落的招牌:石屋之間夾著木構穀倉)
function houseLayout(art, hasBarn) {
  const houseSpecs = art.houseSpecs.filter((h) => h.village === 'town' || h.village === 'foy');
  const sorted = [...houseSpecs].filter((h) => h.village === 'town').sort((a, b) => b.w - a.w);
  const barnSpecs = hasBarn ? sorted.slice(0, 3) : [];
  const barnSet = new Set(barnSpecs);
  return {
    plainSpecs: houseSpecs.filter((h) => !barnSet.has(h)),
    barnSpecs,
    churchSpec: art.houseSpecs.find((h) => h.village === 'church'),
  };
}
function hideProceduralVillages(art) {
  for (const m of [art.townWalls, art.townRoofs, art.townSnow, art.foyWalls, art.foyRoofM, art.foySnowM]) {
    if (m) m.visible = false;                     // 程序化村落退場(fallback 留著)
  }
}

async function upgradeBuildings(art, assets) {
  // 桌機 high／medium 優先用 Cycles 舊化烘焙版(§R2.4);失敗就往下走平塗＋Poly Haven 那條
  if (art.quality?.baked) {
    try {
      if (await upgradeBuildingsBaked(art, assets)) return true;
    } catch (e) { console.warn('[bastogne] 烘焙版房舍失敗,改用平塗版', e); }
  }
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

  const { plainSpecs, barnSpecs, churchSpec } = houseLayout(art, !!barn);

  const added = [];
  added.push(...instanceBuilding(house, plainSpecs, {
    shell: mkMat('shell', wallPBR), roof: mkMat('roof', slatePBR), snow: snowMat, glass: glassMat,
  }, art));
  if (barn && barnSpecs.length) {
    added.push(...instanceBuilding(barn, barnSpecs, {
      shell: mkMat('shell', stonePBR), roof: mkMat('roof', tilePBR), snow: snowMat, glass: glassMat,
    }, art));
  }
  if (church && churchSpec) {
    added.push(...instanceBuilding(church, [{ ...churchSpec, x: churchSpec.x - 5, heightRef: 30 }], {
      shell: mkMat('shell', stonePBR), roof: mkMat('roof', slatePBR), snow: snowMat, glass: glassMat,
    }, art));
  }
  if (!added.length) return false;

  hideProceduralVillages(art);
  // 夜間窗光改由 glass 那一組承接(圍城中的小鎮是燈火管制的,只給很弱的一點)
  art.nightHooks.push((k) => { glassMat.emissiveIntensity = k * 0.9; });
  art.assetBuildings = added;
  return true;
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _col = new THREE.Color();

function instanceBuilding(gltf, specs, mats, art, opts = {}) {
  const { groupOf = HOUSE_GROUPS, tint = true, modelH: modelHIn = 0 } = opts;
  const groups = collectByGroup(gltf.scene, groupOf);
  const out = [];
  const merged = new Map();
  for (const [key, list] of groups) {
    const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (g) merged.set(key, g);
  }
  if (!merged.size) return out;
  // modelH 由呼叫端指定時代表「與另一個模型共用同一套縮放」(烘焙版的殼 ＋ 平塗版的玻璃)
  let modelH = modelHIn;
  if (!modelH) for (const g of merged.values()) modelH = Math.max(modelH, geoMetrics(g).height);
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
      // 烘焙版的顏色已經在貼圖裡(instanceColor 會再乘一次牆色 → 整排房子變深),所以只有平塗版染色
      if (tint && key === 'shell') im.setColorAt(i, _col.setHex(s.wallHex ?? 0xb4b0a6).multiplyScalar(1.25));
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
  // wooden_crate_01 曾經也放,但它 101 KB／4k 面只換來幾個木箱,首屏預算拿去給高規樹更划算
  const [trunk, crate] = await Promise.all([
    assets.model('dead_tree_trunk'), assets.model('ammo_crate'),
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
  for (const [gltf, count, scale] of [[crate, 18, 1.6]]) {
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
