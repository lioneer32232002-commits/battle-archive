// scripts/assets/manifest.mjs
//
// 資產管線的 curated 清單與共用常數（docs/asset-pipeline-spec.md §1.1）。
// 全部來源為 Poly Haven，授權 CC0。
//
// 每筆欄位：
//   id       輸出用 id（檔名前綴，一律小寫底線）
//   ph       Poly Haven asset id（可能有大寫，例如 Barrel_01）
//   type     texture | hdri | model
//   maps     貼圖要抓的 map（diff / nor / arm）
//   res      Poly Haven 解析度（一律 1k，web 端再縮）
//   use      用途註記
//   battles  會用到的場次

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DIRS = {
  src: path.join(ROOT, 'assets-src', 'polyhaven'),
  tex: path.join(ROOT, 'public', 'tex'),
  hdri: path.join(ROOT, 'public', 'hdri'),
  models: path.join(ROOT, 'public', 'models'),
  draco: path.join(ROOT, 'public', 'draco'),
  tmp: path.join(ROOT, 'assets-src', '.tmp'),
};

export const MANIFEST_PATH = path.join(ROOT, 'public', 'assets-manifest.json');

/** 體積預算（bytes，gzip 前）— docs/asset-pipeline-spec.md §0.2 */
export const BUDGET = {
  texture: 350 * 1024,
  hdr: Math.round(1.6 * 1024 * 1024),
  hdrTonemapped: 400 * 1024,
  model: 300 * 1024,
};

/** 模型三角形上限（樹壓到這個數以內） */
export const TRI_BUDGET = 20000;

/** 並行下載上限 */
export const CONCURRENCY = 4;

export const API_BASE = 'https://api.polyhaven.com/files/';
export const LICENSE = 'CC0';
export const SOURCE = 'Poly Haven';

/** web 輸出尺寸：桌機 1024²、手機 512² */
export const TEX_SIZES = [
  { tag: '1k', px: 1024 },
  { tag: '512', px: 512 },
];

/** HDRI tonemapped JPG 的輸出尺寸 */
export const HDRI_TM_SIZE = { w: 2048, h: 1024, quality: 75 };

// ---------------------------------------------------------------------------
// 貼圖
// ---------------------------------------------------------------------------

const T = (ph, use, battles, extra = {}) => ({
  id: ph.toLowerCase(),
  ph,
  type: 'texture',
  maps: ['diff', 'nor', 'arm'],
  res: '1k',
  use,
  battles,
  ...extra,
});

export const TEXTURES = [
  // 牧草地
  T('aerial_grass_rock', '牧草地主層（航拍草皮夾石礫），地表 repeat 40×40', ['brecourt', 'carentan', 'crossroads']),
  T('leafy_grass', '牧草地近景草葉，低空鏡頭用', ['brecourt', 'carentan']),
  T('grass_path_2', '草地踏出的小徑／車轍邊緣', ['brecourt', 'crossroads']),

  // 林地／泥地
  T('forrest_ground_01', '林地腐植落葉層', ['bastogne', 'brecourt']),
  T('brown_mud_leaves_01', '濕泥夾落葉（雨後樹籬底）', ['bastogne', 'carentan']),
  T('brown_mud_dry', '乾裂泥地、彈坑周邊', ['brecourt', 'carentan', 'crossroads']),
  T('dirt_floor', '散兵坑／掩體翻出的新土（增補）', ['brecourt', 'bastogne']),
  T('forest_leaves_03', '樹籬底層厚落葉（增補，brecourt 樹籬）', ['brecourt', 'bastogne']),

  // 雪地
  T('snow_02', '雪地主層', ['bastogne']),
  T('snow_field_aerial', '雪原遠景 macro 層', ['bastogne']),
  T('snow_01', '積雪細節（踏痕與堆邊）', ['bastogne']),
  T('snow_03', '雪地第三變化，破平鋪（增補）', ['bastogne']),

  // 道路
  T('asphalt_02', '堤路柏油', ['crossroads']),
  T('gravelly_sand', '碎石土路', ['brecourt', 'crossroads']),
  T('cobblestone_floor_04', '鋪石街（carentan 市鎮）', ['carentan']),

  // 牆面
  T('painted_plaster_wall', '粉刷外牆', ['carentan', 'crossroads']),
  T('rustic_stone_wall_02', '粗石砌牆', ['carentan', 'bastogne']),
  T('plastered_stone_wall', '灰泥石牆', ['carentan']),
  T('red_brick_03', '紅磚牆', ['carentan', 'crossroads']),
  T('medieval_blocks_02', '諾曼第切石塊牆／教堂基座（增補）', ['carentan']),

  // 屋頂
  T('roof_09', '一般瓦屋頂', ['carentan']),
  T('roof_slates_03', '石板瓦（阿登木石屋）', ['bastogne', 'crossroads']),
  T('ceramic_roof_01', '陶瓦', ['carentan']),
  T('grey_roof_tiles_02', '灰瓦', ['crossroads']),

  // 金屬
  T('metal_plate', '艦體鋼板', ['midway', 'yamato']),
  T('rusty_metal_02', '鏽蝕鋼板（艦體戰損）', ['yamato', 'midway']),
  T('green_metal_rust', '軍綠鏽蝕（載具車身）', ['brecourt', 'carentan', 'crossroads', 'bastogne']),
  T('rusty_metal_sheet', '戰損鐵皮／殘骸（增補）', ['bastogne', 'crossroads']),

  // 木
  T('wood_planks', '日軍航艦木甲板', ['midway']),
  T('wood_planks_dirt', '穀倉木構、彈藥箱、木柵（增補）', ['brecourt', 'bastogne', 'carentan']),

  // 沙／礁
  T('sand_01', '環礁沙', ['midway']),
  T('coast_sand_01', '濱線濕沙', ['midway']),
  T('sandy_gravel', '碎珊瑚礫（增補）', ['midway']),
  T('rock_boulder_dry', '岩塊／礁岩（增補）', ['midway', 'crossroads']),
];

// ---------------------------------------------------------------------------
// HDRI
// ---------------------------------------------------------------------------

const H = (ph, use, battles, phase) => ({
  id: ph.toLowerCase(),
  ph,
  type: 'hdri',
  res: '1k',
  phase,
  use,
  battles,
});

export const HDRIS = [
  H('kiara_1_dawn', '黎明環境光（暖低角）', ['midway', 'crossroads', 'brecourt'], 'dawn'),
  H('spruit_sunrise', '日出環境光（草原晨霧）', ['brecourt', 'crossroads'], 'dawn'),
  H('kloofendal_48d_partly_cloudy_puresky', '白晝多雲純天空', ['midway', 'carentan'], 'day'),
  H('noon_grass', '正午草地環境光', ['carentan', 'brecourt'], 'day'),
  H('belfast_sunset_puresky', '黃昏純天空', ['midway', 'yamato'], 'dusk'),
  H('the_sky_is_on_fire', '火燒雲黃昏', ['midway', 'yamato'], 'dusk'),
  H('moonless_golf', '無月夜', ['midway', 'bastogne'], 'night'),
  H('satara_night_no_lamps', '無人造光夜空', ['bastogne', 'midway'], 'night'),
  H('overcast_soil_puresky', '陰霾天（大和最終戰）', ['yamato', 'bastogne'], 'overcast'),
  H('cannon', '陰霾漫射（室外灰白）', ['yamato', 'bastogne'], 'overcast'),
  H('mud_road_puresky', '陰雨泥路天空', ['bastogne', 'carentan'], 'overcast'),
];

// ---------------------------------------------------------------------------
// 模型
// ---------------------------------------------------------------------------

const M = (ph, use, battles, extra = {}) => ({
  id: ph.toLowerCase(),
  ph,
  type: 'model',
  res: '1k',
  triBudget: TRI_BUDGET,
  use,
  battles,
  ...extra,
});

export const MODELS = [
  // 針葉樹（bastogne 阿登森林）
  // 這三個來源檔的 scene 裡並排放了 _a／_b／_c 三個變體（translation x = 0／6／12），
  // 不砍掉的話三角形預算被三棵分掉，optimize 的 flatten＋join 又會把位移烘進頂點，
  // 產出是一叢 18–21 m 寬、其中兩棵只剩一兩百面的殘骸。keepNodes 只留第一個變體。
  // 森林是巴斯通的招牌，這兩棵另出桌機高規版 <id>_hi.glb（512² 貼圖、4–6 萬面、≤1.2 MB）；
  // 手機仍載 300 KB 的一般版。其他樹要比照辦理就加同樣的 hiVariant 欄位。
  M('fir_tree_01', '冷杉，阿登森林主樹種', ['bastogne'], {
    keepNodes: ['_a_'],
    hiVariant: { textureSize: 512, triBudget: 50000, maxBytes: 1.2e6 },
  }),
  M('pine_tree_01', '松樹，阿登森林第二樹種', ['bastogne'], {
    keepNodes: ['_a_'],
    hiVariant: { textureSize: 512, triBudget: 50000, maxBytes: 1.2e6 },
  }),
  // 樹苗的針葉是幾千塊互不相連的小面，meshoptimizer 簡化到某個點就到底了，別設更低的目標
  M('pine_sapling_medium', '松樹苗，林下層與林緣', ['bastogne'], { keepNodes: ['_a_'] }),
  M('dead_tree_trunk', '砲擊後的斷木殘幹（增補）', ['bastogne', 'brecourt'], { triBudget: 8000 }),

  // 闊葉樹（陸戰三場）。來源都是單一 node（沒有 _a／_b／_c 變體），不用 keepNodes。
  // 300 KB 版在 128²／1 萬面下葉片被簡化掉太多、只剩褐色枝幹，六月諾曼第看起來像枯樹，
  // 所以同樣給桌機高規版。
  M('tree_small_02', '小闊葉樹，樹籬與田邊', ['brecourt', 'carentan', 'crossroads'], {
    hiVariant: { textureSize: 512, triBudget: 50000, maxBytes: 1.2e6 },
  }),
  M('island_tree_01', '闊葉樹（含椰島感），環礁與農地', ['midway', 'carentan'], {
    hiVariant: { textureSize: 512, triBudget: 50000, maxBytes: 1.2e6 },
  }),
  M('island_tree_02', '闊葉樹變體，避免重複', ['midway', 'brecourt'], {
    hiVariant: { textureSize: 512, triBudget: 50000, maxBytes: 1.2e6 },
  }),

  // 地被植物。注意：Poly Haven 把這兩個歸在 ground cover，實際尺寸是
  // shrub_01 約 2.59×0.40×0.22 m、shrub_04 約 0.58×0.22×0.15 m 的低矮匍匐草株，
  // 不是 1.5–2 m 的樹籬灌木。當林下地被、田埂雜草、彈坑邊緣點綴用；
  // brecourt 的樹籬要另外找資產或用程序化的。
  // shrub_04 幾何本來就小（27k 面），simplify 直接關掉、原封不動進 Draco。
  // shrub_01 原始 156k 面，即使貼圖降到 128² 也要 427 KB，塞不進 300 KB；
  // 改用保守的 60k 面目標（仍是舊版 11.9k 的五倍細節）換 512² 貼圖。
  M('shrub_01', '低矮匍匐地被（林下、田埂雜草）', ['brecourt', 'carentan'], { triBudget: 60000 }),
  M('shrub_04', '小型地被草株', ['brecourt', 'crossroads'], { simplify: false }),

  // 雜物
  M('wooden_crate_01', '木箱（補給堆、陣地點綴）', ['brecourt', 'carentan', 'bastogne'], { triBudget: 4000 }),
  M('wooden_crate_02', '木箱變體（增補）', ['brecourt', 'bastogne'], { triBudget: 4000 }),
  M('Barrel_01', '油桶', ['carentan', 'crossroads', 'midway'], { triBudget: 4000 }),
  // 這顆石頭的頂點全是分裂的，gltf-transform v4 的 weld 只做精確比對、合不起來，
  // 因此 meshoptimizer 幾乎簡化不動（卡在 ~54k）。目標維持預設，超標由 build 據實回報。
  M('boulder_01', '巨石／掩蔽岩', ['crossroads', 'midway', 'bastogne']),
];

export const ASSETS = [...TEXTURES, ...HDRIS, ...MODELS];

/** 來源目錄：assets-src/polyhaven/<type>/<id>/ */
export function srcDir(asset) {
  return path.join(DIRS.src, asset.type, asset.id);
}

/** 每個資產抓完後寫下的來源記錄（build 產 manifest 時讀） */
export function srcMetaPath(asset) {
  return path.join(srcDir(asset), '_source.json');
}
