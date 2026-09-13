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
