import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  byCategory, dueDate, dueInMonth, emptyData, isPaid, monthData, nextDue, paidKey, parseAmount, parseData, shiftMonth,
  type Data, type Subscription,
} from '../src/lib.ts';

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: 's1', name: 'Netflix', amount: 1000, currency: 'ARS', cycle: 'monthly', day: 10, month: 0,
  active: true, auto: false, cat: 'otros', ...over,
});
const data = (over: Partial<Data> = {}): Data => ({ ...emptyData(), ...over });
const day = (y: number, m: number, d: number) => new Date(y, m, d);

describe('parseAmount', () => {
  test('reads Argentine formats', () => {
    assert.equal(parseAmount('3.500'), 3500);
    assert.equal(parseAmount('1.234.567'), 1234567);
    assert.equal(parseAmount('1.234,50'), 1234.5);
    assert.equal(parseAmount('8,5'), 8.5);
    assert.equal(parseAmount('$ 25.000'), 25000);
    assert.equal(parseAmount('1500'), 1500);
    assert.equal(parseAmount('3.5'), 3.5);
  });
  test('rejects empty and garbage', () => {
    assert.ok(Number.isNaN(parseAmount('')));
    assert.ok(Number.isNaN(parseAmount('abc')));
    assert.ok(Number.isNaN(parseAmount(null)));
  });
});

describe('dueDate', () => {
  test('clamps day 31 to the end of short months', () => {
    assert.deepEqual(dueDate({ day: 31 }, 2026, 1), day(2026, 1, 28));
    assert.deepEqual(dueDate({ day: 31 }, 2028, 1), day(2028, 1, 29));
    assert.deepEqual(dueDate({ day: 31 }, 2026, 3), day(2026, 3, 30));
  });
});

describe('dueInMonth', () => {
  test('yearly subscriptions only bill in their month', () => {
    const s = sub({ cycle: 'yearly', month: 2 });
    assert.equal(dueInMonth(s, 2026, 2), true);
    assert.equal(dueInMonth(s, 2026, 3), false);
  });
  test('does not appear before it was created', () => {
    const s = sub({ since: '2026-09' });
    assert.equal(dueInMonth(s, 2026, 7), false);
    assert.equal(dueInMonth(s, 2026, 8), true);
  });
  test('paused subscriptions keep their history', () => {
    const s = sub({ active: false, until: '2026-09' });
    assert.equal(dueInMonth(s, 2026, 7), true);
    assert.equal(dueInMonth(s, 2026, 8), false);
    assert.equal(dueInMonth(sub({ active: false }), 2026, 7), false);
  });
});

describe('isPaid', () => {
  const today = day(2026, 8, 15);
  test('auto-debit counts as paid once the date arrives', () => {
    const s = sub({ auto: true, day: 10 });
    assert.equal(isPaid(data(), s, 2026, 8, today), true);
    assert.equal(isPaid(data(), sub({ auto: true, day: 20 }), 2026, 8, today), false);
  });
  test('manual subscriptions need an explicit mark', () => {
    const s = sub({ day: 10 });
    assert.equal(isPaid(data(), s, 2026, 8, today), false);
    assert.equal(isPaid(data({ paid: { [paidKey(s.id, 2026, 8)]: true } }), s, 2026, 8, today), true);
  });
  test('an explicit "not paid" overrides auto-debit', () => {
    const s = sub({ auto: true, day: 10 });
    assert.equal(isPaid(data({ paid: { [paidKey(s.id, 2026, 8)]: false } }), s, 2026, 8, today), false);
  });
});

describe('nextDue', () => {
  const today = day(2026, 8, 15);
  test('returns an overdue unpaid charge from this month', () => {
    assert.deepEqual(nextDue(data(), sub({ day: 10 }), today), day(2026, 8, 10));
  });
  test('skips to next month once paid', () => {
    assert.deepEqual(nextDue(data(), sub({ day: 10, auto: true }), today), day(2026, 9, 10));
  });
  test('finds the next yearly charge', () => {
    assert.deepEqual(nextDue(data(), sub({ cycle: 'yearly', month: 2, day: 12 }), today), day(2027, 2, 12));
  });
});

describe('monthData and byCategory', () => {
  test('adds expenses and subscriptions, converting USD', () => {
    const d = data({
      settings: { usd: 1000 },
      subs: [sub({ amount: 10, currency: 'USD', cat: 'tech' }), sub({ id: 's2', amount: 5000, cat: 'salidas' })],
      exps: [
        { id: 'e1', created: 1, amount: 2000, desc: '', cat: 'comida', date: '2026-09-02' },
        { id: 'e2', created: 2, amount: 999, desc: '', cat: 'comida', date: '2026-08-31' },
      ],
    });
    const sept = monthData(d, 2026, 8);
    assert.equal(sept.expTotal, 2000);
    assert.equal(sept.subTotal, 15000);
    assert.equal(sept.total, 17000);
    assert.deepEqual(byCategory(d, sept), [['tech', 10000], ['salidas', 5000], ['comida', 2000]]);
  });
});

describe('shiftMonth', () => {
  test('wraps across years', () => {
    assert.deepEqual(shiftMonth({ y: 2026, m: 0 }, -1), { y: 2025, m: 11 });
    assert.deepEqual(shiftMonth({ y: 2026, m: 11 }, 1), { y: 2027, m: 0 });
  });
});

describe('parseData', () => {
  test('rejects things that are not a backup', () => {
    assert.equal(parseData(null), null);
    assert.equal(parseData({ subs: [] }), null);
    assert.equal(parseData('hola'), null);
  });
  test('fills defaults and drops invalid values', () => {
    const d = parseData({ subs: [{ name: 'X', amount: 5, cat: 'nope', day: 99 }], exps: [], paid: { a: true, b: 'x' }, settings: { usd: -1 } });
    assert.ok(d);
    assert.equal(d.subs[0]?.cat, 'otros');
    assert.equal(d.subs[0]?.day, 31);
    assert.equal(d.subs[0]?.auto, true);
    assert.deepEqual(d.paid, { a: true });
    assert.equal(d.settings.usd, 1000);
  });
});
