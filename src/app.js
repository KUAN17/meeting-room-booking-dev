'use strict';
const cfg = window.APP_CONFIG;

/* ── 工具 ───────────────────────────────────────────────────── */
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

function pad(n) { return String(n).padStart(2, '0'); }
function timeToMin(t) { const [h, m] = t.split(':'); return +h * 60 + +m; }
function minToTime(m) { return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }

function todayMidnight() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function fmtDateISO(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fmtDateDisplay(d) { return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}`; }

function generateSlots() {
  const slots = [];
  for (let m = cfg.START_HOUR * 60; m < cfg.END_HOUR * 60; m += 30) slots.push(minToTime(m));
  return slots;
}
const SLOTS = generateSlots();  // ['08:00','08:30',...,'17:30']
// 結束時間選項包含 18:00
const END_SLOTS = [...SLOTS.slice(1), minToTime(cfg.END_HOUR * 60)];  // ['08:30',...,'18:00']

function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function showLoading() { $('#loading-overlay').classList.remove('hidden'); }
function hideLoading() { $('#loading-overlay').classList.add('hidden'); }

/* ── 通用 Modal ─────────────────────────────────────────────── */
function showModal({ icon='', title='', body='', closeLabel='確認', cancelLabel='', onClose=null, onCancel=null }) {
  $('#modal-icon').textContent = icon;
  $('#modal-title').textContent = title;
  $('#modal-body').textContent = body;
  $('#modal-close').textContent = closeLabel;
  const cb = $('#modal-cancel');
  if (cancelLabel) {
    cb.textContent = cancelLabel;
    cb.classList.remove('hidden');
    cb.onclick = () => { hideGenericModal(); if (onCancel) onCancel(); };
  } else {
    cb.classList.add('hidden');
  }
  $('#modal-close').onclick = () => { hideGenericModal(); if (onClose) onClose(); };
  $('#modal-overlay').classList.remove('hidden');
}
function hideGenericModal() { $('#modal-overlay').classList.add('hidden'); }

/* ── API（全部使用 GET，避免 CORS preflight）─────────────────── */
async function apiGet(action, params = {}) {
  if (!cfg.GAS_URL) return mockApi(action, params);
  const url = new URL(cfg.GAS_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  url.searchParams.set('_t', Date.now());  // 防止瀏覽器快取
  const res = await fetch(url.toString(), { redirect: 'follow' });
  if (!res.ok) throw new Error(`伺服器錯誤 (${res.status})`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error('GAS 回應內容：', text);
    throw new Error('GAS 回應格式錯誤，請確認已重新部署最新版 Code.gs');
  }
}

/* ── 模擬後端 ────────────────────────────────────────────────── */
const mockDB = { bookings: JSON.parse(localStorage.getItem('mock_bk') || '[]') };
function saveMock() { localStorage.setItem('mock_bk', JSON.stringify(mockDB.bookings)); }

async function mockApi(action, p) {
  await new Promise(r => setTimeout(r, 150));
  if (action === 'getWeekBookings') {
    return { ok: true, bookings: mockDB.bookings.filter(b =>
      b.status !== 'cancelled' &&
      b.date >= p.startDate && b.date <= p.endDate &&
      (!p.roomId || b.roomId === p.roomId)
    )};
  }
  if (action === 'getBookings') {
    return { ok: true, bookings: mockDB.bookings.filter(b =>
      b.status !== 'cancelled' &&
      (!p.date   || b.date   === p.date) &&
      (!p.roomId || b.roomId === p.roomId)
    )};
  }
  if (action === 'getMyBookings') {
    return { ok: true, bookings: mockDB.bookings.filter(b => b.empId === p.empId) };
  }
  if (action === 'createBooking') {
    const conflict = mockDB.bookings.some(b =>
      b.status !== 'cancelled' && b.date === p.date && b.roomId === p.roomId &&
      p.startTime < b.endTime && p.endTime > b.startTime
    );
    if (conflict) return { ok: false, error: '所選時段與現有預約衝突' };
    const id = 'BK' + Date.now();
    mockDB.bookings.push({ id, status: 'active', ...p });
    saveMock();
    return { ok: true, bookingId: id };
  }
  if (action === 'cancelBooking') {
    const idx = mockDB.bookings.findIndex(b => b.id === p.id && b.empId === p.empId);
    if (idx === -1) return { ok: false, error: '找不到預約或員工編號不符' };
    mockDB.bookings[idx].status = 'cancelled';
    saveMock();
    return { ok: true };
  }
  if (action === 'updateBooking') {
    const idx = mockDB.bookings.findIndex(b => b.id === p.id && b.empId === p.empId);
    if (idx === -1) return { ok: false, error: '找不到預約或員工編號不符' };
    const conflict = mockDB.bookings.some(b =>
      b.id !== p.id && b.status !== 'cancelled' &&
      b.date === p.date && b.roomId === p.roomId &&
      p.startTime < b.endTime && p.endTime > b.startTime
    );
    if (conflict) return { ok: false, error: '所選時段與現有預約衝突' };
    Object.assign(mockDB.bookings[idx], {
      date: p.date, startTime: p.startTime, endTime: p.endTime,
      name: p.name, dept: p.dept, note: p.note,
    });
    saveMock();
    return { ok: true };
  }
  return { ok: false, error: 'unknown' };
}

/* ── 記憶預約人資訊 ──────────────────────────────────────────── */
const MEMORY_KEY = 'bk_user';
function loadMemory() {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}'); } catch { return {}; }
}
function saveMemory(name, empId, dept) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify({ name, empId, dept }));
}

/* ── 狀態 ───────────────────────────────────────────────────── */
const state = {
  weekMonday:   getMondayOf(new Date()),
  weekBookings: {},  // { 'YYYY-MM-DD': [...] }
  bm: { date: null, startTime: null, endTime: null },
};

/* ── 導覽 ───────────────────────────────────────────────────── */
function navigate(view) {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
}

/* ── 截止日計算（今日起算 +2 個工作日，排除週六日）──────────── */
function getDeadlineISO() {
  const d = todayMidnight();
  let added = 0;
  while (added < 2) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;   // 略過週日(0)與週六(6)
  }
  return fmtDateISO(d);
}

/* ── 週曆：載入 ──────────────────────────────────────────────── */
function getWeekDates(monday) {
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday); d.setDate(d.getDate() + i); return d;
  });
}

async function fetchAndStore(dates) {
  const startDate = fmtDateISO(dates[0]);
  const endDate   = fmtDateISO(dates[4]);
  try {
    const res = await apiGet('getWeekBookings', { startDate, endDate, roomId: cfg.ROOM.id });
    const all = res.bookings || [];
    dates.forEach(d => {
      const iso = fmtDateISO(d);
      state.weekBookings[iso] = all.filter(b => b.date === iso);
    });
  } catch {
    dates.forEach(d => { state.weekBookings[fmtDateISO(d)] = []; });
  }
}

// 切換週（使用者主動操作）：清空畫面 + 顯示 loading
async function loadWeek(monday) {
  state.weekMonday = monday;
  updateWeekLabel();
  $('#week-grid').innerHTML = '<div class="loading-box">載入中…</div>';
  showLoading();
  const dates = getWeekDates(monday);
  await fetchAndStore(dates);
  hideLoading();
  renderWeekGrid(dates);
}

// 存檔後靜默刷新：畫面不閃、不顯示 spinner，資料到了直接更新
async function silentRefreshWeek() {
  const dates = getWeekDates(state.weekMonday);
  await fetchAndStore(dates);
  renderWeekGrid(dates);
}

function updateWeekLabel() {
  const fri = new Date(state.weekMonday);
  fri.setDate(fri.getDate() + 4);
  const m = state.weekMonday;
  $('#w-label').textContent =
    `${m.getFullYear()}/${pad(m.getMonth()+1)}/${pad(m.getDate())}（週一）` +
    ` ～ ${pad(fri.getMonth()+1)}/${pad(fri.getDate())}（週五）`;
}

/* ── 週曆：渲染 ──────────────────────────────────────────────── */
const weekBookingMap = {};  // id → booking，供點擊格子時取用

function renderWeekGrid(dates) {
  const now      = new Date();
  const todayISO = fmtDateISO(todayMidnight());
  const nowMin   = now.getHours() * 60 + now.getMinutes();
  const DAY_NAMES = ['週一','週二','週三','週四','週五'];

  // 截止日 = 今日起算 +2 個工作日（排除週六日）
  const deadlineISO = getDeadlineISO();

  // 更新說明文字（保留實際日期）
  const dl = new Date(deadlineISO + 'T00:00:00');
  $('#w-deadline-notice').textContent =
    `可預約時段：今日起至 ${pad(dl.getMonth()+1)}/${pad(dl.getDate())} (D+2)`;

  // 更新下週按鈕：若下週一已超出截止日則 disable
  const nextMonday = new Date(state.weekMonday);
  nextMonday.setDate(nextMonday.getDate() + 7);
  $('#w-next').disabled = fmtDateISO(nextMonday) > deadlineISO;
  $('#w-next').style.opacity = $('#w-next').disabled ? '0.35' : '';

  const consumedByDay = dates.map(() => new Set());
  const bookingStart  = dates.map(() => ({}));

  // 清空並重建 booking map
  Object.keys(weekBookingMap).forEach(k => delete weekBookingMap[k]);

  dates.forEach((date, di) => {
    const bks = state.weekBookings[fmtDateISO(date)] || [];
    bks.forEach(b => { weekBookingMap[b.id] = b; });  // 存入 map
    SLOTS.forEach(slot => {
      if (consumedByDay[di].has(slot)) return;
      const slotM = timeToMin(slot);
      const bk = bks.find(b => timeToMin(b.startTime) <= slotM && timeToMin(b.endTime) > slotM);
      if (!bk) return;
      bookingStart[di][slot] = bk;
      const endM = timeToMin(bk.endTime);
      SLOTS.forEach(s => { if (timeToMin(s) > slotM && timeToMin(s) < endM) consumedByDay[di].add(s); });
    });
  });

  const headerCells = dates.map((d, i) => {
    const iso     = fmtDateISO(d);
    const isToday = iso === todayISO;
    return `<th class="${isToday ? 'today-col' : ''}">
      <span class="day-name">${DAY_NAMES[i]}</span>
      <span class="day-date">${pad(d.getMonth()+1)}/${pad(d.getDate())}</span>
    </th>`;
  }).join('');

  const bodyRows = SLOTS.map((slot) => {
    const slotM  = timeToMin(slot);
    const isHour = slotM % 60 === 0;
    const timeCell = `<td class="time-cell${isHour ? ' hour-line' : ''}">${isHour ? slot : ''}</td>`;

    const dayCells = dates.map((date, di) => {
      const iso = fmtDateISO(date);
      if (consumedByDay[di].has(slot)) return '';
      const bk = bookingStart[di][slot];
      if (bk) {
        const endM    = timeToMin(bk.endTime);
        const rowspan = Math.round((endM - slotM) / 30);
        const isPast  = iso < todayISO || (iso === todayISO && slotM < nowMin);
        return `<td class="slot-booked${isPast ? ' past' : ''}${isHour ? ' hour-line' : ''}"
                    rowspan="${rowspan}" data-bk-id="${bk.id}">
          <div class="booked-name">${bk.name}</div>
          <div class="booked-dept">${bk.dept || ''}</div>
          <div class="booked-time">${bk.startTime}–${bk.endTime}</div>
        </td>`;
      }
      const isToday  = iso === todayISO;
      const isPast   = iso < todayISO || (iso === todayISO && slotM < nowMin);
      const isTooFar = iso > deadlineISO;
      return `<td class="slot-empty${(isPast || isTooFar) ? ' past' : ''}${isHour ? ' hour-line' : ''}${isToday ? ' today-col' : ''}"
                  data-date="${iso}" data-time="${slot}"></td>`;
    }).join('');

    return `<tr>${timeCell}${dayCells}</tr>`;
  }).join('');

  $('#week-grid').innerHTML = `
    <table class="week-table">
      <colgroup><col class="col-time">${dates.map(() => '<col>').join('')}</colgroup>
      <thead><tr><th></th>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;

  // 空格 → 新增預約
  $$('.slot-empty:not(.past)', $('#week-grid')).forEach(td => {
    td.addEventListener('click', () => openBookingModal(td.dataset.date, td.dataset.time));
  });

  // 灰色空格 → 提示不可預約
  $$('.slot-empty.past', $('#week-grid')).forEach(td => {
    td.addEventListener('click', () => {
      const dl = new Date(deadlineISO + 'T00:00:00');
      const msg = td.dataset.date < todayISO
        ? '此時段已過期，無法預約。'
        : `超出可預約範圍，僅開放至 ${pad(dl.getMonth()+1)}/${pad(dl.getDate())}（今日起 +2 個工作日）。`;
      showModal({ icon: '🚫', title: '無法預約', body: msg });
    });
  });

  // 已預約格子 → 編輯
  $$('.slot-booked:not(.past)', $('#week-grid')).forEach(td => {
    td.addEventListener('click', () => {
      const bk = weekBookingMap[td.dataset.bkId];
      if (bk) openEditModal(bk);
    });
  });
}

/* ── 預約 Modal ─────────────────────────────────────────────── */
function openBookingModal(date, startTime) {
  state.bm.date      = date;
  state.bm.startTime = startTime;
  state.bm.endTime   = minToTime(timeToMin(startTime) + 60);  // 預設 +1 小時

  // 日期標題
  const d = new Date(date + 'T00:00:00');
  const dayNames = ['日','一','二','三','四','五','六'];
  $('#bm-date-label').textContent = `${fmtDateDisplay(d)}（週${dayNames[d.getDay()]}）`;

  // 帶入記憶資訊
  const mem = loadMemory();
  if (mem.name)  $('#f-name').value  = mem.name;
  if (mem.empId) $('#f-empid').value = mem.empId;
  if (mem.dept)  $('#f-dept').value  = mem.dept;

  $('#f-note').value = '';
  $('#bm-msg').textContent = '';

  buildTimeSelects();
  $('#bm-overlay').classList.remove('hidden');
}

function closeBmModal() { $('#bm-overlay').classList.add('hidden'); }

/* 找最近衝突的開始時間（分鐘），用來限制結束時間上限 */
function getConflictLimit(startMin) {
  const bks = state.weekBookings[state.bm.date] || [];
  let limit = cfg.END_HOUR * 60;
  bks.forEach(b => {
    const bStart = timeToMin(b.startTime);
    if (bStart > startMin) limit = Math.min(limit, bStart);
  });
  return limit;
}

function buildTimeSelects() {
  const startSel = $('#bm-start-sel');
  const endSel   = $('#bm-end-sel');

  // ── 開始時間選單（標記已佔用時段）──
  const bks = state.weekBookings[state.bm.date] || [];
  startSel.innerHTML = SLOTS.map(s => {
    const sMin = timeToMin(s);
    const busy = bks.some(b => timeToMin(b.startTime) <= sMin && sMin < timeToMin(b.endTime));
    return `<option value="${s}" ${s === state.bm.startTime ? 'selected' : ''} ${busy ? 'disabled' : ''}>${s}${busy ? '（已被佔用）' : ''}</option>`;
  }).join('');
  // 若預設開始時間剛好落在佔用區間，改選下一個可用時段
  if (startSel.options[startSel.selectedIndex]?.disabled) {
    const first = [...startSel.options].find(o => !o.disabled);
    if (first) { startSel.value = first.value; state.bm.startTime = first.value; }
  }

  // ── 結束時間選單（依開始時間動態更新）──
  function refreshEndSel() {
    const startMin = timeToMin(startSel.value);
    const limitMin = getConflictLimit(startMin);

    endSel.innerHTML = END_SLOTS
      .filter(s => timeToMin(s) > startMin && timeToMin(s) <= limitMin)
      .map(s => `<option value="${s}" ${s === state.bm.endTime ? 'selected' : ''}>${s}</option>`)
      .join('');

    // 若目前 endTime 超出限制，自動調整
    if (!endSel.value || timeToMin(endSel.value) > limitMin) {
      // 選 startMin+60 或最大可用
      const preferred = minToTime(startMin + 60);
      const opts = [...endSel.options].map(o => o.value);
      endSel.value = opts.includes(preferred) ? preferred : opts[opts.length - 1] || '';
    }
    state.bm.endTime = endSel.value;

    // 衝突提示
    const warn = $('#dur-warn');
    if (limitMin < cfg.END_HOUR * 60) {
      warn.textContent = `${minToTime(limitMin)} 起已有他人預約，結束時間最晚可選至 ${minToTime(limitMin)}`;
      warn.classList.remove('hidden');
    } else {
      warn.classList.add('hidden');
    }
  }

  refreshEndSel();

  startSel.onchange = () => {
    state.bm.startTime = startSel.value;
    refreshEndSel();
  };
  endSel.onchange = () => {
    state.bm.endTime = endSel.value;
  };
}

/* ── 送出預約 ───────────────────────────────────────────────── */
function initBmForm() {
  $('#bm-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name  = $('#f-name').value.trim();
    const empId = $('#f-empid').value.trim();
    const dept  = $('#f-dept').value.trim();
    const note  = $('#f-note').value.trim();

    if (!name || !empId) { setMsg('請填寫姓名與員工編號', 'error'); return; }
    if (!dept) { setMsg('請選擇部門', 'error'); return; }

    const startTime = $('#bm-start-sel').value;
    const endTime   = $('#bm-end-sel').value;
    if (!startTime || !endTime || timeToMin(endTime) <= timeToMin(startTime)) {
      setMsg('請確認時間設定正確', 'error'); return;
    }

    showLoading();
    try {
      const res = await apiGet('createBooking', {
        roomId:   cfg.ROOM.id,
        roomName: cfg.ROOM.name,
        date:     state.bm.date,
        startTime, endTime,
        name, empId, dept, note,
      });
      hideLoading();
      if (res.ok) {
        saveMemory(name, empId, dept);
        closeBmModal();
        showModal({
          icon: '✅', title: '預約成功！',
          body: `${cfg.ROOM.name} ${state.bm.date} ${startTime}–${endTime}`,
          onClose: () => silentRefreshWeek(),
        });
      } else {
        setMsg(res.error || '預約失敗，請稍後再試', 'error');
      }
    } catch (err) {
      hideLoading(); setMsg(err.message, 'error');
    }
  });
}
function setMsg(txt, type = '') {
  const el = $('#bm-msg');
  el.textContent = txt;
  el.className = 'form-msg' + (type ? ' ' + type : '');
}

/* ── 我的預約 ───────────────────────────────────────────────── */
let myBookingsList = [];  // 存最新查詢結果供編輯用

function initMyBookings() {
  $('#query-btn').addEventListener('click', doQuery);
  $('#query-empid').addEventListener('keydown', e => { if (e.key === 'Enter') doQuery(); });
}
async function doQuery() {
  const empId = $('#query-empid').value.trim();
  if (!empId) return;
  showLoading();
  try {
    const res = await apiGet('getMyBookings', { empId });
    hideLoading();
    myBookingsList = res.bookings || [];
    renderMyList(myBookingsList);
  } catch (err) {
    hideLoading();
    $('#my-list').innerHTML = `<p style="color:var(--gray-400);font-size:.9rem">查詢失敗：${err.message}</p>`;
  }
}

function renderMyList(bks) {
  const el = $('#my-list');
  if (bks.length === 0) {
    el.innerHTML = `<div class="empty-state">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
      </svg><p>查無預約紀錄</p></div>`;
    return;
  }
  const todayISO = fmtDateISO(todayMidnight());
  el.innerHTML = bks.map((b, idx) => {
    const isPast  = b.date < todayISO;
    const status  = b.status === 'cancelled' ? 'cancelled' : isPast ? 'past' : 'active';
    const label   = { cancelled: '已取消', past: '已結束', active: '有效' }[status];
    return `<div class="booking-item">
      <div>
        <div class="booking-item-title">${b.date} ${b.startTime}–${b.endTime}</div>
        <div class="booking-item-meta">
          <span>👤 ${b.name}${b.dept ? '・' + b.dept : ''}</span>
          <span>🆔 ${b.empId}</span>
          ${b.note ? `<span>📝 ${b.note}</span>` : ''}
        </div>
      </div>
      <div class="booking-item-actions">
        <span class="badge badge-${status}">${label}</span>
        ${status === 'active' ? `
          <button class="btn btn-outline btn-sm" data-action="edit"   data-idx="${idx}">編輯</button>
          <button class="btn btn-outline btn-sm" data-action="cancel" data-idx="${idx}">取消</button>
        ` : ''}
      </div>
    </div>`;
  }).join('');

  $$('[data-action="edit"]', el).forEach(btn => {
    btn.addEventListener('click', () => {
      openEditModal(myBookingsList[+btn.dataset.idx], true);
    });
  });
  $$('[data-action="cancel"]', el).forEach(btn => {
    btn.addEventListener('click', () => {
      const bk = myBookingsList[+btn.dataset.idx];
      showModal({
        icon: '⚠️', title: '確定取消預約？', body: '取消後無法復原。',
        cancelLabel: '返回', onCancel: () => {},
        closeLabel: '確定取消',
        onClose: async () => {
          showLoading();
          try {
            const res = await apiGet('cancelBooking', { id: bk.id, empId: bk.empId });
            hideLoading();
            if (res.ok) { doQuery(); silentRefreshWeek(); }
            else showModal({ icon: '❌', title: '取消失敗', body: res.error });
          } catch (err) { hideLoading(); showModal({ icon: '❌', title: '錯誤', body: err.message }); }
        },
      });
    });
  });
}

/* ── 編輯 Modal ─────────────────────────────────────────────── */
const emState = {
  id: null, empId: null, roomId: null,
  date: null, startTime: null, endTime: null,
  bookingsCache: {},
};

function openEditModal(bk, autoFill = false) {
  emState.id        = bk.id;
  emState.empId     = bk.empId;
  emState.roomId    = bk.roomId || cfg.ROOM.id;
  emState.date      = bk.date;
  emState.startTime = bk.startTime;
  emState.endTime   = bk.endTime;
  emState.bookingsCache = {};

  $('#em-name').value         = bk.name;
  $('#em-empid').value        = bk.empId;
  $('#em-empid-verify').value = autoFill ? bk.empId : '';

  // 從「我的預約」進入：隱藏驗證欄位；從週曆進入：顯示
  const verifyRow = $('#em-empid-verify').closest('.form-group');
  verifyRow.style.display = autoFill ? 'none' : '';

  $('#em-dept').value         = bk.dept || '';
  $('#em-note').value         = bk.note || '';
  $('#em-msg').textContent    = '';

  buildEditDateSel();
  $('#em-overlay').classList.remove('hidden');
}

function closeEditModal() { $('#em-overlay').classList.add('hidden'); }

function buildEditDateSel() {
  const t = todayMidnight();
  const deadlineISO = getDeadlineISO();
  const DAY_NAMES = ['日','一','二','三','四','五','六'];
  const opts = [];
  for (let i = 0; ; i++) {
    const d = new Date(t);
    d.setDate(t.getDate() + i);
    if (fmtDateISO(d) > deadlineISO) break;
    const iso = fmtDateISO(d);
    opts.push(`<option value="${iso}" ${iso === emState.date ? 'selected' : ''}>` +
      `${fmtDateDisplay(d)}（週${DAY_NAMES[d.getDay()]}）</option>`);
  }
  $('#em-date-sel').innerHTML = opts.join('');
  loadEditBookingsAndBuildTime(emState.date);
  $('#em-date-sel').onchange = () => {
    emState.date = $('#em-date-sel').value;
    loadEditBookingsAndBuildTime(emState.date);
  };
}

async function loadEditBookingsAndBuildTime(date) {
  if (!emState.bookingsCache[date]) {
    showLoading();
    try {
      const res = await apiGet('getBookings', { date, roomId: emState.roomId });
      // 排除自己，才能正確判斷衝突
      emState.bookingsCache[date] = (res.bookings || []).filter(b => b.id !== emState.id);
    } catch { emState.bookingsCache[date] = []; }
    finally { hideLoading(); }
  }
  buildEditTimeSelects(emState.bookingsCache[date]);
}

function buildEditTimeSelects(otherBks) {
  const startSel = $('#em-start-sel');
  const endSel   = $('#em-end-sel');

  function getLimit(startMin) {
    let limit = cfg.END_HOUR * 60;
    otherBks.forEach(b => {
      const s = timeToMin(b.startTime);
      if (s > startMin) limit = Math.min(limit, s);
    });
    return limit;
  }

  // ── 開始時間選單（標記已佔用時段）──
  startSel.innerHTML = SLOTS.map(s => {
    const sMin = timeToMin(s);
    const busy = otherBks.some(b => timeToMin(b.startTime) <= sMin && sMin < timeToMin(b.endTime));
    return `<option value="${s}" ${s === emState.startTime ? 'selected' : ''} ${busy ? 'disabled' : ''}>${s}${busy ? '（已被佔用）' : ''}</option>`;
  }).join('');

  function refreshEndSel() {
    const startMin = timeToMin(startSel.value);
    const limitMin = getLimit(startMin);
    endSel.innerHTML = END_SLOTS
      .filter(s => timeToMin(s) > startMin && timeToMin(s) <= limitMin)
      .map(s => `<option value="${s}" ${s === emState.endTime ? 'selected' : ''}>${s}</option>`)
      .join('');
    if (!endSel.value) {
      const preferred = minToTime(startMin + 60);
      const opts = [...endSel.options].map(o => o.value);
      endSel.value = opts.includes(preferred) ? preferred : opts[opts.length - 1] || '';
    }
    emState.endTime = endSel.value;
    const warn = $('#em-dur-warn');
    if (limitMin < cfg.END_HOUR * 60) {
      warn.textContent = `${minToTime(limitMin)} 起已有他人預約，結束時間最晚可選至 ${minToTime(limitMin)}`;
      warn.classList.remove('hidden');
    } else { warn.classList.add('hidden'); }
  }

  refreshEndSel();
  startSel.onchange = () => { emState.startTime = startSel.value; refreshEndSel(); };
  endSel.onchange   = () => { emState.endTime = endSel.value; };
}

function initEditForm() {
  $('#em-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name      = $('#em-name').value.trim();
    const dept      = $('#em-dept').value.trim();
    const note      = $('#em-note').value.trim();
    const date      = $('#em-date-sel').value;
    const startTime = $('#em-start-sel').value;
    const endTime   = $('#em-end-sel').value;

    const empIdVerify = $('#em-empid-verify').value.trim();
    if (!name) { setEditMsg('請填寫姓名', 'error'); return; }
    if (!dept) { setEditMsg('請選擇部門', 'error'); return; }
    if (!empIdVerify) { setEditMsg('請輸入員工編號以確認身份', 'error'); return; }
    if (empIdVerify !== emState.empId) { setEditMsg('員工編號不符，無法儲存', 'error'); return; }
    if (timeToMin(endTime) <= timeToMin(startTime)) { setEditMsg('結束時間須晚於開始時間', 'error'); return; }

    showLoading();
    try {
      const res = await apiGet('updateBooking', {
        id: emState.id, empId: emState.empId, roomId: emState.roomId,
        date, startTime, endTime, name, dept, note,
      });
      hideLoading();
      if (res.ok) {
        saveMemory(name, emState.empId, dept);
        closeEditModal();
        showModal({
          icon: '✅', title: '修改成功！',
          body: `已更新為 ${date} ${startTime}–${endTime}`,
          onClose: () => { doQuery(); silentRefreshWeek(); },
        });
      } else {
        setEditMsg(res.error || '修改失敗', 'error');
      }
    } catch (err) { hideLoading(); setEditMsg(err.message, 'error'); }
  });
}
function setEditMsg(txt, type = '') {
  const el = $('#em-msg');
  el.textContent = txt;
  el.className = 'form-msg' + (type ? ' ' + type : '');
}

/* ── 初始化 ─────────────────────────────────────────────────── */
function init() {
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
  $('#w-prev').addEventListener('click', () => {
    const m = new Date(state.weekMonday); m.setDate(m.getDate() - 7); loadWeek(m);
  });
  $('#w-next').addEventListener('click', () => {
    const m = new Date(state.weekMonday); m.setDate(m.getDate() + 7); loadWeek(m);
  });
  $('#w-today').addEventListener('click', () => loadWeek(getMondayOf(new Date())));
  $('#bm-close-x').addEventListener('click', closeBmModal);
  $('#bm-cancel-btn').addEventListener('click', closeBmModal);
  $('#bm-overlay').addEventListener('click', e => { if (e.target === $('#bm-overlay')) closeBmModal(); });
  $('#em-close-x').addEventListener('click', closeEditModal);
  $('#em-cancel-btn').addEventListener('click', closeEditModal);
  $('#em-overlay').addEventListener('click', e => { if (e.target === $('#em-overlay')) closeEditModal(); });
  $('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) hideGenericModal(); });
  $('#usage-toggle').addEventListener('click', () => {
    const cards = $('#usage-cards');
    const btn   = $('#usage-toggle');
    const open  = cards.classList.toggle('hidden') === false;
    btn.classList.toggle('open', open);
    btn.textContent = open ? '✕ 收起說明' : '❓ 操作說明';
  });
  initBmForm();
  initEditForm();
  initMyBookings();
  loadWeek(getMondayOf(new Date()));
}

document.addEventListener('DOMContentLoaded', init);
