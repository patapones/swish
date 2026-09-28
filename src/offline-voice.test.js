import { describe, it, expect, vi } from 'vitest';

vi.stubGlobal('document', { baseURI: 'http://localhost/' });
const { guessHeadset } = await import('./offline-voice.js');

const mic = (deviceId, label) => ({ kind: 'audioinput', deviceId, label });

describe('guessHeadset', () => {
  it('préfère le micro Bluetooth à l’écouteur d’appel du téléphone (Galaxy S24)', () => {
    const mics = [mic('a', 'Headset earpiece'), mic('b', 'Speakerphone'), mic('c', 'Bluetooth headset')];
    expect(guessHeadset(mics)).toBe('c');
  });
  it('ne choisit rien sans écouteurs', () => {
    expect(guessHeadset([mic('a', 'Headset earpiece'), mic('b', 'Speakerphone')])).toBe('');
  });
  it('reconnaît un casque nommé par sa marque', () => {
    expect(guessHeadset([mic('a', 'Default'), mic('b', 'Jabra Elite 8 Active')])).toBe('b');
  });
});
