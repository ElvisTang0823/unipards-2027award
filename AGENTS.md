# 專案開發指引

## 專案結構

- `server.js` 使用 Node.js 原生 HTTP 與 `ws` 提供控制台 API、WebSocket relay 及靜態檔案。
- `public/ctrl.html`、`public/overlay.html`、`public/mc.html` 分別是控制台、OBS 字卡及司儀頁面。
- 頁面樣式放在 `public/css/`，頁面程式碼放在 `public/js/`；HTML 僅放頁面結構，不新增內嵌 `<style>`、`<script>`、`style` 屬性或 inline 事件處理器。
- 資料由 `data.json` 提供；修改資料結構或 API 時，需同步檢查控制台、Overlay、司儀頁面及 README。

## 開發慣例

- 沿用原生 HTML、CSS、JavaScript 與 Node.js，不為簡單頁面功能加入框架或 CDN 依賴。
- Overlay 的隊伍頭像透過同源 `/api/teams/{teamId}/avatar` API 載入；伺服器會在啟動及獎項資料更新時預熱快取，依序向 `10.0.100.5:8080`、`localhost:8080` 取得圖片並在記憶體快取 10 分鐘。Overlay 同時預載獎項隊伍圖片，圖片抵達前立即顯示 `public/assets/logos/0.png`；兩個來源皆失敗時保留備用圖。
- 浮水印透過控制台的單一切換按鈕同步控制，伺服器啟動時預設顯示；緊急清空字卡不更動浮水印狀態。
- 跑馬燈透過控制台上方的單一切換按鈕控制；緊急清空會同步隱藏跑馬燈。
- 保留伺服器的同源 WebSocket、外部 API token 驗證及資料明確儲存行為。
- 只修改任務相關內容，避免覆蓋工作目錄中既有的未提交變更。

## 執行與驗證

- 安裝 Node.js 的開發環境可執行 `node server.js` 啟動；Windows 免安裝啟動使用 `Start NKS Award.bat`。
- `package.json` 目前沒有實際測試套件；變更後至少檢查 JavaScript 語法，並以瀏覽器或本機 HTTP 請求確認相關頁面與資產可載入。
