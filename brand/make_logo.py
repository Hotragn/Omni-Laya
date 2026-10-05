"""Draws the OmniLaya mark and lockups as SVG.

The mark is an open ring painted in one brush stroke, like an enso, with an
ink drop flicked inside it. The ring is "omni", the whole web; the drop is the
one point where Laya makes a decision. The stroke is generated, not hand
drawn, so the files can be rebuilt and every size stays consistent:

    python brand/make_logo.py

Two renderings of the same geometry are written:
- `*-wash.svg` carries an SVG filter that gives the ink watercolor edges, a
  darker pooled rim, uneven density and paper grain. Use it at 48 px and up.
- `*-flat.svg` is the plain shape for favicons and other small sizes, where
  texture turns into noise.
"""
import math
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'logo')

INK = '#1b1a17'
INK_SOFT = '#635f57'
PAPER = '#f4eee3'
NIGHT = '#15140f'
INK_ON_NIGHT = '#efe8dc'
INK_SOFT_ON_NIGHT = '#a39c8e'

CX, CY, R = 50.0, 51.0, 31.0
# SVG angles run clockwise from 3 o'clock. The stroke starts just past the gap
# and runs clockwise; the gap sits at about half past one.
START, SWEEP = math.radians(-22), math.radians(322)


def width_at(t):
    """Brush pressure along the stroke: quick attack, full body, thinning tail."""
    attack = min(1.0, t / 0.07) ** 0.7
    body = math.sin(math.pi * min(1.0, 0.18 + t * 0.82)) ** 0.35
    return 2.4 + 11.6 * attack * body


def point(a, r):
    return CX + r * math.cos(a), CY + r * math.sin(a)


def band(t0, t1, offset, scale, drift, steps):
    """A closed band along the ring from t0 to t1, offset from the centre line."""
    outer, inner = [], []
    for i in range(steps + 1):
        t = t0 + (t1 - t0) * i / steps
        a = START + SWEEP * t
        w = width_at(t) * scale
        # strands fade to a point at their own end
        end_taper = min(1.0, (t1 - t) / 0.05) if t1 < 1 else 1.0
        w *= max(0.12, end_taper)
        r = R + drift(a) + offset
        outer.append(point(a, r + w / 2))
        inner.append(point(a, r - w / 2))
    pts = outer + inner[::-1]
    return 'M' + ' L'.join(f'{x:.2f} {y:.2f}' for x, y in pts) + ' Z'


def ring_paths(seed=5):
    rnd = random.Random(seed)
    wobble = [rnd.uniform(-0.5, 0.5) for _ in range(6)]

    def drift(a):
        return sum(w * math.sin((k + 2) * a + k * 1.7) for k, w in enumerate(wobble)) * 0.55

    body_end = 0.78
    paths = [band(0.0, body_end + 0.02, 0.0, 1.0, drift, 150)]
    # Dry brush: the stroke splits into strands that run out at different lengths.
    w_end = width_at(body_end)
    for offset, scale, end in [(-0.34, 0.26, 0.9), (-0.08, 0.2, 1.0), (0.18, 0.22, 0.95), (0.38, 0.14, 0.86)]:
        paths.append(band(body_end - 0.01, end, offset * w_end, scale * w_end / width_at(body_end) * 1.0, drift, 40))
    return paths


def drop_path():
    """An ink drop inside the ring, near the gap, its tail pointing at the gap."""
    gap = START - math.radians(19)
    x, y = point(gap, R * 0.5)
    rr = 4.4
    tail = gap  # outward, toward the gap
    tip = (x + math.cos(tail) * rr * 2.3, y + math.sin(tail) * rr * 2.3)
    # tangent points on the circle for a tail that leaves it smoothly
    spread = math.acos(1 / 2.3)
    p1 = (x + math.cos(tail + spread) * rr, y + math.sin(tail + spread) * rr)
    p2 = (x + math.cos(tail - spread) * rr, y + math.sin(tail - spread) * rr)
    # p1 to tip to p2, then the long way round the circle back to p1
    return (f'M{p1[0]:.2f} {p1[1]:.2f} L{tip[0]:.2f} {tip[1]:.2f} L{p2[0]:.2f} {p2[1]:.2f} '
            f'A{rr:.2f} {rr:.2f} 0 1 0 {p1[0]:.2f} {p1[1]:.2f} Z')


def wash_filter(ink, fid='wash'):
    """Watercolor on the shape's alpha only, then filled with the ink colour."""
    return f"""
    <filter id="{fid}" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="3" seed="4" result="edgeNoise"/>
      <feDisplacementMap in="SourceAlpha" in2="edgeNoise" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="ragged"/>
      <feMorphology in="ragged" operator="erode" radius="1.4" result="core"/>
      <feGaussianBlur in="core" stdDeviation="1.5" result="coreSoft"/>
      <feComposite in="ragged" in2="coreSoft" operator="out" result="rim"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed="9" result="blotchNoise"/>
      <feColorMatrix in="blotchNoise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 2.2 -0.7" result="blotch"/>
      <feComposite in="ragged" in2="blotch" operator="arithmetic" k1="0.34" k2="0.64" k3="0" k4="0" result="body"/>
      <feComposite in="body" in2="rim" operator="arithmetic" k1="0" k2="1" k3="0.9" k4="0" result="pigment"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="2" result="grainNoise"/>
      <feColorMatrix in="grainNoise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.34 -0.1" result="grain"/>
      <feComposite in="pigment" in2="grain" operator="arithmetic" k1="-1" k2="1" k3="0" k4="0" result="alpha"/>
      <feFlood flood-color="{ink}"/>
      <feComposite in2="alpha" operator="in"/>
    </filter>"""


def shapes():
    return ''.join(f'<path d="{d}"/>' for d in ring_paths()) + f'<path d="{drop_path()}"/>'


def mark_svg(ink, bg=None, wash=True, size=100):
    defs = f'<defs>{wash_filter(ink)}\n  </defs>' if wash else ''
    fattr = ' filter="url(#wash)"' if wash else ''
    rect = f'<rect width="100" height="100" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="{size}" height="{size}" role="img" aria-label="OmniLaya">\n'
            f'  {defs}\n  {rect}\n  <g fill="{ink}"{fattr}>{shapes()}</g>\n</svg>\n')


def icon_svg(ink, bg, pad, wash=True):
    """Square app icon on a paper tile, with room for maskable crops."""
    s = (100 - 2 * pad) / 100
    defs = f'<defs>{wash_filter(ink)}\n  </defs>' if wash else ''
    fattr = ' filter="url(#wash)"' if wash else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">\n'
            f'  {defs}\n  <rect width="100" height="100" fill="{bg}"/>\n'
            f'  <g transform="translate({pad} {pad}) scale({s:.4f})" fill="{ink}"{fattr}>{shapes()}</g>\n</svg>\n')


def lockup_svg(ink, soft, bg=None):
    """Mark plus wordmark. The wordmark is set in Shippori Mincho; outline it before print use."""
    rect = f'<rect width="560" height="120" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 120" width="560" height="120" role="img" aria-label="OmniLaya Search">\n'
            f'  <defs>{wash_filter(ink)}\n  </defs>\n  {rect}\n'
            f'  <g transform="translate(10 10)" fill="{ink}" filter="url(#wash)">{shapes()}</g>\n'
            f'  <text x="126" y="77" font-family="&apos;Shippori Mincho&apos;, &apos;Hiragino Mincho ProN&apos;, Georgia, serif" font-size="52" font-weight="700" letter-spacing="-1" fill="{ink}">OmniLaya'
            f'<tspan dx="12" font-weight="500" fill="{soft}">Search</tspan></text>\n</svg>\n')


def wash_svg():
    """A soft ink wash for backgrounds: overlapping pools with bled edges and a darker rim.

    Rendered once to `public/wash.webp`; the page sets its opacity and inverts it for the night theme.
    """
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 800" width="1600" height="800">
  <defs>
    <filter id="bleed" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="4" seed="7" result="edgeNoise"/>
      <feDisplacementMap in="SourceAlpha" in2="edgeNoise" scale="120" xChannelSelector="R" yChannelSelector="G" result="ragged"/>
      <feGaussianBlur in="ragged" stdDeviation="6" result="soft"/>
      <feMorphology in="soft" operator="erode" radius="14" result="core"/>
      <feGaussianBlur in="core" stdDeviation="22" result="coreSoft"/>
      <feComposite in="soft" in2="coreSoft" operator="arithmetic" k2="1" k3="-0.45" result="pooled"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.01" numOctaves="3" seed="3" result="blotchNoise"/>
      <feColorMatrix in="blotchNoise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.8 -0.5" result="blotch"/>
      <feComposite in="pooled" in2="blotch" operator="arithmetic" k1="0.5" k2="0.5" result="alpha"/>
      <feFlood flood-color="#1b1a17"/>
      <feComposite in2="alpha" operator="in"/>
    </filter>
  </defs>
  <g filter="url(#bleed)">
    <ellipse cx="660" cy="430" rx="470" ry="210"/>
    <ellipse cx="1000" cy="350" rx="360" ry="170"/>
  </g>
</svg>
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    files = {
        'mark-wash.svg': mark_svg(INK),
        'mark-flat.svg': mark_svg(INK, wash=False),
        'mark-wash-on-night.svg': mark_svg(INK_ON_NIGHT),
        'mark-flat-on-night.svg': mark_svg(INK_ON_NIGHT, wash=False),
        'icon.svg': icon_svg(INK, PAPER, pad=13),
        'icon-maskable.svg': icon_svg(INK, PAPER, pad=23),
        'favicon.svg': icon_svg(INK, PAPER, pad=6, wash=False),
        'lockup.svg': lockup_svg(INK, INK_SOFT),
        'lockup-on-night.svg': lockup_svg(INK_ON_NIGHT, INK_SOFT_ON_NIGHT, bg=NIGHT),
        'wash.svg': wash_svg(),
    }
    for name, svg in files.items():
        with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(svg)
    for old in ('mark-wash-on-dark.svg', 'mark-flat-on-dark.svg', 'lockup-on-dark.svg'):
        path = os.path.join(OUT, old)
        if os.path.exists(path):
            os.remove(path)
    print('wrote', ', '.join(files))


if __name__ == '__main__':
    main()
