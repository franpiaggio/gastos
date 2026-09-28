'use strict';

// ---------- Data ----------
const KEY = 'gastos.v1';
const CATS = {
  comida: 'Comida',
  super: 'Súper',
  transporte: 'Transporte',
  salidas: 'Salidas',
  casa: 'Casa',
  salud: 'Salud',
  ropa: 'Ropa',
  tech: 'Servidores e IA',
  otros: 'Otros',
};
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DEFAULTS = { subs: [], exps: [], paid: {}, settings: { usd: 1000 } };

function normalize(d) {
  return { ...DEFAULTS, ...d, settings: { ...DEFAULTS.settings, ...d.settings }, paid: d.paid || {} };
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.subs) && Array.isArray(d.exps)) return normalize(d);
  } catch {}
  return normalize({});
}
let db = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(db));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
navigator.storage?.persist?.();

// ---------- Helpers ----------
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const catIcon = (cat) => icon(CATS[cat] ? cat : 'otros');
const catName = (cat) => CATS[cat] || CATS.otros;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const money = (n, cur = 'ARS') =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: cur, maximumFractionDigits: cur === 'USD' ? 2 : 0 }).format(n || 0);
const toARS = (amount, cur) => (cur === 'USD' ? amount * (Number(db.settings.usd) || 0) : amount);
const inputAmount = (n) => (n === '' || n == null ? '' : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n));

// Accepts "1234", "1.234", "1234,5", "1.234,50", "$ 3.500".
function parseAmount(s) {
  s = String(s ?? '').trim().replace(/\s|\$/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s);
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const monthKey = (y, m) => `${y}-${pad(m + 1)}`;
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
const shortDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${d.getFullYear() !== today().getFullYear() ? ` ${d.getFullYear()}` : ''}`;

// ---------- Subscriptions ----------
function dueDate(sub, y, m) {
  const dim = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(sub.day, dim));
}
// `since`/`until` (YYYY-MM) keep history honest: new subs don't appear in past months,
// paused ones keep counting in the months before the pause.
function dueInMonth(sub, y, m) {
  const k = monthKey(y, m);
  if (sub.since && k < sub.since) return false;
  if (sub.active === false && (!sub.until || k >= sub.until)) return false;
  return sub.cycle !== 'yearly' || sub.month === m;
}
const thisMonthKey = () => monthKey(today().getFullYear(), today().getMonth());
const monthlyEquiv = (sub) => toARS(sub.amount, sub.currency) / (sub.cycle === 'yearly' ? 12 : 1);
const paidKey = (id, y, m) => `${id}:${monthKey(y, m)}`;

// An explicit mark wins; otherwise auto-debit subs count as paid once the due date arrives.
function isPaid(sub, y, m) {
  const k = paidKey(sub.id, y, m);
  if (k in db.paid) return db.paid[k];
  return sub.auto !== false && dueDate(sub, y, m) <= today();
}

function nextDue(sub) {
  const t = today();
  for (let i = 0; i < 24; i++) {
    const y = t.getFullYear() + Math.floor((t.getMonth() + i) / 12);
    const m = (t.getMonth() + i) % 12;
    if (!dueInMonth(sub, y, m) || isPaid(sub, y, m)) continue;
    const d = dueDate(sub, y, m);
    if (d >= t || i === 0) return d;
  }
  return null;
}

function dueBadge(date, paid, auto) {
  if (paid) return `<span class="badge ok">${auto ? 'Debitado' : 'Pagado'}</span>`;
  const n = daysBetween(today(), date);
  if (n < 0) return `<span class="badge late">Venció hace ${plural(-n, 'día', 'días')}</span>`;
  if (n === 0) return '<span class="badge late">Vence hoy</span>';
  if (n === 1) return '<span class="badge soon">Vence mañana</span>';
  if (n <= 5) return `<span class="badge soon">Vence en ${n} días</span>`;
  return `<span class="badge">${shortDate(date)}</span>`;
}

function monthData(y, m) {
  const key = monthKey(y, m);
  const exps = db.exps.filter((e) => e.date.startsWith(key)).sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  const subs = db.subs.filter((s) => dueInMonth(s, y, m)).sort((a, b) => a.day - b.day);
  const expTotal = exps.reduce((t, e) => t + e.amount, 0);
  const subTotal = subs.reduce((t, s) => t + toARS(s.amount, s.currency), 0);
  return { exps, subs, expTotal, subTotal, total: expTotal + subTotal };
}

// ---------- State ----------
let cur = { y: today().getFullYear(), m: today().getMonth() };
let tab = 'home';
const isCurrentMonth = () => cur.y === today().getFullYear() && cur.m === today().getMonth();

// ---------- Views ----------
function expRow(e) {
  return `<button class="row" data-action="edit-exp" data-id="${e.id}">
    <div class="tile">${catIcon(e.cat)}</div>
    <div class="main"><div class="name">${esc(e.desc || catName(e.cat))}</div><div class="meta">${esc(catName(e.cat))}</div></div>
    <div class="amt num"><span>${money(e.amount)}</span></div>
  </button>`;
}

function emptyBlock(title, text, action, label) {
  return `<div class="list empty"><p class="t">${title}</p><p>${text}</p>
    ${action ? `<button class="btn primary" data-action="${action}">${icon('plus')}${label}</button>` : ''}</div>`;
}

function viewWelcome() {
  return `<div class="welcome">
    <h2>Arrancá en un minuto</h2>
    <p>Cargá tus suscripciones fijas una sola vez y anotá los gastos del día a medida que aparecen. El total del mes y los vencimientos se arman solos.</p>
    <div class="stack">
      <button class="btn primary" data-action="add-sub">${icon('repeat')}Agregar una suscripción</button>
      <button class="btn" data-action="add-exp">${icon('plus')}Anotar un gasto</button>
    </div>
  </div>`;
}

function viewHome() {
  if (!db.exps.length && !db.subs.length) return viewWelcome();
  const { y, m } = cur;
  const d = monthData(y, m);
  const prev = monthData(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1);

  const byCat = {};
  const add = (c, v) => (byCat[c] = (byCat[c] || 0) + v);
  d.exps.forEach((e) => add(CATS[e.cat] ? e.cat : 'otros', e.amount));
  d.subs.forEach((s) => add(CATS[s.cat] ? s.cat : 'otros', toARS(s.amount, s.currency)));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;

  const dues = d.subs.map((s) => ({ s, date: dueDate(s, y, m), paid: isPaid(s, y, m) }));
  const pending = dues.filter((x) => !x.paid).reduce((t, x) => t + toARS(x.s.amount, x.s.currency), 0);
  const pctA = d.total ? (d.expTotal / d.total) * 100 : 0;

  return `
    <div class="summary">
      <div class="caption">Total de ${MONTHS[m]}</div>
      <div class="total num">${money(d.total)}</div>
      ${d.total ? `<div class="split-bar" aria-hidden="true">${d.expTotal ? `<i class="a" style="flex:${pctA}"></i>` : ''}${d.subTotal ? `<i class="b" style="flex:${100 - pctA}"></i>` : ''}</div>` : ''}
      <ul class="legend">
        <li><span class="dot a"></span><span class="name">Gastos diarios <span class="muted">· ${plural(d.exps.length, 'movimiento', 'movimientos')}</span></span><span class="v num">${money(d.expTotal)}</span></li>
        <li><span class="dot b"></span><span class="name">Suscripciones <span class="muted">· ${d.subs.length}</span></span><span class="v num">${money(d.subTotal)}</span></li>
        ${prev.exps.length ? `<li class="muted"><span class="name">Mes anterior (completo)</span><span class="num">${money(prev.total)}</span></li>` : ''}
      </ul>
    </div>

    <section>
      <div class="sec-head"><h2>Vencimientos</h2>
        ${dues.length ? `<span class="aside">${pending ? `Falta pagar <b class="num">${money(pending)}</b>` : 'Todo pagado'}</span>` : ''}</div>
      ${dues.length ? `<div class="list">${dues.map(({ s, date, paid }) => `
        <div class="row ${paid ? 'done' : ''}">
          <button class="check" data-action="toggle-paid" data-id="${s.id}" aria-pressed="${paid}" aria-label="${esc(s.name)}: ${paid ? 'marcar como no pagada' : 'marcar como pagada'}">${icon('check')}</button>
          <div class="main"><div class="name">${esc(s.name)}</div><div class="meta">${dueBadge(date, paid, s.auto !== false)}</div></div>
          <div class="amt num"><span>${money(toARS(s.amount, s.currency))}</span>${s.currency === 'USD' ? `<small>${money(s.amount, 'USD')}</small>` : ''}</div>
        </div>`).join('')}</div>`
        : emptyBlock('Sin vencimientos este mes', 'Cargá Netflix, Spotify, tu VPS o el gimnasio y te aviso cuándo vencen.', 'add-sub', 'Agregar suscripción')}
    </section>

    ${cats.length ? `<section>
      <div class="sec-head"><h2>Por categoría</h2></div>
      <div class="bars">${cats.map(([c, v]) => `
        <div class="bar-row"><div class="tile">${catIcon(c)}</div>
          <span>${esc(catName(c))}<span class="pct num">${Math.round((v / d.total) * 100)}%</span></span><span class="num">${money(v)}</span>
          <div class="bar"><i style="width:${(v / max) * 100}%"></i></div></div>`).join('')}
      </div>
    </section>` : ''}

    <section>
      <div class="sec-head"><h2>Últimos gastos</h2>
        ${d.exps.length > 5 ? '<button class="link-btn" data-tab="gastos">Ver todos</button>' : ''}</div>
      ${d.exps.length ? `<div class="list">${d.exps.slice(0, 5).map(expRow).join('')}</div>`
        : emptyBlock('Sin gastos este mes', 'Anotá lo que vas gastando: café, súper, un Uber.', 'add-exp', 'Anotar gasto')}
    </section>`;
}

function dayLabel(date) {
  const n = daysBetween(fromISO(date), today());
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Ayer';
  return cap(fromISO(date).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' }));
}

function viewGastos() {
  const d = monthData(cur.y, cur.m);
  if (!d.exps.length) return `<div class="summary"><div class="caption">Gastos de ${MONTHS[cur.m]}</div><div class="total num">${money(0)}</div></div>
    ${emptyBlock('Nada anotado en este mes', 'Cada gasto que cargues aparece acá, agrupado por día.', 'add-exp', 'Anotar gasto')}`;
  const days = {};
  d.exps.forEach((e) => (days[e.date] ||= []).push(e));
  const elapsed = isCurrentMonth() ? today().getDate() : new Date(cur.y, cur.m + 1, 0).getDate();
  return `<div class="summary"><div class="caption">Gastos de ${MONTHS[cur.m]}</div><div class="total num">${money(d.expTotal)}</div>
      <div class="caption">${plural(d.exps.length, 'movimiento', 'movimientos')} · promedio ${money(d.expTotal / elapsed)} por día</div></div>` +
    Object.entries(days).map(([date, list]) => `
      <div class="day-head"><span>${dayLabel(date)}</span><span class="num">${money(list.reduce((t, e) => t + e.amount, 0))}</span></div>
      <div class="list">${list.map(expRow).join('')}</div>`).join('');
}

function viewSubs() {
  if (!db.subs.length) return `<div class="summary"><div class="caption">Suscripciones por mes</div><div class="total num">${money(0)}</div></div>
    ${emptyBlock('Todavía no cargaste suscripciones', 'Streaming, apps, servidores, gimnasio: cargalas una vez y se suman solas cada mes.', 'add-sub', 'Agregar suscripción')}`;
  const active = db.subs.filter((s) => s.active !== false);
  const subs = [...db.subs].sort((a, b) => (a.active === false) - (b.active === false) || (nextDue(a) || 0) - (nextDue(b) || 0));
  const monthly = active.reduce((t, s) => t + monthlyEquiv(s), 0);
  return `<div class="summary"><div class="caption">Suscripciones por mes</div><div class="total num">${money(monthly)}</div>
      <div class="caption">${money(monthly * 12)} al año · ${plural(active.length, 'activa', 'activas')}</div></div>
    <section><div class="list">${subs.map((s) => {
      const nd = s.active !== false ? nextDue(s) : null;
      const cycle = s.cycle === 'yearly' ? `Anual · ${s.day} de ${MONTHS[s.month]}` : `Mensual · día ${s.day}`;
      return `<button class="row ${s.active === false ? 'paused' : ''}" data-action="edit-sub" data-id="${s.id}">
        <div class="tile">${catIcon(s.cat)}</div>
        <div class="main"><div class="name">${esc(s.name)}</div><div class="meta">${cycle}${s.currency === 'USD' ? ` · ≈&nbsp;${money(toARS(s.amount, 'USD'))}` : ''}${s.active === false ? ' · Pausada' : ''}</div></div>
        <div class="amt num"><span>${s.currency === 'USD' ? money(s.amount, 'USD') : money(s.amount)}</span>${nd ? dueBadge(nd, false) : ''}</div>
      </button>`;
    }).join('')}</div></section>`;
}

function renderHeader() {
  const title = $('#title');
  const monthly = tab !== 'subs';
  $('#monthNav').hidden = !monthly;
  if (monthly) {
    const year = cur.y !== today().getFullYear() ? `<span class="year">${cur.y}</span>` : '';
    const back = isCurrentMonth() ? '' : '<span class="today">Hoy</span>';
    title.innerHTML = `<span>${cap(MONTHS[cur.m])}</span>${year}${back}`;
    title.disabled = isCurrentMonth();
    title.setAttribute('aria-label', isCurrentMonth() ? `${MONTHS[cur.m]} ${cur.y}` : `${MONTHS[cur.m]} ${cur.y}. Volver al mes actual`);
  } else {
    title.textContent = 'Suscripciones';
    title.disabled = true;
    title.removeAttribute('aria-label');
  }
  document.querySelectorAll('.tabs button').forEach((b) =>
    b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  $('.fab').setAttribute('aria-label', tab === 'subs' ? 'Nueva suscripción' : 'Nuevo gasto');
}

function render() {
  renderHeader();
  $('#view').innerHTML = tab === 'home' ? viewHome() : tab === 'gastos' ? viewGastos() : viewSubs();
}

// ---------- Toast ----------
let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) $('button', el).onclick = () => { action.run(); hideToast(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 5000 : 2200);
}
const hideToast = () => { $('#toast').hidden = true; };

// ---------- Sheets ----------
const sheet = $('#sheet');
const form = $('#sheetForm');
let handlers = {};

function openSheet(title, body, h) {
  handlers = h;
  form.innerHTML = `
    <div class="grabber" aria-hidden="true"></div>
    <div class="sheet-head"><h3 id="sheetTitle">${title}</h3>
      <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Cerrar">${icon('x')}</button></div>
    ${body}
    ${h.onSave && !h.noActions ? `<div class="actions">
      ${h.onDelete ? `<button type="button" class="btn danger" data-action="sheet-delete">Eliminar</button>` : ''}
      <button type="submit" class="btn primary">${h.saveLabel || 'Guardar'}</button>
    </div>` : ''}`;
  hideToast();
  sheet.showModal();
  // Focus synchronously inside the tap handler so mobile keyboards open.
  const first = $('[data-autofocus]', form);
  if (first) first.focus();
  else form.querySelector('.sheet-head button').blur();
}
const closeSheet = () => sheet.close();

function commit(message) {
  save();
  closeSheet();
  render();
  if (message) toast(message.text, message.action);
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  clearErrors();
  const result = handlers.onSave?.(new FormData(form));
  if (result !== false) commit(result);
});
sheet.addEventListener('click', (ev) => { if (ev.target === sheet) closeSheet(); });

function clearErrors() {
  form.querySelectorAll('.err').forEach((e) => e.remove());
  form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
}
function fieldError(name, msg) {
  const input = form.elements[name];
  const holder = input.closest('.field, .amount-wrap');
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', `err-${name}`);
  holder.insertAdjacentHTML('beforeend', `<p class="err" id="err-${name}">${msg}</p>`);
  input.focus();
  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    $(`#err-${name}`)?.remove();
  }, { once: true });
  return false;
}

const catChips = (selected) => `<fieldset class="chips"><legend>Categoría</legend>${Object.entries(CATS).map(([k, n]) =>
  `<label class="chip"><input type="radio" name="cat" value="${k}" ${selected === k ? 'checked' : ''}><span>${icon(k)}${n}</span></label>`).join('')}</fieldset>`;

function recentDescriptions() {
  const seen = new Map();
  [...db.exps].sort((a, b) => b.created - a.created).forEach((e) => {
    const k = e.desc?.trim().toLowerCase();
    if (k && !seen.has(k)) seen.set(k, e);
  });
  return [...seen.values()].slice(0, 40);
}

function expenseSheet(e) {
  const isNew = !e;
  let date = iso(today());
  if (isNew && !isCurrentMonth()) date = iso(new Date(cur.y, cur.m, 1));
  e ||= { date, cat: 'comida', amount: '', desc: '' };
  const recent = recentDescriptions();
  openSheet(isNew ? 'Nuevo gasto' : 'Editar gasto', `
    <div class="amount-wrap">
      <label class="amount"><span class="cur">$</span><input class="num" name="amount" inputmode="decimal" enterkeyhint="done" placeholder="0" aria-label="Monto" value="${inputAmount(e.amount)}" ${isNew ? 'data-autofocus' : ''}></label>
    </div>
    <label class="field"><span>Descripción</span>
      <input class="input" name="desc" list="descs" value="${esc(e.desc)}" placeholder="Ej: almuerzo, Uber, farmacia" maxlength="60" enterkeyhint="done" autocapitalize="sentences"></label>
    <datalist id="descs">${recent.map((r) => `<option value="${esc(r.desc)}">`).join('')}</datalist>
    ${catChips(CATS[e.cat] ? e.cat : 'otros')}
    <label class="field"><span>Fecha</span><input class="input" type="date" name="date" value="${e.date}"></label>`,
  {
    onSave(fd) {
      const amount = parseAmount(fd.get('amount'));
      if (!(amount > 0)) return fieldError('amount', 'Ingresá un monto mayor a cero.');
      const dateVal = fd.get('date') || iso(today());
      const data = { amount, desc: fd.get('desc').trim(), cat: fd.get('cat') || 'otros', date: dateVal };
      if (isNew) db.exps.push({ id: uid(), created: Date.now(), ...data });
      else Object.assign(db.exps.find((x) => x.id === e.id), data);
      const dt = fromISO(dateVal);
      const moved = dt.getFullYear() !== cur.y || dt.getMonth() !== cur.m;
      if (moved) cur = { y: dt.getFullYear(), m: dt.getMonth() };
      return { text: isNew ? `Gasto de ${money(amount)} guardado${moved ? ` en ${MONTHS[dt.getMonth()]}` : ''}` : 'Cambios guardados' };
    },
    onDelete: isNew ? null : () => {
      const i = db.exps.findIndex((x) => x.id === e.id);
      const [removed] = db.exps.splice(i, 1);
      commit({ text: 'Gasto eliminado', action: { label: 'Deshacer', run: () => { db.exps.splice(i, 0, removed); save(); render(); } } });
    },
  });
  // Picking a previous description reuses its category.
  form.elements.desc.addEventListener('input', (ev) => {
    const hit = recent.find((r) => r.desc.toLowerCase() === ev.target.value.trim().toLowerCase());
    if (hit && CATS[hit.cat]) form.querySelector(`[name=cat][value="${hit.cat}"]`).checked = true;
  });
}

function subSheet(s) {
  const isNew = !s;
  s ||= { name: '', amount: '', currency: 'ARS', cycle: 'monthly', day: today().getDate(), month: today().getMonth(), active: true, auto: true, cat: 'otros' };
  openSheet(isNew ? 'Nueva suscripción' : 'Editar suscripción', `
    <label class="field"><span>Nombre</span>
      <input class="input" name="name" value="${esc(s.name)}" placeholder="Ej: Netflix, Hetzner, ChatGPT" maxlength="40" autocapitalize="words" enterkeyhint="next" ${isNew ? 'data-autofocus' : ''}></label>
    <div class="grid2">
      <label class="field"><span>Monto</span><input class="input num" name="amount" inputmode="decimal" value="${inputAmount(s.amount)}" placeholder="0"></label>
      <label class="field"><span>Moneda</span><select class="input" name="currency">
        <option value="ARS" ${s.currency !== 'USD' ? 'selected' : ''}>Pesos (ARS)</option>
        <option value="USD" ${s.currency === 'USD' ? 'selected' : ''}>Dólares (USD)</option>
      </select></label>
    </div>
    ${catChips(CATS[s.cat] ? s.cat : 'otros')}
    <div class="field"><span>Se cobra</span>
      <div class="seg" role="radiogroup" aria-label="Frecuencia">
        <label class="chip"><input type="radio" name="cycle" value="monthly" ${s.cycle !== 'yearly' ? 'checked' : ''}><span>Todos los meses</span></label>
        <label class="chip"><input type="radio" name="cycle" value="yearly" ${s.cycle === 'yearly' ? 'checked' : ''}><span>Una vez al año</span></label>
      </div></div>
    <div class="grid2">
      <label class="field"><span>Día de cobro</span><input class="input num" name="day" type="number" inputmode="numeric" min="1" max="31" value="${s.day}"></label>
      <label class="field" id="monthField" ${s.cycle === 'yearly' ? '' : 'hidden'}><span>Mes</span><select class="input" name="month">
        ${MONTHS.map((n, i) => `<option value="${i}" ${s.month === i ? 'selected' : ''}>${cap(n)}</option>`).join('')}
      </select></label>
    </div>
    <div class="group">
      <label class="switch"><span class="txt">Débito automático<small>Se marca como pagada sola al llegar la fecha</small></span>
        <input type="checkbox" role="switch" name="auto" ${s.auto !== false ? 'checked' : ''}></label>
      ${isNew ? '' : `<label class="switch"><span class="txt">Pausada<small>No suma al total ni aparece en vencimientos</small></span>
        <input type="checkbox" role="switch" name="paused" ${s.active === false ? 'checked' : ''}></label>`}
    </div>`,
  {
    onSave(fd) {
      const name = fd.get('name').trim();
      if (!name) return fieldError('name', 'Poné un nombre para reconocerla.');
      const amount = parseAmount(fd.get('amount'));
      if (!(amount > 0)) return fieldError('amount', 'Ingresá un monto mayor a cero.');
      const day = Number(fd.get('day'));
      if (!(day >= 1 && day <= 31 && Number.isInteger(day))) return fieldError('day', 'Elegí un día entre 1 y 31.');
      const paused = !!fd.get('paused');
      const data = {
        name, amount, day,
        currency: fd.get('currency'),
        cycle: fd.get('cycle'),
        month: Number(fd.get('month')),
        active: !paused,
        until: paused ? (s.active === false ? s.until : thisMonthKey()) : undefined,
        auto: !!fd.get('auto'),
        cat: fd.get('cat') || 'otros',
      };
      if (isNew) db.subs.push({ id: uid(), since: thisMonthKey(), ...data });
      else Object.assign(db.subs.find((x) => x.id === s.id), data);
      return { text: isNew ? `${name} agregada` : 'Cambios guardados' };
    },
    onDelete: isNew ? null : () => {
      const i = db.subs.findIndex((x) => x.id === s.id);
      const [removed] = db.subs.splice(i, 1);
      const paid = Object.entries(db.paid).filter(([k]) => k.startsWith(s.id + ':'));
      paid.forEach(([k]) => delete db.paid[k]);
      commit({ text: `${removed.name} eliminada`, action: { label: 'Deshacer', run: () => {
        db.subs.splice(i, 0, removed);
        paid.forEach(([k, v]) => (db.paid[k] = v));
        save(); render();
      } } });
    },
  });
  form.querySelectorAll('[name=cycle]').forEach((r) =>
    r.addEventListener('change', () => { $('#monthField').hidden = form.elements.cycle.value !== 'yearly'; }));
}

function settingsSheet() {
  const last = db.settings.lastBackup ? fromISO(db.settings.lastBackup) : null;
  const ago = last ? daysBetween(last, today()) : null;
  const lastText = !last ? 'Todavía no hiciste ningún backup.'
    : ago === 0 ? 'Último backup: hoy.' : `Último backup: ${shortDate(last)} (hace ${plural(ago, 'día', 'días')}).`;
  openSheet('Ajustes', `
    <label class="field"><span>Cotización del dólar</span>
      <input class="input num" name="usd" inputmode="decimal" enterkeyhint="done" value="${inputAmount(db.settings.usd)}"></label>
    <p class="hint">Se usa para pasar a pesos las suscripciones en dólares. Se guarda al salir del campo.</p>
    <p class="set-title">Tus datos</p>
    <p class="hint">Se guardan sólo en este dispositivo: ${plural(db.exps.length, 'gasto', 'gastos')} y ${plural(db.subs.length, 'suscripción', 'suscripciones')}. ${lastText}</p>
    <div class="grid2">
      <button type="button" class="btn" data-action="export">${icon('download')}Exportar</button>
      <button type="button" class="btn" data-action="import">${icon('upload')}Importar</button>
    </div>`,
  {
    noActions: true,
    onSave(fd) {
      const usd = parseAmount(fd.get('usd'));
      if (!(usd > 0)) return fieldError('usd', 'Ingresá una cotización válida.');
      db.settings.usd = usd;
      return { text: 'Cotización actualizada' };
    },
  });
  // Save in place so the sheet stays open for export/import.
  form.elements.usd.addEventListener('change', (ev) => {
    clearErrors();
    const usd = parseAmount(ev.target.value);
    if (!(usd > 0)) return fieldError('usd', 'Ingresá una cotización válida.');
    db.settings.usd = usd;
    ev.target.value = inputAmount(usd);
    save();
    render();
  });
}

function exportData() {
  db.settings.lastBackup = iso(today());
  save();
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gastos-${iso(today())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  closeSheet();
  toast('Backup descargado');
}

$('#importFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  let d;
  try {
    d = JSON.parse(await file.text());
    if (!Array.isArray(d.subs) || !Array.isArray(d.exps)) throw new Error('format');
  } catch {
    closeSheet();
    toast('Ese archivo no es un backup de Gastos');
    return;
  }
  openSheet('Reemplazar datos', `
    <p class="hint">El backup tiene ${plural(d.exps.length, 'gasto', 'gastos')} y ${plural(d.subs.length, 'suscripción', 'suscripciones')}.
    Va a reemplazar todo lo que hay ahora en este dispositivo (${plural(db.exps.length, 'gasto', 'gastos')} y ${plural(db.subs.length, 'suscripción', 'suscripciones')}).</p>`,
  {
    saveLabel: 'Reemplazar',
    onSave() {
      db = normalize(d);
      cur = { y: today().getFullYear(), m: today().getMonth() };
      return { text: 'Datos importados' };
    },
  });
});

// ---------- Events ----------
function shiftMonth(delta) {
  const d = new Date(cur.y, cur.m + delta, 1);
  cur = { y: d.getFullYear(), m: d.getMonth() };
  render();
}

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-action],[data-tab]');
  if (!t) return;
  if (t.dataset.tab) {
    if (sheet.open) closeSheet();
    tab = t.dataset.tab;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const id = t.dataset.id;
  switch (t.dataset.action) {
    case 'prev-month': shiftMonth(-1); break;
    case 'next-month': shiftMonth(1); break;
    case 'today': cur = { y: today().getFullYear(), m: today().getMonth() }; render(); break;
    case 'add': tab === 'subs' ? subSheet() : expenseSheet(); break;
    case 'add-exp': expenseSheet(); break;
    case 'add-sub': subSheet(); break;
    case 'edit-exp': expenseSheet(db.exps.find((x) => x.id === id)); break;
    case 'edit-sub': subSheet(db.subs.find((x) => x.id === id)); break;
    case 'settings': settingsSheet(); break;
    case 'close-sheet': closeSheet(); break;
    case 'sheet-delete': handlers.onDelete?.(); break;
    case 'export': exportData(); break;
    case 'import': $('#importFile').click(); break;
    case 'toggle-paid': {
      const sub = db.subs.find((x) => x.id === id);
      db.paid[paidKey(id, cur.y, cur.m)] = !isPaid(sub, cur.y, cur.m);
      save();
      render();
      break;
    }
  }
});

// Horizontal swipe on the content changes month; screen edges are left to the OS back gesture.
let touch = null;
$('#view').addEventListener('touchstart', (e) => {
  const { clientX: x, clientY: y } = e.touches[0];
  touch = x > 30 && x < innerWidth - 30 ? { x, y } : null;
}, { passive: true });
$('#view').addEventListener('touchend', (e) => {
  if (!touch || tab === 'subs') return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) shiftMonth(dx > 0 ? -1 : 1);
}, { passive: true });

// Refresh "today"-relative labels when the app comes back to the foreground.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !sheet.open) render(); });

render();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
