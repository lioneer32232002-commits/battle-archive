# 全戰役美術精緻化規格（2026-09-12，涵蓋六場既有戰役）

> 目的：把六場既有戰役的「畫面質感」拉到同一個新水準。內容（史實、事件、HUD 文案、時間軸）**一律不動**，只動渲染與美術。
> 適用：`src/midway`、`src/yamato`、`src/brecourt`、`src/carentan`、`src/crossroads` 全面套用；`src/bastogne` 只做 §5 的補強。
> 前作：`docs/quality-upgrade-spec.md`（原本只限巴斯通起的新戰役）。本文件把其中的渲染管線、運動、鏡頭項目**擴及舊戰役**，並加上真正的美術項目（地表、植被、天空、海面、特效）。
> 參考實作：`src/bastogne/` 已完整做過管線與運動升級，**能複製就複製，不要重新發明**（`scene/postfx.js`、`engine/timeline.js` 的 Catmull-Rom、`camera/director.js` 的手持／震動／前置量、`main.js` 的動態解析度與 `renderFrame()` 分流）。

現況診斷（2026-09-12 實機截圖）：
- 舊五戰役：無 ACES、無陰影、無後製 → 整體「平、灰、塑膠」。單位動線直線插值、瞬間轉頭。
- 陸戰三場：地面是單色大平面＋硬邊多邊形田野，樹是「球＋棍」，遠看像桌遊。
- 海戰兩場：海面 shader 尚可，但雲是幾團巨大白色圓斑、船艦無真正尾流、天上無太陽、全圖無亮部。
- 巴斯通：管線已到位，但樹是單一圓錐、雪地細節少。

---

## 0. 鐵則（每一場都適用）

1. **只改自己的目錄**：`src/<id>/**` 與 `tests/<id>-*.test.js`。不得動 `src/site/`、`public/`、`battles/`、`vite.config.js`、其他戰役目錄。
2. **對外行為不變**：所有事件時間、單位軌跡、HUD 內容、圖卡、音效觸發點都不變。`interpolateTrack(track, t)` 的 API 與回傳 `{x, z, heading}` 不變。
3. **手機保流暢、桌機吃質感**：沿用 `isMobile = matchMedia('(max-width: 640px)')` 分流。手機：無 shadow map、無 composer、粒子與 sprite 減半、貼圖 1024。桌機：全開。
4. **主迴圈衛生**：tick 內不得 `new` 物件；材質／幾何盡量共用；每幀走訪用預存陣列。
5. **可重現**：所有隨機佈局用檔內既有的 `mulberry(seed)` / `rng(seed)`，重新整理畫面不會變。
6. **慣例沿用**：中文全形標點、HUD 半透明＋`-webkit-backdrop-filter`、真實比例、`clearTransients()` 清殘留特效。
7. **驗收以實機截圖為準**，不是「程式看起來對」。每一場至少三個時間點（開場、高潮、尾聲）的桌機截圖要拿出來看過，並確認 console 無錯、`npx vitest run` 全綠。**不要跑 `npm run build`**（由整合者統一跑）。
8. **效能底線**：桌機 Chrome 全程 ≥ 55fps；手機模擬 ≥ 30fps。上新東西前後用 `renderer.info.render.calls` 對照，draw call 不得因本次升級增加超過 40%（InstancedMesh／合併幾何是達標手段）。

---

## 1. 渲染管線（P，舊五戰役必做；直接抄巴斯通）

- **P-1 ACES 色調映射**：`renderer.toneMapping = ACESFilmicToneMapping; toneMappingExposure = 1.0; outputColorSpace = SRGBColorSpace`。開了之後**必須重校 environment.js 調色盤**：sun／amb 約 +20–30%，天空、霧色、水色重調到「不死暗、不過曝」。巴斯通的 PALETTES 註解寫了校正經驗，照做。
- **P-2 陰影（桌機）**：`PCFSoftShadowMap`；太陽 `castShadow`，正交範圍**只罩戰鬥核心區**（陸戰約 ±400、海戰約 ±1200 場景單位，依各戰役核心區調），mapSize 2048，`bias -0.0006`、`normalBias 0.8` 起調。單位、建築、樹、船 `castShadow`；地面／甲板 `receiveShadow`。海面是自寫 ShaderMaterial 不能收影，海戰陰影只落在甲板與艦體自遮（艦島影子落甲板是重要的質感來源）。
- **P-3 後製（桌機）**：複製 `src/bastogne/scene/postfx.js`（RenderPass ＋ UnrealBloom strength 0.25／radius 0.6／threshold 0.85 ＋ 暗角顆粒 ShaderPass）。海戰 bloom threshold 可略降到 0.8 讓太陽反光與爆炸更亮。resize 要 `setSize`。截圖流程用 `preserveDrawingBuffer: true` 沿用。
- **P-4 動態解析度**：複製巴斯通 `fpsSample()`（每 2 秒結算、降 0.25、連續 4 秒好才升回）。
- **P-5 太陽本體與光暈**：天空圓頂上、沿 `sun.position` 方向放一顆 Sprite 太陽（Additive、暖白）＋一圈更大更淡的光暈 Sprite；晨昏相位放大變橘、白晝縮小變白。雙海戰與陸戰都要（陸戰在晨光相位很重要）。bloom 會自然讓它泛光。
- **P-6 地平線霧帶**：sky shader 的地平線混色再加一層薄薄的暖／灰霧帶（`pow(h, 0.55)` 之外，在 h < 0.08 區間混入 fog 色），讓地平線不是一條硬線。

## 2. 運動與鏡頭（M，舊五戰役必做；直接抄巴斯通）

- **M-1 Catmull-Rom 插值**：把 `src/bastogne/engine/timeline.js` 的 `interpolateTrack` 搬進來（保留各戰役 timeline.js 其他函式）。複製 `tests/bastogne-timeline.test.js` 成 `tests/<id>-timeline.test.js` 並改 import 路徑，全部要過。
- **M-2 朝向阻尼**：主迴圈用 `shortestAngleDiff` 阻尼逼近；`onScrub`／`onJump`／`onReplay` 設 `snapRot = true` 直接對齊。海戰：船艦轉向阻尼要更重（`Math.pow(0.01, dt)`），大船不該像快艇一樣甩頭；同時加**轉向側傾**：`rotation.z = -angularVelocity * k`（k 依船長調，航艦約 0.6、驅逐艦 1.2，上限 ±0.06 rad）。
- **M-3 微動作**：陸戰士兵行進起伏（抄巴斯通 A-3，troopers 陣列）。海戰：船艦隨浪微幅縱搖／橫搖（`rotation.x/z` 疊加 2 個不同頻率的 sin，幅度 0.004–0.012 rad，驅逐艦大、航艦小），飛機隊形內每架略有相位差的上下起伏（±1.5 單位）與 ±0.05 rad 的滾轉。
- **M-4 鏡頭手感**：抄巴斯通 director.js 的手持噪聲、`shake()`、跟拍前置量。`runFx` 的 barrage／destroy／explosion 依距離觸發震動。

## 3. 陸戰美術（L：brecourt、carentan、crossroads）

- **L-1 地表程序化貼圖（最重要）**：地面平面改用 canvas 程序化貼圖（桌機 2048²、手機 1024²）當 `map`，不能再有任何「一整片單色」在常用鏡頭距離下可見。
  - 基底：多倍頻值雜訊（3–4 octave）做草地明暗斑；再疊一層低頻大色斑做田塊色差（黃綠／深綠／略帶土黃的收割地）。
  - 田塊邊界：**畫進貼圖裡**（略深的一圈＋樹籬投影般的暗帶），現有硬邊多邊形田野 mesh 若保留，須改成極淡的半透明疊層或直接移除，不得再有塑膠硬邊。
  - 道路：沿現有道路幾何在貼圖上畫土黃色路面＋兩道車轍暗線＋路肩漸層；碎石路要有雜訊顆粒。
  - 戰區：彈坑暈染（深色圓斑＋淺色濺邊）、踩踏痕。
  - 平鋪接縫：雜訊頻率取整數週期或邊緣 wrap 混色。
  - 各戰場題材：brecourt＝諾曼第六月牧草地與樹籬田（bocage），carentan＝市鎮周邊、N13 堤道兩側沼澤反光濕地（濕地用略亮偏藍綠的斑）、鐵路路堤碎石；crossroads＝荷蘭圩田（狹長平行田塊、排水溝亮線、堤防草坡）。
- **L-2 植被**：
  - 樹：廢除「球＋棍」。改成 2–3 層錯位堆疊的扁球／低面數 icosahedron，頂點做微抖動（rng），兩色 Lambert（上冠亮綠、下冠深綠）＋樹幹圓柱。**全部改 InstancedMesh**（每個變體一個），依 rng 隨機縮放 0.8–1.3、隨機 y 旋轉。`castShadow` 開。
  - 樹籬（bocage）：改成連續的土堤（略高於地面的長條圓角幾何）＋沿線 InstancedMesh 灌木叢；樹籬頂端隨機幾棵高樹。樹籬是這三場戰役的視覺主角，要一眼看得出「這是諾曼第」。
  - 草叢（桌機可選）：戰鬥核心區 ±150 單位內撒 2–4 千個交叉雙面 quad（alpha 貼圖草叢）InstancedMesh，隨風輕搖（vertex shader 或整體 rotation 微擺）。手機不放。
- **L-3 建築（carentan 為主，crossroads 農舍次之）**：牆面 canvas 貼圖（石砌／灰泥＋窗戶暗格）、屋頂貼圖（瓦片橫線＋色差）、煙囪、部分屋頂缺角／焦黑（戰損）。市鎮街道貼圖用鋪石。教堂尖塔有十字。靜態建築用 `mergeGeometries` 按材質合併。
- **L-4 單位**：模型不重做（已可辨識），但：`castShadow` 開；手機無陰影時在每個班底下放一張柔邊深色圓 sprite 當接地影；行進微動作（M-3）；交火期間班內小兵略壓低（可選）。
- **L-5 特效升級**（沿用 effects.js API 名稱，內部升級）：
  - 爆炸：閃光 sprite（Additive、極短）＋火球 sprite 由橘轉暗＋**會留下來的煙**（3–5 顆煙 sprite 上升、放大、8–12 秒淡出）＋碎屑粒子（10–20 個小方塊拋物線落地）。
  - 砲擊落地留**焦痕貼花**（深色柔邊圓 plane，貼地 +0.3，持續到 `clearTransients`）。
  - 槍火：曳光線（細長 Additive 線段，沿射向飛 0.15 秒）取代單純閃點；MG 巢有節奏（每 0.1 秒一發、間歇 0.6 秒）。
  - 煙幕：更大更慢、隨風漂。

## 4. 海戰美術（N：midway、yamato）

- **N-1 海面 shader 升級**：現有 3 波疊加改為 5–6 波（加入 2 個高頻小波做「碎浪紋」），法線用同樣數值微分；片元加：太陽 glitter（高指數 specular ＋ 隨法線抖動的稀疏亮點）、fresnel 天空反射（近處水色、遠處天色）、依距離往霧色淡出、**浪峰白沫**（h 超過某閾值時混入白色，稀疏）。ACES 開啟後水色要重校（偏暗偏藍綠，避免灰）。
- **N-2 尾流（最重要）**：現有貼圖尾流 plane 太假。改成每艘移動中的船艦有：
  - 艦艏浪：艦艏兩側各一片白沫 sprite（隨速度縮放，停俥消失）。
  - 尾流帶：沿航跡動態發射的白沫 sprite 序列（每 0.4 秒一顆，貼水面 +0.6，逐漸放大並在 12–20 秒淡出，最多 40 顆／艘，環形緩衝重用），形成一條真正跟著轉彎的尾跡。手機每艘上限 16 顆。
  - 沉沒中的船不再發射，殘留尾跡自然淡出。
- **N-3 艦體質感**：船殼 canvas 貼圖（鋼板分割線、水線以下紅褐色、水線黑色 boot-topping、艦艉／艦艏鏽痕）；甲板已有貼圖，補：艦島影子（靠 P-2 陰影）、桅杆索具（`LineSegments`，細灰線）、防空砲座（小方塊叢集）、甲板上停放的小飛機方塊（出擊後消失、返航後出現，看事件時間即可，做不到就跳過）。大和：三聯裝主砲塔要有砲管（三根圓柱）並隨事件略轉向（可選）。
- **N-4 飛機**：俯衝轟炸機隊在高空拉**凝結尾**（每架後方一條漸淡細 ribbon 或 sprite 串，僅在高度 > 某值時出現）；螺旋槳半透明圓盤；編隊內微動作（M-3）。中彈墜海的飛機：拖黑煙下墜＋落水白濺（沿用 flak／destroy 特效再加水花 sprite）。
- **N-5 太陽與天光**：P-5 太陽本體對海戰特別重要：中途島黎明相位太陽貼海平面、橘紅大顆，海面 glitter 沿太陽方向拉出光路；大和 4 月午後太陽偏西、白亮。
- **N-6 雲**：廢除「巨大白色圓斑」。雲貼圖改為 canvas 上 6–10 個大小不一、位置隨機的柔邊圓疊加＋輕雜訊，做 3 種變體；數量增加到 80–120 朵、每朵不透明度 0.15–0.35、分兩層高度（低層大而淡、高層小而亮），並沿風向慢慢漂。加一層遠景低雲帶貼近地平線（扁長 sprite，60–80 朵），這是「海戰油畫感」的關鍵。手機數量減半。
- **N-7 沉沒與火災**：沉沒中的船艦周圍撒**油汙貼花**（深色半透明圓 plane，隨時間擴大）、火災煙柱改成持續上升的煙 sprite 串（黑→灰、越高越淡、被風吹斜）、水面反射火光靠一顆橘色 Additive sprite 貼水面。大和大爆炸：閃光 ＋ 蕈狀煙柱（直上 400+ 單位、頂端擴散）＋ 環形衝擊波（貼水面白色環快速擴大淡出）＋ `director.shake` 全力。
- **N-8 中途島環礁**：礁盤／潟湖改用 canvas 貼圖（外礁白沫線、礁盤淺綠到潟湖深綠藍漸層、沙島沙色帶植被斑）、機場跑道用深灰帶＋白色中線、InstancedMesh 椰子樹一小叢（30–60 棵，樹冠用交叉 quad 或幾片扁平三角葉）。

## 5. 巴斯通補強（B）

- **B-1 針葉樹**：單一圓錐改為 3 層錯位圓錐（下大上小、略帶不同綠）＋每層頂緣一圈白色薄錐當積雪＋樹幹；保持 InstancedMesh（一個 InstancedMesh 可用合併後的幾何）。森林地面在貼圖上畫出樹下的深色斑與踩踏小徑。
- **B-2 雪地貼圖細節**：雪地上加車轍（沿道路兩道深線）、散兵坑線一排（E 連守線位置的小深坑點）、風吹雪紋（低頻長條微亮斑）。
- **B-3 房舍**：屋頂加積雪白蓋（屋頂上再一層略大的白色薄板）、牆面貼圖、窗戶夜間發微弱橘光（夜相位 emissive）。
- **B-4 遠景**：地平線森林剪影帶（一圈深色鋸齒 ring mesh，霧色淡出），避免雪原盡頭直接接天。

## 6. 各戰役調色盤重校提示（ACES 後）

| 戰役 | 主相位 | 重點 |
|---|---|---|
| midway | 黎明→白晝→黃昏→夜 | 黎明橘紅低日、白晝亮藍海＋積雲、黃昏金橘光路；夜相星空 |
| yamato | 4 月午後陰晴 | 東海午後偏灰藍、雲隙光、大爆炸時全畫面短暫過曝（exposure 瞬間 1.6 再回 1.0） |
| brecourt | D 日清晨 | 低斜暖光、長影、薄晨霧貼地（mist sprite 抄巴斯通 mist） |
| carentan | 6 月晨→晝 | 街戰：晨光斜射屋牆；血腥溝：正午白亮，煙塵多 |
| crossroads | 10 月拂曉 | 濃霧拂曉（這場的招牌）：霧近、地平線灰白、日出後霧散、圩田水溝反光 |
| bastogne | 12 月陰／夜／晴 | 已校過，補樹與房舍即可 |

## 7. 驗收清單（每場完工前逐項確認，附截圖）

1. `npx vitest run` 全綠（含新的 `<id>-timeline.test.js`）。console 無錯、無 three.js 警告洗版。
2. 三個時間點桌機截圖（開場、高潮、尾聲）看過：無死暗／過曝、無 z-fighting、無破圖、標籤仍可讀。
3. 手機模擬（`resize_window` preset mobile 後重新整理）一張截圖：HUD 正常、無 composer／陰影、幀率可接受。
4. 拖曳時間軸來回：位置正確、朝向立即對齊、無殘留特效、尾流／焦痕／煙都被 `clearTransients` 清乾淨。
5. draw call 對照前後（`renderer.info.render.calls`），寫在完工回報裡。
6. 完工回報：改了哪些檔、每項規格做／沒做（沒做要寫原因）、draw call 前後、截圖路徑。

## 8. 執行順序建議（給執行模型）

1. 先做 P-1～P-4（抄巴斯通），跑起來、重校調色盤到三個時間點都順眼。這一步就已經是 60% 的觀感提升。
2. 再做 M-1～M-4（抄巴斯通）＋單元測試。
3. 然後做該戰役的美術主項：陸戰＝L-1 地表 → L-2 植被 → L-5 特效 → L-3 建築；海戰＝N-2 尾流 → N-6 雲 → N-1 海面 → N-5 太陽 → N-7 → N-3 → N-4 → N-8。
4. 最後跑 §7 驗收，附截圖回報。

*本規格由 Claude（Fable 5.1）於 2026-09-12 依六場戰役實機截圖撰寫。*

---

## 9. 施工期間發現的管線陷阱（2026-09-12 整合時補記，日後新戰役必讀）

1. **EffectComposer 一定要有 `OutputPass`**（放在 Bloom 之後、自寫暗角顆粒 ShaderPass 之前）。three 渲染到 render target 時會關掉材質的 tonemapping／colorspace chunk，交給管線最後一關；沒有 OutputPass 等於桌機整條管線既沒 ACES 也沒 sRGB 編碼、`toneMappingExposure` 無效，畫面比手機（直接 `renderer.render`）暗約 2.3 倍。原 `quality-upgrade-spec.md` B-5 與巴斯通首版 postfx.js 都漏了這一道，2026-09-12 起各戰役已補。
2. **`Effects.update()` 不可用 `this.transients.filter()` 就地過濾**：很多特效會在自己的 `update` 裡 push 新 transient（彈幕逐發爆炸、槍口焰、手榴彈），`filter` 的長度快照會把這些新項目連同舊陣列一起丟掉，結果是「彈幕整段沒有爆炸」。正確寫法：先把陣列換成空的，再逐一 update，存活者 push 回去，期間新增者合併。
3. **當 `map`／`emissiveMap` 用的 `CanvasTexture` 必須設 `colorSpace = SRGBColorSpace`**，否則被當線性資料，實際亮度是預期的數倍、整片糊掉（資料類貼圖如 alpha／normal 不設）。
4. three 0.184 已棄用 `PCFSoftShadowMap`（會退回 PCFShadowMap 並洗 console 警告），直接用 `PCFShadowMap`。
5. `renderer.info.render.calls` 在開了 composer 之後只反映最後一個 pass；量 draw call 要另外直接 `renderer.render()` 一次再讀。
6. 手機沒有 composer 時，自寫的 sky ShaderMaterial 不會過 tone mapping，需在 shader 內自做 ACES 近似（Narkowicz fit）＋ sRGB transfer，桌機則交給 OutputPass。
7. **「一根針／一片葉一個三角形」的植被資產，遠距離會整棵消失**：次像素三角形常被光柵化整個丟棄（與 alphaTest、mipmap 無關，純紅色不透明材質對照實驗同樣消失）。解法是把三角形重心烘成屬性，在 vertex shader 依鏡頭距離沿重心放大三角形，維持螢幕空間最小寬度（巴斯通 `terrain-upgrade.js` 的 needle shader）；否則只能做 impostor billboard LOD。開 composer 後 `renderer.antialias` 無效，要在 render target 開 MSAA samples。
