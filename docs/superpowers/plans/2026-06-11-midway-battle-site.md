# 戰役模擬網站 + 中途島 3D 頁面 實作計畫

> **For agentic workers:** 本計畫由主工作階段直接逐任務執行(使用者 token 預算考量,
> 不採 subagent-driven)。各步驟用 checkbox 追蹤。

**Goal:** 建立靜態戰役模擬網站(入口頁 + 中途島戰役 3D 模擬頁),部署 GitHub + Cloudflare Pages。

**Architecture:** Vite 多頁建置。時間軸引擎為純邏輯模組(Vitest 測試),戰役資料為資料模組,
3D 呈現層(Three.js)讀取引擎狀態繪製。UI 層控制時間軸。

**Tech Stack:** Vite, Three.js, Vitest, 原生 JS/CSS。

---

## 檔案結構

```
package.json / vite.config.js
index.html                       主網站入口(選時期→戰役卡片)
src/site/main.js, main.css, battles.js
battles/midway/index.html        中途島頁面
src/midway/main.js               bootstrap + render loop
src/midway/data/battle.js        戰役資料(單位/航跡/事件/戰力)
src/midway/engine/timeline.js    純邏輯:位置插值、事件觸發、戰力結算
src/midway/scene/environment.js  海面 shader、天空、雲、光
src/midway/scene/terrain.js      中途島環礁
src/midway/scene/ships.js        船艦工廠(航艦/護衛/軍旗)
src/midway/scene/aircraft.js     機隊模型
src/midway/scene/effects.js      爆炸/火焰煙/魚雷航跡/曳光彈
src/midway/scene/labels.js       Sprite 文字標籤
src/midway/camera/director.js    導演運鏡
src/midway/ui/hud.js             時間列/字卡/部隊面板/圖例
tests/timeline.test.js
```

座標系:場景單位 1 = 0.1 浬;中途島於原點;船艦放大約 400 倍。
時間:以「中途島當地時間分鐘數」為時間軸刻度(6/4 00:00 = 0)。

### Task 1: 專案鷹架
- [ ] npm init、安裝 three / vite / vitest,vite.config.js 設多頁 input(index、battles/midway)
- [ ] .gitignore(node_modules, dist);`npm run build` 成功;commit

### Task 2: 時間軸引擎(TDD)
介面:
- `interpolateTrack(waypoints, t)` → `{x, z, heading}`;waypoints=`[{t, x, z}]`,線性插值,端點外取端值
- `activeEvents(events, t)` → 目前 t 已發生事件清單;`eventAt(events, prevT, t)` → 新觸發事件
- `unitStateAt(unit, t)` → `{pos, heading, status, strength}`;status 由 unit.statusChanges
  (如 `{t, status:'burning'|'sunk', strengthDelta}`)累計
- [ ] 寫失敗測試(插值中點/端點外、事件觸發邊界、戰損累計、sunk 後不再移動)
- [ ] 實作使測試通過;`npx vitest run` 全綠;commit

### Task 3: 戰役資料
- [ ] 以 NHHC / Shattered Sword 為準,網路快速核對艦載機數與關鍵時刻
- [ ] data/battle.js:單位(南雲機動部隊四航艦+護衛、TF16、TF17、中途島基地)、
      指揮官(中文+原文)、航跡、約 25 個事件(04:30 出擊 → 17:03 飛龍中彈,含前後簡述)、
      天氣區(雲層帶)、攻擊波(機隊起飛/航線/命中)
- [ ] 事件含:`{t, title, desc, camera:{target, dist}, fx:[...]}`;commit

### Task 4: 主網站入口頁
- [ ] battles.js 資料(時期「第二次世界大戰‧太平洋」→中途島卡片,預留結構)
- [ ] index.html + main.js/css:深色節目風格、卡片連到 battles/midway/;commit

### Task 5: 3D 環境
- [ ] environment.js:漸層天空 dome、程序化海面(頂點波浪+鏡面反光 shader)、
      飄移雲層(sprite 群)、平行光+霧
- [ ] terrain.js:環礁(礁盤淺藍、沙島/東島低多邊形、跑道);commit

### Task 6: 船艦與機隊
- [ ] ships.js:`createCarrier(spec)`(艦島左/右舷、甲板 canvas 貼圖:日之丸+片假名/美軍編號)、
      `createEscort(type)`(戰艦/巡洋/驅逐)、軍旗(旭日旗/星條旗 canvas)、紅藍陣營光圈、艦艏波
- [ ] aircraft.js:機隊=數架小飛機編隊 group,依攻擊波資料飛行;commit

### Task 7: 特效
- [ ] effects.js:爆炸閃光+火球、持續火焰黑煙(著火航艦)、魚雷白色航跡、
      防空曳光彈(紅/橘點射向來機)、俯衝轟炸彈道、沉沒動畫(下沉+傾斜);commit

### Task 8: 導演運鏡 + UI
- [ ] director.js:事件觸發時平滑移動攝影機至 camera.target;自由模式 OrbitControls 切換
- [ ] hud.js:頂部標題+日期時刻、底部時間軸(播放/暫停/1x2x4x/拖曳、事件刻度)、
      左右部隊面板(指揮官/艦/機數,戰損更新)、事件字卡、圖例;main.js 串接;commit

### Task 9: 瀏覽器驗證與打磨
- [ ] Claude Preview 啟動 dev server,截圖驗證:場景、時間軸播放、事件運鏡、特效、面板數字
- [ ] 修正問題;`npm run build` 確認;commit

### Task 10: 部署
- [ ] gh repo create + push
- [ ] Cloudflare Pages 設定(wrangler 或指引使用者連 GitHub);驗證上線
