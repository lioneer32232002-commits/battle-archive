# 戰史檔案館美術技術總整理（可移植到其他 Three.js 專案）

> 2026-09-12 至 09-13 在六場戰役上實際做過、實機驗證過的技術，依「投報率」排序。每一項寫：做什麼、為什麼有效、關鍵參數、踩過的坑。另一個專案照這份文件的順序做，前三節就能拿到八成的觀感提升。
> 真源規格：`docs/art-upgrade-spec.md`（渲染與程序化美術）、`docs/asset-pipeline-spec.md`（資產管線）、`docs/realism-spec.md`（骨架動畫、烘焙、GTAO）。程式範例以本 repo `src/bastogne/`、`src/yamato/` 為準。

---

## 1. 渲染管線（零資產、最便宜、效果最大）

| 技術 | 做法 | 關鍵參數 | 坑 |
|---|---|---|---|
| ACES 色調映射 | `renderer.toneMapping = ACESFilmicToneMapping`、`outputColorSpace = SRGBColorSpace` | exposure 1.0 起 | 開了會變暗變對比，**調色盤要重校**（光 +20–30%、霧與天空重調） |
| 後製 composer | `RenderPass → UnrealBloomPass → OutputPass → 自寫調色／暗角／顆粒 → SMAAPass` | bloom strength 0.25、radius 0.6、threshold 0.8–0.85；顆粒 ≤ 0.035；暗角底值 0.84 | **沒有 OutputPass 整條管線不吃 ACES 與 sRGB**，桌機會比手機暗 2.3 倍、exposure 失效。顆粒與暗角放 OutputPass 之後才是底片行為 |
| 陰影 | `PCFShadowMap`、太陽 castShadow、正交框只罩戰鬥核心區 | mapSize 2048、bias −0.0006、normalBias 0.15（1 單位＝10 m 的尺度） | `PCFSoftShadowMap` 在 r184 已棄用；normalBias 0.8 在小單位會把採樣點推出 8 公尺；海面自寫 shader 不能收影 |
| HDR 火光 | 爆炸／曳光給 > 1.0 的線性顏色（例如 7.0） | threshold 0.8 才會泛光 | ACES 把 1.0 壓到 0.8，不給超過 1 的值爆炸就是一張橘色貼紙 |
| 動態解析度 | 每 2 秒結算平均 fps，低於門檻降 0.25 pixelRatio，連續 4 秒好才升回 | 桌機下限 0.75×、手機 1.0 | 降級時先關 GTAO、砍粒子，再降解析度 |
| 太陽本體與光暈 | 沿 sun.position 放 Additive sprite 兩顆（日輪＋大光暈），尺寸與色溫隨日相插值 | 黎明大而橘、白晝小而白 | `fog:false`、`depthTest:false`，否則濃霧會吃掉它 |
| 地平線霧帶 | sky shader 在 `h < 0.085` 混入 fog 色 | smoothstep | 天空是 ShaderMaterial，手機無 composer 時要在 shader 內自做 ACES 近似（Narkowicz） |
| 手機分流 | `matchMedia('(max-width:640px)')`：無 shadow map、無 composer、粒子減半、貼圖 512 | | 桌機與手機調色差異來自管線，不是調色盤 |

## 2. 運動與鏡頭（讓東西「像在動」）

- **Catmull-Rom 曲線動線**：航點間用 centripetal Catmull-Rom 插值，heading 取切線；時間參數沿用航點 `t`（不是弧長），拖曳時間軸才是確定性映射。只在整條 track 首段 ease-in、末段 ease-out，中間不要加緩動（每個航點會頓）。
- **朝向阻尼**：`rot += shortestAngleDiff(target, rot) * (1 - 0.001^dt)`；拖曳／跳轉時直接對齊。船艦阻尼更重（`0.01^dt`）並加轉向側傾 `rotation.z = -angVel * k`。
- **微動作**：士兵行進正弦起伏（改骨架動畫後移除）；船艦隨浪縱橫搖用海面高度場的 JS／GLSL 共用同一組波參數，艦艏艦艉浪高差算縱搖；飛機編隊內相位差起伏與滾轉。
- **鏡頭手感**：跟拍疊 2–3 個不同頻率 sin 的手持噪聲（幅度＝距離 0.3%）、`shake(intensity, duration)` 衰減式震動依距離觸發、跟拍前置量沿行進方向前移 8%。

## 3. 程序化環境（不下載任何資產也能做）

- **地表 canvas 貼圖**（2048²）：多倍頻值雜訊草斑＋低頻田塊色差＋田界暗帶＋道路車轍＋彈坑暈染。平鋪接縫用整數週期或邊緣 wrap。**平鋪重複感**用第二層低頻 macro 遮罩（整張地圖一張 512、`onBeforeCompile` 在 `map_fragment` 後相乘）打散。
- **對位貼圖層**：與地形 1:1 對位、不平鋪的透明「細節貼花層」（車轍、散兵坑、樹下暗斑、踩踏小徑），座標直接取自物件佈局陣列，樹在哪暗斑就在哪；1 個 draw call。
- **雲**：canvas 上 6–10 個柔邊圓疊加＋雜訊做 3 種變體，80–120 朵分兩層高度＋地平線扁長雲帶；抬高到 620 以上放淡，避免低機位整片白斑。
- **海面 shader**：6 波疊加（含 2 個高頻碎浪）＋數值微分法線、太陽 glitter、fresnel 天空反射、遠距霧化、浪峰白沫（白沫的浪高在**片元端重算**，否則網格粗會變菱形色塊）、近距離漣漪法線擾動。
- **尾流**：依「行進距離」每 7.5 單位發射一顆貼水白沫（不是依時間，倍速播放密度才不變），環形緩衝 40 顆／艘，頂點著色器加該點浪高才不會被浪峰吃掉；艦艏浪左右各一、艦艉攪動一片。
- **樹（程序化版）**：2–3 層錯位扁球／低面數 icosahedron＋頂點抖動＋兩色；針葉三層錐＋積雪白緣。全部 InstancedMesh。
- **特效**：閃光（極短 Additive）＋火球轉暗＋會留下來的煙（上升放大 8–12 s 淡出）＋碎屑 InstancedMesh 拋物線；焦痕貼花池（InstancedMesh 環形緩衝，1 draw call）；曳光線池（細長 Additive 柱體沿射向飛 0.15 s）；MG 節奏（0.1 s 一發、五發一串、歇 0.6 s）。
- **遠景**：地平線森林剪影帶（BackSide 開放圓柱貼鋸齒 alpha），靠霧淡出。

## 4. 資產管線（免費、CC0）

- **來源**：Poly Haven（`https://api.polyhaven.com/files/<id>`）貼圖（diff／nor_gl／arm）、HDRI（1k .hdr＋tonemapped JPG）、植被模型。全部 CC0。
- **壓縮**：sharp 轉 1024² 與 512² JPG；模型用 `@gltf-transform/cli`：`optimize --compress false` 後單獨 `draco --quantize-position 12 --quantize-normal 8 --quantize-texcoord 10`、貼圖 `--texture-compress webp`。Draco 解碼器複製到 `public/draco/`。
- **manifest**：`public/assets-manifest.json` 登記路徑、bytes、px、colorSpace、alphaMaterials、bbox；程式只認 manifest。
- **預算**：貼圖 ≤ 350 KB、HDRI ≤ 1.6 MB、模型 ≤ 300 KB；招牌植被另出桌機高規版 `*_hi.glb`（512²、4–6 萬面、≤ 1.2 MB）。首屏桌機 ≤ 6 MB、手機 ≤ 2.5 MB。
- **坑**：Poly Haven 樹 glTF 的葉片 alpha 沒包進 gltf（要另抓 `*_alpha` PNG 合成 RGBA，材質改 MASK cutoff 0.5）；一檔常含三棵變體並排（只留 `_a` 並歸零位移）；`shrub_*` 是地被不是灌木（看 metadata dimensions）；300 KB 版的樹只夠遠景。

## 5. Blender 腳本建模（零手工）

- 無頭執行 `blender -b -P script.py -- --out ...`，bpy／bmesh 程序化建模，每個模型一支可重跑腳本；共用工具：剖面 loft、材質、glTF 匯出、Workbench 預覽渲染。
- 座標約定：Y 上、−Z 前、公尺、原點底部中心（船艦水線中心）；可動零件獨立節點命名（`turret_A`、`barrels_A`、`prop`、`snow_cap`、`hand_r`）。
- 面數預算：艦艇 ≤ 12k、載具 ≤ 4k、單兵 ≤ 1.5k、建築 ≤ 3k、飛機 ≤ 1.5k。建築 UV 以 1 UV＝1 公尺平鋪，讓整合端直接套 PBR 貼圖。
- 每支腳本渲 3/4 視角預覽 PNG，整合者看圖把關「像不像」。
- 進階（規格 §R1／R2，施工中）：骨架＋程序化關鍵影格動畫輸出 glTF animations；Cycles 程序化舊化（Pointiness 邊角磨損、AO 髒汙、鏽痕流跡、接縫 bump）烘成 diffuse／roughness／normal／AO 四張貼圖，整模單一材質。

## 6. 整合模式（把資產接進 Three.js 不掉幀）

- **fallback 優先**：先建程序化版本、資產到了再就地替換同一個 Group，HUD 與時間軸不等資產；載入失敗回 `null` 就地退回。
- **烘頂點色合併**：Blender 純色 glb 每材質一個 primitive → 把 baseColor 烘進頂點色、合併成單一幾何，一個小兵含武器仍 1 個 draw call；材質「每單位一份」讓淡出不外溢。海戰再把粗糙度／金屬度烘進每頂點屬性＋shader 注入，一艘船 1 個 draw call 保住 6 種塗裝。
- **縮放**：用單一倍率（站姿 1.75 m → 場景單位；船用長度 Z），不要逐姿態用 bbox（跪姿會被拉壯）。
- **macro × detail 地表**：Poly Haven 細節貼圖高 repeat（30–120）＋ normal／arm，程序化貼圖留作 macro 層相乘；細節層先除以自身平均亮度再乘，否則整片發黑。`metal_plate` 的 diffuse 偏褐，艦體只取 nor＋arm。
- **HDRI 環境光**：桌機 PMREM 1k .hdr、手機 tonemapped JPG；只在進入該日相才下載；`environmentIntensity` 壓到 0.16–0.45（調色盤是無 IBL 校的）並相應調降半球光；切換時淡出再淡入。
- **三層 LOD**：hero（全幾何、投影）／mid（同一份幾何按 quad 抽稀、不投影、不畫枝條）／far（程序化或一般版）。`_branches` 枝條常比葉片還貴，mid 層直接不畫。
- **次像素三角形**：一根針一個三角形的植被，遠距離會整棵消失（光柵化直接丟掉次像素三角形），跟 alpha 無關；解法是把三角形重心烘成屬性，vertex shader 依距離放大三角形維持螢幕寬度（上限 14×），零額外三角形。composer 內另開 4× MSAA 或 SMAA。
- **葉片**：`alphaMode MASK` 用 `alphaTest`（0.3–0.5）不用 `transparent`，可投影、免排序；128² 貼圖一 mipmap 就被 alphaTest 吃光，要先放大 alpha。
- **CSM／GTAO 註冊**：資產載入後新增的材質要統一過一個註冊函式（shadow、envMap、roughness 下限 0.35、Physical 降級 Standard）。

## 7. 效能鐵則

- tick 內不 `new`；粒子、貼花、曳光全部池化＋InstancedMesh；靜態幾何依材質 `mergeGeometries`。
- 每次升級前後量 draw call（開 composer 後 `renderer.info` 只反映最後一個 pass，要另外直接 `renderer.render()` 一次再讀）與同步渲染幀時間（`render()` + `gl.finish()` 取中位數）。
- 背景分頁 rAF 會停，fps 量測要在前景；多代理並行時各開一個 vite 實例，否則互相整頁重載。

## 8. 驗收協定

三個時間點桌機截圖（開場、高潮、尾聲）＋手機一張、console 無錯、單元測試全綠、拖曳時間軸來回無殘留（`clearTransients`）、draw call 與首屏載入量前後對照、誠實列出「還不夠好的地方」。**以實機截圖為準，不以「程式看起來對」為準。**

## 9. 多代理施工方式

規劃者寫規格（含現況診斷截圖、逐項要求、驗收清單、執行順序），每場一個執行代理只改自己目錄，規劃者做截圖 QA 與回饋修正、統一 commit／build／push；跨戰役發現的 bug 立即寫進規格「陷阱」節並廣播給其他代理。

## 10. 免費但還沒做的下一步

真實地形（SRTM／Mapzen 公有領域高程）與 OpenStreetMap 真實街道田界；Blender Mantaflow 煙火模擬烘成序列圖；Mixamo（免費 Adobe 帳號）動作捕捉；Sketchfab CC-BY 模型（免費帳號＋致謝頁）。

*整理：Claude（Fable 5.1），2026-09-13。*
