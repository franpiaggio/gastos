import {
  CATS, MONTHS, asCategory, byCategory, cap, daysBetween, dueDate, emptyData, fromISO, inputAmount, iso, isPaid,
  money, monthData, monthKey, monthlyEquiv, nextDue, paidKey, parseAmount, parseData, plural, shiftMonth, startOfDay,
  toARS, uid,
  type CategoryId, type Data, type Expense, type Month, type Subscription,
} from './lib.js';

// ---------- Storage ----------
const KEY = 'gastos.v1';

function load(): Data {
  try {
    return parseData(JSON.parse(localStorage.getItem(KEY) ?? 'null')) ?? emptyData();
  } catch {
    return emptyData();
  }
}
let db = load();
const save = (): void => localStorage.setItem(KEY, JSON.stringify(db));
void navigator.storage?.persist?.();

// ---------- DOM helpers ----------
function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}
const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const icon = (name: string): string => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const catName = (cat: CategoryId): string => CATS[cat];

const today = (): Date => startOfDay(new Date());
const thisMonth = (): Month => ({ y: today().getFullYear(), m: today().getMonth() });
const shortDate = (d: Date): string =>
  `${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)}${d.getFullYear() !== today().getFullYear() ? ` ${d.getFullYear()}` : ''}`;

// ---------- State ----------
type Tab = 'home' | 'gastos' | 'subs';
let cur: Month = thisMonth();
let tab: Tab = 'home';
const isCurrentMonth = (): boolean => cur.y === today().getFullYear() && cur.m === today().getMonth();
const monthName = (m: number): string => MONTHS[m]!;

// ---------- Views ----------
function dueBadge(date: Date, paid: boolean, auto = false): string {
  if (paid) return `<span class="badge ok">${auto ? 'Debitado' : 'Pagado'}</span>`;
  const n = daysBetween(today(), date);
  if (n < 0) return `<span class="badge late">Venció hace ${plural(-n, 'día', 'días')}</span>`;
  if (n === 0) return '<span class="badge late">Vence hoy</span>';
  if (n === 1) return '<span class="badge soon">Vence mañana</span>';
  if (n <= 5) return `<span class="badge soon">Vence en ${n} días</span>`;
  return `<span class="badge">${shortDate(date)}</span>`;
}

function expRow(e: Expense): string {
  return `<button class="row" data-action="edit-exp" data-id="${e.id}">
    <div class="tile">${icon(e.cat)}</div>
    <div class="main"><div class="name">${esc(e.desc || catName(e.cat))}</div><div class="meta">${esc(catName(e.cat))}</div></div>
    <div class="amt num"><span>${money(e.amount)}</span></div>
  </button>`;
}

function emptyBlock(title: string, text: string, action: string, label: string): string {
  return `<div class="list empty"><p class="t">${title}</p><p>${text}</p>
    <button class="btn primary" data-action="${action}">${icon('plus')}${label}</button></div>`;
}

function viewWelcome(): string {
  return `<div class="welcome">
    <h2>Arrancá en un minuto</h2>
    <p>Cargá tus suscripciones fijas una sola vez y anotá los gastos del día a medida que aparecen. El total del mes y los vencimientos se arman solos.</p>
    <div class="stack">
      <button class="btn primary" data-action="add-sub">${icon('repeat')}Agregar una suscripción</button>
      <button class="btn" data-action="add-exp">${icon('plus')}Anotar un gasto</button>
    </div>
  </div>`;
}

function viewHome(): string {
  if (!db.exps.length && !db.subs.length) return viewWelcome();
  const { y, m } = cur;
  const d = monthData(db, y, m);
  const prevMonth = shiftMonth(cur, -1);
  const prev = monthData(db, prevMonth.y, prevMonth.m);
  const cats = byCategory(db, d);
  const max = cats[0]?.[1] || 1;

  const dues = d.subs.map((s) => ({ s, date: dueDate(s, y, m), paid: isPaid(db, s, y, m, today()) }));
  const pending = dues.filter((x) => !x.paid).reduce((t, x) => t + toARS(db, x.s.amount, x.s.currency), 0);
  const pctA = d.total ? (d.expTotal / d.total) * 100 : 0;

  return `
    <div class="summary">
      <div class="caption">Total de ${monthName(m)}</div>
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
          <div class="main"><div class="name">${esc(s.name)}</div><div class="meta">${dueBadge(date, paid, s.auto)}</div></div>
          <div class="amt num"><span>${money(toARS(db, s.amount, s.currency))}</span>${s.currency === 'USD' ? `<small>${money(s.amount, 'USD')}</small>` : ''}</div>
        </div>`).join('')}</div>`
        : emptyBlock('Sin vencimientos este mes', 'Cargá Netflix, Spotify, tu VPS o el gimnasio y te aviso cuándo vencen.', 'add-sub', 'Agregar suscripción')}
    </section>

    ${cats.length ? `<section>
      <div class="sec-head"><h2>Por categoría</h2></div>
      <div class="bars">${cats.map(([c, v]) => `
        <div class="bar-row"><div class="tile">${icon(c)}</div>
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

function dayLabel(date: string): string {
  const n = daysBetween(fromISO(date), today());
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Ayer';
  return cap(fromISO(date).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' }));
}

function viewGastos(): string {
  const d = monthData(db, cur.y, cur.m);
  const head = (body: string) => `<div class="summary"><div class="caption">Gastos de ${monthName(cur.m)}</div>${body}</div>`;
  if (!d.exps.length) {
    return head(`<div class="total num">${money(0)}</div>`) +
      emptyBlock('Nada anotado en este mes', 'Cada gasto que cargues aparece acá, agrupado por día.', 'add-exp', 'Anotar gasto');
  }
  const days = new Map<string, Expense[]>();
  d.exps.forEach((e) => days.set(e.date, [...(days.get(e.date) ?? []), e]));
  const elapsed = isCurrentMonth() ? today().getDate() : new Date(cur.y, cur.m + 1, 0).getDate();
  return head(`<div class="total num">${money(d.expTotal)}</div>
      <div class="caption">${plural(d.exps.length, 'movimiento', 'movimientos')} · promedio ${money(d.expTotal / elapsed)} por día</div>`) +
    [...days.entries()].map(([date, list]) => `
      <div class="day-head"><span>${dayLabel(date)}</span><span class="num">${money(list.reduce((t, e) => t + e.amount, 0))}</span></div>
      <div class="list">${list.map(expRow).join('')}</div>`).join('');
}

function viewSubs(): string {
  const head = (total: number, sub = '') =>
    `<div class="summary"><div class="caption">Suscripciones por mes</div><div class="total num">${money(total)}</div>${sub}</div>`;
  if (!db.subs.length) {
    return head(0) + emptyBlock('Todavía no cargaste suscripciones', 'Streaming, apps, servidores, gimnasio: cargalas una vez y se suman solas cada mes.', 'add-sub', 'Agregar suscripción');
  }
  const t = today();
  const active = db.subs.filter((s) => s.active);
  const due = (s: Subscription) => (s.active ? nextDue(db, s, t)?.getTime() ?? Infinity : Infinity);
  const subs = [...db.subs].sort((a, b) => Number(!a.active) - Number(!b.active) || due(a) - due(b));
  const monthly = active.reduce((sum, s) => sum + monthlyEquiv(db, s), 0);
  return head(monthly, `<div class="caption">${money(monthly * 12)} al año · ${plural(active.length, 'activa', 'activas')}</div>`) +
    `<section><div class="list">${subs.map((s) => {
      const nd = s.active ? nextDue(db, s, t) : null;
      const cycle = s.cycle === 'yearly' ? `Anual · ${s.day} de ${monthName(s.month)}` : `Mensual · día ${s.day}`;
      const ars = s.currency === 'USD' ? ` · ≈&nbsp;${money(toARS(db, s.amount, 'USD'))}` : '';
      return `<button class="row ${s.active ? '' : 'paused'}" data-action="edit-sub" data-id="${s.id}">
        <div class="tile">${icon(s.cat)}</div>
        <div class="main"><div class="name">${esc(s.name)}</div><div class="meta">${cycle}${ars}${s.active ? '' : ' · Pausada'}</div></div>
        <div class="amt num"><span>${money(s.amount, s.currency)}</span>${nd ? dueBadge(nd, false) : ''}</div>
      </button>`;
    }).join('')}</div></section>`;
}

function renderHeader(): void {
  const title = $<HTMLButtonElement>('#title');
  const monthly = tab !== 'subs';
  $('#monthNav').hidden = !monthly;
  if (monthly) {
    const year = cur.y !== today().getFullYear() ? `<span class="year">${cur.y}</span>` : '';
    const back = isCurrentMonth() ? '' : '<span class="today">Hoy</span>';
    title.innerHTML = `<span>${cap(monthName(cur.m))}</span>${year}${back}`;
    title.disabled = isCurrentMonth();
    title.setAttribute('aria-label', `${monthName(cur.m)} ${cur.y}${isCurrentMonth() ? '' : '. Volver al mes actual'}`);
  } else {
    title.textContent = 'Suscripciones';
    title.disabled = true;
    title.removeAttribute('aria-label');
  }
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
    b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  $('.fab').setAttribute('aria-label', tab === 'subs' ? 'Nueva suscripción' : 'Nuevo gasto');
}

function render(): void {
  renderHeader();
  $('#view').innerHTML = tab === 'home' ? viewHome() : tab === 'gastos' ? viewGastos() : viewSubs();
}

// ---------- Toast ----------
interface ToastAction { label: string; run: () => void }
interface Message { text: string; action?: ToastAction }

let toastTimer: number | undefined;
function toast({ text, action }: Message): void {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) $<HTMLButtonElement>('button', el).onclick = () => { action.run(); hideToast(); };
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, action ? 5000 : 2200);
}
const hideToast = (): void => { $('#toast').hidden = true; };

// ---------- Sheets ----------
const sheet = $<HTMLDialogElement>('#sheet');
const form = $<HTMLFormElement>('#sheetForm');

interface SheetHandlers {
  /** Returns the confirmation message, or false to keep the sheet open (validation failed). */
  onSave?: (fd: FormData) => Message | false;
  onDelete?: () => void;
  saveLabel?: string;
  /** Hide the bottom action row (the sheet saves in place). */
  noActions?: boolean;
}
let handlers: SheetHandlers = {};

type Field = HTMLInputElement | HTMLSelectElement;
const field = (name: string): Field => {
  const el = form.elements.namedItem(name);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) throw new Error(`Missing field: ${name}`);
  return el;
};
const text = (fd: FormData, name: string): string => {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

function openSheet(title: string, body: string, h: SheetHandlers): void {
  handlers = h;
  form.innerHTML = `
    <div class="grabber" aria-hidden="true"></div>
    <div class="sheet-head"><h3 id="sheetTitle">${title}</h3>
      <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Cerrar">${icon('x')}</button></div>
    ${body}
    ${h.onSave && !h.noActions ? `<div class="actions">
      ${h.onDelete ? '<button type="button" class="btn danger" data-action="sheet-delete">Eliminar</button>' : ''}
      <button type="submit" class="btn primary">${h.saveLabel ?? 'Guardar'}</button>
    </div>` : ''}`;
  hideToast();
  sheet.showModal();
  // Focus synchronously inside the tap handler so mobile keyboards open.
  const first = form.querySelector<HTMLElement>('[data-autofocus]');
  if (first) first.focus();
  else form.querySelector<HTMLElement>('.sheet-head button')?.blur();
}
const closeSheet = (): void => sheet.close();

function commit(message?: Message): void {
  save();
  closeSheet();
  render();
  if (message) toast(message);
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  clearErrors();
  const result = handlers.onSave?.(new FormData(form));
  if (result !== false) commit(result);
});
sheet.addEventListener('click', (ev) => { if (ev.target === sheet) closeSheet(); });

function clearErrors(): void {
  form.querySelectorAll('.err').forEach((e) => e.remove());
  form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
}

function fieldError(name: string, msg: string): false {
  const input = field(name);
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', `err-${name}`);
  input.closest('.field, .amount-wrap')?.insertAdjacentHTML('beforeend', `<p class="err" id="err-${name}">${msg}</p>`);
  input.focus();
  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    document.getElementById(`err-${name}`)?.remove();
  }, { once: true });
  return false;
}

const catChips = (selected: CategoryId): string =>
  `<fieldset class="chips"><legend>Categoría</legend>${(Object.keys(CATS) as CategoryId[]).map((k) =>
    `<label class="chip"><input type="radio" name="cat" value="${k}" ${selected === k ? 'checked' : ''}><span>${icon(k)}${CATS[k]}</span></label>`).join('')}</fieldset>`;

function recentDescriptions(): Expense[] {
  const seen = new Map<string, Expense>();
  [...db.exps].sort((a, b) => b.created - a.created).forEach((e) => {
    const k = e.desc.trim().toLowerCase();
    if (k && !seen.has(k)) seen.set(k, e);
  });
  return [...seen.values()].slice(0, 40);
}

function expenseSheet(existing?: Expense): void {
  const isNew = !existing;
  const e = existing ?? {
    date: iso(isCurrentMonth() ? today() : new Date(cur.y, cur.m, 1)),
    cat: 'comida' as CategoryId, amount: '' as const, desc: '',
  };
  const recent = recentDescriptions();
  openSheet(isNew ? 'Nuevo gasto' : 'Editar gasto', `
    <div class="amount-wrap">
      <label class="amount"><span class="cur">$</span><input class="num" name="amount" inputmode="decimal" enterkeyhint="done" placeholder="0" aria-label="Monto" value="${inputAmount(e.amount)}" ${isNew ? 'data-autofocus' : ''}></label>
    </div>
    <label class="field"><span>Descripción</span>
      <input class="input" name="desc" list="descs" value="${esc(e.desc)}" placeholder="Ej: almuerzo, Uber, farmacia" maxlength="60" enterkeyhint="done" autocapitalize="sentences"></label>
    <datalist id="descs">${recent.map((r) => `<option value="${esc(r.desc)}">`).join('')}</datalist>
    ${catChips(e.cat)}
    <label class="field"><span>Fecha</span><input class="input" type="date" name="date" value="${e.date}"></label>`,
  {
    onSave(fd) {
      const amount = parseAmount(fd.get('amount'));
      if (!(amount > 0)) return fieldError('amount', 'Ingresá un monto mayor a cero.');
      const date = text(fd, 'date') || iso(today());
      const data = { amount, desc: text(fd, 'desc'), cat: asCategory(fd.get('cat')), date };
      if (existing) Object.assign(existing, data);
      else db.exps.push({ id: uid(), created: Date.now(), ...data });
      const dt = fromISO(date);
      const moved = dt.getFullYear() !== cur.y || dt.getMonth() !== cur.m;
      if (moved) cur = { y: dt.getFullYear(), m: dt.getMonth() };
      return { text: isNew ? `Gasto de ${money(amount)} guardado${moved ? ` en ${monthName(dt.getMonth())}` : ''}` : 'Cambios guardados' };
    },
    ...(existing && {
      onDelete() {
        const i = db.exps.indexOf(existing);
        db.exps.splice(i, 1);
        commit({ text: 'Gasto eliminado', action: { label: 'Deshacer', run: () => { db.exps.splice(i, 0, existing); save(); render(); } } });
      },
    }),
  });
  // Picking a previous description reuses its category.
  field('desc').addEventListener('input', (ev) => {
    const value = (ev.target as HTMLInputElement).value.trim().toLowerCase();
    const hit = recent.find((r) => r.desc.toLowerCase() === value);
    if (hit) form.querySelector<HTMLInputElement>(`[name=cat][value="${hit.cat}"]`)!.checked = true;
  });
}

function subSheet(existing?: Subscription): void {
  const isNew = !existing;
  const s = existing ?? {
    name: '', amount: '' as const, currency: 'ARS', cycle: 'monthly', day: today().getDate(), month: today().getMonth(),
    active: true, auto: true, cat: 'otros' as CategoryId,
  };
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
    ${catChips(s.cat)}
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
        <input type="checkbox" role="switch" name="auto" ${s.auto ? 'checked' : ''}></label>
      ${isNew ? '' : `<label class="switch"><span class="txt">Pausada<small>No suma al total ni aparece en vencimientos</small></span>
        <input type="checkbox" role="switch" name="paused" ${s.active ? '' : 'checked'}></label>`}
    </div>`,
  {
    onSave(fd) {
      const name = text(fd, 'name');
      if (!name) return fieldError('name', 'Poné un nombre para reconocerla.');
      const amount = parseAmount(fd.get('amount'));
      if (!(amount > 0)) return fieldError('amount', 'Ingresá un monto mayor a cero.');
      const day = Number(fd.get('day'));
      if (!(Number.isInteger(day) && day >= 1 && day <= 31)) return fieldError('day', 'Elegí un día entre 1 y 31.');
      const paused = fd.has('paused');
      const data: Omit<Subscription, 'id'> = {
        name, amount, day,
        currency: fd.get('currency') === 'USD' ? 'USD' : 'ARS',
        cycle: fd.get('cycle') === 'yearly' ? 'yearly' : 'monthly',
        month: Number(fd.get('month')),
        active: !paused,
        auto: fd.has('auto'),
        cat: asCategory(fd.get('cat')),
      };
      if (existing) {
        const until = paused ? (existing.active ? monthKey(today().getFullYear(), today().getMonth()) : existing.until) : undefined;
        Object.assign(existing, data);
        if (until) existing.until = until;
        else delete existing.until;
      } else {
        db.subs.push({ id: uid(), since: monthKey(today().getFullYear(), today().getMonth()), ...data });
      }
      return { text: isNew ? `${name} agregada` : 'Cambios guardados' };
    },
    ...(existing && {
      onDelete() {
        const i = db.subs.indexOf(existing);
        db.subs.splice(i, 1);
        const marks = Object.entries(db.paid).filter(([k]) => k.startsWith(`${existing.id}:`));
        marks.forEach(([k]) => delete db.paid[k]);
        commit({
          text: `${existing.name} eliminada`,
          action: { label: 'Deshacer', run: () => {
            db.subs.splice(i, 0, existing);
            marks.forEach(([k, v]) => (db.paid[k] = v));
            save();
            render();
          } },
        });
      },
    }),
  });
  form.querySelectorAll<HTMLInputElement>('[name=cycle]').forEach((r) =>
    r.addEventListener('change', () => {
      $('#monthField').hidden = form.querySelector<HTMLInputElement>('[name=cycle]:checked')?.value !== 'yearly';
    }));
}

function settingsSheet(): void {
  const last = db.settings.lastBackup ? fromISO(db.settings.lastBackup) : null;
  const ago = last ? daysBetween(last, today()) : 0;
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
  const usdInput = field('usd');
  usdInput.addEventListener('change', () => {
    clearErrors();
    const usd = parseAmount(usdInput.value);
    if (!(usd > 0)) return void fieldError('usd', 'Ingresá una cotización válida.');
    db.settings.usd = usd;
    usdInput.value = inputAmount(usd);
    save();
    render();
  });
}

function exportData(): void {
  db.settings.lastBackup = iso(today());
  save();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }));
  a.download = `gastos-${iso(today())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  closeSheet();
  toast({ text: 'Backup descargado' });
}

const importInput = $<HTMLInputElement>('#importFile');
importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  importInput.value = '';
  if (!file) return;
  let incoming: Data | null = null;
  try {
    incoming = parseData(JSON.parse(await file.text()));
  } catch { /* handled below */ }
  if (!incoming) {
    closeSheet();
    toast({ text: 'Ese archivo no es un backup de Gastos' });
    return;
  }
  const data = incoming;
  const count = (d: Data) => `${plural(d.exps.length, 'gasto', 'gastos')} y ${plural(d.subs.length, 'suscripción', 'suscripciones')}`;
  openSheet('Reemplazar datos', `
    <p class="hint">El backup tiene ${count(data)}. Va a reemplazar todo lo que hay ahora en este dispositivo (${count(db)}).</p>`,
  {
    saveLabel: 'Reemplazar',
    onSave() {
      db = data;
      cur = thisMonth();
      return { text: 'Datos importados' };
    },
  });
});

// ---------- Events ----------
function goToMonth(month: Month): void {
  cur = month;
  render();
}

document.addEventListener('click', (ev) => {
  const t = (ev.target as Element).closest<HTMLElement>('[data-action],[data-tab]');
  if (!t) return;
  if (t.dataset.tab) {
    if (sheet.open) closeSheet();
    tab = t.dataset.tab as Tab;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const id = t.dataset.id;
  switch (t.dataset.action) {
    case 'prev-month': goToMonth(shiftMonth(cur, -1)); break;
    case 'next-month': goToMonth(shiftMonth(cur, 1)); break;
    case 'today': goToMonth(thisMonth()); break;
    case 'add': if (tab === 'subs') subSheet(); else expenseSheet(); break;
    case 'add-exp': expenseSheet(); break;
    case 'add-sub': subSheet(); break;
    case 'edit-exp': expenseSheet(db.exps.find((x) => x.id === id)); break;
    case 'edit-sub': subSheet(db.subs.find((x) => x.id === id)); break;
    case 'settings': settingsSheet(); break;
    case 'close-sheet': closeSheet(); break;
    case 'sheet-delete': handlers.onDelete?.(); break;
    case 'export': exportData(); break;
    case 'import': importInput.click(); break;
    case 'toggle-paid': {
      const sub = db.subs.find((x) => x.id === id);
      if (!sub) break;
      db.paid[paidKey(sub.id, cur.y, cur.m)] = !isPaid(db, sub, cur.y, cur.m, today());
      save();
      render();
      break;
    }
  }
});

// Horizontal swipe on the content changes month; screen edges are left to the OS back gesture.
const view = $('#view');
let touch: { x: number; y: number } | null = null;
view.addEventListener('touchstart', (e) => {
  const p = e.touches[0];
  touch = p && p.clientX > 30 && p.clientX < innerWidth - 30 ? { x: p.clientX, y: p.clientY } : null;
}, { passive: true });
view.addEventListener('touchend', (e) => {
  const p = e.changedTouches[0];
  if (!touch || !p || tab === 'subs') return;
  const dx = p.clientX - touch.x;
  const dy = p.clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) goToMonth(shiftMonth(cur, dx > 0 ? -1 : 1));
}, { passive: true });

// Refresh "today"-relative labels when the app comes back to the foreground.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !sheet.open) render(); });

render();

if ('serviceWorker' in navigator) void navigator.serviceWorker.register('sw.js');
