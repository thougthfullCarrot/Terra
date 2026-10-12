import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../.github/scripts/new-migrations.sh');
const DIR = 'backend/supabase/migrations';

/** A scratch repo with applied migrations, then one push's worth of changes; returns what the workflow would run. */
function pick(change: (root: string) => void): string[] {
  const root = mkdtempSync(join(tmpdir(), 'migrate-pick-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    mkdirSync(join(root, DIR), { recursive: true });
    mkdirSync(join(root, 'backend/supabase/pending'), { recursive: true });
    writeFileSync(join(root, DIR, '0001_init.sql'), 'create table firms (id int);\n');
    writeFileSync(join(root, DIR, '0016_city.sql'), 'alter table postings drop constraint postings_city_check;\n');
    writeFileSync(join(root, 'backend/supabase/pending/0017_watchlists.sql'), 'create table watchlists (id int);\n-- '.padEnd(400, 'x') + '\n');
    git('add', '-A');
    git('commit', '-qm', 'before');
    const before = git('rev-parse', 'HEAD');
    change(root);
    git('add', '-A');
    git('commit', '-qm', 'after', '--allow-empty');
    const out = execFileSync('bash', [SCRIPT, before, 'HEAD', DIR], { cwd: root, encoding: 'utf8' }).trim();
    return out ? out.split('\n') : [];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('which migrations a push applies', () => {
  it('applies an added file', () => {
    expect(pick((root) => writeFileSync(join(root, DIR, '0018_firms.sql'), 'insert into firms values (1);\n'))).toEqual([`${DIR}/0018_firms.sql`]);
  });

  it('applies a file moved in from pending/, which git sees as a rename', () => {
    expect(pick((root) => renameSync(join(root, 'backend/supabase/pending/0017_watchlists.sql'), join(root, DIR, '0017_watchlists.sql')))).toEqual([
      `${DIR}/0017_watchlists.sql`
    ]);
  });

  it('does not re-run a file renamed inside migrations/', () => {
    expect(pick((root) => renameSync(join(root, DIR, '0016_city.sql'), join(root, DIR, '0016_postings_city.sql')))).toEqual([]);
  });

  it('does not run a deleted file', () => {
    expect(pick((root) => rmSync(join(root, DIR, '0016_city.sql')))).toEqual([]);
  });

  it('does not re-run an unchanged or edited file', () => {
    expect(pick(() => {})).toEqual([]);
    expect(pick((root) => appendFileSync(join(root, DIR, '0001_init.sql'), '-- note\n'))).toEqual([]);
  });

  it('lists several new files in name order, and ignores non-SQL files', () => {
    expect(
      pick((root) => {
        writeFileSync(join(root, DIR, '0019_b.sql'), 'select 2;\n');
        writeFileSync(join(root, DIR, '0018_a.sql'), 'select 1;\n');
        writeFileSync(join(root, DIR, 'README.md'), 'notes\n');
      })
    ).toEqual([`${DIR}/0018_a.sql`, `${DIR}/0019_b.sql`]);
  });
});
