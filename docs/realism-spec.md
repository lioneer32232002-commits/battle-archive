# 真實感升級規格：骨架動畫、Cycles 烘焙舊化、渲染層（2026-09-13）

> 目的：在零外部費用的前提下，把六場戰役的真實感再拉一階。三個槓桿：**士兵會走路**（骨架動畫）、**模型有服役痕跡**（Blender Cycles 程序化舊化烘成貼圖）、**畫面像攝影機拍的**（GTAO、階層陰影、景深、調色、反鋸齒）。
> 前作：`docs/art-upgrade-spec.md`（管線與程序化美術）、`docs/asset-pipeline-spec.md`（Poly Haven／Blender glb 資產，§5 有踩過的坑）。本文件只寫新增項目；鐵則（只改自己目錄、手機分流、首屏預算、fallback、實機截圖驗收、不 commit 不 build）全部沿用。
> Blender：`"C:/Program Files/Blender Foundation/Blender 4.5/blender.exe" -b -P <script> -- --out public/models`。既有共用工具在 `scripts/blender/_common.py`、`_land_common.py`。

---

## R1 士兵骨架動畫（`scripts/blender/soldier_rig.py`）

目標：士兵不再是整塊平移＋上下起伏，而是真的在走、跑、匍匐、跪射。

1. **模型**：沿用 `soldier.py` 的零件建法（M1 盔／M35 盔、M42 跳傘服／野戰灰／長大衣、背具、靴），但改成**單一 T-pose 網格**（各零件合併），三個變體 `us`、`de`、`de_coat`。面數 ≤ 2k。武器獨立（沿用現有武器 glb），掛點改為骨頭 `hand_R`。
2. **骨架**：`root`（原點）、`hips`、`spine`、`chest`、`neck`、`head`、`shoulder_L/R`、`upperarm_L/R`、`forearm_L/R`、`hand_L/R`、`thigh_L/R`、`shin_L/R`、`foot_L/R`。共 19 根。蒙皮：零件建構時就知道屬於哪段肢體，**直接指派 vertex group 權重 1.0**（關節處兩側各 0.5 平滑一圈即可），不用 automatic weights。
3. **動畫（程序化關鍵影格，bpy 寫入 action，全部循環）**：
   - `idle`（2 s）：呼吸起伏、槍口微晃。
   - `walk`（1.0 s 一步循環，1.4 m/s）：正弦大腿擺動 ±30°、小腿相位差、手臂反向擺動、髖部左右 ±3°、身體上下 ±3 cm。
   - `run`（0.6 s，3.5 m/s）：幅度加大、身體前傾 12°、手肘彎。
   - `crouch_walk`（1.1 s，1.0 m/s）：膝彎 40°、上身前傾、槍托抵肩。
   - `kneel_fire`（1.6 s）：右膝跪地、瞄準、每循環一次後座（槍口上抬 3° 再回）。
   - `prone_fire`（2.0 s）：臥倒、手肘撐地、後座抖動。
   - `hit_fall`（1.2 s，不循環）：中彈倒地，供摧毀淡出時播放（可選）。
   每個 clip 在 glTF 內命名固定如上，`walk`／`run` 的 **每秒位移速度** 寫進 `extras.speed`，讓程式依實際移動速度選 clip 與播放倍率（腳不滑）。
4. **輸出**：`public/models/soldier_rig_<variant>.glb`（含全部 clips，Draco 關閉以保骨架權重精度，改用 meshopt 或不壓；單檔 ≤ 250 KB），預覽：每個 clip 中段一張 PNG 並排到 `assets-src/previews/soldier_rig_<variant>.png`。
5. **整合（各陸戰 `src/<id>/scene/soldiers.js`）**：
   - 每個小兵一個 `SkinnedMesh`（`SkeletonUtils.clone`），共用幾何與骨架定義，**材質每單位一份**（淡出不外溢），`AnimationMixer` 每兵一個，clip 依單位狀態選：移動速度 > 2.2 m/s → run、> 0.2 → walk（衝鋒段 crouch_walk）、靜止守軍 → kneel_fire／prone_fire／idle 依 `SQUAD_CFG` 姿態；同班各兵 `time` 加隨機相位，避免齊步。播放倍率 = 實際速度 ÷ `extras.speed`。
   - `userData.troopers` 保留（改為指向 SkinnedMesh），原本的正弦起伏微動作**移除**（動畫已含）。
   - 手機：SkinnedMesh 一樣可跑（38–120 具、每具 ≤ 2k 面沒問題），但 `mixer.update` 每兩幀一次；若實測掉幀再退回靜態 glb。
   - 武器掛在 `hand_R` 骨頭下。
   - 驗收：衝鋒段截圖看得出邁步、跪射有後座；拖曳時間軸後動畫狀態正確；draw call 不增；vitest 全綠。

## R2 Cycles 程序化舊化烘焙（`scripts/blender/bake.py`）

目標：大和、航艦、雪曼、StuG、榴彈砲、建築從純色平塗變成有磨損、鏽跡、接縫、髒汙的表面。

1. **通用流程**（一支腳本，依模型清單跑）：
   - 載入該模型的建構函式（import 對應腳本的 build 函式，不要重寫模型），**Smart UV Project**（角度 66°、島邊距 0.02）攤 UV 到單一 UV 圖。
   - 材質：每個原本的純色材質換成 Principled，base color 保留原色，再疊：
     - **邊角磨損**：Geometry → Pointiness（或 Bevel 節點 0.02 m）＋ Noise 做遮罩，露出淺灰金屬色。
     - **AO 髒汙**：Ambient Occlusion 節點乘暗色。
     - **鏽痕流跡**：以物件座標 Z 向拉伸的 Noise 做「往下流」的條紋，鏽色 (0.35, 0.15, 0.08)，只在金屬材質、垂直面（法線 Z 分量小）出現。
     - **鋼板接縫／鉚釘**：Brick 或 Wave 節點做 bump（強度 0.15），船體用 3–4 m 板距、載具 0.6 m。
     - **雪地／泥地下擺髒汙**（載具、建築牆腳）：物件座標 Z 低處漸層混泥色。
   - **烘焙**（Cycles、128 samples、denoise）：`DIFFUSE`（只 color）、`ROUGHNESS`、`NORMAL`（含 bump）、`AO` 四張，1024²，全部烘到**同一張 UV 圖**（一個模型一組貼圖，整模單一材質 → 整模 1 個 draw call）。
   - 匯出 glb：單一材質引用四張貼圖，再過 `gltf-transform`（`--texture-size 512 --texture-compress webp`、Draco），輸出 `public/models/<id>_baked.glb`，預算：艦艇 ≤ 600 KB、載具 ≤ 400 KB、建築 ≤ 350 KB。手機仍用原本平塗版。
2. **清單**（優先順序）：`yamato`、`sherman`、`stug`、`carrier_ijn_L/R`、`carrier_usn`、`cruiser_ijn/usn`、`destroyer_ijn/usn`、`howitzer_105`、`house_normandy_s/l`、`church`、`house_ardennes`、`barn`、`farmhouse_dutch`。
3. **預覽**：每個模型烘完渲一張 3/4 視角 PNG 到 `assets-src/previews/<id>_baked.png`，**自己看過**：磨損要在稜角、鏽要往下流、不能整片髒成一團。
4. **整合**：各戰役 `assets.js` 桌機優先載 `<id>_baked.glb`；烘焙版已是單一材質＋貼圖，**不再烘頂點色**，直接用 glb 材質（roughness ≥ 0.35，`envMapIntensity` 依場），保留現有縮放與掛點邏輯。

## R4 渲染層（六場 `src/<id>/scene/postfx.js`、`environment.js`、`main.js`）

桌機限定，順序固定：`RenderPass → GTAOPass → UnrealBloomPass → OutputPass → 調色 ShaderPass（含暗角顆粒）→ SMAAPass`。

1. **GTAO**：`three/addons/postprocessing/GTAOPass.js`，半解析度、radius 依場尺度（陸戰約 6 單位、海戰 25）、`distanceExponent 1`、`thickness 1`、blend 強度 0.6。這是「接地感」的關鍵，尤其士兵腳下、房舍牆腳、艦島根部。
2. **階層式陰影 CSM**：`three/addons/csm/CSM.js`，3 層、`maxFar` 陸戰 900／海戰 3500、`mode: 'practical'`、shadowMapSize 2048。取代目前單張正交陰影（近處銳利、遠處仍有影）。所有 MeshStandard／Lambert 材質要 `csm.setupMaterial(mat)`（含 glb 載入後與 InstancedMesh）；自寫 ShaderMaterial（海面、天空）不吃 CSM 照舊。太陽方向隨日相變化時 `csm.lightDirection` 同步更新。
3. **景深**：`BokehPass` 只在導演模式 follow 時開，`focus` 設為跟拍目標距離、`aperture` 極小（0.00008 級）、`maxblur 0.006`；自由模式關閉，手機關閉。目標是「遠景略柔」，不是手機人像模式。
4. **調色**：現有暗角顆粒 ShaderPass 擴充成調色：lift／gamma／gain 三段、飽和度、微 teal-orange 分離色調（陰影偏青 0.04、亮部偏暖 0.04）、對比 S 曲線。各戰役一組參數：海戰偏冷藍、諾曼第偏暖綠、巴斯通低飽和冷灰、十字路口拂曉青灰。
5. **反鋸齒**：composer 內開 `SMAAPass`（取代 MSAA render target 或並存看效能）。
6. **效能**：GTAO 半解析度、CSM 3 層 2048 是上限；桌機幀時間預算 ≤ 12 ms（用 `__dbg` 同步渲染量，開關前後各量一次寫進回報）；動態解析度機制沿用，並在降級時先關 GTAO 再降解析度。
7. **驗收**：每場三個時間點截圖（同機位開／關新管線各一張對照）、console 無錯、vitest 全綠、拖曳無殘留。

## 分工

1. **rig 代理**：R1 的 1–4（Blender 端），輸出 glb 與預覽。
2. **bake 代理**：R2 的 1–3（Blender 端），輸出 `_baked.glb` 與預覽。
3. **render 代理**：R4 六場全部（一個代理依序做，先巴斯通當範本再複製到其他五場），不碰 soldiers／ships／assets。
4. 1、2 完成後：**六個整合代理**分別把 R1（陸戰四場）與 R2（六場）接進去。
5. 整合者（Fable）：截圖 QA、commit、build、push。

*本規格由 Claude（Fable 5.1）於 2026-09-13 撰寫。*

---

## R5 畫質分級（2026-09-13 補記；六場 `main.js`、`environment.js`、`terrain*.js`、`postfx.js`）

背景：實測（`__dbg.dbgPerf`，readPixels 同步，1600×1000）本機 Intel UHD 內顯上巴斯通單幀約 50 ms、R4 新管線只多約 5 ms，重的是場景幾何（2–8M 三角形、三層 cascade 重畫三次）。R4 保留，但桌機必須依顯示卡等級分三級，並在執行期自動降級。

1. **等級判定（啟動時，建場景之前）**：
   - `?q=high|medium|low` 覆寫 → `localStorage['battle-quality']` → 自動判定。
   - 自動：`WEBGL_debug_renderer_info` 的 UNMASKED_RENDERER 命中 `/Intel|Iris|UHD|Apple GPU|Mali|Adreno|SwiftShader|llvmpipe/i` → `medium`，其餘 → `high`；手機路徑（`isMobile`）不在此列，維持既有。
   - 執行期：滾動平均幀時間連續 3 秒 > 40 ms → 降一級（最多降到 low）；降級順序先動可即時切換的旋鈕，再重建需重建的（見 3）。不自動升級（避免振盪），只在下次載入依 localStorage 記憶。
2. **三級內容**：

   | 項目 | high | medium | low |
   |---|---|---|---|
   | GTAO | 半解析度 | 關 | 關 |
   | 陰影 | CSM 3 層 2048 | CSM 2 層 1536 | 單張正交 1024（既有 legacy 路徑） |
   | 景深、SMAA、調色、bloom | 全開 | 開（bloom 半解析度） | 只留 OutputPass＋調色 |
   | pixelRatio 上限 | 2 | 1.25 | 1 |
   | hero 植被 | `_hi` 全幾何 | `_hi` 抽稀 50% 或一般版 | 程序化 |
   | mid 植被、草叢 | 全量 | 半量 | 無 |
   | 雪、粒子、雲 sprite | 全量 | 60% | 40% |
   | 士兵 SkinnedMesh | 每幀 mixer | mixer 每 2 幀 | 每 3 幀 |
3. **實作要求**：`src/<id>/scene/quality.js` 匯出 `getQuality()`（回傳 tier 與參數物件）與 `onQualityChange(cb)`；所有建構函式吃參數而不是各自讀 `isMobile`。植被數量與 CSM 層數屬「需重建」，降級時允許直接 `location.reload()` 並寫入 localStorage（簡單可靠），其他旋鈕即時切。HUD 右上加一顆小按鈕「畫質：高／中／低」循環切換（同樣寫 localStorage 後 reload）。
4. **驗收**：三級各一張同機位截圖與 `dbgPerf` 數字寫進回報；`?q=low` 在本機 Intel 內顯上巴斯通 ≤ 25 ms；console 無錯；vitest 全綠。

## R6 整合備忘（R4 施工後新增的介面，整合代理必讀）

- **CSM 註冊**：`environment.registerObject(group)`／`registerMaterial(mat)`／`refreshShadowMaterials()`，冪等、手機 no-op。**glb 換模、`SkeletonUtils.clone`、材質 clone 之後必須呼叫**，沒註冊的 Standard／Lambert 材質會被三盞 cascade 燈各照一次、亮度變三倍。`createAssets` 有 `onMaterial` 選項可在載入時直接註冊。
- **GTAO 可見性**：`depthWrite:false` 的物件（天空、雲、霧、太陽、標籤）與所有 Sprite 已由 postfx 自動跳過；新加的透明大面積物件掛 `userData.noAO = true`。
- **量測**：`__dbg.freezeQuality(true)` 後 `__dbg.dbgPerf(n)`（readPixels 同步，`gl.finish()` 在 ANGLE 上不擋 CPU、數字不可信）；`__dbg.pipeline('legacy'|'modern')` 做同機位對照。
- **巴斯通已知問題**：核心區雪面 overlay（`terrain-upgrade.js`）`receiveShadow=false` 加 hemi 0.98，導致雪地看不到投影；整合時 overlay 改 `receiveShadow=true`（或改成把細節混進底層材質）並把 hemi 降到約 0.75 後重校。
- **烘焙版模型**：桌機 high／medium 優先載 `<id>_baked.glb`（單一材質＋四張貼圖，不再烘頂點色，roughness ≥ 0.35），low 與手機用平塗版；`_baked` 檔還在陸續產出，開工先 `ls public/models/*_baked.glb`，沒有的維持現況並回報。
