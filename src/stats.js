// Calculs purs sur les tirs. Un tir = { m: 1 (marqué) | 0 (raté), t: timestamp ms }.

export function pct(made, attempts) {
  return attempts ? Math.round((made / attempts) * 100) : 0;
}

export function summarize(shots) {
  let made = 0;
  let streak = 0;
  let bestStreak = 0;
  for (const s of shots) {
    if (s.m) {
      made++;
      streak++;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      streak = 0;
    }
  }
  const attempts = shots.length;
  return {
    attempts,
    made,
    missed: attempts - made,
    pct: pct(made, attempts),
    streak,
    bestStreak,
  };
}

// Pourcentage par tranche de `size` tirs (ex. 1-10, 11-20…) pour voir la fatigue dans une séance.
export function splits(shots, size = 10) {
  const out = [];
  for (let i = 0; i < shots.length; i += size) {
    const chunk = shots.slice(i, i + size);
    const made = chunk.filter((s) => s.m).length;
    out.push({ from: i + 1, to: i + chunk.length, made, attempts: chunk.length, pct: pct(made, chunk.length) });
  }
  return out;
}

export function overall(sessions, minShotsForRecord = 10) {
  let made = 0;
  let attempts = 0;
  let bestPct = null;
  let bestStreak = 0;
  for (const session of sessions) {
    const s = summarize(session.shots);
    made += s.made;
    attempts += s.attempts;
    if (s.bestStreak > bestStreak) bestStreak = s.bestStreak;
    if (s.attempts >= minShotsForRecord && (bestPct === null || s.pct > bestPct)) bestPct = s.pct;
  }
  return { sessions: sessions.length, made, attempts, pct: pct(made, attempts), bestPct, bestStreak };
}
