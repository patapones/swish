import { describe, it, expect } from 'vitest';
import { blobs, judge, roiFor } from './core.js';

const rim = { x: 500, y: 300, w: 100 };
// Trajectoire à 30 i/s à partir d'une liste de [x, y]
const path = (pts, t0 = 0) => pts.map(([x, y], i) => ({ t: t0 + i / 30, x, y }));

describe('judge', () => {
  it('marqué : traverse le cercle puis est freiné par le filet', () => {
    const tr = path([[380, 150], [410, 190], [440, 230], [470, 270], [495, 310], [498, 318], [499, 322], [500, 330], [502, 360], [504, 400]]);
    expect(judge(tr, rim)).toMatchObject({ made: true });
  });
  it('raté : tombe devant/derrière le cercle sans être freiné', () => {
    const tr = path([[380, 150], [410, 190], [440, 230], [470, 270], [495, 310], [497, 350], [498, 395], [499, 440]]);
    expect(judge(tr, rim)).toMatchObject({ made: false });
  });
  it('raté : rebondit sur le cercle et ressort', () => {
    const tr = path([[380, 150], [410, 190], [440, 230], [470, 270], [490, 290], [470, 250], [450, 220], [430, 200], [410, 190], [390, 200], [370, 230]]);
    expect(judge(tr, rim)).toMatchObject({ made: false });
  });
  it('ignoré : tir de près, le ballon monte depuis le dessous du cercle', () => {
    const tr = path([[440, 420], [450, 380], [460, 340], [470, 300], [480, 260], [490, 240], [495, 250], [498, 280], [499, 300], [500, 305], [500, 310], [501, 330], [502, 360]]);
    expect(judge(tr, rim)).toBeNull();
  });
  it("pas un tir : ne passe jamais au-dessus du cercle", () => {
    const tr = path([[200, 500], [220, 480], [240, 470], [260, 480]]);
    expect(judge(tr, rim)).toBeNull();
  });
});

describe('blobs', () => {
  it('sépare deux taches et mesure leur surface', () => {
    const W = 6, H = 3;
    const m = new Uint8Array([1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1]);
    const b = blobs(m, W, H).map(({ area, w, h }) => ({ area, w, h }));
    expect(b).toEqual([{ area: 4, w: 2, h: 2 }, { area: 4, w: 2, h: 2 }]);
  });
});

describe('roiFor', () => {
  it('reste dans l’image', () => {
    expect(roiFor({ x: 1850, y: 50, w: 100 }, 1920, 1080)).toEqual({ x: 1550, y: 0, w: 370, h: 300 });
  });
});
