// Stipple's animated wallpaper, one full-screen pass.
//
// Three ways to draw:
//   mode 0  recolour: the saved PNG, re-inked. Every mono PNG is paper + ink * coverage, so the
//           coverage comes back from the pixel and is mixed with the colours of the hour. Any
//           style; used for a still wallpaper under the Stipple theme.
//   mode 1  dots: the Braille lattice drawn from the field texture (one texel per dot):
//             R  the saved dot (255 = raised), exactly what the PNG shows
//           Twinkle flips one dot in a few cells per tick.
//   mode 2  letters (Columns): one keyframe of the letters, drawn from
//             framesTex  the keyframes' cells, R = 1 + glyph index (0 blank), this one's at fgrid.zw
//             glyphTex   each glyph at a few cell heights (levels), glyph g in channel g % 3 of
//                        slot g / 3, a pixel of padding and OVER_X / OVER_Y of the cell around it
//           Glyphs overhang their cell, so a pixel looks at its cell and the 8 around it. The two
//           levels nearest the cell height are blended (lvMix). See src/lib/letterframes.ts.
//
// Outside the art's rectangle (the margin, or around an art box) is the surround colour.
//
// The night (effects.y, 0-1): when the hour's colours have crossed over, the art drawn the other
// way round takes over, so the picture stays a positive. Each mode has it: mode 0 in nightTex (its
// coverage), mode 1 in the field's G, mode 2 in framesTex's G. 0 draws only the day's, 1 only the
// night's; between (a narrow band where ink and paper meet, palette.mjs flipAt) the two are mixed.
//
// The geometry is src/lib/rasterize.ts's: dot centres on a regular lattice snapped to quarter
// pixels, radius min(dotR * pitchX, 0.46 * pitch). src/lib/motion.ts mirrors every formula here
// for the app's preview; keep the two in step.

#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 ink;        // colours to draw with
    vec4 paper;
    vec4 srcInk;     // colours the PNG was drawn with (mode 0)
    vec4 srcPaper;
    vec4 canvas;     // wallpaper width, height, mode, seed
    vec4 map;        // wallpaper px = uv * map.xy + map.zw
    vec4 lattice;    // grid origin x, y, dot pitch x, y
    vec4 clipRect;   // x0, y0, x1, y1 in wallpaper px
    vec4 field;      // field width, height, dot radius, 0
    vec4 effects;    // twinkle amount, night (0 the day's art, 1 the night's), 0, 0
    vec4 clock;      // 0, twinkle tick, 0, 0
    vec4 inner;      // the art's rectangle x0, y0, x1, y1 in wallpaper px (surround outside)
    vec4 surround;   // colour outside it
    vec4 fcell;      // mode 2: the keyframe's grid origin x, y and cell width, height (px)
    vec4 fgrid;      // mode 2: its columns, rows, and its cells' top-left in framesTex
    vec4 lvA;        // mode 2: glyph level A: band top, cell width, cell height, tile width
    vec4 lvB;        // mode 2: glyph level B, the same
    vec4 lvX;        // mode 2: tile height A, slots per row A, tile height B, slots per row B
    vec4 lvMix;      // mode 2: weight of level B, 0, 0, 0
};

layout(binding = 1) uniform sampler2D fieldTex;
layout(binding = 2) uniform sampler2D artTex;
layout(binding = 3) uniform sampler2D framesTex;
layout(binding = 4) uniform sampler2D glyphTex;
layout(binding = 5) uniform sampler2D nightTex;

const float OVER_X = 0.5, OVER_Y = 0.35;

float hash(uint x, uint y, uint z) {
    uint h = x * 374761393u + y * 668265263u + z * 2246822519u;
    h = (h ^ (h >> 13)) * 1274126177u;
    h ^= h >> 16;
    return float(h >> 8) * (1.0 / 16777216.0);
}

// ch: 0 the day's dots (R), 1 the night's (G)
bool dotOn(ivec2 s, int ch) {
    if (s.x < 0 || s.y < 0 || s.x >= int(field.x) || s.y >= int(field.y)) return false;
    uint seed = uint(canvas.w);
    bool on = texelFetch(fieldTex, s, 0)[ch] > 0.5;
    if (effects.x > 0.0) {
        ivec2 c = s / ivec2(2, 4);
        uint tk = uint(clock.y) * 4u + seed;
        if (hash(uint(c.x), uint(c.y), tk + 1u) < effects.x) {
            int k = min(7, int(hash(uint(c.x), uint(c.y), tk + 2u) * 8.0));
            if (s == c * ivec2(2, 4) + ivec2(k & 1, k >> 1)) on = !on;
        }
    }
    return on;
}

// Coverage of glyph g at u (cell units, the cell is 0..1) from one atlas level, bilinear inside
// its tile only, so a neighbouring glyph never bleeds in.
float glyphAt(int g, vec2 u, vec4 lv, float th, float perRow) {
    vec2 p = vec2(1.0 + (u.x + OVER_X) * lv.y, 1.0 + (u.y + OVER_Y) * lv.z);
    if (p.x <= 0.0 || p.y <= 0.0 || p.x >= lv.w || p.y >= th) return 0.0;
    int slot = g / 3, ch = g - slot * 3, pr = max(int(perRow), 1);
    ivec2 o = ivec2((slot % pr) * int(lv.w), int(lv.x) + (slot / pr) * int(th));
    ivec2 hi = o + ivec2(int(lv.w), int(th)) - 1;
    vec2 q = p - 0.5;
    ivec2 i0 = ivec2(floor(q));
    vec2 f = q - vec2(i0);
    float a = texelFetch(glyphTex, clamp(o + i0, o, hi), 0)[ch];
    float b = texelFetch(glyphTex, clamp(o + i0 + ivec2(1, 0), o, hi), 0)[ch];
    float c = texelFetch(glyphTex, clamp(o + i0 + ivec2(0, 1), o, hi), 0)[ch];
    float d = texelFetch(glyphTex, clamp(o + i0 + ivec2(1, 1), o, hi), 0)[ch];
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// ch: 0 the day's keyframes (R), 1 the night's (G)
float lettersCov(vec2 wp, int ch) {
    vec2 f = (wp - fcell.xy) / fcell.zw;
    ivec2 c0 = ivec2(floor(f));
    ivec2 n = ivec2(fgrid.xy);
    float cov = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            ivec2 c = c0 + ivec2(dx, dy);
            if (c.x < 0 || c.y < 0 || c.x >= n.x || c.y >= n.y) continue;
            int id = int(texelFetch(framesTex, ivec2(fgrid.zw) + c, 0)[ch] * 255.0 + 0.5);
            if (id == 0) continue;
            vec2 u = f - vec2(c);
            float k = glyphAt(id - 1, u, lvA, lvX.x, lvX.y);
            if (lvMix.x > 0.0) k = mix(k, glyphAt(id - 1, u, lvB, lvX.z, lvX.w), lvMix.x);
            cov = 1.0 - (1.0 - cov) * (1.0 - k);
        }
    }
    return cov;
}

float dotsCov(vec2 wp, float aa, int ch) {
    float cov = 0.0;
    float r = field.z;
    vec2 f = (wp - lattice.xy) / lattice.zw - 0.5;
    ivec2 s0 = ivec2(floor(f));
    for (int dy = 0; dy < 2; dy++) {
        for (int dx = 0; dx < 2; dx++) {
            ivec2 s = s0 + ivec2(dx, dy);
            vec2 c = floor((lattice.xy + (vec2(s) + 0.5) * lattice.zw) * 4.0 + 0.5) / 4.0;
            float dist = length(wp - c);
            if (dist > r + aa || !dotOn(s, ch)) continue;
            float ci = clamp((r - dist) / aa + 0.5, 0.0, 1.0);
            cov = 1.0 - (1.0 - cov) * (1.0 - ci);
        }
    }
    return cov;
}

void main() {
    vec2 wp = qt_TexCoord0 * map.xy + map.zw;
    // derivatives in uniform control flow: the branches below differ per pixel
    float aa = max(fwidth(wp.x), 1e-4);
    float night = effects.y;
    vec3 col;
    if (wp.x < inner.x || wp.y < inner.y || wp.x >= inner.z || wp.y >= inner.w) {
        col = surround.rgb;
    } else if (canvas.z < 0.5) {
        float k = 0.0;
        if (night < 1.0) {
            vec3 c = texture(artTex, wp / canvas.xy).rgb;
            vec3 d = srcInk.rgb - srcPaper.rgb;
            k = clamp(dot(c - srcPaper.rgb, d) / max(dot(d, d), 1e-6), 0.0, 1.0);
        }
        if (night > 0.0) k = mix(k, texture(nightTex, wp / canvas.xy).r, night);
        col = mix(paper.rgb, ink.rgb, k);
    } else {
        float cov = 0.0;
        if (wp.x >= clipRect.x && wp.y >= clipRect.y && wp.x < clipRect.z && wp.y < clipRect.w) {
            bool letters = canvas.z > 1.5;
            float day = night < 1.0 ? (letters ? lettersCov(wp, 0) : dotsCov(wp, aa, 0)) : 0.0;
            float other = night > 0.0 ? (letters ? lettersCov(wp, 1) : dotsCov(wp, aa, 1)) : 0.0;
            cov = mix(day, other, night);
        }
        col = mix(paper.rgb, ink.rgb, cov);
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
