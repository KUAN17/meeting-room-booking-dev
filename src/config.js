// ── 設定檔 ────────────────────────────────────────────────
window.APP_CONFIG = {
  GAS_URL: '',

  ROOM: { id: 'R01', name: '測試室', capacity: 10, floor: '3F', features: ['投影機', '白板'] },

  START_HOUR: 9,   // 09:00
  END_HOUR:   19,  // 19:00（最後時段 18:30~19:00）

  // 可選時長（單位：小時）
  DURATIONS: [0.5, 1, 1.5, 2, 2.5, 3],
  DEFAULT_DURATION: 1,

  BOOK_AHEAD_DAYS: 14,  // 可預約天數（今天起算）
};
