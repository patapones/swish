import { describe, it, expect } from 'vitest';
import { parseCommands } from './voice.js';

describe('parseCommands', () => {
  it('reconnaît les mots-clés et leurs variantes de transcription', () => {
    expect(parseCommands('Marqué')).toEqual(['make']);
    expect(parseCommands('rater')).toEqual(['miss']);
    expect(parseCommands('RATÉE !')).toEqual(['miss']);
    expect(parseCommands('dedans')).toEqual(['make']);
    expect(parseCommands('annule')).toEqual(['undo']);
  });
  it('garde plusieurs commandes dans l’ordre', () => {
    expect(parseCommands('raté raté marqué')).toEqual(['miss', 'miss', 'make']);
  });
  it('ignore les autres mots', () => {
    expect(parseCommands("allez c'est parti")).toEqual([]);
    expect(parseCommands('marquage rateau')).toEqual([]);
  });
});
