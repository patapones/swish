import { describe, it, expect } from 'vitest';
import { summarize, splits, overall, pct } from './stats.js';

const shots = (pattern) => [...pattern].map((c, i) => ({ m: c === 'x' ? 1 : 0, t: i }));

describe('summarize', () => {
  it('compte réussis, ratés et pourcentage', () => {
    expect(summarize(shots('xx.x.'))).toMatchObject({ attempts: 5, made: 3, missed: 2, pct: 60 });
  });
  it('suit la série en cours et la meilleure série', () => {
    expect(summarize(shots('xxx.xx'))).toMatchObject({ streak: 2, bestStreak: 3 });
    expect(summarize(shots('xx.'))).toMatchObject({ streak: 0, bestStreak: 2 });
  });
  it('gère une séance vide', () => {
    expect(summarize([])).toMatchObject({ attempts: 0, pct: 0, bestStreak: 0 });
  });
});

describe('splits', () => {
  it('découpe par tranches de 10 avec une dernière tranche partielle', () => {
    const r = splits(shots('xxxxx.....' + 'xxx'));
    expect(r).toEqual([
      { from: 1, to: 10, made: 5, attempts: 10, pct: 50 },
      { from: 11, to: 13, made: 3, attempts: 3, pct: 100 },
    ]);
  });
});

describe('overall', () => {
  it('agrège les séances et ignore les petites séances pour le record', () => {
    const sessions = [{ shots: shots('xx') }, { shots: shots('xxxx......') }];
    expect(overall(sessions)).toMatchObject({ sessions: 2, made: 6, attempts: 12, pct: 50, bestPct: 40, bestStreak: 4 });
  });
  it('arrondit le pourcentage', () => {
    expect(pct(1, 3)).toBe(33);
  });
});
