"""Prototype phase 1 : détecte les tirs et décide marqué / raté à partir d'une vidéo.

Principe (le même que celui qui tournera ensuite dans l'app) :
1. On ne regarde qu'une zone autour de l'arceau, dont la position est donnée (calibrage).
2. On sépare ce qui bouge du décor (fond moyen qui s'adapte lentement : nuages, feuillage).
3. Parmi ce qui bouge, on garde les taches de la taille et de la forme du ballon.
4. On relie les positions image après image en trajectoires.
5. Une trajectoire qui descend à travers le cercle puis continue sous le cercle = marqué.
   Une trajectoire qui arrive près du cercle sans ça = raté.

Toutes les tailles sont exprimées en largeurs d'arceau, pour marcher quelle que soit la distance.

Usage : python detect.py video.mp4 --rim 1420,249,108 [--labels labels.json] [--debug]
"""

import argparse
import json
import subprocess
import sys

import numpy as np
from scipy import ndimage

FPS = 30  # assez pour suivre le ballon (~30 px par image près du cercle en 1080p)
SCALE = 0.5  # on travaille en demi-résolution


def frames(ffmpeg, video, roi):
    x, y, w, h = roi
    W, H = int(w * SCALE), int(h * SCALE)
    cmd = [ffmpeg, '-loglevel', 'error', '-i', video, '-vf',
           f'fps={FPS},crop={w}:{h}:{x}:{y},scale={W}:{H},format=gray', '-f', 'rawvideo', '-']
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    i = 0
    while True:
        buf = p.stdout.read(W * H)
        if len(buf) < W * H:
            break
        yield i / FPS, np.frombuffer(buf, np.uint8).reshape(H, W).astype(np.float32)
        i += 1


def ball_candidates(fg, rim_w):
    """Taches de la taille d'un ballon dans le masque de mouvement."""
    ball_d = 0.37 * rim_w * SCALE  # ballon ≈ 24 cm, cercle ≈ 45 cm + bord vu de côté
    expected = np.pi * (ball_d / 2) ** 2
    labels, n = ndimage.label(fg)
    out = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        area = (labels[sl] == i).sum()
        if not (0.35 * expected < area < 2.5 * expected):
            continue
        if not (0.5 < w / h < 2.0):
            continue
        if area / (w * h) < 0.45:  # un ballon remplit bien sa boîte ; une branche non
            continue
        cy, cx = ndimage.center_of_mass(labels[sl] == i)
        out.append((sl[1].start + cx, sl[0].start + cy, area))
    return out


def track(points_by_frame, max_jump):
    """Relie les candidats en trajectoires (plus proche voisin)."""
    tracks, active = [], []
    for t, pts in points_by_frame:
        used = set()
        still = []
        for tr in active:
            lt, lx, ly = tr[-1]
            if t - lt > 0.2:  # perdu depuis trop longtemps
                continue
            best, bd = None, max_jump * (t - lt) * FPS
            for j, (x, y, _) in enumerate(pts):
                d = np.hypot(x - lx, y - ly)
                if j not in used and d < bd:
                    best, bd = j, d
            if best is not None:
                used.add(best)
                tr.append((t, pts[best][0], pts[best][1]))
            still.append(tr)
        for j, (x, y, _) in enumerate(pts):
            if j not in used:
                tr = [(t, x, y)]
                tracks.append(tr)
                still.append(tr)
        active = still
    return [tr for tr in tracks if len(tr) >= 4]


def held_by_net(ts, xs, ys, i, rim):
    """Juste sous le cercle, le ballon ralentit fortement pendant au moins 2 images d'affilée."""
    cx, cy, rw = rim
    slow_run = 0
    for j in range(i, len(ts) - 1):
        if ts[j] > ts[i] + 0.4 or ys[j] > cy + 1.0 * rw:
            break
        dt = (ts[j + 1] - ts[j]) * FPS  # en images (une image peut manquer)
        dy = (ys[j + 1] - ys[j]) / dt
        in_net = cy <= ys[j] and abs(xs[j] - cx) < 0.6 * rw
        slow_run = slow_run + 1 if in_net and dy < 0.12 * rw else 0
        if slow_run >= 2:
            return True
    return False


def judge(tr, rim):
    """Analyse une trajectoire. Renvoie None si ce n'est pas un tir, sinon (t, marqué?)."""
    cx, cy, rw = rim
    xs = np.array([p[1] for p in tr])
    ys = np.array([p[2] for p in tr])
    ts = np.array([p[0] for p in tr])
    near = np.abs(xs - cx) < 2.5 * rw
    above = near & (ys < cy - 0.2 * rw)
    if not above.any():
        return None  # jamais passé au-dessus du cercle : pas un tir (joueur, ballon au sol…)
    t_shot = ts[above][0]
    made = False
    for i in range(1, len(tr)):
        # descente qui traverse le plan du cercle
        if ys[i - 1] < cy <= ys[i]:
            k = (cy - ys[i - 1]) / (ys[i] - ys[i - 1])
            x_cross = xs[i - 1] + k * (xs[i] - xs[i - 1])
            if abs(x_cross - cx) < 0.45 * rw:
                # Vu de côté, un ballon qui tombe devant ou derrière le cercle semble aussi le traverser.
                # La différence : dans le filet, le ballon est freiné (quasi à l'arrêt quelques images),
                # alors qu'à côté il tombe en chute libre.
                if held_by_net(ts, xs, ys, i, rim):
                    # et ne remonte pas au-dessus du cercle ensuite (rebond sorti)
                    later_up = (ts > ts[i] + 0.3) & (ys < cy - 0.3 * rw)
                    if not later_up.any():
                        made = True
    return t_shot, made


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('--rim', required=True, help='x,y,largeur du cercle en pixels 1080p')
    ap.add_argument('--labels')
    ap.add_argument('--ffmpeg', default='ffmpeg')
    ap.add_argument('--debug', action='store_true')
    a = ap.parse_args()

    cx, cy, rw = [float(v) for v in a.rim.split(',')]
    # zone d'analyse autour du cercle, en pixels 1080p
    x0 = int(max(0, cx - 3 * rw)); x1 = int(min(1920, cx + 3 * rw))
    y0 = int(max(0, cy - 2.5 * rw)); y1 = int(min(1080, cy + 2.5 * rw))
    roi = (x0, y0, (x1 - x0) // 4 * 4, (y1 - y0) // 4 * 4)

    bg = None
    per_frame = []
    for t, f in frames(a.ffmpeg, a.video, roi):
        if bg is None:
            bg = f.copy()
        diff = np.abs(f - bg)
        # le ballon est plus sombre que le ciel et que la planche : on garde les pixels qui s'assombrissent
        fg = (diff > 22) & (f < bg)
        fg = ndimage.binary_opening(fg, iterations=1)
        # Quelqu'un passe devant la caméra : une grande partie de l'image bouge d'un coup. Pas un tir.
        cands = [] if fg.mean() > 0.15 else ball_candidates(fg, rw)
        # retour en pixels 1080p
        per_frame.append((t, [(x0 + x / SCALE, y0 + y / SCALE, ar) for x, y, ar in cands]))
        # le fond suit lentement le décor, mais pas là où quelque chose bouge
        alpha = np.where(fg, 0.005, 0.08)
        bg += alpha * (f - bg)

    tracks = track(per_frame, max_jump=0.6 * rw)
    shots = []
    for tr in tracks:
        r = judge(tr, (cx, cy, rw))
        if r:
            shots.append(r)
    shots.sort()
    # plusieurs morceaux de trajectoire pour un même tir (rebonds, pertes) : on regroupe sur 2,5 s
    merged = []
    for t, made in shots:
        if merged and t - merged[-1][0] < 2.5:
            merged[-1][1] = merged[-1][1] or made
        else:
            merged.append([t, made])

    for t, made in merged:
        print(f'{int(t // 60)}:{t % 60:04.1f}  {"MARQUÉ" if made else "raté"}')
    n_made = sum(m for _, m in merged)
    print(f'\n{len(merged)} tirs, {n_made} marqués')

    if a.labels:
        truth = json.load(open(a.labels))['shots']
        used = set()
        ok = 0
        print('\nComparaison avec la vérité terrain :')
        for s in truth:
            match = next((i for i, (t, _) in enumerate(merged) if i not in used and abs(t - s['t']) < 3), None)
            if match is None:
                print(f"  {s['t']:6.1f}s  {'M' if s['made'] else 'R'}  → NON DÉTECTÉ")
                continue
            used.add(match)
            good = merged[match][1] == s['made']
            ok += good
            print(f"  {s['t']:6.1f}s  {'M' if s['made'] else 'R'}  → {'M' if merged[match][1] else 'R'} {'✓' if good else '✗'}")
        extra = [merged[i] for i in range(len(merged)) if i not in used]
        for t, m in extra:
            print(f'  {t:6.1f}s  (pas un tir)  → faux tir détecté')
        print(f'\nScore : {ok}/{len(truth)} bien classés, {len(extra)} faux tirs')

    if a.debug:
        json.dump([[list(p) for p in tr] for tr in tracks], open('analysis/tracks-debug.json', 'w'))


if __name__ == '__main__':
    sys.exit(main())
