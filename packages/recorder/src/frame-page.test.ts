import { expect, test } from 'vitest';
import { createPageNumbers } from './frame-page.ts';

test('the first page is 0, a page keeps its number, and each new page takes the next', () => {
  const pageNumber = createPageNumbers();
  const first = {};
  const popup = {};
  const third = {};
  expect(pageNumber(first)).toBe(0);
  expect(pageNumber(first)).toBe(0);
  expect(pageNumber(popup)).toBe(1);
  expect(pageNumber(third)).toBe(2);
  expect(pageNumber(popup)).toBe(1);
  expect(typeof pageNumber(first)).toBe('number');
});

test('two runs number their pages apart', () => {
  const a = createPageNumbers();
  const b = createPageNumbers();
  const page = {};
  expect(a({})).toBe(0);
  expect(a(page)).toBe(1);
  expect(b(page)).toBe(0);
});
