// This is the built-in fragment shader used by My Blocks Scene. The scene
// function is replaced with the GLSL generated from the scene definition
// blocks; the ray marcher and lighting stay in this source unchanged.
const SCENE_FRAGMENT_SHADER = `
precision highp float;

varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_time;
uniform int u_frame;
uniform vec3 campos;
uniform vec3 camrot;

// ============================================================================
// User scene expression
//
// \`p\` is a world-space position. Return RGB for a point inside an object and
// vec3(0.0) for empty space. The renderer below treats zero RGB as "empty".
//
// GLSL does not allow \`abs(p) < 50\` directly because that comparison produces
// a bvec3. The equivalent expression is:
//   all(lessThan(abs(p), vec3(50.0)))
//
// This example is a colored box. Replace only this function to define a scene.
// ============================================================================
vec3 scene(vec3 p) {
    return all(lessThan(abs(p), vec3(0.65)))
        ? vec3(0.95, 0.18, 0.06)
        : vec3(0.0);
}

// ============================================================================
// Internal renderer
// ============================================================================

// The renderer needs a finite search volume because scene() provides no
// distance or other way to skip empty space. Keep this volume around the
// objects you define above.
const vec3 SCENE_MIN = vec3(-1.5);
const vec3 SCENE_MAX = vec3(1.5);

// More samples make thin objects easier to hit, but cost proportionally more.
// This is the unavoidable cost of using a color/presence function instead of
// an SDF. Once a hit interval is found, binary refinement is inexpensive.
const int TRACE_STEPS = 128;
const int REFINE_STEPS = 8;
const float EMPTY_EPSILON = 0.0001;
const float NORMAL_EPSILON = 0.002;
const float DEG_TO_RAD = 0.017453292519943295;

struct Hit {
    bool found;
    float t;
    vec3 color;
};

mat3 rotationX(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(
        1.0, 0.0, 0.0,
        0.0, c, -s,
        0.0, s, c
    );
}

mat3 rotationY(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(
        c, 0.0, s,
        0.0, 1.0, 0.0,
        -s, 0.0, c
    );
}

mat3 rotationZ(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(
        c, -s, 0.0,
        s, c, 0.0,
        0.0, 0.0, 1.0
    );
}

// shading.app camera rotation is expressed as XYZ degrees. The vector is
// rotated X -> Y -> Z, matching the app's default XYZ Euler order.
vec3 rotateCamera(vec3 direction, vec3 rotationDegrees) {
    vec3 angles = rotationDegrees * DEG_TO_RAD;
    direction = rotationX(angles.x) * direction;
    direction = rotationY(angles.y) * direction;
    return rotationZ(angles.z) * direction;
}

float colorMagnitude(vec3 color) {
    return max(max(abs(color.r), abs(color.g)), abs(color.b));
}

bool isOccupied(vec3 p) {
    return colorMagnitude(scene(p)) > EMPTY_EPSILON;
}

bool intersectBox(
    vec3 rayOrigin,
    vec3 rayDirection,
    vec3 boxMin,
    vec3 boxMax,
    out float tNear,
    out float tFar
) {
    vec3 safeDirection = vec3(
        abs(rayDirection.x) < 1.0e-6
            ? (rayDirection.x < 0.0 ? -1.0e-6 : 1.0e-6)
            : rayDirection.x,
        abs(rayDirection.y) < 1.0e-6
            ? (rayDirection.y < 0.0 ? -1.0e-6 : 1.0e-6)
            : rayDirection.y,
        abs(rayDirection.z) < 1.0e-6
            ? (rayDirection.z < 0.0 ? -1.0e-6 : 1.0e-6)
            : rayDirection.z
    );

    vec3 t0 = (boxMin - rayOrigin) / safeDirection;
    vec3 t1 = (boxMax - rayOrigin) / safeDirection;
    vec3 tMin = min(t0, t1);
    vec3 tMax = max(t0, t1);

    tNear = max(max(tMin.x, tMin.y), tMin.z);
    tFar = min(min(tMax.x, tMax.y), tMax.z);

    return tFar >= max(tNear, 0.0);
}

Hit traceScene(vec3 rayOrigin, vec3 rayDirection) {
    Hit hit;
    hit.found = false;
    hit.t = 0.0;
    hit.color = vec3(0.0);

    float tNear;
    float tFar;
    if (!intersectBox(
        rayOrigin,
        rayDirection,
        SCENE_MIN,
        SCENE_MAX,
        tNear,
        tFar
    )) {
        return hit;
    }

    float start = max(tNear, 0.0);
    float stepSize = (tFar - start) / float(TRACE_STEPS);
    float previousT = start;
    bool previousOccupied = isOccupied(rayOrigin + rayDirection * previousT);

    if (previousOccupied) {
        hit.found = true;
        hit.t = previousT;
        hit.color = scene(rayOrigin + rayDirection * hit.t);
        return hit;
    }

    for (int i = 1; i <= TRACE_STEPS; i++) {
        float currentT = min(start + stepSize * float(i), tFar);
        vec3 currentPosition = rayOrigin + rayDirection * currentT;
        bool currentOccupied = isOccupied(currentPosition);

        if (!previousOccupied && currentOccupied) {
            // The exact surface is only known to lie between previousT and
            // currentT. Refine that transition without needing a distance.
            float emptyT = previousT;
            float occupiedT = currentT;

            for (int j = 0; j < REFINE_STEPS; j++) {
                float middleT = 0.5 * (emptyT + occupiedT);
                vec3 middlePosition = rayOrigin + rayDirection * middleT;

                if (isOccupied(middlePosition)) {
                    occupiedT = middleT;
                } else {
                    emptyT = middleT;
                }
            }

            hit.found = true;
            hit.t = occupiedT;
            hit.color = scene(rayOrigin + rayDirection * hit.t);
            return hit;
        }

        previousT = currentT;
        previousOccupied = currentOccupied;
    }

    return hit;
}

vec3 sceneNormal(vec3 p) {
    vec3 e = vec3(NORMAL_EPSILON, 0.0, 0.0);
    vec3 gradient = vec3(
        (isOccupied(p - e.xyy) ? 1.0 : 0.0)
            - (isOccupied(p + e.xyy) ? 1.0 : 0.0),
        (isOccupied(p - e.yxy) ? 1.0 : 0.0)
            - (isOccupied(p + e.yxy) ? 1.0 : 0.0),
        (isOccupied(p - e.yyx) ? 1.0 : 0.0)
            - (isOccupied(p + e.yyx) ? 1.0 : 0.0)
    );

    // A one-sided fallback keeps the normal valid on very thin features.
    if (dot(gradient, gradient) < 0.000001) {
        gradient = vec3(
            isOccupied(p - e.xyy) ? 1.0 : -1.0,
            isOccupied(p - e.yxy) ? 1.0 : -1.0,
            isOccupied(p - e.yyx) ? 1.0 : -1.0
        );
    }

    return normalize(gradient);
}

float shadowVisibility(vec3 p, vec3 lightDirection) {
    // Start just outside the surface so the hit does not shadow itself.
    Hit shadowHit = traceScene(p + lightDirection * NORMAL_EPSILON * 2.0, lightDirection);
    return shadowHit.found ? 0.25 : 1.0;
}

vec3 background(vec2 uv) {
    vec3 top = vec3(0.035, 0.055, 0.09);
    vec3 bottom = vec3(0.005, 0.008, 0.015);
    return mix(bottom, top, clamp(0.5 + 0.5 * uv.y, 0.0, 1.0));
}

void main() {
    vec2 uv = v_uv * 2.0 - 1.0;
    uv.x *= u_resolution.x / max(u_resolution.y, 1.0);

    vec3 rayOrigin = campos;
    vec3 rayDirection = normalize(rotateCamera(vec3(uv, -2.2), camrot));

    Hit hit = traceScene(rayOrigin, rayDirection);
    vec3 pixel = background(uv);

    if (hit.found) {
        vec3 position = rayOrigin + rayDirection * hit.t;
        vec3 normal = sceneNormal(position);
        vec3 lightDirection = normalize(vec3(-0.6, 0.8, 1.0));
        float diffuse = max(dot(normal, lightDirection), 0.0);
        float shadow = shadowVisibility(position, lightDirection);
        float rim = pow(1.0 - max(dot(normal, -rayDirection), 0.0), 2.0);

        vec3 lighting = vec3(0.18) + vec3(0.82) * diffuse * shadow;
        pixel = hit.color * lighting + hit.color * rim * 0.12;
    }

    gl_FragColor = vec4(pixel, 1.0);
}
`;

export default SCENE_FRAGMENT_SHADER;
