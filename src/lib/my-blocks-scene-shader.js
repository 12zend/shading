// This is the built-in fragment shader used by My Blocks Scene. The scene
// function is replaced with the GLSL generated from the scene definition
// blocks. Camera and lighting state are supplied by MovieAssetManager so this
// renderer follows the Camera and Objects/Lighting blocks.
const SCENE_MAX_LIGHTS = 8;
const SCENE_LIGHT_UNIFORM_DECLARATIONS = Array.from(
    {length: SCENE_MAX_LIGHTS},
    (_, index) => [
        `uniform vec4 u_scene_light_position_${index};`,
        `uniform vec4 u_scene_light_color_${index};`,
        `uniform vec4 u_scene_light_params_${index};`
    ].join('\n')
).join('\n');
const SCENE_LIGHT_CALLS = Array.from(
    {length: SCENE_MAX_LIGHTS},
    (_, index) => `    if (u_scene_light_count > ${index}) {
        result += sceneLightContribution(
            position,
            normal,
            u_scene_light_position_${index},
            u_scene_light_color_${index},
            u_scene_light_params_${index}
        );
    }`
).join('\n');

const SCENE_FRAGMENT_SHADER = `
precision highp float;

varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_time;
uniform int u_frame;
uniform vec3 campos;
uniform vec3 camrot;
uniform float camfocal;
uniform int camrotorder;
uniform vec2 u_scene_viewport;
uniform int u_scene_light_count;
uniform vec3 u_scene_ambient_sky;
uniform vec3 u_scene_ambient_ground;
uniform vec3 u_scene_ambient_direction;
uniform float u_scene_ambient_intensity;
uniform vec3 u_scene_spot_target;
${SCENE_LIGHT_UNIFORM_DECLARATIONS}

// ============================================================================
// User scene expression
//
// \`p\` is a world-space position. sceneContains(p) decides whether the point is
// inside an object, and scene(p) returns its RGB. A true condition may still
// return black, so occupancy is kept separate from the RGB value.
//
// GLSL does not allow \`abs(p) < 50\` directly because that comparison produces
// a bvec3. The equivalent expression is:
//   all(lessThan(abs(p), vec3(50.0)))
//
// This example is a colored box. Replace these functions to define a scene.
// ============================================================================
bool sceneContains(vec3 p) {
    return all(lessThan(abs(p), vec3(0.65)));
}

vec3 scene(vec3 p) {
    return sceneContains(p)
        ? vec3(0.95, 0.18, 0.06)
        : vec3(0.0);
}

// ============================================================================
// Internal renderer
// ============================================================================

// scene() is an occupancy function, not an SDF, so the renderer cannot skip
// empty space. Do not intersect a fixed scene box here: a valid expression can
// describe an object that extends forever along one or more axes. Keep a dense
// near range for ordinary objects and a logarithmic far range for unbounded
// objects such as px < -1.5. The far distance is only a GPU termination bound;
// it does not clamp p.x, p.y, or p.z to a scene-space box.
const float TRACE_NEAR_DISTANCE = 32.0;
const float TRACE_FAR_DISTANCE = 1000000.0;
const int TRACE_NEAR_STEPS = 192;
const int TRACE_FAR_STEPS = 64;
const int TRACE_STEPS = TRACE_NEAR_STEPS + TRACE_FAR_STEPS;
const int REFINE_STEPS = 12;
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

// Movie stores positions in a +Z-forward coordinate system, while the Scene
// shader follows the Three.js/source shader convention where the camera looks
// down -Z. Reflect the local and world vectors around Z when applying the
// Movie Euler rotation so Camera blocks and the Objects renderer agree.
mat3 movieToSceneBasis() {
    return mat3(
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, -1.0
    );
}

// shading.app camera rotation is expressed as Euler degrees. Apply the axes in
// the same order as the Camera category's rotationOrder state.
vec3 rotateCamera(vec3 direction, vec3 rotationDegrees, int rotationOrder) {
    mat3 basis = movieToSceneBasis();
    direction = basis * direction;
    vec3 angles = rotationDegrees * DEG_TO_RAD;
    if (rotationOrder == 0) {
        direction = rotationX(angles.x) * direction;
        direction = rotationY(angles.y) * direction;
        direction = rotationZ(angles.z) * direction;
    } else if (rotationOrder == 1) {
        direction = rotationX(angles.x) * direction;
        direction = rotationZ(angles.z) * direction;
        direction = rotationY(angles.y) * direction;
    } else if (rotationOrder == 2) {
        direction = rotationY(angles.y) * direction;
        direction = rotationX(angles.x) * direction;
        direction = rotationZ(angles.z) * direction;
    } else if (rotationOrder == 3) {
        direction = rotationY(angles.y) * direction;
        direction = rotationZ(angles.z) * direction;
        direction = rotationX(angles.x) * direction;
    } else if (rotationOrder == 4) {
        direction = rotationZ(angles.z) * direction;
        direction = rotationX(angles.x) * direction;
        direction = rotationY(angles.y) * direction;
    } else {
        direction = rotationZ(angles.z) * direction;
        direction = rotationY(angles.y) * direction;
        direction = rotationX(angles.x) * direction;
    }
    return basis * direction;
}

bool isOccupied(vec3 p) {
    return sceneContains(p);
}

Hit traceScene(vec3 rayOrigin, vec3 rayDirection) {
    Hit hit;
    hit.found = false;
    hit.t = 0.0;
    hit.color = vec3(0.0);

    float previousT = 0.0;
    bool previousOccupied = isOccupied(rayOrigin + rayDirection * previousT);

    if (previousOccupied) {
        hit.found = true;
        hit.t = previousT;
        hit.color = scene(rayOrigin + rayDirection * hit.t);
        return hit;
    }

    for (int i = 1; i <= TRACE_STEPS; i++) {
        float currentT;
        if (i <= TRACE_NEAR_STEPS) {
            currentT = TRACE_NEAR_DISTANCE * float(i) / float(TRACE_NEAR_STEPS);
        } else {
            float farProgress = float(i - TRACE_NEAR_STEPS) / float(TRACE_FAR_STEPS);
            currentT = TRACE_NEAR_DISTANCE * pow(
                TRACE_FAR_DISTANCE / TRACE_NEAR_DISTANCE,
                farProgress
            );
        }
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

vec3 safeNormalize(vec3 value) {
    float lengthSquared = dot(value, value);
    return lengthSquared > 0.000001 ? value * inversesqrt(lengthSquared) : vec3(0.0, 0.0, 1.0);
}

float sceneDistanceAttenuation(float lightDistance, float radius) {
    // Match Three.js PointLight/SpotLight decay=2 and distance cutoff.
    float attenuation = 1.0 / max(lightDistance * lightDistance, 0.01);
    if (radius > 0.0) {
        float ratio = lightDistance / radius;
        float cutoff = max(1.0 - ratio * ratio * ratio * ratio, 0.0);
        attenuation *= cutoff * cutoff;
    }
    return attenuation;
}

float sceneShadowVisibility(vec3 p, vec3 lightDirection, float shadowStrength) {
    if (shadowStrength <= 0.0) return 1.0;
    // Start just outside the surface so the hit does not shadow itself.
    Hit shadowHit = traceScene(p + lightDirection * NORMAL_EPSILON * 2.0, lightDirection);
    return shadowHit.found ? 1.0 - shadowStrength : 1.0;
}

vec3 sceneLightContribution(
    vec3 position,
    vec3 normal,
    vec4 lightPositionRadius,
    vec4 lightColorIntensity,
    vec4 lightParams
) {
    // lightParams.x: point=0, spot=1, directional=2
    // lightParams.y: spot cone angle in degrees
    // lightParams.z: authored shadow strength
    float lightType = lightParams.x;
    vec3 lightDirection;
    float attenuation = 1.0;

    if (lightType > 1.5) {
        // Directional light positions are the same direction vectors used by
        // Three.js, converted into Movie's positive-z coordinate space.
        lightDirection = safeNormalize(lightPositionRadius.xyz);
    } else {
        vec3 toLight = lightPositionRadius.xyz - position;
        float lightDistance = length(toLight);
        lightDirection = safeNormalize(toLight);
        attenuation = sceneDistanceAttenuation(lightDistance, lightPositionRadius.w);

        if (lightType > 0.5) {
            vec3 spotDirection = safeNormalize(lightPositionRadius.xyz - u_scene_spot_target);
            float angle = radians(clamp(lightParams.y, 0.1, 90.0));
            float coneCosine = cos(angle);
            float penumbraCosine = cos(angle * 0.8);
            float angleCosine = dot(lightDirection, spotDirection);
            attenuation *= smoothstep(coneCosine, penumbraCosine, angleCosine);
        }
    }

    float diffuse = max(dot(normal, lightDirection), 0.0);
    if (diffuse <= 0.0) return vec3(0.0);
    float shadow = sceneShadowVisibility(position, lightDirection, lightParams.z);
    return lightColorIntensity.rgb * lightColorIntensity.w * attenuation * diffuse * shadow;
}

vec3 sceneLighting(vec3 position, vec3 normal) {
    vec3 ambientDirection = safeNormalize(u_scene_ambient_direction);
    float ambientWeight = clamp(0.5 + 0.5 * dot(normal, ambientDirection), 0.0, 1.0);
    vec3 result = mix(u_scene_ambient_ground, u_scene_ambient_sky, ambientWeight) *
        u_scene_ambient_intensity;
${SCENE_LIGHT_CALLS}
    return max(result, vec3(0.0));
}

void main() {
    vec2 uv = v_uv * 2.0 - 1.0;
    // Convert the fragment Y coordinate to Scratch's world convention before
    // building the ray: positive Y is up in Scratch.
    uv.y = -uv.y;
    uv.x *= u_resolution.x / max(u_resolution.y, 1.0);

    vec3 rayOrigin = campos;
    float viewportHeight = max(u_scene_viewport.y, 1.0);
    float focalLength = max(abs(camfocal), 0.001);
    vec3 cameraDirection = vec3(
        uv.x * viewportHeight * 0.5,
        uv.y * viewportHeight * 0.5,
        -focalLength
    );
    vec3 rayDirection = safeNormalize(rotateCamera(cameraDirection, camrot, camrotorder));

    Hit hit = traceScene(rayOrigin, rayDirection);
    vec4 original = texture2D(u_image, v_uv);
    vec3 pixel = vec3(0.0);

    if (hit.found) {
        vec3 position = rayOrigin + rayDirection * hit.t;
        vec3 normal = sceneNormal(position);
        pixel = hit.color * sceneLighting(position, normal);
    }

    // A miss contributes transparent black. Composite it over the input so a
    // Scene can be stacked above an existing Pen/Shader layer without painting
    // the empty part black. On an empty input this remains fully transparent.
    vec4 scenePixel = hit.found ? vec4(pixel, 1.0) : vec4(0.0);
    gl_FragColor = scenePixel + original * (1.0 - scenePixel.a);
}
`;

export default SCENE_FRAGMENT_SHADER;

export {SCENE_MAX_LIGHTS};
