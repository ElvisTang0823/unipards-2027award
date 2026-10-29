# NKS Award Overlay

## 免安裝啟動（Windows x64）

專案已附 Node.js 執行檔。將整個專案資料夾複製到另一台電腦，雙擊 `Start NKS Award.bat` 即可啟動；目標電腦不需安裝 Node.js、npm 或其他插件。請勿只複製 `server.js`，`node.exe`、`node_modules/`、`data.json` 與 `public/` 都必須保留。

啟動後可在本機開啟 `http://localhost:3000/ctrl`。若要使用外部觸發 API，請先設定 `EXT_API_TOKEN` 再從命令列啟動。

## 開發／手動啟動（需安裝 Node.js）

設定外部觸發 API 的存取 token（未設定時外部觸發 API 會拒絕請求），再啟動伺服器：

```powershell
$env:EXT_API_TOKEN = "replace-with-a-long-random-token"
node server.js
```

不需使用外部觸發 API 時，可不設定 token 直接啟動；控制台、Overlay、MC 與本機資料管理仍可使用：

```powershell
node server.js
```

## 網址

- 控制台：`http://localhost:3000/ctrl`
- OBS 下方 overlay：`http://localhost:3000/overlay?where=down`
- OBS 上方 overlay：`http://localhost:3000/overlay?where=up`
- 司儀專頁：`http://localhost:3000/mc`

伺服器啟動後會顯示區網網址，可供同一網路的設備使用。

伺服器使用 Node.js 原生 HTTP 與 `ws` WebSocket relay；控制台、Overlay 與 MC 以原生 WebSocket 連線，不載入 Socket.IO、GSAP 或 Pixi CDN。字卡觸發只傳送類型、資料 ID 與階段碼，Overlay/MC 以啟動時讀取的名單還原顯示內容。

頁面 HTML、CSS 與 JavaScript 分別維護；樣式放在 `public/css/`，程式碼放在 `public/js/`。

控制台上方可透過單一按鈕切換 Overlay 浮水印與跑馬燈；伺服器啟動時浮水印預設顯示、跑馬燈預設隱藏。緊急清空字卡時會同步隱藏跑馬燈，但不會清除浮水印。

控制台的得獎隊號與隊伍名稱平時以密碼樣式遮罩，聚焦編輯時顯示內容，離開欄位後重新遮罩。

WebSocket 只接受同源頁面連線，最多 16 個連線、每連線每秒 20 則訊息；HTTP 最多 64 個連線並限制 request timeout。外部自動化請使用具 token 驗證的 REST trigger API。

## 外部觸發 API

所有 `/api/v1/trigger/*` 請求都需要 `EXT_API_TOKEN`，以 `x-api-key` 傳送。API 只依現有 ID 觸發資料，不提供資料新增、修改或刪除操作。

```http
POST /api/v1/trigger/guest
x-api-key: your-token
Content-Type: application/json

{"id":"g1"}
```

可用路徑：`POST /api/v1/trigger/guest`、`POST /api/v1/trigger/award/envelope`、`POST /api/v1/trigger/award/lower-third`、`POST /api/v1/trigger/clear`。

## 資料與備援

伺服器啟動時讀取一次 `data.json`，控制台編輯只更新伺服器記憶體。按「儲存資料」才會寫入 `data.json`；按「儲存備份」則將目前記憶體資料另存到 `backups/`。字卡狀態不寫入 `state.json`。未手動儲存的名單修改會在伺服器重啟後消失。

字型以一年快取標頭提供；Overlay 的 Lower Third 背板由 CSS 生成，不需底圖 PNG。隊伍頭像透過同源 `/api/teams/{teamId}/avatar` API 載入；伺服器會在啟動及獎項資料更新時預熱快取，依序向 `10.0.100.5:8080`、`localhost:8080` 取得圖片並在記憶體快取 10 分鐘。Overlay 會預載獎項隊伍圖片，圖片抵達前立即顯示 `public/assets/logos/0.png`；兩個來源皆失敗時保留備用圖。