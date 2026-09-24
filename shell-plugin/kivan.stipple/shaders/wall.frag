// Stipple's animated wallpaper, one full-screen pass.
//
// Two ways to draw:
//   mode 0  recolour: the saved PNG, re-inked. Every mono PNG is paper + ink * coverage, so the
//           coverage comes back from the pixel and is mixed with the colours of the hour. Any
//           style; used when only Colour over the day is on.
//   mode 1  dots: the Braille lattice drawn from the field texture (one texel per dot):
//             R  the saved dot (255 = raised), exactly what the PNG shows
//             G  ink amount 1 - L, quantised so an Ordered threshold picks the same dots
//             B  a dot forced on by edge emphasis
//           Twinkle flips one dot in a few cells per tick; Shimmer and Pan and zoom re-dither G
//           with Typist's 4x4 Bayer matrix (dither.js), so time 0 is the PNG exactly.
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
    vec4 effects;    // twinkle amount, shimmer amount, pan zoom, pan period (s)
    vec4 clock;      // time (s), twinkle tick, shimmer tick, 0
};

layout(binding = 1) uniform sampler2D fieldTex;
layout(binding = 2) uniform sampler2D artTex;

const float BAYER4[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);

float hash(uint x, uint y, uint z) {
    uint h = x * 374761393u + y * 668265263u + z * 2246822519u;
    h = (h ^ (h >> 13)) * 1274126177u;
    h ^= h >> 16;
    return float(h >> 8) * (1.0 / 16777216.0);
}

ivec2 fieldMax() { return ivec2(field.xy) - 1; }

// Ink amount at a point in sample units (sample i's centre is i + 0.5), bilinear.
float toneAt(vec2 p) {
    vec2 q = p - 0.5;
    ivec2 i0 = ivec2(floor(q));
    vec2 f = q - vec2(i0);
    ivec2 m = fieldMax();
    float a = texelFetch(fieldTex, clamp(i0, ivec2(0), m), 0).g;
    float b = texelFetch(fieldTex, clamp(i0 + ivec2(1, 0), ivec2(0), m), 0).g;
    float c = texelFetch(fieldTex, clamp(i0 + ivec2(0, 1), ivec2(0), m), 0).g;
    float d = texelFetch(fieldTex, clamp(i0 + ivec2(1, 1), ivec2(0), m), 0).g;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Pan and zoom inside the crop: zoom breathes 1 -> 1 + zoom -> 1 over the period while the view
// wanders, never leaving the field. Time 0 is the identity.
vec2 panned(vec2 p) {
    if (effects.z <= 0.0) return p;
    float T = clock.x, P = max(effects.w, 1.0);
    float z = 1.0 + effects.z * (0.5 - 0.5 * cos(6.2831853 * T / P));
    vec2 C = field.xy * 0.5;
    float a = 6.2831853 * T / (P * 1.618);
    vec2 dir = vec2(cos(a), sin(a * 1.3));
    return C + (p - C) / z + (1.0 - 1.0 / z) * 0.9 * C * dir;
}

bool dotOn(ivec2 s) {
    if (s.x < 0 || s.y < 0 || s.x >= int(field.x) || s.y >= int(field.y)) return false;
    uint seed = uint(canvas.w);
    bool on;
    if (effects.y > 0.0 || effects.z > 0.0) {
        vec2 p = panned(vec2(s) + 0.5);
        float t = (BAYER4[(s.y & 3) * 4 + (s.x & 3)] + 0.5) / 16.0;
        if (effects.y > 0.0) t += (hash(uint(s.x), uint(s.y), uint(clock.z) * 4u + seed) - 0.5) * effects.y;
        on = toneAt(p) > t || texelFetch(fieldTex, clamp(ivec2(floor(p)), ivec2(0), fieldMax()), 0).b > 0.5;
    } else {
        on = texelFetch(fieldTex, s, 0).r > 0.5;
    }
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

void main() {
    vec2 wp = qt_TexCoord0 * map.xy + map.zw;
    vec3 col;
    if (canvas.z < 0.5) {
        vec3 c = texture(artTex, wp / canvas.xy).rgb;
        vec3 d = srcInk.rgb - srcPaper.rgb;
        float k = clamp(dot(c - srcPaper.rgb, d) / max(dot(d, d), 1e-6), 0.0, 1.0);
        col = mix(paper.rgb, ink.rgb, k);
    } else {
        float cov = 0.0;
        if (wp.x >= clipRect.x && wp.y >= clipRect.y && wp.x < clipRect.z && wp.y < clipRect.w) {
            float aa = max(fwidth(wp.x), 1e-4);
            float r = field.z;
            vec2 f = (wp - lattice.xy) / lattice.zw - 0.5;
            ivec2 s0 = ivec2(floor(f));
            for (int dy = 0; dy < 2; dy++) {
                for (int dx = 0; dx < 2; dx++) {
                    ivec2 s = s0 + ivec2(dx, dy);
                    vec2 c = floor((lattice.xy + (vec2(s) + 0.5) * lattice.zw) * 4.0 + 0.5) / 4.0;
                    float dist = length(wp - c);
                    if (dist > r + aa || !dotOn(s)) continue;
                    float ci = clamp((r - dist) / aa + 0.5, 0.0, 1.0);
                    cov = 1.0 - (1.0 - cov) * (1.0 - ci);
                }
            }
        }
        col = mix(paper.rgb, ink.rgb, cov);
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
