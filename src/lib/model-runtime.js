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
const TRANSPARENT_TEXTURE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQDJ' +
    'Pv/AAAAAAElFTkSuQmCC';

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

const makeMMDLoader = modules => {
    const loadingManager = new THREE.LoadingManager();
    // PMX files only contain references to texture paths. Models remain importable when those optional files
    // are unavailable; their material colours are retained below.
    loadingManager.setURLModifier(url => (url.startsWith('data:') ? url : TRANSPARENT_TEXTURE));
    return new modules.MMDLoader(loadingManager);
};

const makeGLTFMaterial = material => {
    const color = material && (material.diffuse || material.color);
    const emissive = material && material.emissive;
    return new THREE.MeshStandardMaterial({
        color: color && color.isColor ? color.clone() : new THREE.Color(0xffffff),
        emissive: emissive && emissive.isColor ? emissive.clone() : new THREE.Color(0x000000),
        metalness: 0,
        opacity: material && Number.isFinite(material.opacity) ? material.opacity : 1,
        roughness: 0.8,
        side: material ? material.side : THREE.FrontSide,
        transparent: Boolean(material && material.transparent)
    });
};

const makePMXObject = (modules, data) => {
    const loader = makeMMDLoader(modules);
    const parsed = loader._getParser().parsePmx(toArrayBuffer(data), true);
    const mesh = loader.meshBuilder.setResourcePath('').build(parsed, '', null, () => {});
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = Array.isArray(mesh.material) ? materials.map(makeGLTFMaterial) : makeGLTFMaterial(materials[0]);
    materials.forEach(material => material.dispose());
    return mesh;
};

const parseSourceModel = async (format, data, mtlData) => {
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
        return {
            animations: [],
            object: makePMXObject(modules, data)
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

const convertModelToGLB = async (format, data, mtlData) => {
    const parsed = await parseSourceModel(format, data, mtlData);
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
};

const loadGLBObject = async data => {
    const {GLTFLoader} = await loadLoaderModules();
    const gltf = await parseWithCallback(new GLTFLoader(), toArrayBuffer(data));
    gltf.scene.animations = gltf.animations || [];
    return gltf.scene;
};

const findSkinnedMesh = object => {
    let result = null;
    object.traverse(child => {
        if (!result && child.isSkinnedMesh && child.skeleton) result = child;
    });
    return result;
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
    const mesh = findSkinnedMesh(gltf.scene);
    if (!mesh) throw new Error('VMD/VPD files require a rigged model with bones.');
    const loader = makeMMDLoader(modules);
    let clip;
    if (format === 'vmd') {
        const vmd = loader._getParser().parseVmd(toArrayBuffer(motionData), true);
        clip = loader.animationBuilder.build(vmd, mesh);
    } else if (format === 'vpd') {
        clip = makeVPDClip(motionData, mesh, loader);
    } else {
        throw new Error('Supported model motion formats are VMD and VPD.');
    }
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

const verticalFOVFromFocalLength = (focalLength, height) => (
    2 * Math.atan((Math.max(1, height) / 2) / Math.max(0.001, focalLength)) * (180 / Math.PI)
);

const modelScale = value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 1;
};

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

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
        this.camera.position.set(0, 0, 310);
        this.camera.lookAt(0, 0, 0);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x303848, 1.8));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
        keyLight.position.set(2, 3, 4);
        this.scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0x8eb8ff, 0.9);
        fillLight.position.set(-4, 1, 2);
        this.scene.add(fillLight);
    }

    setOutputSize (width, height) {
        if (this.canvas.width === width && this.canvas.height === height) return;
        this.renderer.setSize(width, height, false);
        this.canvas.reusable = false;
    }

    setObject (sourceObject, animationName, frame) {
        this.clearObjects();
        this.currentObject = cloneModelObject(sourceObject);
        this.currentObjects = [this.currentObject];
        this.scene.add(this.currentObject);
        this.applyAnimation(this.currentObject, animationName, frame);
        return this.currentObject;
    }

    applyAnimation (object, animationName, frame) {
        if (!animationName || !Array.isArray(object.animations)) return;
        const clip = THREE.AnimationClip.findByName(object.animations, animationName);
        if (!clip) return;
        const requestedTime = (Math.max(1, Number(frame) || 1) - 1) / MMD_FRAME_RATE;
        const animationTime = Math.min(requestedTime, Math.max(0, clip.duration));
        const mmdMesh = findSkinnedMesh(object);
        if (MMDAnimationHelperClass && mmdMesh && mmdMesh.geometry.userData.MMD) {
            try {
                const helper = new MMDAnimationHelperClass({pmxAnimation: true, sync: false});
                helper.add(mmdMesh, {animation: clip, physics: false});
                const mixer = helper.objects.get(mmdMesh).mixer;
                const action = mixer.clipAction(clip);
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
                mixer.setTime(animationTime);
                helper._animateMesh(mmdMesh, 0);
                object.updateMatrixWorld(true);
                this.currentMixers.push(mixer);
                return;
            } catch (error) {
                // Fall through to ordinary skeletal animation if optional MMD metadata is incomplete.
            }
        }
        const mixer = new THREE.AnimationMixer(object);
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        mixer.setTime(animationTime);
        object.updateMatrixWorld(true);
        this.currentMixers.push(mixer);
    }

    clearObjects () {
        if (this.currentMixers) this.currentMixers.forEach(mixer => mixer.stopAllAction());
        this.currentMixers = [];
        if (this.currentObjects) {
            this.currentObjects.forEach(object => this.scene.remove(object));
        } else if (this.currentObject) {
            this.scene.remove(this.currentObject);
        }
        this.currentObject = null;
        this.currentObjects = [];
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

    renderWorldScene (sceneItems, cameraTransform, stageSize, bitmapResolution = 2) {
        const width = Math.max(1, stageSize[0]);
        const height = Math.max(1, stageSize[1]);
        this.setOutputSize(Math.round(width * bitmapResolution), Math.round(height * bitmapResolution));
        this.clearObjects();
        this.currentObjects = sceneItems.map(item => {
            const object = cloneModelObject(item.sourceObject);
            const transform = item.transform;
            this.applyAnimation(object, item.animationName, item.frame);
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
            this.scene.add(object);
            return object;
        });
        this.currentObject = this.currentObjects.length === 1 ? this.currentObjects[0] : null;

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

        this.renderer.render(this.scene, this.camera);
        return this.canvas;
    }

    dispose () {
        this.clearObjects();
        this.renderer.dispose();
    }
}

export {
    DEFAULT_DEPTH,
    DEFAULT_FOV,
    DEFAULT_FOCAL_LENGTH,
    DEFAULT_STAGE_HEIGHT,
    DEFAULT_STAGE_WIDTH,
    MODEL_RENDER_SIZE,
    ROTATION_ORDERS,
    ModelRenderer,
    attachMotionToGLB,
    cameraLookAt,
    convertModelToGLB,
    disposeObject,
    focalLengthFromFOV,
    fovFromFocalLength,
    loadGLBObject,
    moviePositionToThree,
    movieRotationToThreeQuaternion,
    normalizeFOV,
    projectPosition,
    verticalFOVFromFocalLength
};
