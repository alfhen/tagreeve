import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const markerLine = /^<!-- [A-Z]\d{2} -->$/;
const versionHeading = /^## (\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/;

type Version = [number, number, number, number];

// A final release sorts after its own release candidates.
function parseVersion(match: RegExpMatchArray): Version {
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? Infinity : Number(match[4])];
}

function isOlder(a: Version, b: Version): boolean {
  for (let i = 0; i < 4; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return false;
}

export function markerProblems(text: string, packageVersion: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('## '));
  if (start === -1) return ['no ## version heading'];
  const heading = versionHeading.exec(lines[start]!);
  if (!heading) return [`line ${start + 1}: ${lines[start]} is not a version heading`];
  const pkg = versionHeading.exec(`## ${packageVersion}`);
  if (!pkg) return [`package version ${packageVersion} is not a version`];
  if (isOlder(parseVersion(heading), parseVersion(pkg))) {
    return [`line ${start + 1}: ${lines[start]} is older than package version ${packageVersion}`];
  }
  const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  const end = next === -1 ? lines.length : next;
  const problems: string[] = [];
  for (let i = start + 1; i < end; i++) {
    if (!markerLine.test(lines[i]!)) continue;
    const before = lines[i - 1];
    const after = lines[i + 1];
    if (before !== undefined && before.trim() !== '') {
      problems.push(`line ${i + 1}: ${lines[i]} has no blank line before it`);
    }
    if (after !== undefined && after.trim() !== '') {
      problems.push(`line ${i + 1}: ${lines[i]} has no blank line after it`);
    }
  }
  return problems;
}

describe('markerProblems', () => {
  const v = '1.0.0';

  it('accepts markers with blank lines around them', () => {
    expect(
      markerProblems('# Changelog\n\n## 1.0.0\n\n<!-- A01 -->\n\n<!-- B01 -->\n\n## 0.9.0\n', v),
    ).toEqual([]);
  });

  it('accepts a section with no markers', () => {
    expect(markerProblems('# Changelog\n\n## 1.0.0\n\n- A change.\n', v)).toEqual([]);
  });

  it('flags a marker glued to the line above', () => {
    const problems = markerProblems('## 1.0.0\n\n- A change.\n<!-- A01 -->\n\n- Next.\n', v);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('before');
  });

  it('flags a marker glued to the line below', () => {
    const problems = markerProblems('## 1.0.0\n\n<!-- A01 -->\n- A change.\n', v);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('after');
  });

  it('flags two markers on neighbouring lines', () => {
    expect(markerProblems('## 1.0.0\n\n<!-- A01 -->\n<!-- B01 -->\n\n## 0.9.0\n', v)).toHaveLength(2);
  });

  it('flags a changelog with no ## heading', () => {
    expect(markerProblems('# Changelog\n\n- A.\n', v)).toHaveLength(1);
  });

  it('reads CRLF line endings', () => {
    expect(markerProblems('## 1.0.0\r\n\r\n<!-- A01 -->\r\n\r\n- A.\r\n', v)).toEqual([]);
    expect(markerProblems('## 1.0.0\r\n\r\n<!-- A01 -->\r\n- A.\r\n', v)).toHaveLength(1);
  });

  it('ignores markers in older sections', () => {
    expect(markerProblems('## 1.0.0\n\n- A.\n\n## 0.9.0\n- B.\n<!-- A01 -->\n- C.\n', v)).toEqual([]);
  });

  describe('first heading', () => {
    it('accepts the package version', () => {
      expect(markerProblems('## 1.0.0-rc.1\n\n<!-- A01 -->\n', '1.0.0-rc.1')).toEqual([]);
    });

    it('accepts a later version', () => {
      expect(markerProblems('## 1.0.0-rc.2\n\n<!-- A01 -->\n', '1.0.0-rc.1')).toEqual([]);
      expect(markerProblems('## 1.0.0\n\n<!-- A01 -->\n', '1.0.0-rc.9')).toEqual([]);
    });

    it('flags an older version', () => {
      const problems = markerProblems('## 1.0.0-rc.1\n\n<!-- A01 -->\n', '1.0.0');
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('older');
    });

    it('flags a heading that is not a version', () => {
      const problems = markerProblems('## Unreleased\n\n<!-- A01 -->\n', v);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('not a version heading');
    });

    it('flags a heading with trailing text', () => {
      expect(markerProblems('## 1.0.0 (draft)\n\n<!-- A01 -->\n', v)).toHaveLength(1);
    });
  });
});

describe('CHANGELOG.md', () => {
  const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

  it('starts with a real version section and has blank lines around every marker', () => {
    expect(markerProblems(text, pkg.version)).toEqual([]);
  });

  describe('0.8.0-rc.2 and 0.8.0-rc.1', () => {
    const sectionOf = (version: string) => {
      const start = text.indexOf(`## ${version}\n`);
      const next = text.indexOf('\n## ', start + 1);
      return start === -1 ? '' : text.slice(start, next === -1 ? undefined : next);
    };
    const rc2 = sectionOf('0.8.0-rc.2');
    const rc1 = sectionOf('0.8.0-rc.1');

    it('has the rc.2 section above rc.1 with the install line', () => {
      expect(rc2).not.toBe('');
      expect(rc1).not.toBe('');
      expect(text.indexOf('## 0.8.0-rc.2\n')).toBeLessThan(text.indexOf('## 0.8.0-rc.1\n'));
      expect(rc2).toContain('Install it with `npm i -g tagreeve@next`.');
    });

    it('names #1632, #1633, #1635 and #1636 in rc.2', () => {
      for (const pr of ['#1632', '#1633', '#1635', '#1636']) expect(rc2).toContain(pr);
    });

    it('has the sentBy browser upgrade note in rc.1', () => {
      const note = rc1.split('\n').find((l) => l.startsWith('- ') && l.includes('region1.google-analytics.com'));
      expect(note).toBeDefined();
      expect(note).toContain('sentBy: browser');
    });

    it('says nothing about a missing field test in either section', () => {
      expect(rc2).not.toBe('');
      expect(rc1).not.toBe('');
      expect(rc2).not.toContain('not field-tested on a real store');
      expect(rc1).not.toContain('not field-tested on a real store');
    });
  });

  describe('0.8.0-rc.3', () => {
    const sectionOf = (version: string) => {
      const start = text.indexOf(`## ${version}\n`);
      const next = text.indexOf('\n## ', start + 1);
      return start === -1 ? '' : text.slice(start, next === -1 ? undefined : next);
    };
    const rc3 = sectionOf('0.8.0-rc.3');
    const rc1 = sectionOf('0.8.0-rc.1');
    const buildNote = (part: string) =>
      part.split('\n').find((l) => l.includes('`tagreeve server-container build`') && l.includes('is not available'));

    it('has the rc.3 section above rc.2 with the install line', () => {
      expect(rc3).not.toBe('');
      expect(text.indexOf('## 0.8.0-rc.3\n')).toBeLessThan(text.indexOf('## 0.8.0-rc.2\n'));
      expect(rc3).toContain('Install it with `npm i -g tagreeve@next`.');
    });

    it('names #1641 and #1639 in rc.3', () => {
      expect(rc3).not.toBe('');
      for (const pr of ['#1641', '#1639']) expect(rc3).toContain(pr);
    });

    it('has a Known in 0.8.0-rc.3 part that names #1640 and serverSendProbableLink', () => {
      const at = rc3.indexOf('Known in 0.8.0-rc.3');
      expect(at).toBeGreaterThanOrEqual(0);
      expect(rc3.slice(at)).toContain('#1640');
      expect(rc3.slice(at)).toContain('`serverSendProbableLink`');
    });

    it('has the server image note in rc.3 and in the rc.1 upgrade list', () => {
      const start = rc1.indexOf('### Upgrading from 0.7.0\n');
      expect(start).toBeGreaterThanOrEqual(0);
      const end = rc1.indexOf('\n### ', start + 1);
      const upgrade = rc1.slice(start, end === -1 ? undefined : end);
      const bullet = buildNote(upgrade);
      expect(buildNote(rc3)).toBeDefined();
      expect(bullet).toBeDefined();
      expect(bullet?.startsWith('- ')).toBe(true);
      expect(buildNote(rc3)).toContain('arm64');
      expect(bullet).toContain('arm64');
    });

    it('passes the marker check at 0.8.0-rc.3', () => {
      expect(markerProblems(text, '0.8.0-rc.3')).toEqual([]);
    });
  });

  describe('released section 0.7.0', () => {
    const section = (() => {
      const start = text.indexOf('## 0.7.0\n');
      const next = text.indexOf('\n## ', start + 1);
      return start === -1 ? '' : text.slice(start, next === -1 ? undefined : next);
    })();

    it('exists with the install line and its Known heading', () => {
      expect(section).not.toBe('');
      expect(section).toContain('`npm i -g tagreeve` installs this release.');
      expect(section).toContain('### Known in 0.7.0\n');
    });

    it('has no marker and no "Not released yet" line', () => {
      expect(section).not.toMatch(/^<!-- [A-Z]\d{2} -->$/m);
      expect(section).not.toContain('Not released yet');
    });

    it('sits above 0.7.0-rc.4', () => {
      const final = text.indexOf('## 0.7.0\n');
      expect(final).toBeGreaterThan(-1);
      expect(final).toBeLessThan(text.indexOf('## 0.7.0-rc.4\n'));
    });
  });

  describe('released section 0.7.0-rc.4', () => {
    const section = (() => {
      const start = text.indexOf('## 0.7.0-rc.4\n');
      const next = text.indexOf('\n## ', start + 1);
      return start === -1 ? '' : text.slice(start, next === -1 ? undefined : next);
    })();

    it('exists with the install line', () => {
      expect(section).not.toBe('');
      expect(section).toContain('Install it with `npm i -g tagreeve@next`.');
    });

    it('has no marker and no "Not released yet" line', () => {
      expect(section).not.toMatch(/^<!-- [A-Z]\d{2} -->$/m);
      expect(section).not.toContain('Not released yet');
    });
  });

  describe('released section 0.7.0-rc.3', () => {
    const section = (() => {
      const start = text.indexOf('## 0.7.0-rc.3\n');
      const next = text.indexOf('\n## ', start + 1);
      return start === -1 ? '' : text.slice(start, next === -1 ? undefined : next);
    })();

    it('exists with the install line', () => {
      expect(section).not.toBe('');
      expect(section).toContain('Install it with `npm i -g tagreeve@next`.');
    });

    it('has no marker and no "Not released yet" line', () => {
      expect(section).not.toMatch(/^<!-- [A-Z]\d{2} -->$/m);
      expect(section).not.toContain('Not released yet');
    });
  });

  describe('released section 0.7.0-rc.2', () => {
    const section = (() => {
      const start = text.indexOf('## 0.7.0-rc.2\n');
      const next = text.indexOf('\n## ', start + 1);
      return start === -1 ? '' : text.slice(start, next === -1 ? undefined : next);
    })();

    it('exists with the install line', () => {
      expect(section).not.toBe('');
      expect(section).toContain('Install it with `npm i -g tagreeve@next`.');
    });

    it('has no marker and no "Not released yet" line', () => {
      expect(section).not.toMatch(/^<!-- [A-Z]\d{2} -->$/m);
      expect(section).not.toContain('Not released yet');
    });
  });

  describe('released section 0.7.0-rc.1', () => {
    const section = (() => {
      const start = text.indexOf('## 0.7.0-rc.1\n');
      const next = text.indexOf('\n## ', start + 1);
      return start === -1 ? '' : text.slice(start, next === -1 ? undefined : next);
    })();

    it('exists with the install line, the upgrade section and its Known heading', () => {
      expect(section).not.toBe('');
      expect(section).toContain('Install it with `npm i -g tagreeve@next`.');
      expect(section).toContain('### Upgrading from 0.6.2\n');
      expect(section).toContain('### Known in 0.7.0-rc.1\n');
    });

    it('has no marker and no "Not released yet" line', () => {
      expect(section).not.toMatch(/^<!-- [A-Z]\d{2} -->$/m);
      expect(section).not.toContain('Not released yet');
    });
  });

  describe('released section 0.6.2', () => {
    const section = (() => {
      const start = text.indexOf('## 0.6.2\n');
      const next = text.indexOf('\n## ', start + 1);
      return start === -1 ? '' : text.slice(start, next === -1 ? undefined : next);
    })();

    it('exists with the install line, the upgrade section and its Known heading', () => {
      expect(section).not.toBe('');
      expect(section).toContain('`npm i -g tagreeve` installs this release.');
      expect(section).toContain('### Upgrading from 0.6.1\n');
      expect(section).toContain('### Known in 0.6.2\n');
    });

    it('has no marker and no "Not released yet" line', () => {
      expect(section).not.toMatch(/<!--/);
      expect(section).not.toContain('Not released yet');
    });
  });

  describe('released section 0.6.1', () => {
    const section = (() => {
      const start = text.indexOf('## 0.6.1\n');
      const next = text.indexOf('\n## ', start + 1);
      return start === -1 ? '' : text.slice(start, next === -1 ? undefined : next);
    })();

    it('exists with the install line and its Known heading', () => {
      expect(section).not.toBe('');
      expect(section).toContain('`npm i -g tagreeve` installs this release.');
      expect(section).toContain('### Known in 0.6.1\n');
    });

    it('has no marker and no "Not released yet" line', () => {
      expect(section).not.toMatch(/<!--/);
      expect(section).not.toContain('Not released yet');
    });
  });

  describe.each(['0.6.0-rc.3', '0.6.0-rc.2'])('released section %s', (version) => {
    const section = (() => {
      const start = text.indexOf(`## ${version}\n`);
      const next = text.indexOf('\n## ', start + 1);
      return start === -1 ? '' : text.slice(start, next === -1 ? undefined : next);
    })();

    it('exists with the install line and its Known heading', () => {
      expect(section).not.toBe('');
      expect(section).toContain('Install it with `npm i -g tagreeve@next`.');
      expect(section).toContain(`### Known in ${version}\n`);
    });

    it('has no marker and no "Not released yet" line', () => {
      expect(section).not.toMatch(/^<!-- [A-Z]\d{2} -->$/m);
      expect(section).not.toContain('Not released yet');
    });
  });

  it('lists 0.6.0-rc.3 and 0.6.0-rc.2 above 0.6.0-rc.1 in order', () => {
    const rc3 = text.indexOf('## 0.6.0-rc.3\n');
    const rc2 = text.indexOf('## 0.6.0-rc.2\n');
    const rc1 = text.indexOf('## 0.6.0-rc.1\n');
    expect(rc3).toBeGreaterThan(-1);
    expect(rc3).toBeLessThan(rc2);
    expect(rc2).toBeLessThan(rc1);
  });

  describe('released section 0.6.0', () => {
    const section = (() => {
      const start = text.indexOf('## 0.6.0\n');
      const next = text.indexOf('\n## ', start + 1);
      return start === -1 ? '' : text.slice(start, next === -1 ? undefined : next);
    })();

    it('exists with the install line and its Known heading', () => {
      expect(section).not.toBe('');
      expect(section).toContain('`npm i -g tagreeve` installs this release.');
      expect(section).toContain('### Known in 0.6.0\n');
    });

    it('has no marker and no "Not released yet" line', () => {
      expect(section).not.toMatch(/^<!-- [A-Z]\d{2} -->$/m);
      expect(section).not.toContain('Not released yet');
    });

    it('sits above 0.6.0-rc.3', () => {
      const final = text.indexOf('## 0.6.0\n');
      expect(final).toBeGreaterThan(-1);
      expect(final).toBeLessThan(text.indexOf('## 0.6.0-rc.3\n'));
    });
  });
});
