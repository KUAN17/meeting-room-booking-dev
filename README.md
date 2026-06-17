# 會議室預約系統

GitHub Pages + Google Sheets 的輕量級會議室預約系統，無需伺服器，零費用部署。

## 功能

- **預約** — 選擇會議室、日期、時段，填寫資訊送出
- **我的預約** — 以 Email 查詢歷史預約，可取消
- **時程表** — 每日各會議室預約狀況一覽
- **離線模式** — 未設定後端時自動使用 localStorage 模擬（方便本地測試）

## 快速開始

### 1. 啟用 GitHub Pages

1. 進入 GitHub 儲存庫 **Settings > Pages**
2. Source 選 **Deploy from a branch**
3. Branch 選 `main`，目錄選 `/ (root)`
4. 儲存後約 1 分鐘即可存取：`https://<你的帳號>.github.io/meeting-room-booking/`

### 2. 設定 Google Sheets 後端（可選，若需持久化資料）

#### 建立試算表

1. 開啟 [Google Sheets](https://sheets.google.com)，建立新試算表
2. 點選「**擴充功能 > Apps Script**」
3. 刪除預設程式碼，貼入 `gas/Code.gs` 的全部內容
4. 儲存（Ctrl+S）

#### 初始化工作表

1. 在 Apps Script 編輯器，執行 `setupSheets()` 函式
2. 允許必要的權限
3. 確認試算表已出現「預約紀錄」與「會議室」兩個工作表

#### 部署為 Web App

1. 點選右上角「**部署 > 新增部署**」
2. 類型選「**網頁應用程式**」
3. 執行身分：**我**
4. 存取權限：**所有人**（必須，才能讓前端呼叫）
5. 點選「**部署**」，複製產生的 Web App URL

#### 連接前端

開啟 `src/config.js`，將 URL 填入：

```js
GAS_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
```

提交並推送後，網站即完成與 Google Sheets 的整合。

## 自訂會議室

**方法 A（不需後端）** — 修改 `src/config.js`：

```js
DEFAULT_ROOMS: [
  { id: 'R01', name: '第一會議室', capacity: 10, floor: '3F', features: ['投影機', '白板'] },
  // 新增更多…
],
```

**方法 B（有後端）** — 直接編輯 Google Sheets 的「會議室」工作表，重新整理網頁即生效。

## 自訂時段

修改 `src/config.js` 的 `TIME_SLOTS`（格式：`'HH:00'`）與 `MAX_HOURS`（最多連續預約時數）。

## 檔案結構

```
meeting-room-booking/
├── index.html          # 主頁面
├── src/
│   ├── config.js       # 設定（GAS URL、會議室、時段）
│   ├── style.css       # 樣式
│   └── app.js          # 前端邏輯
└── gas/
    └── Code.gs         # Google Apps Script 後端
```

## 技術說明

- 純原生 HTML/CSS/JS，無任何框架依賴
- Google Apps Script 作為 REST API（CORS 透過 GET 參數傳遞）
- 離線/測試模式使用 localStorage 模擬後端
- RWD 支援行動裝置
