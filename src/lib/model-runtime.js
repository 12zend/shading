import * as THREE from 'three';

const MODEL_RENDER_SIZE = 512;
const MODEL_DISPLAY_SIZE = 150;
const DEFAULT_FOCAL_LENGTH = 480;
const DEFAULT_STAGE_WIDTH = 480;
const DEFAULT_STAGE_HEIGHT = 360;
const DEFAULT_FOV = 2 * Math.atan((Math.max(DEFAULT_STAGE_WIDTH, DEFAULT_STAGE_HEIGHT) / 2) /
    DEFAULT_FOCAL_LENGTH) * (180 / Math.PI);
const DEFAULT_DEPTH = 480;
const ROTATION_ORDERS = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'];
const MMD_FRAME_RATE = 30;
const POINT_SHADOW_MAP_SIZE = 256;
const SPOT_SHADOW_MAP_SIZE = 512;
const DEFAULT_SHADOW_FAR = 10000;
const TRANSPARENT_TEXTURE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQDJ' +
    'Pv/AAAAAAElFTkSuQmCC';
const TEXTURE_MIME_TYPES = {
    bmp: 'image/bmp',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    spa: 'image/bmp',
    sph: 'image/bmp',
    tga: 'image/x-tga',
    webp: 'image/webp'
};

const DEFAULT_BUILDING_MATERIAL = Object.freeze({
    albedo: '#ff00ff',
    emission: '#000000',
    ior: 1.45,
    roughness: 1
});

const normalizeFOV = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_FOV;
    return Math.min(179.999, Math.max(0.001, number));
};

const focalLengthFromFOV = (fov, width = DEFAULT_STAGE_WIDTH, height = DEFAULT_STAGE_HEIGHT) => {
    const halfLongSide = Math.max(Number(width) || DEFAULT_STAGE_WIDTH, Number(height) || DEFAULT_STAGE_HEIGHT) / 2;
    return halfLongSide / Math.tan(normalizeFOV(fov) * Math.PI / 360);
};

const fovFromFocalLength = (focalLength, width = DEFAULT_STAGE_WIDTH, height = DEFAULT_STAGE_HEIGHT) => {
    const halfLongSide = Math.max(Number(width) || DEFAULT_STAGE_WIDTH, Number(height) || DEFAULT_STAGE_HEIGHT) / 2;
    const safeFocalLength = Math.max(0.001, Number(focalLength) || DEFAULT_FOCAL_LENGTH);
    return 2 * Math.atan(halfLongSide / safeFocalLength) * (180 / Math.PI);
};

let loaderModulesPromise;
let cloneModelObject = object => object.clone(true);
let MMDAnimationHelperClass = null;

const loadLoaderModules = () => {
    if (!loaderModulesPromise) {
        loaderModulesPromise = Promise.all([
            import('three/examples/jsm/loaders/GLTFLoader.js'),
            import('three/examples/jsm/loaders/FBXLoader.js'),
            import('three/examples/jsm/loaders/OBJLoader.js'),
            import('three/examples/jsm/loaders/MTLLoader.js'),
            import('three/examples/jsm/loaders/MMDLoader.js'),
            import('three/examples/jsm/animation/MMDAnimationHelper.js'),
            import('three/examples/jsm/utils/SkeletonUtils.js'),
            import('three/examples/jsm/exporters/GLTFExporter.js')
        ]).then(([gltf, fbx, obj, mtl, mmd, mmdAnimation, skeletonUtils, exporter]) => {
            cloneModelObject = skeletonUtils.clone;
            MMDAnimationHelperClass = mmdAnimation.MMDAnimationHelper;
            return {
                FBXLoader: fbx.FBXLoader,
                GLTFExporter: exporter.GLTFExporter,
                GLTFLoader: gltf.GLTFLoader,
                MTLLoader: mtl.MTLLoader,
                MMDLoader: mmd.MMDLoader,
                OBJLoader: obj.OBJLoader
            };
        });
    }
    return loaderModulesPromise;
};

const toArrayBuffer = data => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

const parseWithCallback = (loader, data, path = '') => new Promise((resolve, reject) => {
    loader.parse(data, path, resolve, reject);
});

const normalizeObject = object => {
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) throw new Error('The model does not contain renderable geometry.');
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const largestDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largestDimension) || largestDimension <= 0) {
        throw new Error('The model has invalid dimensions.');
    }

    const wrapper = new THREE.Group();
    object.position.sub(center);
    wrapper.add(object);
    wrapper.scale.setScalar(MODEL_DISPLAY_SIZE / largestDimension);
    wrapper.updateMatrixWorld(true);
    return {object: wrapper, originalSize: size};
};

const countGeometry = object => {
    let vertices = 0;
    let triangles = 0;
    object.traverse(child => {
        if (!child.isMesh || !child.geometry) return;
        const positions = child.geometry.getAttribute('position');
        const vertexCount = positions ? positions.count : 0;
        vertices += vertexCount;
        triangles += child.geometry.index ? child.geometry.index.count / 3 : vertexCount / 3;
    });
    return {
        triangles: Math.round(triangles),
        vertices
    };
};

const disableFullyTransparentMaterials = object => {
    object.traverse(child => {
        if (!child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(material => {
            // Three.js still submits transparent materials with zero opacity to the GPU.
            // They cannot contribute a pixel, so omit their geometry groups from rendering.
            if (material && material.transparent && material.opacity <= 0) material.visible = false;
        });
    });
    return object;
};

const exportGLB = async (object, animations) => {
    const {GLTFExporter} = await loadLoaderModules();
    const exporter = new GLTFExporter();
    return new Promise((resolve, reject) => {
        exporter.parse(
            object,
            result => {
                if (!(result instanceof ArrayBuffer)) {
                    reject(new Error('Model conversion did not produce a binary GLB file.'));
                    return;
                }
                resolve(new Uint8Array(result));
            },
            reject,
            {
                binary: true,
                animations,
                onlyVisible: false,
                truncateDrawRange: true
            }
        );
    });
};

const normalizeTexturePath = path => {
    let normalized = String(path || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
    try {
        normalized = decodeURIComponent(normalized);
    } catch (error) {
        // Keep the original path when it contains malformed percent escapes.
    }
    return normalized.toLowerCase();
};

const getTextureMimeType = texture => {
    if (texture.type) return texture.type;
    const path = normalizeTexturePath(texture.path);
    const extension = path.includes('.') ? path.split('.').pop() : '';
    return TEXTURE_MIME_TYPES[extension] || 'application/octet-stream';
};

const makeMMDLoader = (modules, textures = []) => {
    const loadingManager = new THREE.LoadingManager();
    const textureURLs = [];
    const texturesByPath = new Map();
    const texturesByName = new Map();
    textures.forEach(texture => {
        const path = normalizeTexturePath(texture.path);
        if (!path) return;
        texturesByPath.set(path, texture);
        const name = path.split('/').pop();
        if (!texturesByName.has(name)) texturesByName.set(name, []);
        texturesByName.get(name).push(texture);
    });
    loadingManager.setURLModifier(url => {
        if (url.startsWith('data:')) return url;
        const path = normalizeTexturePath(url);
        const nameMatches = texturesByName.get(path.split('/').pop()) || [];
        const texture = texturesByPath.get(path) || (nameMatches.length === 1 ? nameMatches[0] : null);
        if (!texture) return TRANSPARENT_TEXTURE;
        const textureURL = URL.createObjectURL(new Blob([texture.data], {type: getTextureMimeType(texture)}));
        textureURLs.push(textureURL);
        return textureURL;
    });
    return {
        dispose: () => textureURLs.forEach(textureURL => URL.revokeObjectURL(textureURL)),
        loader: new modules.MMDLoader(loadingManager),
        loadingManager
    };
};

const makeGLTFMaterial = material => {
    const color = material && (material.diffuse || material.color);
    const emissive = material && material.emissive;
    return new THREE.MeshStandardMaterial({
        alphaMap: material && material.alphaMap ? material.alphaMap : null,
        color: color && color.isColor ? color.clone() : new THREE.Color(0xffffff),
        emissive: emissive && emissive.isColor ? emissive.clone() : new THREE.Color(0x000000),
        map: material && material.map ? material.map : null,
        metalness: 0,
        opacity: material && Number.isFinite(material.opacity) ? material.opacity : 1,
        roughness: 0.8,
        side: material ? material.side : THREE.FrontSide,
        transparent: Boolean(material && material.transparent)
    });
};

const makePMXObject = async (modules, data, textures) => {
    const {dispose, loader, loadingManager} = makeMMDLoader(modules, textures);
    try {
        const textureLoading = new Promise((resolve, reject) => {
            loadingManager.onLoad = resolve;
            loadingManager.onError = url => reject(new Error(`Could not decode PMX texture: ${url}`));
        });
        const parsed = loader._getParser().parsePmx(toArrayBuffer(data), true);
        const mesh = loader.meshBuilder.build(parsed, '', null, () => {});
        await textureLoading;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.material = Array.isArray(mesh.material) ?
            materials.map(makeGLTFMaterial) : makeGLTFMaterial(materials[0]);
        materials.forEach(material => material.dispose());
        return {dispose, object: mesh};
    } catch (error) {
        dispose();
        throw error;
    }
};

const parseSourceModel = async (format, data, mtlData, textures) => {
    const modules = await loadLoaderModules();
    if (format === 'glb') {
        const gltf = await parseWithCallback(new modules.GLTFLoader(), toArrayBuffer(data));
        return {
            animations: gltf.animations || [],
            object: gltf.scene
        };
    }
    if (format === 'fbx') {
        const object = new modules.FBXLoader().parse(toArrayBuffer(data), '');
        return {
            animations: object.animations || [],
            object
        };
    }
    if (format === 'obj') {
        const loader = new modules.OBJLoader();
        if (mtlData) {
            const materials = new modules.MTLLoader().parse(new TextDecoder().decode(mtlData), '');
            materials.preload();
            loader.setMaterials(materials);
        }
        return {
            animations: [],
            object: loader.parse(new TextDecoder().decode(data))
        };
    }
    if (format === 'pmx') {
        const pmx = await makePMXObject(modules, data, textures);
        return {
            animations: [],
            dispose: pmx.dispose,
            object: pmx.object
        };
    }
    throw new Error('Supported model formats are GLB, PMX, FBX, and OBJ/MTL.');
};

const unusedAnimationName = (requestedName, animations) => {
    const names = animations.map(animation => animation.name.toLowerCase());
    if (!names.includes(requestedName.toLowerCase())) return requestedName;
    let index = 2;
    while (names.includes(`${requestedName}${index}`.toLowerCase())) index++;
    return `${requestedName}${index}`;
};

const convertModelToGLB = async (format, data, mtlData, textures) => {
    const parsed = await parseSourceModel(format, data, mtlData, textures);
    try {
        const normalized = normalizeObject(parsed.object);
        const geometry = countGeometry(normalized.object);
        const animations = [];
        parsed.animations.forEach((animation, index) => {
            animation.name = unusedAnimationName(animation.name || `Animation ${index + 1}`, animations);
            animations.push(animation);
        });
        const glb = await exportGLB(normalized.object, animations);
        return {
            activeMotion: animations.length ? animations[0].name : '',
            animationCount: animations.length,
            glb,
            motions: animations.map(animation => ({
                format,
                frameCount: Math.max(1, Math.round(animation.duration * MMD_FRAME_RATE) + 1),
                name: animation.name
            })),
            originalSize: {
                x: normalized.originalSize.x,
                y: normalized.originalSize.y,
                z: normalized.originalSize.z
            },
            ...geometry
        };
    } finally {
        if (parsed.dispose) parsed.dispose();
    }
};

const findSkinnedMesh = object => {
    let result = null;
    object.traverse(child => {
        if (!result && child.isSkinnedMesh && child.skeleton) result = child;
    });
    return result;
};

const restoreMMDBoneHierarchy = object => {
    const mesh = findSkinnedMesh(object);
    if (!mesh || !mesh.geometry.userData.MMD) return mesh;
    const bones = new Set(mesh.skeleton.bones);
    const rootBones = mesh.skeleton.bones.filter(bone => !bones.has(bone.parent));
    object.updateMatrixWorld(true);
    rootBones.forEach(rootBone => {
        let ancestor = mesh;
        while (ancestor && ancestor !== rootBone) ancestor = ancestor.parent;
        if (ancestor !== rootBone && rootBone.parent !== mesh) mesh.attach(rootBone);
    });
    object.updateMatrixWorld(true);
    return mesh;
};

const resampleAnimationClip = (clip, frameRate = MMD_FRAME_RATE) => {
    const lastFrame = Math.max(0, Math.round(clip.duration * frameRate));
    const times = [];
    for (let frame = 0; frame <= lastFrame; frame++) times.push(frame / frameRate);
    const tracks = clip.tracks.map(track => {
        const values = [];
        const interpolant = track.createInterpolant();
        times.forEach(time => values.push(...interpolant.evaluate(time)));
        return new track.constructor(track.name, times, values, THREE.InterpolateLinear);
    });
    return new THREE.AnimationClip(clip.name, lastFrame / frameRate, tracks);
};

const bindAnimationToMesh = (clip, mesh) => {
    const targetName = THREE.PropertyBinding.sanitizeNodeName(mesh.name || mesh.uuid);
    mesh.name = targetName;
    clip.tracks.forEach(track => {
        if (track.name.startsWith('.')) track.name = `${targetName}${track.name}`;
    });
    return clip;
};

const loadGLBObject = async data => {
    const {GLTFLoader} = await loadLoaderModules();
    const gltf = await parseWithCallback(new GLTFLoader(), toArrayBuffer(data));
    gltf.scene.animations = gltf.animations || [];
    restoreMMDBoneHierarchy(gltf.scene);
    disableFullyTransparentMaterials(gltf.scene);
    return gltf.scene;
};

const decodeVPD = (data, mesh, loader) => {
    const bytes = toArrayBuffer(data);
    const decodings = ['shift-jis', 'utf-8'];
    let best = null;
    let bestMatches = -1;
    const boneNames = new Set(mesh.skeleton.bones.map(bone => bone.name));
    for (const encoding of decodings) {
        try {
            const parsed = loader._getParser().parseVpd(new TextDecoder(encoding).decode(bytes), true);
            const matches = parsed.bones.reduce((count, bone) => count + (boneNames.has(bone.name) ? 1 : 0), 0);
            if (matches > bestMatches) {
                best = parsed;
                bestMatches = matches;
            }
        } catch (e) { // Try the other common VPD encoding.
            // Intentionally empty.
        }
    }
    if (!best) throw new Error('The VPD pose could not be decoded.');
    return best;
};

const makeVPDClip = (data, mesh, loader) => {
    const vpd = decodeVPD(data, mesh, loader);
    const bones = new Map(mesh.skeleton.bones.map(bone => [bone.name, bone]));
    const tracks = [];
    for (const pose of vpd.bones) {
        const bone = bones.get(pose.name);
        if (!bone) continue;
        const position = bone.position.clone().add(new THREE.Vector3().fromArray(pose.translation));
        const quaternion = bone.quaternion.clone().multiply(new THREE.Quaternion().fromArray(pose.quaternion));
        const trackName = `.bones[${pose.name}]`;
        tracks.push(new THREE.VectorKeyframeTrack(`${trackName}.position`, [0], position.toArray()));
        tracks.push(new THREE.QuaternionKeyframeTrack(`${trackName}.quaternion`, [0], quaternion.toArray()));
    }
    if (!tracks.length) throw new Error('The VPD pose does not match any bones in this model.');
    return new THREE.AnimationClip('', 1 / MMD_FRAME_RATE, tracks);
};

const attachMotionToGLB = async (modelData, motionData, format, requestedName) => {
    const modules = await loadLoaderModules();
    const gltf = await parseWithCallback(new modules.GLTFLoader(), toArrayBuffer(modelData));
    const mesh = restoreMMDBoneHierarchy(gltf.scene) || findSkinnedMesh(gltf.scene);
    if (!mesh) throw new Error('VMD/VPD files require a rigged model with bones.');
    const {dispose, loader} = makeMMDLoader(modules);
    try {
        let clip;
        if (format === 'vmd') {
            const vmd = loader._getParser().parseVmd(toArrayBuffer(motionData), true);
            clip = resampleAnimationClip(loader.animationBuilder.build(vmd, mesh));
        } else if (format === 'vpd') {
            clip = makeVPDClip(motionData, mesh, loader);
        } else {
            throw new Error('Supported model motion formats are VMD and VPD.');
        }
        bindAnimationToMesh(clip, mesh);
        if (!clip.tracks.length) throw new Error(`The ${format.toUpperCase()} file does not match this model.`);
        const animations = gltf.animations || [];
        clip.name = unusedAnimationName(requestedName || format.toUpperCase(), animations);
        const nextAnimations = animations.concat(clip);
        const glb = await exportGLB(gltf.scene, nextAnimations);
        return {
            activeMotion: clip.name,
            animationCount: nextAnimations.length,
            glb,
            motion: {
                format,
                frameCount: format === 'vpd' ? 1 :
                    Math.max(1, Math.round(clip.duration * MMD_FRAME_RATE) + 1),
                name: clip.name
            }
        };
    } finally {
        dispose();
    }
};

const degreesToEuler = (rotation, order) => new THREE.Euler(
    THREE.MathUtils.degToRad(rotation.x),
    THREE.MathUtils.degToRad(rotation.y),
    THREE.MathUtils.degToRad(rotation.z),
    ROTATION_ORDERS.includes(order) ? order : 'XYZ'
);

const movieRotationToThreeQuaternion = (rotation, order) => {
    const movieRotation = new THREE.Matrix4().makeRotationFromEuler(degreesToEuler(rotation, order));
    const invertZ = new THREE.Matrix4().makeScale(1, 1, -1);
    const threeRotation = invertZ.clone()
        .multiply(movieRotation)
        .multiply(invertZ);
    return new THREE.Quaternion().setFromRotationMatrix(threeRotation);
};

const moviePositionToThree = position => new THREE.Vector3(position.x, position.y, -position.z);

const clampLightValue = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

const normalizeLight = light => ({
    angle: clampLightValue(light && light.angle, 0.1, 90, 45),
    color: light && light.color,
    intensity: clampLightValue(light && light.intensity, 0, Number.MAX_SAFE_INTEGER, 1),
    position: {
        x: clampLightValue(light && light.position && light.position.x, -Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER, 0),
        y: clampLightValue(light && light.position && light.position.y, -Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER, 0),
        z: clampLightValue(light && light.position && light.position.z, -Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER, 0)
    },
    radius: clampLightValue(light && light.radius, 0, Number.MAX_SAFE_INTEGER, 0),
    shadow: clampLightValue(light && light.shadow, 0, 1, 0),
    type: light && light.type === 'spot' ? 'spot' : 'point'
});

const verticalFOVFromFocalLength = (focalLength, height) => (
    2 * Math.atan((Math.max(1, height) / 2) / Math.max(0.001, focalLength)) * (180 / Math.PI)
);

const modelScale = value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 1;
};

const buildingNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

const buildingUV = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

const buildingZ = value => {
    const z = buildingNumber(value);
    return z === 0 ? 0 : -z;
};

const setBuildingUVs = (geometry, requestedUV) => {
    const uv = geometry.getAttribute('uv');
    if (!uv) return;
    const u1 = buildingUV(requestedUV && requestedUV.u1);
    const v1 = buildingUV(requestedUV && requestedUV.v1);
    const u2 = buildingUV(requestedUV && requestedUV.u2);
    const v2 = buildingUV(requestedUV && requestedUV.v2);
    for (let index = 0; index < uv.count; index++) {
        uv.setXY(
            index,
            u1 + ((u2 - u1) * uv.getX(index)),
            v1 + ((v2 - v1) * uv.getY(index))
        );
    }
    uv.needsUpdate = true;
};

const makeBuildingPlaneGeometry = (positions, requestedUV) => {
    const u1 = buildingUV(requestedUV && requestedUV.u1);
    const v1 = buildingUV(requestedUV && requestedUV.v1);
    const u2 = buildingUV(requestedUV && requestedUV.u2);
    const v2 = buildingUV(requestedUV && requestedUV.v2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
        u1, v1,
        u2, v1,
        u2, v2,
        u1, v2
    ], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    return geometry;
};

const makeBuildingMaterial = () => new THREE.MeshPhysicalMaterial({
    color: DEFAULT_BUILDING_MATERIAL.albedo,
    emissive: DEFAULT_BUILDING_MATERIAL.emission,
    ior: DEFAULT_BUILDING_MATERIAL.ior,
    roughness: DEFAULT_BUILDING_MATERIAL.roughness,
    side: THREE.DoubleSide
});

const createBuildingPrimitive = (type, requestedBounds, requestedUV, material = makeBuildingMaterial()) => {
    const bounds = requestedBounds || {};
    const x1 = buildingNumber(bounds.x1);
    const y1 = buildingNumber(bounds.y1);
    const z1 = buildingNumber(bounds.z1);
    const x2 = buildingNumber(bounds.x2);
    const y2 = buildingNumber(bounds.y2);
    const z2 = buildingNumber(bounds.z2);
    let geometry;

    if (type === 'wall') {
        geometry = makeBuildingPlaneGeometry([
            x1, y1, buildingZ(z1),
            x2, y1, buildingZ(z2),
            x2, y2, buildingZ(z2),
            x1, y2, buildingZ(z1)
        ], requestedUV);
    } else if (type === 'floor') {
        geometry = makeBuildingPlaneGeometry([
            x1, y1, buildingZ(z1),
            x2, y1, buildingZ(z1),
            x2, y2, buildingZ(z2),
            x1, y2, buildingZ(z2)
        ], requestedUV);
    } else {
        geometry = new THREE.BoxGeometry(
            Math.abs(x2 - x1),
            Math.abs(y2 - y1),
            Math.abs(z2 - z1)
        );
        geometry.translate((x1 + x2) / 2, (y1 + y2) / 2, buildingZ((z1 + z2) / 2));
        setBuildingUVs(geometry, requestedUV);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Movie ${type}`;
    return mesh;
};

const loadBuildingTexture = source => new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(source, texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
        resolve(texture);
    }, undefined, reject);
});

const worldToCamera = (position, camera) => {
    const result = new THREE.Vector3(
        position.x - camera.position.x,
        position.y - camera.position.y,
        position.z - camera.position.z
    );
    const inverseCamera = new THREE.Quaternion()
        .setFromEuler(degreesToEuler(camera.rotation, camera.rotationOrder))
        .invert();
    return result.applyQuaternion(inverseCamera);
};

const projectPosition = (position, camera) => {
    const cameraSpace = worldToCamera(position, camera);
    const inFront = cameraSpace.z > 0.001;
    const safeDepth = inFront ? cameraSpace.z : 0.001;
    const perspective = camera.focalLength / safeDepth;
    return {
        depth: cameraSpace.z,
        inFront,
        perspective,
        x: cameraSpace.x * perspective,
        y: cameraSpace.y * perspective
    };
};

const cameraLookAt = (position, target, rotationOrder) => {
    const direction = new THREE.Vector3(
        target.x - position.x,
        target.y - position.y,
        target.z - position.z
    );
    if (direction.lengthSq() < 1e-12) return {x: 0, y: 0, z: 0};
    direction.normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        direction
    );
    const euler = new THREE.Euler().setFromQuaternion(
        quaternion,
        ROTATION_ORDERS.includes(rotationOrder) ? rotationOrder : 'XYZ'
    );
    return {
        x: THREE.MathUtils.radToDeg(euler.x),
        y: THREE.MathUtils.radToDeg(euler.y),
        z: THREE.MathUtils.radToDeg(euler.z)
    };
};

const disposeObject = object => {
    object.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (!child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(material => {
            Object.values(material).forEach(value => {
                if (value && value.isTexture) value.dispose();
            });
            material.dispose();
        });
    });
};

class ModelRenderer {
    constructor (canvas) {
        this.canvas = canvas || document.createElement('canvas');
        this.canvas.width = MODEL_RENDER_SIZE;
        this.canvas.height = MODEL_RENDER_SIZE;
        this.canvas.reusable = false;
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            canvas: this.canvas,
            preserveDrawingBuffer: true
        });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(MODEL_RENDER_SIZE, MODEL_RENDER_SIZE, false);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.shadowMap.enabled = false;
        this.renderer.shadowMap.autoUpdate = false;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
        this.camera.position.set(0, 0, 310);
        this.camera.lookAt(0, 0, 0);
        this.lightObjects = [];
        this.lightConfiguration = undefined;
        this.usesShadows = false;
        this.setLights(null);

        // Keep cloned scene objects and their animation mixers alive between frames. A PMX model can have
        // hundreds of bones, so cloning its hierarchy and rebuilding the mixer for every frame is substantially
        // more expensive than updating the pose of an existing clone.
        this.currentObjects = [];
        this.currentSources = [];
        this.currentAnimationNames = [];
        this.animationStates = new WeakMap();
    }

    clearLightObjects () {
        (this.lightObjects || []).forEach(object => {
            this.scene.remove(object);
            if (object.shadow && object.shadow.map) object.shadow.map.dispose();
        });
        this.lightObjects = [];
    }

    addLightObject (light) {
        this.scene.add(light);
        this.lightObjects.push(light);
        if (light.target) {
            this.scene.add(light.target);
            this.lightObjects.push(light.target);
        }
    }

    makeLight (configuration, intensity, castShadow) {
        const color = new THREE.Color();
        try {
            color.set(configuration.color || 0xffffff);
        } catch (error) {
            color.set(0xffffff);
        }
        let light;
        if (configuration.type === 'spot') {
            light = new THREE.SpotLight(
                color,
                intensity,
                configuration.radius,
                THREE.MathUtils.degToRad(configuration.angle),
                0.2,
                2
            );
            light.target.position.set(0, 0, -DEFAULT_DEPTH);
            light.shadow.mapSize.set(SPOT_SHADOW_MAP_SIZE, SPOT_SHADOW_MAP_SIZE);
        } else {
            light = new THREE.PointLight(color, intensity, configuration.radius, 2);
            light.shadow.mapSize.set(POINT_SHADOW_MAP_SIZE, POINT_SHADOW_MAP_SIZE);
        }
        light.position.copy(moviePositionToThree(configuration.position));
        light.castShadow = castShadow;
        if (castShadow) {
            light.shadow.bias = -0.0005;
            light.shadow.normalBias = 0.5;
            light.shadow.radius = 2;
            light.shadow.camera.near = 0.5;
            light.shadow.camera.far = Math.max(1, configuration.radius || DEFAULT_SHADOW_FAR);
            light.shadow.camera.updateProjectionMatrix();
        }
        return light;
    }

    setObjectShadowState (object) {
        object.traverse(child => {
            if (!child.isMesh) return;
            child.castShadow = this.usesShadows;
            child.receiveShadow = this.usesShadows;
        });
    }

    setLights (requestedLights) {
        if (this.lightConfiguration === requestedLights) return;
        this.lightConfiguration = requestedLights;
        this.clearLightObjects();

        // A null configuration keeps existing projects and model previews using the original studio lighting.
        if (!Array.isArray(requestedLights)) {
            this.addLightObject(new THREE.HemisphereLight(0xffffff, 0x303848, 1.8));
            const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
            keyLight.position.set(2, 3, 4);
            this.addLightObject(keyLight);
            const fillLight = new THREE.DirectionalLight(0x8eb8ff, 0.9);
            fillLight.position.set(-4, 1, 2);
            this.addLightObject(fillLight);
            this.usesShadows = false;
        } else {
            const configurations = requestedLights.map(normalizeLight);
            this.usesShadows = configurations.some(light => light.shadow > 0 && light.intensity > 0);
            configurations.forEach(configuration => {
                // Split a partially shadowed light into a shadow-casting and an unshadowed contribution. This
                // keeps the lit intensity constant while making 0 fully unshadowed and 1 maximally dark.
                const shadowedIntensity = configuration.intensity * configuration.shadow;
                const unshadowedIntensity = configuration.intensity - shadowedIntensity;
                if (unshadowedIntensity > 0) {
                    this.addLightObject(this.makeLight(configuration, unshadowedIntensity, false));
                }
                if (shadowedIntensity > 0) {
                    this.addLightObject(this.makeLight(configuration, shadowedIntensity, true));
                }
            });
        }
        if (this.renderer.shadowMap) this.renderer.shadowMap.enabled = this.usesShadows;
        (this.currentObjects || []).forEach(object => this.setObjectShadowState(object));
    }

    setOutputSize (width, height) {
        if (this.canvas.width === width && this.canvas.height === height) return;
        this.renderer.setSize(width, height, false);
        this.canvas.reusable = false;
    }

    setObject (sourceObject, animationName, frame) {
        this.syncObjects([{animationName, frame, sourceObject}]);
        this.currentObject = this.currentObjects[0];
        return this.currentObject;
    }

    applyAnimation (object, animationName, frame) {
        if (!animationName || !Array.isArray(object.animations)) return;
        const clip = THREE.AnimationClip.findByName(object.animations, animationName);
        if (!clip) return;
        const requestedTime = (Math.max(1, Number(frame) || 1) - 1) / MMD_FRAME_RATE;
        const animationTime = Math.min(requestedTime, Math.max(0, clip.duration));
        let state = this.animationStates.get(object);
        if (!state) {
            const mmdMesh = findSkinnedMesh(object);
            if (MMDAnimationHelperClass && mmdMesh && mmdMesh.geometry.userData.MMD) {
                try {
                    const helper = new MMDAnimationHelperClass({pmxAnimation: true, sync: false});
                    helper.add(mmdMesh, {animation: clip, physics: false});
                    const mixer = helper.objects.get(mmdMesh).mixer;
                    const action = mixer.clipAction(clip);
                    action.setLoop(THREE.LoopOnce, 1);
                    action.clampWhenFinished = true;
                    state = {helper, mixer, mmdMesh};
                } catch (error) {
                    // Fall through to ordinary skeletal animation if optional MMD metadata is incomplete.
                }
            }
            if (!state) {
                const mixer = new THREE.AnimationMixer(object);
                const action = mixer.clipAction(clip);
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
                action.play();
                state = {mixer};
            }
            this.animationStates.set(object, state);
        }
        state.mixer.setTime(animationTime);
        if (state.helper) state.helper._animateMesh(state.mmdMesh, 0);
        object.updateMatrixWorld(true);
    }

    removeObject (object) {
        const animationState = this.animationStates.get(object);
        if (animationState) {
            animationState.mixer.stopAllAction();
            if (animationState.helper) animationState.helper.remove(animationState.mmdMesh);
            this.animationStates.delete(object);
        }
        this.scene.remove(object);
    }

    syncObjects (sceneItems) {
        for (let index = 0; index < sceneItems.length; index++) {
            const item = sceneItems[index];
            const canReuse = this.currentSources[index] === item.sourceObject &&
                this.currentAnimationNames[index] === item.animationName;
            if (!canReuse) {
                if (this.currentObjects[index]) this.removeObject(this.currentObjects[index]);
                const object = cloneModelObject(item.sourceObject);
                this.currentObjects[index] = object;
                this.currentSources[index] = item.sourceObject;
                this.currentAnimationNames[index] = item.animationName;
                this.scene.add(object);
                this.setObjectShadowState(object);
            }
            this.applyAnimation(this.currentObjects[index], item.animationName, item.frame);
        }
        for (let index = sceneItems.length; index < this.currentObjects.length; index++) {
            this.removeObject(this.currentObjects[index]);
        }
        this.currentObjects.length = sceneItems.length;
        this.currentSources.length = sceneItems.length;
        this.currentAnimationNames.length = sceneItems.length;
        this.currentObject = this.currentObjects.length === 1 ? this.currentObjects[0] : null;
        return this.currentObjects;
    }

    clearObjects () {
        if (this.currentObjects) this.currentObjects.forEach(object => this.removeObject(object));
        this.currentObject = null;
        this.currentObjects = [];
        this.currentSources = [];
        this.currentAnimationNames = [];
    }

    render (sourceObject, transform, cameraTransform, animationName, frame) {
        this.setOutputSize(MODEL_RENDER_SIZE, MODEL_RENDER_SIZE);
        this.setObject(sourceObject, animationName, frame);
        this.currentObject.position.set(0, 0, 0);
        this.currentObject.scale.set(1, 1, 1);
        const objectQuaternion = new THREE.Quaternion().setFromEuler(
            degreesToEuler(transform.rotation, transform.rotationOrder)
        );
        const cameraQuaternion = new THREE.Quaternion().setFromEuler(
            degreesToEuler(cameraTransform.rotation, cameraTransform.rotationOrder)
        );
        this.currentObject.quaternion.copy(cameraQuaternion.invert().multiply(objectQuaternion));
        this.camera.fov = 38;
        this.camera.aspect = 1;
        this.camera.position.set(0, 0, 310);
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();
        this.renderer.render(this.scene, this.camera);
        return this.canvas;
    }

    renderWorld (sourceObject, transform, cameraTransform, stageSize, bitmapResolution = 2) {
        return this.renderWorldScene([{
            sourceObject,
            transform
        }], cameraTransform, stageSize, bitmapResolution);
    }

    renderWorldScene (sceneItems, cameraTransform, stageSize, bitmapResolution = 2, lights = null) {
        const width = Math.max(1, stageSize[0]);
        const height = Math.max(1, stageSize[1]);
        this.setOutputSize(Math.round(width * bitmapResolution), Math.round(height * bitmapResolution));
        this.setLights(lights);
        this.syncObjects(sceneItems);
        this.currentObjects.forEach((object, index) => {
            const item = sceneItems[index];
            const transform = item.transform;
            object.position.copy(moviePositionToThree({
                x: transform.worldX,
                y: transform.worldY,
                z: transform.worldZ
            }));
            object.quaternion.copy(movieRotationToThreeQuaternion(
                transform.rotation,
                transform.rotationOrder
            ));
            const scale = Math.max(0, Number(transform.size) || 0) / 100;
            const transformScale = transform.scale || {};
            object.scale.set(
                scale * modelScale(transformScale.x),
                scale * modelScale(transformScale.y),
                scale * modelScale(transformScale.z)
            );
        });

        this.camera.fov = verticalFOVFromFocalLength(cameraTransform.focalLength, height);
        this.camera.aspect = width / height;
        this.camera.near = 0.1;
        this.camera.far = 10000000;
        this.camera.position.copy(moviePositionToThree(cameraTransform.position));
        this.camera.quaternion.copy(movieRotationToThreeQuaternion(
            cameraTransform.rotation,
            cameraTransform.rotationOrder
        ));
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld(true);

        if (this.usesShadows && this.renderer.shadowMap) this.renderer.shadowMap.needsUpdate = true;
        this.renderer.render(this.scene, this.camera);
        return this.canvas;
    }

    dispose () {
        this.clearObjects();
        this.clearLightObjects();
        this.renderer.dispose();
    }
}

export {
    DEFAULT_BUILDING_MATERIAL,
    DEFAULT_DEPTH,
    DEFAULT_FOV,
    DEFAULT_FOCAL_LENGTH,
    DEFAULT_STAGE_HEIGHT,
    DEFAULT_STAGE_WIDTH,
    MODEL_RENDER_SIZE,
    ROTATION_ORDERS,
    ModelRenderer,
    attachMotionToGLB,
    bindAnimationToMesh,
    cameraLookAt,
    convertModelToGLB,
    createBuildingPrimitive,
    disableFullyTransparentMaterials,
    disposeObject,
    focalLengthFromFOV,
    fovFromFocalLength,
    loadGLBObject,
    loadBuildingTexture,
    makeBuildingMaterial,
    moviePositionToThree,
    movieRotationToThreeQuaternion,
    normalizeLight,
    normalizeFOV,
    projectPosition,
    resampleAnimationClip,
    restoreMMDBoneHierarchy,
    verticalFOVFromFocalLength
};
