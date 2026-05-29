// ╔════════════════════════════════════════════════════════════╗
// ║  OCBS Margin Calculator – Frontend logic                  ║
// ╚════════════════════════════════════════════════════════════╝

const STATE = {
  master: {},        // {SYM: {name, exch, r, ts}}
  caps:   {},        // {SYM: {high, low}}
  prices: {},        // {SYM: {price, change, changePct}}
  holdings: [],      // 10 rows: {sym, qty, price, capUsed, r}
};

const fmtVND = n => (n==null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('vi-VN');
const getFb       = () => (+$('pFb').value       || 0.15) / 100;
const getFs       = () => getFb() + 0.001;
const getMaxLoan  = () => +($('pMaxLoan')?.value)   || 81e9;
const fmtPct = n => (n==null || isNaN(n)) ? '—' : (n*100).toFixed(2) + '%';
const fmtNum = n => (n==null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('vi-VN');
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Numeric input with thousand separators ─────────────────
const parseNum = v => {
  if (v == null) return 0;
  const s = String(v).replace(/[^\d-]/g, '');
  return s ? +s : 0;
};
const fmtNumInput = n => {
  if (n == null || isNaN(n)) return '';
  return Math.round(n).toLocaleString('vi-VN');
};
const setNumVal = (el, n) => { if (el) el.value = fmtNumInput(n); };
const getNumVal = id => parseNum($(id)?.value);

// Live format [data-num] inputs while preserving caret position
document.addEventListener('input', e => {
  const t = e.target;
  if (!t.matches || !t.matches('input[data-num]')) return;
  const before = t.value;
  const caret = t.selectionStart || 0;
  const digitsBefore = (before.slice(0, caret).match(/\d/g) || []).length;
  const num = parseNum(before);
  const formatted = num === 0 && before.trim() === '' ? '' : num.toLocaleString('vi-VN');
  if (formatted !== before) {
    t.value = formatted;
    let pos = 0, seen = 0;
    while (pos < formatted.length && seen < digitsBefore) {
      if (/\d/.test(formatted[pos])) seen++;
      pos++;
    }
    try { t.setSelectionRange(pos, pos); } catch(_) {}
  }
}, true);

// Format initial values for any [data-num] inputs currently in DOM
function formatNumInputs(root = document) {
  root.querySelectorAll('input[data-num]').forEach(el => {
    const raw = el.value.trim();
    if (!raw) return;
    const n = parseNum(raw);
    el.value = isNaN(n) ? raw : n.toLocaleString('vi-VN');
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => formatNumInputs());
} else {
  formatNumInputs();
}

// ── Tabs ───────────────────────────────────────────────────
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.panel').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  document.querySelector(`.panel[data-panel="${t.dataset.tab}"]`).classList.add('active');
  if (t.dataset.tab === 'caps') renderCaps();
  if (t.dataset.tab === 'muonhang') recalcMuon();
  if (t.dataset.tab === 'viphm') renderSellTable();
});

// ── Load master + caps ─────────────────────────────────────
async function loadMaster() {
  let d = null;
  for (const url of ['/api/stocks', 'stocks.json']) {
    try { const r = await fetch(url); if (r.ok) { d = await r.json(); break; } } catch(_) {}
  }
  if (!d) { $('hdrInfo').textContent = '⚠️ Không tải được master list'; return; }
  STATE.master = d.stocks || {};
  if ($('listDate')) $('listDate').textContent = `Danh mục áp dụng: ${d.updated || '—'}  (${d.count||0} mã)`;
  if ($('listCount')) $('listCount').textContent = d.count || Object.keys(STATE.master).length;
  $('hdrInfo').textContent = `${d.count || 0} mã CK · cập nhật ${d.updated || '—'}`;
}
async function loadCaps() {
  for (const url of ['/api/caps', 'caps.json']) {
    try { const r = await fetch(url); if (r.ok) { STATE.caps = await r.json(); return; } } catch(_) {}
  }
  STATE.caps = {};
}
async function saveCaps() {
  await fetch('/api/caps', {method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify(STATE.caps)});
  $('capInfo').textContent = `✓ Đã lưu ${Object.keys(STATE.caps).length} mã`;
  setTimeout(()=>$('capInfo').textContent='', 3000);
}

// ── Giá tham chiếu hôm nay (đọc từ prices.json, cập nhật 1 lần/ngày) ─
async function loadPrices() {
  try {
    // Thử backend (server.py) trước, fallback file tĩnh trong cùng folder
    let d = null;
    try { const r = await fetch('/prices.json'); if (r.ok) d = await r.json(); } catch(_) {}
    if (!d) { const r = await fetch('prices.json'); if (r.ok) d = await r.json(); }
    if (!d) throw new Error('prices.json không tải được');
    for (const [sym, price] of Object.entries(d.prices || {})) {
      STATE.prices[sym] = { price, ref: price };
    }
    if ($('hdrInfo')) {
      const cur = $('hdrInfo').textContent;
      $('hdrInfo').textContent = `${cur} · Giá TC ${d.tradingDate || d.updated || '?'}`;
    }
  } catch(e) { console.warn('loadPrices', e); }
}

async function fetchPrice(sym) {
  if (!sym) return null;
  sym = sym.toUpperCase().trim();
  return STATE.prices[sym] || null;
}

function getR(sym) {
  const m = STATE.master[(sym||'').toUpperCase()];
  return m ? m.r : 0.5;
}
function getCapHigh(sym) {
  const s = (sym||'').toUpperCase();
  // Ưu tiên user override (caps.json/localStorage), fallback giá chặn từ PL1 (master.cap)
  const u = STATE.caps[s];
  if (u && u.high) return u.high;
  const m = STATE.master[s];
  return (m && m.cap) ? m.cap : null;
}
function getStockLimit(sym) {
  const m = STATE.master[(sym||'').toUpperCase()];
  return (m && m.limit) ? m.limit : null;
}
// Hiện/ẩn dòng cảnh báo chạm Hạn mức tối đa 1 mã (limit).
// rowId/warnId: id dòng + ô text. capped: true nếu dư nợ đã bị kẹp. lim: trần. raw: dư nợ trước kẹp.
function showLimitWarn(rowId, warnId, capped, lim, raw) {
  const row = $(rowId), warn = $(warnId);
  if (!row || !warn) return;
  if (capped) {
    row.style.display = '';
    warn.textContent = `Trần ${fmtVND(lim)} (lý thuyết ${fmtVND(raw)})`;
  } else {
    row.style.display = 'none';
    warn.textContent = '';
  }
}
// Giá đánh giá = MIN(giá TT, giá chặn trên). Nếu chặn null → dùng giá TT
function evalPrice(sym, marketPrice) {
  const cap = getCapHigh(sym);
  return cap ? Math.min(marketPrice, cap) : marketPrice;
}

// ╔════════════════ TAB 1: Rtt & Danh mục ════════════════════╗
function initHoldingsTable() {
  const tb = $('tblHoldings').querySelector('tbody');
  tb.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i+1}</td>
      <td><input type="text" data-i="${i}" data-f="sym" placeholder=""></td>
      <td><input type="text" inputmode="numeric" data-num data-i="${i}" data-f="qty" value="0"></td>
      <td><input type="text" inputmode="numeric" data-num data-i="${i}" data-f="price" value="0"></td>
      <td class="calc" data-i="${i}" data-f="evalPrice">0</td>
      <td><input type="number" data-i="${i}" data-f="r" value="0.5" min="0" max="1" step="0.05"
          style="width:70px;text-align:right;background:#FFF9C4;color:#0d47a1;font-weight:600;
                 padding:4px 6px;border:1px solid #dbe3ec;border-radius:3px"
          title="T.lệ CTCK cho vay – tự gợi ý từ master list, có thể sửa"></td>
      <td class="calc" data-i="${i}" data-f="mv">0</td>
      <td class="calc" data-i="${i}" data-f="dmax">0</td>
      <td class="calc" data-i="${i}" data-f="mr">0</td>
    `;
    tb.appendChild(tr);
  }
  STATE.holdings = Array.from({length:10}, () => ({sym:'', qty:0, price:0, r:0.5}));
  tb.addEventListener('input', onHoldingChange);
  tb.addEventListener('change', onHoldingBlur);
}
function onHoldingChange(e) {
  const t = e.target; if (!t.dataset) return;
  const i = +t.dataset.i, f = t.dataset.f;
  if (f === 'sym') {
    const sym = t.value.toUpperCase().trim();
    STATE.holdings[i].sym = sym;
    const rEl = document.querySelector(`input[data-i="${i}"][data-f="r"]`);
    if (rEl) { delete rEl.dataset.manualEdit; rEl.style.background = '#FFF9C4'; }
    // Auto-fill T.lệ Margin từ master list ngay khi mã khớp
    const masterR = STATE.master[sym]?.r;
    if (masterR != null && rEl) {
      rEl.value = masterR;
      STATE.holdings[i].r = masterR;
    }
    // Auto-fill giá tham chiếu nếu đã có sẵn trong cache (prices.json)
    const cachedPx = STATE.prices[sym]?.price;
    if (cachedPx) {
      const priceEl = document.querySelector(`input[data-i="${i}"][data-f="price"]`);
      setNumVal(priceEl, cachedPx);
      STATE.holdings[i].price = cachedPx;
    }
  } else if (f === 'r') {
    STATE.holdings[i].r = +t.value || 0;
    // Đánh dấu đã sửa tay → đổi màu cam nhạt
    t.dataset.manualEdit = '1';
    t.style.background = '#FFE0B2';
  } else if (f === 'qty' || f === 'price') {
    STATE.holdings[i][f] = parseNum(t.value);
  } else {
    STATE.holdings[i][f] = +t.value || 0;
  }
  recalcAll();
}
async function onHoldingBlur(e) {
  const t = e.target; if (!t.dataset) return;
  if (t.dataset.f !== 'sym') return;
  const sym = t.value.toUpperCase().trim();
  if (!sym) return;
  const i = +t.dataset.i;
  // Fill giá tham chiếu (luôn ghi đè khi user vừa gõ mã, kể cả khi prices đã prefetch)
  const p = await fetchPrice(sym);
  if (p) {
    const inputPrice = document.querySelector(`input[data-i="${i}"][data-f="price"]`);
    setNumVal(inputPrice, p.price);
    STATE.holdings[i].price = p.price;
  }
  // Gợi ý T.lệ margin từ master list
  const masterR = STATE.master[sym]?.r;
  if (masterR != null) {
    const rEl = document.querySelector(`input[data-i="${i}"][data-f="r"]`);
    if (!rEl.dataset.manualEdit) {
      rEl.value = masterR;
      STATE.holdings[i].r = masterR;
    }
  }
  recalcAll();
}

function recalcHoldings() {
  let totMV = 0, totDmax = 0, totMR = 0;
  for (let i = 0; i < 10; i++) {
    const h = STATE.holdings[i];
    const r = h.r ?? getR(h.sym);
    const pEval = evalPrice(h.sym, h.price);
    const mv = h.qty * pEval;
    const lim = getStockLimit(h.sym);
    const dmaxRaw = mv * r;
    const dmax = (lim != null) ? Math.min(dmaxRaw, lim) : dmaxRaw;
    const mr = mv - dmax;
    totMV += mv; totDmax += dmax; totMR += mr;
    // Update cells
    document.querySelector(`[data-i="${i}"][data-f="evalPrice"]`).textContent = fmtVND(pEval);
    document.querySelector(`[data-i="${i}"][data-f="mv"]`).textContent = fmtVND(mv);
    document.querySelector(`[data-i="${i}"][data-f="dmax"]`).textContent = fmtVND(dmax);
    document.querySelector(`[data-i="${i}"][data-f="mr"]`).textContent = fmtVND(mr);
  }
  $('totMV').textContent = fmtVND(totMV);
  $('totDmax').textContent = fmtVND(totDmax);
  $('totMR').textContent = fmtVND(totMR);
  return { totMV, totDmax, totMR };
}

function recalcAll() {
  // Cập nhật display phí + thuế bán
  if ($('pFsDisplay')) $('pFsDisplay').textContent = (getFs() * 100).toFixed(3) + '%';

  const { totMV, totDmax } = recalcHoldings();
  const cash = getNumVal('aCash');
  const debt = getNumVal('aDebt');
  const intt = getNumVal('aInt');
  const D = debt + intt;
  $('aTotalDebt').textContent = fmtVND(D);
  const V = totMV + cash;
  const E = V - D;
  const rtt = V > 0 ? E / V : 0;
  STATE.account = { V, D, E, rtt, cash, totMV, totDmax };
  const room = totDmax - D;

  // Tab 1 outputs
  $('rVcp').textContent = fmtVND(totMV);
  $('rM').textContent = fmtVND(cash);
  $('rV').textContent = fmtVND(V);
  $('rD').textContent = fmtVND(D);
  $('rE').textContent = fmtVND(E);
  $('rRtt').textContent = fmtPct(rtt);
  $('rDmax').textContent = fmtVND(totDmax);
  $('rRoom').textContent = fmtVND(room);

  const loanRoom = getMaxLoan() - D;
  if ($('rLoanRoom')) {
    const el = $('rLoanRoom');
    el.textContent = fmtVND(loanRoom);
    el.style.color = loanRoom < 0 ? '#c0392b' : '';
    el.style.fontWeight = loanRoom < 0 ? '700' : '';
  }

  const cm = +$('pCall').value || 0.35;
  const fs = +$('pForce').value || 0.25;
  const stEl = $('rStatus');
  let needAlert = false, alertClass = '';
  if (V === 0) { stEl.textContent = '— (nhập danh mục để bắt đầu)'; stEl.className = 'status'; }
  else if (rtt >= 0.5)     { stEl.textContent = '✅ AN TOÀN (Rtt ≥ 50%)';                                stEl.className = 'status safe'; }
  else if (rtt >= cm)      { stEl.textContent = `⚠️ CẢNH BÁO (${(cm*100)|0}% ≤ Rtt < 50%)`;             stEl.className = 'status watch'; }
  else if (rtt >= fs)      { stEl.textContent = `🔴 CALL MARGIN (${(fs*100)|0}% ≤ Rtt < ${(cm*100)|0}%)`; stEl.className = 'status call'; needAlert = true; alertClass = 'call'; }
  else                     { stEl.textContent = `🚨 FORCE SELL (Rtt < ${(fs*100)|0}%)`;                  stEl.className = 'status force'; needAlert = true; alertClass = 'force'; }

  // Alert panel
  const panel = $('alertPanel');
  if (needAlert && V > 0 && D > 0) {
    const c50 = Math.max(0, D / 0.5  - V);
    const c35 = Math.max(0, D / 0.65 - V);
    const s50 = Math.max(0, V - E / 0.5);
    const s35 = Math.max(0, V - E / 0.35);
    $('alertTitle').textContent = alertClass === 'force'
      ? `🚨 FORCE SELL – Rtt hiện tại ${fmtPct(rtt)} – Cần xử lý NGAY`
      : `🔴 CALL MARGIN – Rtt hiện tại ${fmtPct(rtt)} – Cần bổ sung tài sản`;
    $('alertBox').className = `alert-box ${alertClass}`;
    $('aC50').textContent = fmtVND(c50) + ' đ';
    $('aC35').textContent = fmtVND(c35) + ' đ';
    $('aS50').textContent = fmtVND(s50) + ' đ';
    $('aS35').textContent = fmtVND(s35) + ' đ';
    panel.style.display = 'block';
  } else {
    panel.style.display = 'none';
  }

  // Tab 2 propagate
  $('vV').textContent = fmtVND(V); $('vD').textContent = fmtVND(D);
  $('vE').textContent = fmtVND(E); $('vRtt').textContent = fmtPct(rtt);
  const d50 = Math.max(0, D/(1-0.5) - V);
  const d35 = Math.max(0, D/(1-0.35) - V);
  $('d50').textContent = fmtVND(d50);
  $('d35').textContent = fmtVND(d35);
  $('d50r').textContent = fmtPct(d50>0 ? (E+d50)/(V+d50) : rtt);
  $('d35r').textContent = fmtPct(d35>0 ? (E+d35)/(V+d35) : rtt);
  const s35 = Math.max(0, V - E/0.35);
  const s50 = Math.max(0, V - E/0.5);
  $('s35').textContent = fmtVND(s35);
  $('s50').textContent = fmtVND(s50);
  $('s35r').textContent = fmtPct(s35>0 ? E/(V-s35) : rtt);
  $('s50r').textContent = fmtPct(s50>0 ? E/(V-s50) : rtt);

  // Tab 3 propagate
  $('bV').textContent = fmtVND(V); $('bD').textContent = fmtVND(D);
  $('bRtt').textContent = fmtPct(rtt); $('bDmax').textContent = fmtVND(totDmax);
  $('bRoom').textContent = fmtVND(room); $('bM').textContent = fmtVND(cash);

  recalcBuy(V, D, room, cash);
  recalcDeals();
  renderSellTable();
}

// ── Tab 3 buy section ──────────────────────────────────────
async function onBuySymBlur() {
  const sym = $('bSym').value.toUpperCase().trim();
  if (sym) {
    const p = await fetchPrice(sym);
    if (p) { setNumVal($('bPrice'), p.price); $('bPriceNote').textContent = `Giá tham chiếu: ${fmtVND(p.price)}`; }
  }
  recalcAll();
}
function recalcBuy(V, D, room, cash) {
  const sym   = $('bSym').value.toUpperCase().trim();
  const price = getNumVal('bPrice');
  const r     = getR(sym);
  const fb    = getFb();

  $('bR').textContent = (r*100).toFixed(0) + '%';

  // ── KL tối đa = min của các HẠN MỨC DƯ NỢ, quy ra GT lệnh ──────────────
  // Mua bằng vay margin: phần vay = GT·r. CP mua về + vốn chủ sẵn có làm TS đảm bảo
  // cho phần (1−r) → KHÔNG bắt buộc tiền mặt. Tiền mặt (nếu có) tăng thêm sức mua.
  //   (1) HM 1 mã (Phụ lục 1): dư nợ mã này ≤ limit_mã  → GT ≤ limit_mã / r
  //   (2) HM tài khoản: tổng dư nợ sau mua ≤ 81 tỷ → vay mới ≤ 81tỷ − D → GT ≤ (81tỷ−D)/r
  //   (3) Tiền mặt: phần vốn tự có (1−r) có thể trả thêm bằng cash → GT thêm cash/(1−r)
  const lim       = getStockLimit(sym);                 // HM 1 mã (null nếu không có)
  const acctRoom  = Math.max(0, getMaxLoan() - D);      // hạn mức nợ còn lại toàn TK
  const loanCap   = (lim != null) ? Math.min(acctRoom, lim) : acctRoom;  // dư nợ mới tối đa cho mã này
  const bpStock   = (lim != null && r > 0) ? lim / r : Infinity;         // GT chặn bởi HM 1 mã
  const bpAcct    = r > 0 ? acctRoom / r : Infinity;                     // GT chặn bởi HM 81 tỷ
  const bpLoan    = r > 0 ? loanCap / r : 0;            // GT vay tối đa (đã min 2 hạn mức)
  const bpCash    = r < 1 ? cash / (1 - r) : 0;         // GT thêm nhờ tiền mặt
  const bpTotal   = bpLoan + bpCash;                    // GT lệnh tối đa

  const qtyMax = price > 0 ? Math.floor(bpTotal / price / 100) * 100 : 0;
  const fee    = qtyMax * price * fb;
  const loan   = qtyMax * price * r;

  // Yếu tố đang chặn: hạn mức nào nhỏ hơn (so theo GT lệnh, bỏ phần cash chung cho cả 2).
  let boundBy = 'HM tài khoản (81 tỷ)';
  if (bpStock < bpAcct - 1) boundBy = 'HM 1 mã (Phụ lục 1)';
  if (!isFinite(bpStock) && !isFinite(bpAcct)) boundBy = '—';

  // Cảnh báo khi HM 1 mã là ràng buộc chặt hơn HM tài khoản
  showLimitWarn('bLimitRow', 'bLimitWarn', lim != null && lim < acctRoom, lim, acctRoom);
  $('bBpRoom').textContent  = fmtVND(bpLoan);
  $('bBpCash').textContent  = fmtVND(bpCash);
  $('bBpTotal').textContent = fmtVND(bpTotal);
  $('bQtyMax').textContent  = fmtNum(qtyMax);
  $('bFee').textContent     = fmtVND(fee);
  $('bLoan').textContent    = fmtVND(loan);
  const Vafter = V + qtyMax * price;
  const Dafter = D + loan;
  $('bRttAfter').textContent = Vafter > 0 ? fmtPct((Vafter - Dafter) / Vafter) : '—';
  if ($('bBoundBy')) $('bBoundBy').textContent = qtyMax > 0 ? boundBy : '—';

  // ── Mục II mở rộng: KL người dùng tự chọn ──────────────────
  const qC = getNumVal('bQtyChoose');
  const qChosen = qC > 0 ? qC : qtyMax;          // 0 = dùng KL tối đa
  const valC  = qChosen * price;
  const feeC  = valC * fb;
  const loanC = valC * r;
  const eqC   = valC * (1 - r) + feeC;           // vốn tự có cần (phần không vay + phí)
  $('bcVal').textContent    = fmtVND(valC);
  $('bcFee').textContent    = fmtVND(feeC);
  $('bcLoan').textContent   = fmtVND(loanC);
  $('bcEquity').textContent = fmtVND(eqC);
  // Kiểm tra KL chọn có vượt hạn mức nào không: HM 1 mã hoặc HM tài khoản 81 tỷ.
  const overStock = lim != null && loanC > lim + 1;
  const overAcct  = (D + loanC) > getMaxLoan() + 1;
  const rcEl = $('bcRoomChk');
  if (overStock && overAcct) {
    rcEl.textContent = `❌ Vượt cả HM 1 mã & HM 81 tỷ`;
  } else if (overStock) {
    rcEl.textContent = `❌ Vượt HM 1 mã ${fmtVND(loanC - lim)} đ`;
  } else if (overAcct) {
    rcEl.textContent = `❌ Vượt HM 81 tỷ ${fmtVND((D + loanC) - getMaxLoan())} đ`;
  } else {
    rcEl.textContent = '✅ Trong hạn mức';
  }
  rcEl.style.color = (overStock || overAcct) ? '#c0392b' : '#2e7d32';
  const Vc = V + valC, Dc = D + loanC;
  $('bcRtt').textContent = (qChosen > 0 && Vc > 0) ? fmtPct((Vc - Dc) / Vc) : '—';

  // Section III: KL mong muốn
  const qtyWant = +$('bQtyWant').value || 0;
  const valWant = qtyWant * price * (1 + fb);
  const eqWant  = valWant * (1 - r);
  const loanWant= valWant * r;
  const deposit = Math.max(0, eqWant - cash);
  $('bValWant').textContent  = fmtVND(valWant);
  $('bEqWant').textContent   = fmtVND(eqWant);
  $('bLoanWant').textContent = fmtVND(loanWant);
  const wantOverStock = lim != null && loanWant > lim + 1;
  const wantOverAcct  = (D + loanWant) > getMaxLoan() + 1;
  $('bRoomCheck').textContent = (!wantOverStock && !wantOverAcct)
    ? '✅ Trong hạn mức'
    : (wantOverStock ? '❌ Vượt HM 1 mã' : '❌ Vượt HM 81 tỷ');
  $('bDeposit').textContent  = fmtVND(deposit);

  // Section IV: ngưỡng giá (giả định chỉ có 1 mã này)
  // Đơn giản: chỉ tính cho riêng mã bSym tại qtyWant (nếu có) hoặc qtyMax
  const N = qtyWant > 0 ? qtyWant : qtyMax;
  if (N > 0 && price > 0 && D > 0) {
    const Vbase = V - price * N;
    const pCall  = (D/0.65 - Vbase) / N;
    const pForce = (D/0.75 - Vbase) / N;
    $('bPCall').textContent  = fmtVND(pCall);
    $('bPForce').textContent = fmtVND(pForce);
    $('bDCall').textContent  = fmtPct((price - pCall) / price);
    $('bDForce').textContent = fmtPct((price - pForce) / price);
  } else {
    $('bPCall').textContent = '—'; $('bPForce').textContent = '—';
    $('bDCall').textContent = '—'; $('bDForce').textContent = '—';
  }
}

// ── Tab 4: 3 Deals ─────────────────────────────────────────
async function onDealSymBlur(e) {
  const id = e.target.id;
  const sym = e.target.value.toUpperCase().trim();
  if (!sym) return;
  const p = await fetchPrice(sym);
  if (!p) return;
  if (id === 'd1Sym') { setNumVal($('d1P'), p.price); $('d1Pnote').textContent = `Giá tham chiếu: ${fmtVND(p.price)}`; }
  if (id === 'd2Sym') { setNumVal($('d2P'), p.price); $('d2Pnote').textContent = `Giá tham chiếu: ${fmtVND(p.price)}`; }
  if (id === 'd3Sym') { setNumVal($('d3P'), p.price); $('d3Pnote').textContent = `Giá tham chiếu: ${fmtVND(p.price)}`; }
  if (id === 'd4Sym') {
    setNumVal($('d4P'), p.price);
    setNumVal($('d4Pbuy'), p.price);
    $('d4Pnote').textContent = `Giá tham chiếu: ${fmtVND(p.price)}`;
  }
  // Auto-fill r from master
  const r = getR(sym);
  $('dR').value = r;
  recalcDeals();
}

function recalcDeals() {
  const r    = +$('dR').value   || 0.5;
  const Rtt  = +$('dRtt').value || 0.5;
  const fb   = getFb();
  const fs   = getFs();
  const rp   = Math.min(r, 1 - Rtt);
  $('dRp').textContent = (rp*100).toFixed(2) + '%';

  // Deal 1
  const N1 = getNumVal('d1N'), P1 = getNumVal('d1P');
  const V1 = N1 * P1;
  let X1 = V1 * rp / (1 + fb);
  let debt1 = X1 * (1 + fb);           // = V1 · rp
  // Kẹp theo Hạn mức tối đa 1 mã: dư nợ phát sinh không vượt limit của mã d1Sym
  const lim1 = getStockLimit($('d1Sym').value);
  const cap1 = lim1 != null && debt1 > lim1;
  if (cap1) { debt1 = lim1; X1 = lim1 / (1 + fb); }
  const cash1 = X1 * (1 - fs);
  showLimitWarn('d1LimitRow', 'd1LimitWarn', cap1, lim1, V1 * rp);
  $('d1V').textContent   = fmtVND(V1);
  $('d1X').textContent   = fmtVND(X1);
  $('d1Cash').textContent= fmtVND(cash1);
  $('d1Debt').textContent= fmtVND(debt1);
  $('d1Rtt').textContent = V1>0 ? fmtPct((V1-debt1)/V1) : '—';

  // Deal 2
  const Y = getNumVal('d2Y'), P2 = getNumVal('d2P');
  let Vneed2 = (rp>0 && (1-fs)>0) ? Y * (1+fb) / (rp * (1-fs)) : 0;
  // Kẹp theo Hạn mức tối đa 1 mã: dư nợ phát sinh = Vreal2·rp không vượt limit
  // → V tối đa = limit/rp. Nếu Vneed2 vượt ngưỡng này thì không rút đủ Y bằng 1 mã.
  const lim2 = getStockLimit($('d2Sym').value);
  const cap2 = lim2 != null && rp > 0 && Vneed2 * rp > lim2;
  if (cap2) Vneed2 = lim2 / rp;        // V bị kẹp ở mức tạo dư nợ = limit
  const N2 = P2>0 ? Math.ceil(Vneed2 / P2 / 100) * 100 : 0;
  let Vreal2 = N2 * P2;
  let debt2 = Vreal2 * rp;
  // N2 làm tròn LÊN có thể đẩy debt vượt limit lần nữa → kẹp lại debt và tiền rút theo limit
  if (lim2 != null && debt2 > lim2) debt2 = lim2;
  const X2 = debt2 / (1 + fb);
  showLimitWarn('d2LimitRow', 'd2LimitWarn', cap2, lim2, (rp>0 ? Y*(1+fb)/(rp*(1-fs)) : 0) * rp);
  $('d2V').textContent    = fmtVND(Vneed2);
  $('d2N').textContent    = fmtNum(N2);
  $('d2Vreal').textContent= fmtVND(Vreal2);
  $('d2Cash').textContent = fmtVND(X2 * (1 - fs));
  $('d2Debt').textContent = fmtVND(debt2);

  // Deal 3
  const Z = getNumVal('d3Z'), P3 = getNumVal('d3P');
  // Kẹp theo Hạn mức tối đa 1 mã: dư nợ mong muốn Z không thể vượt limit bằng 1 mã.
  const lim3 = getStockLimit($('d3Sym').value);
  const cap3 = lim3 != null && Z > lim3;
  const Zeff = cap3 ? lim3 : Z;        // dư nợ thực tế đạt được
  const Vneed3 = rp > 0 ? Zeff / rp : 0;
  const N3 = P3>0 ? Math.ceil(Vneed3 / P3 / 100) * 100 : 0;
  const Vreal3 = N3 * P3;
  let debt3 = Vreal3 * rp;
  if (lim3 != null && debt3 > lim3) debt3 = lim3;   // N3 tròn lên không vượt trần
  const X3 = debt3 / (1 + fb);
  showLimitWarn('d3LimitRow', 'd3LimitWarn', cap3, lim3, Z);
  $('d3V').textContent    = fmtVND(Vneed3);
  $('d3N').textContent    = fmtNum(N3);
  $('d3Cash').textContent = fmtVND(X3 * (1 - fs));
  $('d3Debt').textContent = fmtVND(debt3);

  // Deal 4: Nộp X tiền mặt → mua tối đa N cp mã Y
  // OCBS cho vay theo giá tham chiếu (Pref), còn user trả tiền theo giá mua (Pbuy).
  //   Loan       = N · Pref · r'
  //   Cash chi   = N · Pbuy · (1+fb) − N · Pref · r'  = N · [Pbuy·(1+fb) − Pref·r']
  //   Đặt = X → N = floor( X / [Pbuy·(1+fb) − Pref·r'] / 100 ) × 100
  const X4 = getNumVal('d4X');
  const P4ref = getNumVal('d4P');
  const P4buy = getNumVal('d4Pbuy') || P4ref;
  const perShareCash = P4buy * (1 + fb) - P4ref * rp;  // tiền mặt cần cho 1 cp
  const Nmax4 = (perShareCash > 0) ? X4 / perShareCash : 0;
  let N4 = Math.max(0, Math.floor(Nmax4 / 100) * 100);
  // Kẹp theo Hạn mức tối đa 1 mã: dư nợ N4·Pref·rp không vượt limit của mã d4Sym
  const lim4 = getStockLimit($('d4Sym').value);
  const cap4 = lim4 != null && rp > 0 && P4ref > 0 && N4 * P4ref * rp > lim4;
  if (cap4) {
    const nByLimit = Math.floor(lim4 / (P4ref * rp) / 100) * 100;
    N4 = Math.max(0, Math.min(N4, nByLimit));
  }
  showLimitWarn('d4LimitRow', 'd4LimitWarn', cap4, lim4, Math.floor(Nmax4/100)*100 * P4ref * rp);
  const Vcost4   = N4 * P4buy;            // chi phí mua (giá đặt)
  const VrefVal4 = N4 * P4ref;            // giá trị stock để tính Rtt (giá TC)
  const debt4    = VrefVal4 * rp;         // dư nợ vay margin
  const cash4    = N4 * perShareCash;     // tiền mặt thực dùng
  $('d4V').textContent    = fmtVND(Vcost4);
  $('d4N').textContent    = fmtNum(N4);
  $('d4Vreal').textContent= fmtVND(VrefVal4);
  $('d4Cash').textContent = fmtVND(cash4);
  $('d4Debt').textContent = fmtVND(debt4);
  $('d4Rem').textContent  = fmtVND(Math.max(0, X4 - cash4));
  // Rtt sau = (V_sau − D_sau) / V_sau. V_sau cộng stock_ref + tiền nộp dư + tài khoản cũ.
  const acc = STATE.account || { V:0, D:0 };
  const Vafter4 = acc.V + VrefVal4 + Math.max(0, X4 - cash4);
  const Dafter4 = acc.D + debt4;
  $('d4Rtt').textContent = (Vafter4 > 0 && N4 > 0)
    ? fmtPct((Vafter4 - Dafter4) / Vafter4)
    : '—';
}

// ╔════════ TAB 2: Phân bổ bán theo từng mã (mô phỏng) ════════╗
// Lưu lựa chọn bán theo mã: {SYM: {checked, qty, price}}. Giữ qua các lần render.
STATE.sellPlan = STATE.sellPlan || {};

// Danh sách holding hợp lệ (có mã + KL > 0) từ tab 1, gộp KL theo mã.
function getSellableHoldings() {
  const map = {};
  for (const h of STATE.holdings) {
    const sym = (h.sym || '').toUpperCase().trim();
    if (!sym || !h.qty || h.qty <= 0) continue;
    const pEval = evalPrice(sym, h.price);
    if (!pEval || pEval <= 0) continue;
    if (!map[sym]) map[sym] = { sym, qty: 0, price: pEval, r: h.r ?? getR(sym) };
    map[sym].qty += h.qty;       // gộp nếu cùng mã ở nhiều dòng
  }
  return Object.values(map);
}

function renderSellTable() {
  const tb = $('tblSell')?.querySelector('tbody');
  if (!tb) return;
  const holds = getSellableHoldings();
  const fs = getFs();                       // phí + thuế bán
  $('spFee').textContent = (fs * 100).toFixed(2).replace('.', ',') + '%';

  // Dọn sellPlan: bỏ mã không còn trong danh mục
  const validSyms = new Set(holds.map(h => h.sym));
  for (const s of Object.keys(STATE.sellPlan)) if (!validSyms.has(s)) delete STATE.sellPlan[s];

  $('sellNoHoldings').style.display = holds.length ? 'none' : '';

  tb.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const h of holds) {
    const plan = STATE.sellPlan[h.sym] || { checked: false, qty: 0, price: h.price };
    // Giá bán mặc định = giá đánh giá; KL bán kẹp trong KL đang giữ
    const sellPrice = plan.price || h.price;
    const sellQty   = Math.min(plan.qty || 0, h.qty);
    const gt        = plan.checked ? sellQty * sellPrice : 0;
    const cash      = gt * (1 - fs);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align:center"><input type="checkbox" data-sym="${h.sym}" data-f="checked" ${plan.checked ? 'checked' : ''}></td>
      <td style="font-weight:700;color:#1F3864;text-align:center">${h.sym}</td>
      <td style="text-align:center">${(h.r*100).toFixed(0)}%</td>
      <td style="text-align:right">${fmtNum(h.qty)}</td>
      <td><input type="text" inputmode="numeric" data-num data-sym="${h.sym}" data-f="price" value="${fmtNumInput(sellPrice)}" style="width:120px"></td>
      <td><input type="text" inputmode="numeric" data-num data-sym="${h.sym}" data-f="qty" value="${fmtNumInput(sellQty)}" style="width:110px"></td>
      <td class="calc" style="text-align:right">${gt ? fmtVND(gt) : '0'}</td>
      <td class="calc" style="text-align:right">${cash ? fmtVND(cash) : '0'}</td>
    `;
    frag.appendChild(tr);
  }
  tb.appendChild(frag);

  recalcSell();
}

function recalcSell() {
  const acc = STATE.account || { V:0, D:0, E:0, totDmax:0 };
  const { V, D, E } = acc;
  const fs = getFs();
  const holds = getSellableHoldings();

  // Tổng GT bán + tiền trả nợ; đồng thời tính Dmax giảm do bán mã có margin
  let S = 0, dmaxDrop = 0;
  for (const h of holds) {
    const plan = STATE.sellPlan[h.sym];
    if (!plan || !plan.checked) continue;
    const q  = Math.min(plan.qty || 0, h.qty);
    const px = plan.price || h.price;
    const gt = q * px;
    S += gt;
    // Bán q cp mã này → mất GT đánh giá q·px, giảm Dmax = (q·px)·r (kẹp theo limit không xét ở mức mã đơn lẻ)
    dmaxDrop += gt * h.r;
  }
  const cash = S * (1 - fs);            // tiền thực trả nợ
  const fee  = S * fs;                  // phí + thuế mất đi
  const Vafter = V - S;
  const Dafter = Math.max(0, D - cash);
  const Eafter = Vafter - Dafter;       // = E − S·fs
  const rttAfter = Vafter > 0 ? Eafter / Vafter : 0;
  const dmaxAfter = Math.max(0, (acc.totDmax || 0) - dmaxDrop);
  const roomAfter = dmaxAfter - Dafter;

  $('sellTotGT').textContent   = fmtVND(S);
  $('sellTotCash').textContent = fmtVND(cash);
  $('rsS').textContent    = fmtVND(S);
  $('rsCash').textContent = fmtVND(cash);
  $('rsFee').textContent  = fmtVND(fee);
  $('rsV').textContent    = fmtVND(Vafter);
  $('rsD').textContent    = fmtVND(Dafter);
  $('rsDmax').textContent = fmtVND(dmaxAfter);
  $('rsRoom').textContent = fmtVND(roomAfter);
  $('rsRtt').textContent  = S > 0 ? fmtPct(rttAfter) : '—';

  // Trạng thái so mục tiêu
  const target = +$('sellTarget').value || 0.35;
  const stEl = $('rsStatus');
  if (S <= 0) {
    stEl.textContent = '— (chọn mã & nhập KL bán để mô phỏng)';
    stEl.className = 'status';
  } else if (rttAfter >= target) {
    stEl.textContent = `✅ Đạt mục tiêu Rtt ≥ ${(target*100)|0}% (sau bán: ${fmtPct(rttAfter)})`;
    stEl.className = 'status safe';
  } else {
    // còn thiếu bao nhiêu GT bán nữa để đạt target (công thức có phí)
    const needS = (fs - target) !== 0 ? (E - target*V)/(fs - target) : 0;
    const more  = Math.max(0, needS - S);
    stEl.textContent = `⚠️ Chưa đủ — Rtt sau bán ${fmtPct(rttAfter)} < ${(target*100)|0}%. Cần bán thêm ~${fmtVND(more)} đ GT nữa.`;
    stEl.className = 'status watch';
  }
}

// Tự chia KL bán theo thứ tự mã đang được tick, đủ để đạt mục tiêu Rtt.
// Tổng GT bán cần (có phí): S* = (E − Rtt*·V)/(fs − Rtt*).
function autoFillSell() {
  const acc = STATE.account || { V:0, D:0, E:0 };
  const { V, E } = acc;
  const fs = getFs();
  const target = +$('sellTarget').value || 0.35;
  const denom = fs - target;
  let needS = denom !== 0 ? (E - target*V)/denom : 0;
  needS = Math.max(0, needS);

  const holds = getSellableHoldings();
  // Chỉ chia cho các mã đang tick; nếu chưa tick mã nào → tick tất cả theo thứ tự bảng
  let checkedSyms = holds.filter(h => STATE.sellPlan[h.sym]?.checked).map(h => h.sym);
  if (!checkedSyms.length) {
    holds.forEach(h => { STATE.sellPlan[h.sym] = { ...(STATE.sellPlan[h.sym]||{}), checked: true, price: h.price }; });
    checkedSyms = holds.map(h => h.sym);
  }

  let remain = needS;
  for (const h of holds) {
    if (!checkedSyms.includes(h.sym)) continue;
    const plan = STATE.sellPlan[h.sym] || { checked: true, price: h.price };
    const px = plan.price || h.price;
    if (remain <= 0 || px <= 0) { plan.qty = 0; STATE.sellPlan[h.sym] = plan; continue; }
    const maxGT = h.qty * px;                 // bán hết mã này
    const takeGT = Math.min(remain, maxGT);
    // làm tròn KL lên bội số 100 cho đủ (không bán lẻ dưới lô)
    let q = Math.ceil(takeGT / px / 100) * 100;
    q = Math.min(q, h.qty);                    // không vượt KL đang giữ
    plan.qty = q;
    plan.checked = true;
    STATE.sellPlan[h.sym] = plan;
    remain -= q * px;
  }
  renderSellTable();
}

// Wiring cho bảng bán (event delegation)
function wireSellTable() {
  const tbl = $('tblSell');
  if (!tbl) return;
  tbl.addEventListener('input', e => {
    const t = e.target; const sym = t.dataset.sym; if (!sym) return;
    const f = t.dataset.f;
    STATE.sellPlan[sym] = STATE.sellPlan[sym] || { checked:false, qty:0, price:0 };
    if (f === 'checked')      STATE.sellPlan[sym].checked = t.checked;
    else if (f === 'qty')     STATE.sellPlan[sym].qty   = parseNum(t.value);
    else if (f === 'price')   STATE.sellPlan[sym].price = parseNum(t.value);
    recalcSell();
    // cập nhật riêng 2 ô GT/tiền của dòng đó để không reset caret khi đang gõ
    if (f === 'qty' || f === 'price') {
      const row = t.closest('tr');
      const p = STATE.sellPlan[sym];
      const holds = getSellableHoldings().find(h => h.sym === sym);
      const q = Math.min(p.qty||0, holds?.qty||0);
      const gt = p.checked ? q * (p.price||holds?.price||0) : 0;
      const cells = row.querySelectorAll('td.calc');
      if (cells[0]) cells[0].textContent = gt ? fmtVND(gt) : '0';
      if (cells[1]) cells[1].textContent = gt ? fmtVND(gt*(1-getFs())) : '0';
    }
  });
  // checkbox dùng change để chắc ăn
  tbl.addEventListener('change', e => {
    if (e.target.dataset.f === 'checked') renderSellTable();
  });
  $('btnAutoFill').onclick  = autoFillSell;
  $('btnClearSell').onclick = () => { STATE.sellPlan = {}; renderSellTable(); };
  $('sellTarget').addEventListener('change', recalcSell);
}

// ╔════════════════ TAB 5: Mượn hàng ═════════════════════════╗
// Ngày nghỉ lễ VN (CK đóng cửa) — định dạng 'YYYY-MM-DD'.
// 2026: Tết DL 1/1; Tết Âm 17–21/2 (mùng 1 = 17/2); Giỗ tổ 26/4(CN)→nghỉ bù 27/4;
//        30/4, 1/5; Quốc khánh 2/9 + nghỉ 1/9. (Có thể cập nhật khi nhà nước công bố.)
const VN_HOLIDAYS = new Set([
  '2026-01-01',
  '2026-02-16','2026-02-17','2026-02-18','2026-02-19','2026-02-20',
  '2026-04-27',
  '2026-04-30','2026-05-01',
  '2026-09-01','2026-09-02',
]);
// true nếu ngày là phiên nghỉ (T7, CN, hoặc lễ)
function isHoliday(d) {
  const wd = d.getDay();              // 0 = CN, 6 = T7
  if (wd === 0 || wd === 6) return true;
  return VN_HOLIDAYS.has(toISODate(d));
}
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseISODate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
// Ngày trả = ngày mượn + 2 phiên giao dịch. Đếm 2 phiên giao dịch (bỏ qua T7/CN/lễ),
// nếu kết quả rơi vào ngày nghỉ thì dời tiếp sang phiên kế. Trả về Date.
function computeReturnDate(borrow) {
  if (!borrow) return null;
  let d = new Date(borrow.getTime());
  let sessions = 0;
  // bước qua từng ngày, mỗi phiên giao dịch hợp lệ tính 1, cần đủ 2 phiên (T+2)
  while (sessions < 2) {
    d.setDate(d.getDate() + 1);
    if (!isHoliday(d)) sessions++;
  }
  return d;
}
// Số ngày lịch giữa 2 mốc
function daysBetween(a, b) {
  if (!a || !b) return 0;
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}

let mReturnAutoFilled = true;  // true khi ngày trả do app tự điền (chưa bị user sửa tay)

async function onMuonSymBlur() {
  const sym = $('mSym').value.toUpperCase().trim();
  if (!sym) return;
  const p = await fetchPrice(sym);
  if (p) { setNumVal($('mPrice'), p.price); $('mPriceNote').textContent = `Giá tham chiếu: ${fmtVND(p.price)}`; }
  recalcMuon();
}

// Khi đổi ngày mượn → tự tính lại ngày trả (nếu user chưa override)
function onBorrowDateChange() {
  const borrow = parseISODate($('mDateBorrow').value);
  if (borrow && mReturnAutoFilled) {
    const ret = computeReturnDate(borrow);
    if (ret) $('mDateReturn').value = toISODate(ret);
  }
  recalcMuon();
}

function recalcMuon() {
  const qty   = getNumVal('mQty');
  const price = getNumVal('mPrice');
  const value = qty * price;                 // Giá trị mượn
  $('mValue').textContent = fmtVND(value);

  const borrow = parseISODate($('mDateBorrow').value);
  const ret    = parseISODate($('mDateReturn').value);
  const days   = daysBetween(borrow, ret);
  $('mDays').textContent = days > 0 ? `${days} ngày` : '—';

  // Tham số % (nhập theo %, chia 100 khi nhân giá trị)
  const fee    = (+$('mFee').value        || 0);   // phí GD mua/bán %
  const tax    = (+$('mTax').value        || 0);   // thuế bán %
  const brw    = (+$('mFeeBorrow').value  || 0);   // phí mượn hàng %
  const adv    = (+$('mFeeAdvance').value || 0);   // phí ứng %/năm

  // Tổng flow phí (%)
  const pctSell    = fee + tax;                    // bán = phí + thuế
  const pctBuy     = fee;                          // mua = phí
  const pctAdvance = adv * days / 360;             // ứng theo kỳ
  const pctBorrow  = brw;                          // phí mượn hàng
  $('mPctSell').textContent    = pctSell.toFixed(3) + '%';
  $('mPctBuy').textContent     = pctBuy.toFixed(3) + '%';
  $('mPctAdvance').textContent = pctAdvance.toFixed(4) + '%';
  $('mPctBorrow').textContent  = pctBorrow.toFixed(3) + '%';

  // Các khoản phí (đồng)
  const feeSell = value * pctSell    / 100;
  const feeBuy  = value * pctBuy     / 100;
  const feeAdv  = value * pctAdvance / 100;
  const feeBrw  = value * pctBorrow  / 100;
  const totalFee = feeSell + feeBuy + feeAdv + feeBrw;
  $('mFeeSell').textContent = fmtVND(feeSell);
  $('mFeeBuy').textContent  = fmtVND(feeBuy);
  $('mFeeAdv').textContent  = fmtVND(feeAdv);
  $('mFeeBrw').textContent  = fmtVND(feeBrw);
  $('mTotalFee').textContent = fmtVND(totalFee);

  // Giá trả hàng = (giá trị mượn − tổng phí) / khối lượng
  const returnPrice = qty > 0 ? (value - totalFee) / qty : 0;
  $('mReturnPrice').textContent = qty > 0 ? fmtVND(returnPrice) : '—';
}

// ── Tab 5: Caps editor ─────────────────────────────────────
// ── Sort state for caps table ─────────────────────────────────
let capSort = { field: 'sym', asc: true };

function renderCaps() {
  const tb    = $('tblCaps').querySelector('tbody');
  const search = ($('capSearch').value || '').toUpperCase().trim();
  const filter = $('capFilter')?.value || 'all';
  const exch   = $('capExch')?.value  || '';

  // Build rows from full master list
  let rows = Object.entries(STATE.master).map(([sym, m]) => ({
    sym, name: m.name || '', exch: m.exch || '', r: m.r ?? 0.5,
    high: STATE.caps[sym]?.high || null,
    low:  STATE.caps[sym]?.low  || null,
    pl1Cap: m.cap || null,
    limit:  m.limit || null,
  }));

  // Filter
  if (search) rows = rows.filter(r => r.sym.includes(search) || r.name.toUpperCase().includes(search));
  if (filter === 'capped') rows = rows.filter(r => r.high || r.low || r.pl1Cap);
  if (filter === 'nocap')  rows = rows.filter(r => !r.high && !r.low && !r.pl1Cap);
  if (exch) rows = rows.filter(r => r.exch === exch);

  // Sort
  rows.sort((a, b) => {
    let va = a[capSort.field], vb = b[capSort.field];
    if (typeof va === 'string') va = va.toLowerCase(), vb = (vb||'').toLowerCase();
    if (va < vb) return capSort.asc ? -1 :  1;
    if (va > vb) return capSort.asc ?  1 : -1;
    return 0;
  });

  // Render (limit 200 rows at a time for perf)
  const total = rows.length;
  const show  = rows.slice(0, 200);

  tb.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const row of show) {
    const tr = document.createElement('tr');
    const refPx = STATE.prices[row.sym]?.price;
    const placeholderHigh = row.pl1Cap
      ? row.pl1Cap.toLocaleString('vi-VN')
      : (refPx ? refPx.toLocaleString('vi-VN') : 'giá TC');
    const pl1Tag = row.pl1Cap ? `<span style="font-size:10px;color:#2e7d32" title="PL1: ${row.pl1Cap.toLocaleString('vi-VN')}đ">PL1</span>` : '';
    const limTxt = row.limit ? `${(row.limit/1e9).toFixed(0)} tỷ` : '—';
    tr.innerHTML = `
      <td style="font-weight:700;color:#1F3864">${row.sym} ${pl1Tag}</td>
      <td style="text-align:left;font-size:12px;color:#444">${row.name}</td>
      <td style="text-align:center;font-size:12px">${row.exch}</td>
      <td style="text-align:center;font-weight:600;color:${row.r>=0.5?'#1a5276':'#7d6608'}">${(row.r*100).toFixed(0)}%</td>
      <td><input type="number" data-sym="${row.sym}" data-f="high" value="${row.high||''}"
          placeholder="${placeholderHigh}" style="${row.high ? 'background:#FFF2CC;color:#7d6608;font-weight:600' : ''}"></td>
      <td><input type="number" data-sym="${row.sym}" data-f="low"  value="${row.low||''}"
          placeholder="—" style="${row.low  ? 'background:#FFF2CC;color:#7d6608;font-weight:600' : ''}"></td>
      <td style="text-align:center;font-size:12px;color:#666">${limTxt}</td>
    `;
    frag.appendChild(tr);
  }
  tb.appendChild(frag);

  const cappedCount = Object.keys(STATE.caps).length;
  $('capInfo').textContent = `${cappedCount} mã đã có giá chặn`;
  if ($('listCount')) $('listCount').textContent = Object.keys(STATE.master).length;
  if ($('capPageInfo')) {
    $('capPageInfo').textContent = total > 200
      ? `Hiển thị 200/${total} kết quả – hãy tìm kiếm để thu hẹp`
      : `${total} mã`;
  }
}

// Sort by column header click
$('tblCaps').querySelector('thead').addEventListener('click', e => {
  const s = e.target.dataset.sort; if (!s) return;
  capSort.asc = capSort.field === s ? !capSort.asc : true;
  capSort.field = s;
  // Update arrow indicators
  $('tblCaps').querySelectorAll('th[data-sort]').forEach(th => {
    const base = th.textContent.replace(/ [↑↓↕]$/,'');
    th.textContent = base + (th.dataset.sort === s ? (capSort.asc ? ' ↑' : ' ↓') : ' ↕');
  });
  renderCaps();
});

$('tblCaps').addEventListener('input', e => {
  const t = e.target; if (!t.dataset.sym) return;
  const sym = t.dataset.sym, f = t.dataset.f;
  const val = +t.value || null;
  if (val) {
    STATE.caps[sym] = STATE.caps[sym] || {};
    STATE.caps[sym][f] = val;
    t.style.background = '#FFF2CC'; t.style.color = '#7d6608'; t.style.fontWeight = '600';
  } else {
    if (STATE.caps[sym]) { STATE.caps[sym][f] = null; }
    if (STATE.caps[sym] && !STATE.caps[sym].high && !STATE.caps[sym].low) delete STATE.caps[sym];
    t.style.background = ''; t.style.color = ''; t.style.fontWeight = '';
  }
  const cappedCount = Object.keys(STATE.caps).length;
  $('capInfo').textContent = `${cappedCount} mã đã có giá chặn`;
  recalcAll();
});

$('capSave').onclick = saveCaps;
$('capSearch').oninput = renderCaps;
$('capFilter').oninput = renderCaps;
$('capExch').oninput   = renderCaps;

// ── Wire general inputs ────────────────────────────────────
['aCash','aDebt','aInt','pFb','pCall','pForce','pMaxLoan','bSym','bPrice','bQtyWant','bQtyChoose',
 'dR','dRtt','d1N','d1P','d2Y','d2P','d3Z','d3P','d4X','d4P','d4Pbuy']
.forEach(id => { const el = $(id); if (el) el.addEventListener('input', recalcAll); });

['d1Sym','d2Sym','d3Sym','d4Sym'].forEach(id => $(id).addEventListener('change', onDealSymBlur));
$('bSym').addEventListener('change', onBuySymBlur);

// ── Tab 2: Phân bổ bán theo mã ─────────────────────────────
wireSellTable();

// ── Tab 5: Mượn hàng wiring ────────────────────────────────
['mQty','mPrice','mFee','mTax','mFeeBorrow','mFeeAdvance']
  .forEach(id => { const el = $(id); if (el) el.addEventListener('input', recalcMuon); });
$('mSym').addEventListener('change', onMuonSymBlur);
$('mDateBorrow').addEventListener('change', onBorrowDateChange);
$('mDateReturn').addEventListener('change', () => { mReturnAutoFilled = false; recalcMuon(); });

$('btnRefreshAll').onclick = async () => {
  for (let i = 0; i < 10; i++) {
    const sym = STATE.holdings[i].sym; if (!sym) continue;
    const p = await fetchPrice(sym);
    if (p) {
      const el = document.querySelector(`input[data-i="${i}"][data-f="price"]`);
      setNumVal(el, p.price);
      STATE.holdings[i].price = p.price;
    }
  }
  recalcAll();
};
$('btnClearRows').onclick = () => {
  document.querySelectorAll('#tblHoldings tbody input').forEach(el => {
    if (el.dataset.f === 'r') { el.value = 0.5; el.style.background = '#FFF9C4'; delete el.dataset.manualEdit; }
    else if (el.type === 'number') el.value = 0;
    else el.value = '';
  });
  STATE.holdings = Array.from({length:10}, () => ({sym:'', qty:0, price:0, r:0.5}));
  recalcAll();
};

// Prefetch giá tham chiếu cho các ô mặc định (Deal 1/2/3, Sức mua)
async function prefetchDefaultPrices() {
  const targets = [
    { symId: 'd1Sym', priceId: 'd1P', noteId: 'd1Pnote' },
    { symId: 'd2Sym', priceId: 'd2P', noteId: 'd2Pnote' },
    { symId: 'd3Sym', priceId: 'd3P', noteId: 'd3Pnote' },
    { symId: 'd4Sym', priceId: 'd4P', noteId: 'd4Pnote', buyId: 'd4Pbuy' },
    { symId: 'bSym',  priceId: 'bPrice', noteId: 'bPriceNote' },
  ];
  await Promise.all(targets.map(async t => {
    const sym = $(t.symId)?.value?.toUpperCase().trim();
    if (!sym) return;
    const p = await fetchPrice(sym);
    if (!p) return;
    setNumVal($(t.priceId), p.price);
    if (t.buyId && $(t.buyId)) setNumVal($(t.buyId), p.price);
    if (t.noteId && $(t.noteId)) $(t.noteId).textContent = `Giá tham chiếu: ${fmtVND(p.price)}`;
  }));
  recalcAll();
}

// Khởi tạo ngày mượn = hôm nay, ngày trả = T+2 (auto skip nghỉ/lễ)
function initMuonDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  $('mDateBorrow').value = toISODate(today);
  const ret = computeReturnDate(today);
  if (ret) $('mDateReturn').value = toISODate(ret);
  mReturnAutoFilled = true;
}

// Prefetch giá tham chiếu cho mã mượn mặc định
async function prefetchMuonPrice() {
  const sym = $('mSym')?.value?.toUpperCase().trim();
  if (!sym) return;
  const p = await fetchPrice(sym);
  if (!p) return;
  setNumVal($('mPrice'), p.price);
  if ($('mPriceNote')) $('mPriceNote').textContent = `Giá tham chiếu: ${fmtVND(p.price)}`;
}

// ── Init ───────────────────────────────────────────────────
(async () => {
  await loadMaster();
  await loadCaps();
  await loadPrices();
  initHoldingsTable();
  initMuonDates();
  recalcAll();
  await prefetchDefaultPrices();
  await prefetchMuonPrice();
  recalcMuon();
})();
