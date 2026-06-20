# 戰史檔案館 / battle-archive

3D 互動歷史戰役模擬網站。線上:https://battle-archive.pages.dev

這是「一個」統一網站:首頁(`index.html`)依時期列出所有戰役,每場戰役是站內的一個獨立子模組,共用同一套樣式與同一次部署。

## 目錄結構

```
battle_video/                  ← 專案根目錄(= 這個 git repo = 整個網站)
├─ index.html                  首頁
├─ vite.config.js              建置設定(每場戰役一個進入點)
├─ package.json
├─ public/                     靜態圖檔:各戰役 OG/橫幅/縮圖(og-*.png、banner-*.jpg、thumb-*.jpg)
├─ src/
│  ├─ site/                    首頁共用程式(battles.js 戰役清單、main.js、main.css)
│  ├─ midway/                  戰役模組:中途島
│  ├─ yamato/                  戰役模組:大和(天號作戰)
│  └─ brecourt/                戰役模組:布雷庫爾奪砲戰
├─ battles/
│  ├─ midway/index.html        各戰役頁面進入點(載入對應 src/<id>/main.js)
│  ├─ yamato/index.html
│  └─ brecourt/index.html
├─ scripts/                    產生 OG 圖等工具腳本
└─ assets-src/                 原始底圖(不進 git,僅本機產圖用)
```

**一場戰役 =** `src/<id>/`(3D 程式)+ `battles/<id>/index.html`(頁面)+ `public/` 三張圖,並在 `src/site/battles.js` 與 `vite.config.js` 兩處登記。`<id>` 是穩定的英文代號(例:`midway`、`brecourt`),與顯示名稱無關。

## 開發

```
npm install      # 第一次
npm run dev      # 本機預覽 http://localhost:5173
npm run build    # 產生 dist/
```

## 新增一場戰役(標準流程)

1. 建 `src/<id>/`,複製最接近的一場當骨架,含 `main.js`、`<id>.css`、`data/battle.js`、`data/figures.js`、`scene/*`、`ui/hud.js` 等。
2. 建 `battles/<id>/index.html`(複製現有的,改 `<title>` 與 OG meta、改成載入 `/src/<id>/main.js`)。
3. 放三張圖到 `public/`:`og-<id>.png`(1200×630)、`banner-<id>.jpg`、`thumb-<id>.jpg`(可用 `scripts/` 的產圖腳本)。
4. 在 `src/site/battles.js` 對應時期的 `battles` 陣列加一筆(`id`、`name`、`date`、`sides`、`thumb`、`summary`、`url`、`available`)。時期名稱用 ` · ` 分段(例:`第二次世界大戰 · 歐洲戰場`),首頁手機版會據此正確斷行。
5. 在 `vite.config.js` 的 `rollupOptions.input` 加 `<id>: resolve(__dirname, 'battles/<id>/index.html')`。
6. `npm run build` 確認所有頁面都產出、無錯。
7. `git commit` + `git push` → 自動部署(見下)。

**慣例(務必沿用):** 顯示用中文一律全形標點(數字之間例外)、不用破折號;血條/事件卡半透明並補 `-webkit-backdrop-filter`(iOS);艦艇/飛機/人物按真實比例。

## 部署 ── 桌機或手機都只要 push

本網站採 **push 自動部署**:對 `master` 推送後,GitHub Actions(`.github/workflows/deploy.yml`)會自動執行 `npm ci → npm run build → 部署到 Cloudflare Pages`。

> **不論桌機或手機,只要 `git commit` + `git push`,網站就會自動建置並更新上線。** 本機沒開機也沒關係。

手動備援(本機直接部署):

```
npm run build
npx wrangler pages deploy dist --project-name battle-archive
```

### 首次設定(只做一次,啟用自動部署)

在 GitHub repo `Settings → Secrets and variables → Actions → New repository secret` 新增兩個祕鑰:

| Secret 名稱 | 取得方式 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token,權限選 **Account › Cloudflare Pages › Edit**,產生後複製權杖。**只貼到 GitHub Secret,切勿寫進程式或 README。** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 帳號 ID(可在 Cloudflare 後台,或本機執行 `npx wrangler whoami` 查到) |

設好後,下一次 push 就會自動建置並部署。**在設定祕鑰之前 push 也沒關係** —— 流程會照常建置、只略過部署那一步,不會報錯。

## 重要紀律:每次改完都要 push

因為桌機與手機共用同一個 GitHub repo,**每次工作結束都要 `git commit` + `git push`**,GitHub 才會是完整正本;否則本機未推的工作,在手機上看不到、也部署不出來。
