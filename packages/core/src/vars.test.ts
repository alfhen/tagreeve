import { describe, expect, test } from 'vitest';
import { fillVars, VarCycleError } from './vars.ts';

describe('fillVars', () => {
  test('fills a declared name', () => {
    expect(fillVars('/c/{coll}', { coll: 'yarn' })).toBe('/c/yarn');
  });

  test('fills the names inside an inserted value, three levels deep too', () => {
    expect(fillVars('{path}', { path: '/c/{coll}', coll: 'yarn' })).toBe('/c/yarn');
    expect(fillVars('{a}', { a: '/x/{b}', b: '{c}', c: 'z' })).toBe('/x/z');
  });

  test('fills a name used twice', () => {
    expect(fillVars('{a}{a}', { a: '{b}', b: 'q' })).toBe('qq');
  });

  test('an undeclared name stays as written, also inside a filled value', () => {
    const vars = { coll: 'yarn' };
    expect(Object.hasOwn(vars, 'colx')).toBe(false);
    expect(fillVars('/c/{colx}', vars)).toBe('/c/{colx}');
    expect(fillVars('/c/{coll}', vars)).toBe('/c/yarn');
    expect(fillVars('{p}', { p: '/c/{colx}' })).toBe('/c/{colx}');
  });

  test('a name that only exists on Object.prototype is not declared', () => {
    const vars = {};
    expect('constructor' in vars).toBe(true);
    expect(Object.hasOwn(vars, 'constructor')).toBe(false);
    expect(fillVars('/{constructor}/{toString}', vars)).toBe('/{constructor}/{toString}');
  });

  test('a two-variable cycle throws and names the variables, not the values', () => {
    const vars = { loopone: 'pw-v1-{looptwo}', looptwo: 'pw-v2-{loopone}' };
    expect(vars.loopone).toContain('pw-v1-');
    expect(vars.looptwo).toContain('pw-v2-');
    let error: unknown;
    try {
      fillVars('{loopone}', vars);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(VarCycleError);
    const message = (error as Error).message;
    expect(message).toContain('loopone');
    expect(message).toContain('looptwo');
    expect(message).not.toMatch(/pw-v[12]-/);
  });

  test('a self-referencing variable throws', () => {
    const vars = { loopself: 'pw-v3-{loopself}' };
    expect(vars.loopself).toContain('pw-v3-');
    let message = '';
    try {
      fillVars('{loopself}', vars);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('loopself');
    expect(message).not.toContain('pw-v3-');
  });

  test('a cycle the text does not reach does not throw', () => {
    expect(fillVars('{ok}', { ok: 'fine', a: '{b}', b: '{a}' })).toBe('fine');
  });
});
