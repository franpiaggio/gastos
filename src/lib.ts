// Pure domain logic: no DOM, no storage, no clock. `today` is always passed in.

export type Currency = 'ARS' | 'USD';
export type Cycle = 'monthly' | 'yearly';

export const CATS = {
  comida: 'Comida',
  super: 'Súper',
  transporte: 'Transporte',
  salidas: 'Salidas',
  casa: 'Casa',
  salud: 'Salud',
  ropa: 'Ropa',
  tech: 'Servidores e IA',
  otros: 'Otros',
} as const;
export type CategoryId = keyof typeof CATS;

export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;

export interface Expense {
  id: string;
  created: number;
  amount: number;
  desc: string;
  cat: CategoryId;
  /** YYYY-MM-DD */
  date: string;
}

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  currency: Currency;
  cycle: Cycle;
  /** Billing day, 1-31 (clamped to the month's length). */
  day: number;
  /** Billing month for yearly subscriptions, 0-11. */
  month: number;
  active: boolean;
  /** Auto-debit: counts as paid once the due date arrives. */
  auto: boolean;
  cat: CategoryId;
  /** First month it applies to (YYYY-MM). */
  since?: string;
  /** Month it was paused (YYYY-MM); months before it still count. */
  until?: string;
}

export interface Settings {
  usd: number;
  /** YYYY-MM-DD */
  lastBackup?: string;
}

export interface Data {
  subs: Subscription[];
  exps: Expense[];
  /** Explicit paid marks, keyed by `${subId}:${YYYY-MM}`. */
  paid: Record<string, boolean>;
  settings: Settings;
}

export interface Month {
  y: number;
  /** 0-11 */
  m: number;
}

// ---------- Validation ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const asCategory = (v: unknown): CategoryId => (typeof v === 'string' && v in CATS ? (v as CategoryId) : 'otros');

/** Parses stored or imported data. Returns null when the shape is not a Gastos backup. */
export function parseData(raw: unknown): Data | null {
  if (!isObj(raw) || !Array.isArray(raw.subs) || !Array.isArray(raw.exps)) return null;
  const settings = isObj(raw.settings) ? raw.settings : {};
  const paid: Record<string, boolean> = {};
  if (isObj(raw.paid)) for (const [k, v] of Object.entries(raw.paid)) if (typeof v === 'boolean') paid[k] = v;

  const exps: Expense[] = raw.exps.filter(isObj).map((e) => ({
    id: str(e.id) || uid(),
    created: num(e.created),
    amount: num(e.amount),
    desc: str(e.desc),
    cat: asCategory(e.cat),
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(e.date)) ? str(e.date) : '1970-01-01',
  }));

  const subs: Subscription[] = raw.subs.filter(isObj).map((s) => ({
    id: str(s.id) || uid(),
    name: str(s.name),
    amount: num(s.amount),
    currency: s.currency === 'USD' ? 'USD' : 'ARS',
    cycle: s.cycle === 'yearly' ? 'yearly' : 'monthly',
    day: Math.min(31, Math.max(1, Math.round(num(s.day, 1)))),
    month: Math.min(11, Math.max(0, Math.round(num(s.month)))),
    active: s.active !== false,
    auto: s.auto !== false,
    cat: asCategory(s.cat),
    ...(typeof s.since === 'string' ? { since: s.since } : {}),
    ...(typeof s.until === 'string' ? { until: s.until } : {}),
  }));

  return {
    subs,
    exps,
    paid,
    settings: {
      usd: num(settings.usd, 1000) > 0 ? num(settings.usd, 1000) : 1000,
      ...(typeof settings.lastBackup === 'string' ? { lastBackup: settings.lastBackup } : {}),
    },
  };
}

export const emptyData = (): Data => ({ subs: [], exps: [], paid: {}, settings: { usd: 1000 } });
export const uid = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- Formatting and parsing ----------

export const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const money = (n: number, cur: Currency = 'ARS'): string =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: cur, maximumFractionDigits: cur === 'USD' ? 2 : 0 }).format(n || 0);

export const inputAmount = (n: number | ''): string =>
  n === '' ? '' : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n);

/** Accepts "1234", "1.234", "1234,5", "1.234,50", "$ 3.500". Returns NaN when empty or invalid. */
export function parseAmount(input: unknown): number {
  let s = String(input ?? '').trim().replace(/\s|\$/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s);
}

// ---------- Dates ----------

export const pad = (n: number): string => String(n).padStart(2, '0');
export const iso = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function fromISO(s: string): Date {
  const [y = 1970, m = 1, d = 1] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const monthKey = (y: number, m: number): string => `${y}-${pad(m + 1)}`;
export const daysBetween = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / 86400000);
export function shiftMonth({ y, m }: Month, delta: number): Month {
  const d = new Date(y, m + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}

// ---------- Subscriptions ----------

export const toARS = (data: Data, amount: number, cur: Currency): number => (cur === 'USD' ? amount * data.settings.usd : amount);
export const monthlyEquiv = (data: Data, s: Subscription): number => toARS(data, s.amount, s.currency) / (s.cycle === 'yearly' ? 12 : 1);
export const paidKey = (id: string, y: number, m: number): string => `${id}:${monthKey(y, m)}`;

/** Billing date in a given month; day 31 falls back to the month's last day. */
export function dueDate(sub: Pick<Subscription, 'day'>, y: number, m: number): Date {
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(sub.day, daysInMonth));
}

/** Whether the subscription is charged in that month, honoring cycle, start and pause. */
export function dueInMonth(sub: Subscription, y: number, m: number): boolean {
  const k = monthKey(y, m);
  if (sub.since && k < sub.since) return false;
  if (!sub.active && (!sub.until || k >= sub.until)) return false;
  return sub.cycle !== 'yearly' || sub.month === m;
}

/** An explicit mark wins; otherwise auto-debit subs count as paid once the due date arrives. */
export function isPaid(data: Data, sub: Subscription, y: number, m: number, today: Date): boolean {
  const k = paidKey(sub.id, y, m);
  if (k in data.paid) return data.paid[k]!;
  return sub.auto && dueDate(sub, y, m) <= today;
}

/** Next unpaid billing date. An overdue unpaid charge in the current month is returned as-is. */
export function nextDue(data: Data, sub: Subscription, today: Date): Date | null {
  for (let i = 0; i < 24; i++) {
    const { y, m } = shiftMonth({ y: today.getFullYear(), m: today.getMonth() }, i);
    if (!dueInMonth(sub, y, m) || isPaid(data, sub, y, m, today)) continue;
    const d = dueDate(sub, y, m);
    if (d >= today || i === 0) return d;
  }
  return null;
}

export interface MonthSummary {
  exps: Expense[];
  subs: Subscription[];
  expTotal: number;
  subTotal: number;
  total: number;
}

export function monthData(data: Data, y: number, m: number): MonthSummary {
  const key = monthKey(y, m);
  const exps = data.exps
    .filter((e) => e.date.startsWith(key))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  const subs = data.subs.filter((s) => dueInMonth(s, y, m)).sort((a, b) => a.day - b.day);
  const expTotal = exps.reduce((t, e) => t + e.amount, 0);
  const subTotal = subs.reduce((t, s) => t + toARS(data, s.amount, s.currency), 0);
  return { exps, subs, expTotal, subTotal, total: expTotal + subTotal };
}

/** Totals per category for a month, expenses and subscriptions combined, largest first. */
export function byCategory(data: Data, summary: MonthSummary): [CategoryId, number][] {
  const totals = new Map<CategoryId, number>();
  const add = (c: CategoryId, v: number) => totals.set(c, (totals.get(c) ?? 0) + v);
  summary.exps.forEach((e) => add(e.cat, e.amount));
  summary.subs.forEach((s) => add(s.cat, toARS(data, s.amount, s.currency)));
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}
