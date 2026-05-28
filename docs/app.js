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
  const cash = +$('aCash').value || 0;
  const debt = +$('aDebt').value || 0;
  const intt = +$('aInt').value || 0;
  const D = debt + intt;
  $('aTotalDebt').textContent = fmtVND(D);
  const V = totMV + cash;
  const E = V - D;
  const rtt = V > 0 ? E / V : 0;
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
  const bpRoom  = r > 0 ? room / r : 0;
  const bpCash  = r < 1 ? cash / (1 - r) : cash;
  const bpTotal = Math.min(bpRoom, bpCash) + cash;
  const qtyMax  = price > 0 ? Math.floor(bpTotal / price / 100) * 100 : 0;
  const fee     = qtyMax * price * fb;
  const loan    = qtyMax * price * r;
  $('bBpRoom').textContent  = fmtVND(bpRoom);
  $('bBpCash').textContent  = fmtVND(bpCash);
  $('bBpTotal').textContent = fmtVND(bpTotal);
  $('bQtyMax').textContent  = fmtNum(qtyMax);
  $('bFee').textContent     = fmtVND(fee);
  $('bLoan').textContent    = fmtVND(loan);
  const Vafter = V + qtyMax * price;
  const Dafter = D + loan;
  $('bRttAfter').textContent = Vafter > 0 ? fmtPct((Vafter - Dafter) / Vafter) : '—';

  // Section III: KL mong muốn
  const qtyWant = +$('bQtyWant').value || 0;
  const valWant = qtyWant * price * (1 + fb);
  const eqWant  = valWant * (1 - r);
  const loanWant= valWant * r;
  const deposit = Math.max(0, eqWant - cash);
  $('bValWant').textContent  = fmtVND(valWant);
  $('bEqWant').textContent   = fmtVND(eqWant);
  $('bLoanWant').textContent = fmtVND(loanWant);
  $('bRoomCheck').textContent = loanWant <= room ? '✅ Đủ Room' : '❌ Không đủ – cần tăng HM';
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
  const X1 = V1 * rp / (1 + fb);
  const cash1 = X1 * (1 - fs);
  const debt1 = X1 * (1 + fb);
  $('d1V').textContent   = fmtVND(V1);
  $('d1X').textContent   = fmtVND(X1);
  $('d1Cash').textContent= fmtVND(cash1);
  $('d1Debt').textContent= fmtVND(debt1);
  $('d1Rtt').textContent = V1>0 ? fmtPct((V1-debt1)/V1) : '—';

  // Deal 2
  const Y = getNumVal('d2Y'), P2 = getNumVal('d2P');
  const Vneed2 = (rp>0 && (1-fs)>0) ? Y * (1+fb) / (rp * (1-fs)) : 0;
  const N2 = P2>0 ? Math.ceil(Vneed2 / P2 / 100) * 100 : 0;
  const Vreal2 = N2 * P2;
  const X2 = Vreal2 * rp / (1 + fb);
  $('d2V').textContent    = fmtVND(Vneed2);
  $('d2N').textContent    = fmtNum(N2);
  $('d2Vreal').textContent= fmtVND(Vreal2);
  $('d2Cash').textContent = fmtVND(X2 * (1 - fs));
  $('d2Debt').textContent = fmtVND(X2 * (1 + fb));

  // Deal 3
  const Z = getNumVal('d3Z'), P3 = getNumVal('d3P');
  const Vneed3 = rp > 0 ? Z / rp : 0;
  const N3 = P3>0 ? Math.ceil(Vneed3 / P3 / 100) * 100 : 0;
  const Vreal3 = N3 * P3;
  const X3 = Vreal3 * rp / (1 + fb);
  $('d3V').textContent    = fmtVND(Vneed3);
  $('d3N').textContent    = fmtNum(N3);
  $('d3Cash').textContent = fmtVND(X3 * (1 - fs));
  $('d3Debt').textContent = fmtVND(X3 * (1 + fb));

  // Deal 4: Nộp X tiền mặt → mua tối đa N cp mã Y với giá MUỐN MUA Pbuy
  // V_mua = X / (1 + fb − rp), N = floor(V_mua / Pbuy / 100) × 100
  const X4 = getNumVal('d4X'), P4buy = getNumVal('d4Pbuy') || getNumVal('d4P');
  const denom4 = 1 + fb - rp;
  const Vmax4 = (denom4 > 0) ? X4 / denom4 : 0;
  const N4 = (P4buy > 0) ? Math.floor(Vmax4 / P4buy / 100) * 100 : 0;
  const Vreal4 = N4 * P4buy;
  const cash4  = Vreal4 * denom4;
  const debt4  = Vreal4 * rp;
  $('d4V').textContent    = fmtVND(Vmax4);
  $('d4N').textContent    = fmtNum(N4);
  $('d4Vreal').textContent= fmtVND(Vreal4);
  $('d4Cash').textContent = fmtVND(cash4);
  $('d4Debt').textContent = fmtVND(debt4);
  $('d4Rem').textContent  = fmtVND(Math.max(0, X4 - cash4));
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
['aCash','aDebt','aInt','pFb','pCall','pForce','pMaxLoan','bSym','bPrice','bQtyWant',
 'dR','dRtt','d1N','d1P','d2Y','d2P','d3Z','d3P','d4X','d4P','d4Pbuy']
.forEach(id => { const el = $(id); if (el) el.addEventListener('input', recalcAll); });

['d1Sym','d2Sym','d3Sym','d4Sym'].forEach(id => $(id).addEventListener('change', onDealSymBlur));
$('bSym').addEventListener('change', onBuySymBlur);

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

// ── Init ───────────────────────────────────────────────────
(async () => {
  await loadMaster();
  await loadCaps();
  await loadPrices();
  initHoldingsTable();
  recalcAll();
  prefetchDefaultPrices();
})();
