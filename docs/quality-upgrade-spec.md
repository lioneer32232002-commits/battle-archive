# 戰役影片品質升級規格（自下一戰役「巴斯通」起適用）

> 目的：讓物件移動更精細、環境更有質感、播放更流暢。
> 適用：`src/bastogne/` 起的所有新戰役。**現有戰役（midway／yamato／brecourt／carentan／crossroads）不改。**
> 基準範本：`src/carentan/`。新戰役先複製其模組架構（`engine/`、`scene/`、`camera/`、`ui/`、`data/`），再套用本規格的升級項目。慣例（標點、HUD 半透明、尺度、標籤、戰史館卡片等）一律比照 carentan 現作，本文件只寫「新增」的品質要求。
>
> 優先順序：若時間有限，先做標示 ★ 的三項（成本最低、效果最明顯）：
> ★ 色調映射（B-1）、★ 曲線路徑插值（A-1）、★ 士兵行進微動作（A-3）。

---

## 0. 分級策略（手機保流暢、桌機吃質感）

沿用 carentan 的 `isMobile` 判斷（`window.matchMedia('(max-width: 640px)')`）：

| 項目 | 手機 | 桌機 |
|---|---|---|
| 色調映射 ACES | ✅ | ✅ |
| 曲線插值＋朝向平滑 | ✅ | ✅ |
| 士兵微動作 | ✅ | ✅ |
| 陰影（shadow map） | ❌ | ✅ |
| 後製（bloom／暗角／顆粒） | ❌ | ✅ |
| 雪粒子數量 | ~500 | ~1500 |
| 雲霧 sprite 數量 | 桌機的一半 | 全量 |
| 動態解析度降級 | ✅（下限 1.0） | ✅（下限 0.75×dpr 上限） |

---

## A. 物件移動精細化

### A-1. ★ 路徑改用 Catmull-Rom 曲線插值

現況：`engine/timeline.js` 的 `interpolateTrack()` 是航點間直線插值，朝向（heading）每段固定、在航點瞬間切換，轉彎很生硬。

要求：
1. 保持 `interpolateTrack(track, t)` 的對外 API 與回傳格式 `{ x, z, heading }` 不變（`unitStateAt` 等呼叫端不用改）。
2. 內部改為 **centripetal Catmull-Rom** 曲線：對每個區段 `[P1, P2]`，取相鄰點 `P0`、`P3`（頭尾用端點複製補），在 (x, z) 平面上做曲線插值。**時間參數必須沿用航點的 `t` 欄位**（不是弧長參數化），因為播放有「冷場自動快轉」與拖曳跳轉，`t` 對位置必須是確定性映射。
3. `heading` 改由曲線切線（對插值參數的導數）算出：`Math.atan2(dx, -dz)`（北為 -z、順時針，與現有慣例一致）。
4. 退化情形：track 只有 1 點照舊回傳定點；只有 2 點退回直線插值。
5. **timeline.js 保持純邏輯、不依賴 Three.js**（現有註解已如此要求）。Catmull-Rom 自己用純 JS 寫，約 20 行。
6. 起步／停止緩動：只對**整條 track 的第一段套 ease-in、最後一段套 ease-out**（例如 smoothstep 只作用在該段的局部參數 f 上）。中間各段不要加緩動，否則每個航點都會有停頓感。

驗收：單位轉彎是弧線、無瞬間轉頭；拖曳時間軸大幅跳轉時位置正確、不飛點。

### A-2. 朝向平滑轉動（渲染層）

即使有了切線 heading，事件跳轉時朝向仍可能瞬變。在主迴圈（main.js 的 tick 內更新單位處）：

- 不要直接 `group.rotation.y = targetHeading`，改成阻尼逼近：
  `rotation.y += shortestAngleDiff(target, current) * (1 - Math.pow(0.001, dt))`。
- `shortestAngleDiff` 要處理 ±π 環繞（wrap），否則單位會原地轉大圈。
- 拖曳時間軸（onScrub／onJump）時**直接對齊**目標朝向，不做阻尼，避免拖完還在慢慢轉。

### A-3. ★ 士兵行進微動作

現況：`scene/soldiers.js` 產生的單位是剛體整塊平移，行進像滑冰。

要求：
1. 建立單位時，替每個小兵 mesh 記 `userData.phase = rng() * Math.PI * 2`（用檔內現有的 `rng(seed)` 保持可重現）。
2. 每幀（只對「正在移動」的單位）：
   - 判斷移動：這幀位移量 > 極小閾值，或由 track 區段判斷目前在行進中。
   - 每個小兵 y 加 `Math.sin(time * 7 + phase) * 0.12`（幅度以模型尺度微調，肉眼可見但不誇張）。
   - 輕微左右搖擺：`rotation.z = Math.sin(time * 7 + phase) * 0.03`。
3. 靜止單位（守軍、MG 巢）不做起伏，可留極輕微的呼吸感（幅度 1/4）或完全不動。
4. 效能：不要每幀 traverse 整個 group 找小兵。建單位時就把小兵 mesh 收進一個陣列掛在 `group.userData.troopers`，主迴圈直接走訪。
5. 進階（可選，時間允許再做）：交火事件期間該單位切換壓低姿態（整組小兵 y 降低＋前傾）。做不完就跳過，不影響驗收。

### A-4. 鏡頭手感（camera/director.js）

1. **手持噪聲**：導演模式 follow 期間，在最終 camera position 與 target 上疊加微小偽 Perlin 偏移（兩三個不同頻率的 sin 疊加即可，幅度約跟拍距離的 0.3%）。自由模式（OrbitControls）不加。
2. **衝擊震動**：新增 `director.shake(intensity, duration)`，衰減式隨機偏移。在 `runFx` 的 `barrage`／`destroy` 觸發（近距離事件強、遠距離弱或不觸發）。
3. **跟拍前置量（look-ahead）**：follow 的目標點沿單位行進方向前移一小段（約跟拍距離的 8%），並沿用現有的指數平滑，畫面重心會落在部隊「要去的地方」，更像紀錄片運鏡。

---

## B. 環境質感

### B-1. ★ 色調映射（兩行，性價比最高）

```js
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace; // 新版 three 預設即此，明寫保險
```

注意：開 ACES 後整體會變暗、對比變高，**必須回頭重調 environment.js 調色盤**（sunInt、amb 大約要提高 20–30%，天空與霧色也要重校）。這不是 bug，是必要的重校步驟。手機桌機都開。

### B-2. 陰影（桌機限定）

1. `renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;`
2. 太陽光 `sun.castShadow = true`，shadow camera 用 **收緊的正交範圍**只罩戰鬥核心區（約 ±400 場景單位），`mapSize` 2048。範圍收得越緊、陰影越銳利，不要貪心罩全地圖。
3. 單位與建築 `castShadow = true`；地面與地形 `receiveShadow = true`。Lambert 材質可直接收影。
4. 手機完全關閉（連 renderer.shadowMap 都不開，省一次 render pass）。

### B-3. 地面程序化紋理

現況：地面是單色 `MeshLambertMaterial` 平面，近景一片死色。

要求：用 canvas（1024×1024）程序化生成貼圖給地面 `map`：
- 巴斯通＝冬季：底色雪白偏灰藍，疊多層低頻噪聲色斑（髒雪、露土），道路沿線畫車轍暗痕，戰區撒彈坑暈染（深色圓斑＋淺色濺邊）。
- 用檔內慣例的 `mulberry(seed)` 偽隨機，佈局可重現。
- 貼圖 repeat 平鋪時注意接縫（邊緣做 wrap 混色，或乾脆把噪聲頻率取整數週期）。

### B-4. 巴斯通氛圍物件（阿登冬季題材）

1. **飄雪**：一個 `THREE.Points` 粒子系統（桌機 ~1500、手機 ~500），粒子在鏡頭周圍一個立方體域內下落＋風向漂移，落出域底回收到頂部。跟著 camera 位置平移域中心，永遠有雪但粒子數固定。
2. **樹頂砲爆（tree burst）**：阿登戰役招牌。新增 fx 種類 `treeburst`：在樹冠高度空炸，閃光＋放射狀木屑線條＋向下的雪塵，配 `explosion` 音效。事件資料（data/battle.js）在德軍砲擊事件掛用。
3. **遠景火光煙柱**：城鎮方向放 2–3 根緩慢升騰的煙柱 sprite＋底部橘色點光暈（sprite 即可，不用真光源）。
4. **呼出白霧**（可選）：跟拍近距離時，行進單位頭部位置偶發小團白霧 sprite，1 秒淡出。做不完可跳過。

### B-5. 後製特效（桌機限定）

用 `EffectComposer`（three/addons）：
1. `RenderPass` ＋ `UnrealBloomPass`（strength ≈ 0.25、threshold ≈ 0.85，只讓爆炸與火光泛光，白雪不能糊掉）＋ 自寫 `ShaderPass`（暗角 vignette ＋ 輕微膠片顆粒，顆粒強度 ≤ 0.04）。
2. resize 時 composer 也要 `setSize`。
3. 手機不建 composer，直接 `renderer.render`，主迴圈用同一個 `renderFrame()` 函式包起來分流。
4. 注意：現有 renderer 開了 `preserveDrawingBuffer: true`（截圖用）。改用 composer 後若截圖流程（縮圖產生腳本）讀 canvas，需驗證仍可截到畫面。

---

## C. 播放流暢度

### C-1. InstancedMesh（樹木必做）

巴斯通＝森林戰，樹的數量會遠超過去戰役。**森林一律用 `THREE.InstancedMesh`**（雪松樹一種或兩種變體，每種一個 InstancedMesh，個別 instance 用 matrix 設位置／旋轉／縮放隨機化）。幾百棵樹 = 1–2 個 draw call。

士兵**維持現有 per-unit group 做法**（淡出邏輯依賴每單位獨立材質），不強制實例化。

### C-2. 靜態幾何合併

城鎮建築、圍牆、路障等不會動的東西，用 `BufferGeometryUtils.mergeGeometries`（three/addons）按材質分組合併成少數幾個 mesh。會被個別炸毀／變化的物件不要合併。

### C-3. 動態解析度

主迴圈維護滾動平均 FPS（每 2 秒結算一次）：
- 桌機：平均 < 45fps → `setPixelRatio` 降 0.25，下限 0.75×原上限；連續 4 秒 > 55fps 才升回，一次升 0.25（避免振盪）。
- 手機：平均 < 27fps → 降級，下限 1.0。
- 降級同時可把雪粒子數砍半（粒子系統做成可動態調 draw range）。

### C-4. 透明疊繪預算

雲、霧、煙 sprite 是手機掉幀主因（overdraw）。手機端：雲霧數量取桌機一半、單張 sprite 尺寸略縮 10–20%。已有先例（carentan 的 isMobile 分流），照做即可。

### C-5. 主迴圈衛生

- tick 內不得 new 物件（Vector3、Color 等一律模組層預先配置重用；現有 `_fwd` 就是這個模式）。
- 士兵微動作走訪用預存陣列（見 A-3 第 4 點）。
- 材質透明度動畫（destroyed 淡出）已有 `prepMats` 快取模式，沿用。

---

## D. 驗收清單（完工前逐項確認）

1. `npm run build` 通過；`tests/` 有對應測試就跑（新的 Catmull-Rom 插值**要加單元測試**：單點／兩點／多點、t 超出頭尾、與航點時間精確對齊時位置=航點位置）。
2. 桌機 Chrome 全程 ≥ 55fps；手機模擬（DevTools mid-tier throttle）≥ 30fps，砲擊高潮不掉到 20 以下。
3. 部隊轉彎為平滑弧線，無瞬間轉頭；行軍有起伏微動作；停止時不滑行。
4. 拖曳時間軸任意來回：位置正確、朝向立即對齊、無殘留特效（沿用 `clearTransients` 慣例）。
5. 陰影、bloom 只在桌機出現；手機無 shadow map、無 composer。
6. ACES 開啟後晨昏／白晝調色盤已重校，不得整體死暗或過曝。
7. 冷場自動快轉（gap > 30 加速）與曲線插值並存無異常。
8. 手機直/橫向 resize、iOS Safari 的 `-webkit-backdrop-filter` HUD 正常（沿用慣例）。

---

## E. 建置順序建議（給執行模型）

1. 複製 carentan 架構為 `src/bastogne/`，先讓空場景跑起來（地形佔位）。
2. 先做 B-1 ACES ＋重校調色盤（冬季夜／晨／晝三相：12 月阿登，晝短夜長，適合夜戰砲火）。
3. 改 timeline.js 插值（A-1）＋單元測試，再接 A-2 朝向平滑。
4. 地形＋森林 InstancedMesh（C-1）＋地面雪紋理（B-3）。
5. 單位工廠（冬裝：美軍缺冬衣是史實梗、德軍白色偽裝服）＋ A-3 微動作。
6. 事件資料＋特效（含 treeburst）＋鏡頭手感（A-4）。
7. 效能收尾：C-2／C-3／C-4，跑 D 驗收清單。
8. 史實資料（data/battle.js 的時序、單位、事件文案）**必須先經多源史實查核**再定稿，與過去戰役相同流程。

---

*本規格由 Claude（Fable 5）於 2026-07-02 基於 src/carentan 現況撰寫。*
