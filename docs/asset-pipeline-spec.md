# 資產管線規格：真實貼圖、HDRI、Blender 建模 glTF（2026-09-12）

> 目的：把六場戰役從「程式現場算出來的積木」升到「有建模資產、有真實材質」的水準。這是使用者未來做遊戲的前哨，**要看的是天花板**，不是省事。
> 前作：`docs/art-upgrade-spec.md`（渲染管線與程序化美術，已全站落地）。本文件在那之上加三種外部資產：Poly Haven CC0 貼圖與 HDRI、Poly Haven CC0 植被模型、Blender 腳本建模輸出的載具／艦艇／人物／建築 glTF。
> 授權：Poly Haven 全部 CC0；Blender 產出為本專案自有。**不得**引入授權不明的模型。

---

## 0. 鐵則

1. 原始下載檔放 `assets-src/polyhaven/`（已 gitignore，可重抓）。**進 git 的只有壓縮優化後的 web 版**：`public/tex/`、`public/hdri/`、`public/models/`。
2. 體積預算（gzip 前）：單一貼圖 ≤ 350 KB（1024²，JPG q80）、手機版 512² 另存；單一 HDRI ≤ 1.6 MB（1k .hdr，桌機限定）＋ 1 張 ≤ 400 KB 的 tonemapped JPG（手機與天幕）；單一模型 .glb ≤ 300 KB（含貼圖，Draco 或 meshopt 壓縮，貼圖 ≤ 512²）。一場戰役首屏總下載 ≤ 6 MB（桌機）／≤ 2.5 MB（手機）。
3. 所有資產走 `public/assets-manifest.json` 登記（id、路徑、來源、授權、尺寸），程式只認 manifest 不寫死路徑。
4. 模型統一：**Y 上、−Z 前、公尺為單位、原點在底部中心（船艦原點在水線中心）**。載入端以「與現有程序化模型的 bounding box 對齊」決定縮放（各戰役尺度不同：中途島船艦 1 單位 ≈ 2.35 m，陸戰士兵約 2 單位高），不在 glTF 內硬編場景尺度。
5. 舊的程序化模型不刪，改為 **fallback**：glTF 載入失敗或手機低階時退回程序化。每個單位工廠函式的對外 API 不變（`createUnit(u)`、`createShip(u)` 等仍回傳同樣結構的 Group，`userData.troopers` 等慣例維持）。
6. 一切以實機截圖驗收，並比對 draw call 與首屏載入時間（DevTools Network 或 `performance.getEntriesByType('resource')` 加總）。

---

## 1. 抓取與壓縮管線（`scripts/assets/`）

- `scripts/assets/manifest.mjs`：curated 清單（下表）。每筆：`id`、`type: texture|hdri|model`、Poly Haven asset id、要抓的 map（diff、nor_gl、arm 或 rough）、解析度、用途註記。
- `scripts/assets/fetch.mjs`：讀 manifest，經 `https://api.polyhaven.com/files/<id>` 取得 URL，下載到 `assets-src/polyhaven/<type>/<id>/`，用 md5 跳過已存在檔。模型要連同 `include` 內的貼圖一起抓。
- `scripts/assets/build.mjs`：
  - 貼圖：sharp 轉 1024² 與 512² JPG（q80，diffuse 用 sRGB；normal／arm 為線性資料，存 JPG 也可但 q90）。輸出 `public/tex/<id>_{diff,nor,arm}_{1k,512}.jpg`。
  - HDRI：1k `.hdr` 原樣放 `public/hdri/<id>_1k.hdr`；tonemapped JPG 用 sharp 縮到 2048×1024 q75 放 `public/hdri/<id>_tm.jpg`。
  - 模型：用 `@gltf-transform/cli`（devDependency）：`gltf-transform optimize in.gltf out.glb --texture-size 512 --compress draco`（或 meshopt），必要時 `simplify --ratio 0.5`。輸出 `public/models/<id>.glb`。Draco 解碼器從 `node_modules/three/examples/jsm/libs/draco/gltf/` 複製到 `public/draco/`。
  - 產出 `public/assets-manifest.json`。
- `package.json` 加 `"assets": "node scripts/assets/fetch.mjs && node scripts/assets/build.mjs"`。
- 全部可重跑、冪等。

### 1.1 Curated 清單（起始版，可增補）

| 用途 | Poly Haven id | 場次 |
|---|---|---|
| 牧草地 | `aerial_grass_rock`、`leafy_grass`、`grass_path_2` | brecourt、carentan、crossroads |
| 林地／泥地 | `forrest_ground_01`、`brown_mud_leaves_01`、`brown_mud_dry` | 陸戰共用、bastogne 森林 |
| 雪地 | `snow_02`、`snow_field_aerial`、`snow_01` | bastogne |
| 道路 | `asphalt_02`（堤路）、`gravelly_sand`（土路）、`cobblestone_floor_04`（鋪石街） | crossroads、brecourt、carentan |
| 牆面 | `painted_plaster_wall`、`rustic_stone_wall_02`、`plastered_stone_wall`、`red_brick_03` | carentan、crossroads、bastogne 房舍 |
| 屋頂 | `roof_09`、`roof_slates_03`、`ceramic_roof_01`、`grey_roof_tiles_02` | 同上 |
| 金屬 | `metal_plate`、`rusty_metal_02`、`green_metal_rust` | 艦體、載具 |
| 木甲板 | `wood_planks` | 日軍航艦甲板 |
| 沙／礁 | `sand_01`、`coast_sand_01` | midway 環礁 |
| HDRI 黎明 | `kiara_1_dawn`、`spruit_sunrise` | midway 黎明、crossroads 拂曉、brecourt 清晨 |
| HDRI 白晝 | `kloofendal_48d_partly_cloudy_puresky`、`noon_grass` | midway 白晝、carentan |
| HDRI 黃昏 | `belfast_sunset_puresky`、`the_sky_is_on_fire` | midway 黃昏 |
| HDRI 夜 | `moonless_golf`、`satara_night_no_lamps` | midway 夜、bastogne 夜 |
| HDRI 陰霾 | `overcast_soil_puresky`、`cannon`、`mud_road_puresky` | yamato、bastogne 陰霾 |
| 針葉樹 | `fir_tree_01`、`pine_tree_01`、`pine_sapling_medium` | bastogne |
| 闊葉樹 | `tree_small_02`、`island_tree_01`、`island_tree_02` | 陸戰三場 |
| 灌木 | `shrub_01`、`shrub_04` | 樹籬 |
| 雜物 | `wooden_crate_01`、`Barrel_01`、`boulder_01` | 陣地點綴 |

---

## 2. Blender 腳本建模（`scripts/blender/`，`blender -b -P <script>.py -- --out public/models/`）

原則：**Python 程序化建模**（bpy／bmesh），不靠手工；每個模型一支腳本，可重跑；材質用 Principled BSDF，貼圖引用 §1 抓下來的 Poly Haven 貼圖或 Blender 內烘焙的簡單色塊貼圖；輸出 glTF（`export_format='GLB'`、`export_draco_mesh_compression_enable=True`、貼圖 ≤ 512²）。面數預算：艦艇 ≤ 12k 三角形、載具 ≤ 4k、單兵 ≤ 1.5k、建築 ≤ 3k、飛機 ≤ 1.5k。都要有合理的 UV 與法線；硬邊用 auto smooth。

### 2.1 海戰（naval）
- `yamato.py`：大和級。艦體流線（以剖面 loft）、球狀艦艏、三座三聯裝 46 cm 主砲塔（砲管獨立物件，命名 `turret_A/B/C`、`barrels_A/B/C` 以便程式轉向）、塔式艦橋、單煙囪後傾、副砲、對空機砲群（instancing 友善：機砲做成一個獨立 mesh 多次擺放）、艦艉飛機甲板與起重機、桅杆索具（細長 box 即可）。水線以下紅褐防汙漆、水線黑帶、上層灰。
- `carrier_ijn.py`：赤城／加賀類日軍航艦（島式艦橋左右舷可參數化、木甲板、艦艏艦艉圓弧、甲板升降機、防空砲座）。輸出兩個變體：`carrier_ijn_L.glb`、`carrier_ijn_R.glb`。
- `carrier_usn.py`：約克鎮級（深藍灰甲板、右舷島、艦島桅杆、雷達）。
- `destroyer.py`、`cruiser.py`：通用驅逐艦與重巡（日美各一配色變體，用材質色參數）。
- `aircraft.py`：SBD 無畏、TBD 毀滅者、F4F 野貓、零戰、九九艦爆、九七艦攻六型，各 ≤ 1.2k 三角形，螺旋槳獨立物件命名 `prop`。

### 2.2 陸戰（land）
- `soldier.py`：參數化人形（比例正確：頭身 7.5），姿態：`stand_rifle`、`advance_rifle`、`kneel_fire`、`prone_mg`、`crouch_run`；裝備變體：美軍傘兵（M1 盔、M42 跳傘服、背具）、德軍（鋼盔、野戰灰／國民擲彈兵長大衣、白色雪地偽裝可用材質色切換）。武器：Garand、Thompson、BAR、Kar98k、MP40、MG42（獨立 glb）。每個姿態一個 glb，≤ 1.5k 三角形。**要能一眼認出是二戰美軍傘兵與德軍**。
- `sherman.py`、`stug.py`、`halftrack.py`（可選）、`howitzer_105.py`（leFH 18）、`mg_nest.py`（沙包＋ MG42）、`c47.py`（傘降運輸機）。
- `buildings.py`：諾曼第石屋（2 種尺寸）、穀倉、教堂（鐘塔＋尖塔＋十字）、阿登木石屋（陡屋頂，可加雪蓋物件 `snow_cap`）、堤防農舍、風車。牆面／屋頂 UV 對應 §1 貼圖。含 `damaged` 變體（屋頂缺角、焦黑）。
- `props.py`：沙包、鹿砦、木柵、電線桿、路標、散兵坑土堆、彈藥箱。

### 2.3 驗收
每支腳本跑完要輸出一張 Blender 內渲染的 512² 預覽 PNG 到 `assets-src/previews/`（`bpy.ops.render.render` 用 Workbench 或 Eevee），整合者靠這張看模型像不像。

---

## 3. 整合（各戰役 `src/<id>/`）

- **載入器**：新增 `src/<id>/scene/assets.js`：讀 manifest、`GLTFLoader` ＋ `DRACOLoader`（decoderPath `/draco/`）、`TextureLoader`、`RGBELoader`；有快取；回傳 Promise。場景初始化改為「先建程序化 fallback，資產到了再換」（不可阻塞首屏；HUD 與時間軸不等資產）。
- **地表 PBR**：地面改 `MeshStandardMaterial`，`map`＝Poly Haven 細節貼圖（repeat 高，例如 40×40），`normalMap`、`roughnessMap`／`aoMap` 同組；**保留**現有程序化 canvas 貼圖當 macro 層（田塊、道路、彈坑、車轍）：用 `onBeforeCompile` 在 `map_fragment` 之後乘上 macro 取樣（brecourt 的 `makeMacroTexture` 已有此模式），或以第二 UV。目標：近看有草葉與土粒，遠看有田塊格局，兩者都不平鋪露餡。
- **HDRI**：桌機用 `PMREMGenerator` 把 1k .hdr 做成 `scene.environment`（金屬、水面、玻璃的反射與間接光），依日相在 2–3 張 HDRI 間切換（不必每幀混，事件切換時 crossfade `environmentIntensity` 即可）；手機用 tonemapped JPG 做 env（`EquirectangularReflectionMapping`）。**天幕**維持現有程序化 sky dome＋雲（時間變化較細），只在需要時用 HDRI 當遠景背景圖層。
- **模型替換**：
  - 海戰：`createShip(u)` 依 `u.kind`／`u.id` 載入對應 glb，依 `u.length` 對齊縮放，保留旗幟、識別環、尾流掛點；大和砲塔隨事件轉向（可選）；飛機隊 InstancedMesh 改用 glb 幾何（`mesh.geometry` 抽出來餵 InstancedMesh）。
  - 陸戰：`createUnit(u)` 的每個小兵改 glb 姿態實例（同姿態共用幾何，`userData.troopers` 陣列仍是每個小兵一個 Object3D 以保留微動作）；載具、火砲、MG 巢換 glb；建築換 glb 並套 PBR 牆面／屋頂；樹改 Poly Haven 樹 glb 的 InstancedMesh（葉片 alphaTest，桌機開 castShadow）。
  - 所有 glb 材質統一過一遍：`envMapIntensity` 依場次、`roughness` 下限 0.35（避免塑膠感）、Lambert 舊材質換 Standard。
- **效能**：模型加起來每場 draw call 不得超過現況 +30%；InstancedMesh 一律沿用；手機端樹與草可退回程序化或降數量。動態解析度機制已在，沿用。
- **驗收**：三個時間點桌機截圖＋手機一張、首屏載入時間、draw call、console 無錯、vitest 全綠、拖曳時間軸無殘留。回報格式同 art-upgrade-spec §7。

---

## 4. 分工與順序

1. **pipeline 代理**：§1 全部（fetch、build、manifest、draco 解碼器、npm script），跑出全部資產並回報每檔大小。
2. **blender-naval 代理**、**blender-land 代理**：§2，與 1 平行（模型不依賴貼圖也能先出），輸出 glb 與預覽 PNG。
3. **六個整合代理**：§3，各自負責一場，等 1 與 2 的產出就緒後開工；先做地表 PBR ＋ HDRI（不依賴 Blender），再換模型。
4. 整合者（Fable）：每階段截圖 QA、commit、build、push。

*本規格由 Claude（Fable 5.1）於 2026-09-12 撰寫。*
