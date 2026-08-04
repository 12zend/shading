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

const loadLoaderModules = () => {
    if (!loaderModulesPromise) {
        loaderModulesPromise = Promise.all([
            import('three/examples/jsm/loaders/GLTFLoader.js'),
            import('three/examples/jsm/loaders/FBXLoader.js'),
            import('three/examples/jsm/loaders/OBJLoader.js'),
            import('three/examples/jsm/loaders/MTLLoader.js'),
            import('three/examples/jsm/exporters/GLTFExporter.js')
        ]).then(([gltf, fbx, obj, mtl, exporter]) => ({
            FBXLoader: fbx.FBXLoader,
            GLTFExporter: exporter.GLTFExporter,
            GLTFLoader: gltf.GLTFLoader,
            MTLLoader: mtl.MTLLoader,
            OBJLoader: obj.OBJLoader
        }));
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
    throw new Error('Supported model formats are GLB, FBX, and OBJ/MTL.');
};

const convertModelToGLB = async (format, data, mtlData) => {
    const parsed = await parseSourceModel(format, data, mtlData);
    const normalized = normalizeObject(parsed.object);
    const geometry = countGeometry(normalized.object);
    const glb = await exportGLB(normalized.object, parsed.animations);
    return {
        animationCount: parsed.animations.length,
        glb,
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
    return gltf.scene;
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

    setObject (sourceObject) {
        if (this.currentObject) this.scene.remove(this.currentObject);
        this.currentObject = sourceObject.clone(true);
        this.scene.add(this.currentObject);
        return this.currentObject;
    }

    render (sourceObject, transform, cameraTransform) {
        this.setOutputSize(MODEL_RENDER_SIZE, MODEL_RENDER_SIZE);
        this.setObject(sourceObject);
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
        const width = Math.max(1, stageSize[0]);
        const height = Math.max(1, stageSize[1]);
        this.setOutputSize(Math.round(width * bitmapResolution), Math.round(height * bitmapResolution));
        this.setObject(sourceObject);

        this.currentObject.position.copy(moviePositionToThree({
            x: transform.worldX,
            y: transform.worldY,
            z: transform.worldZ
        }));
        this.currentObject.quaternion.copy(movieRotationToThreeQuaternion(
            transform.rotation,
            transform.rotationOrder
        ));
        const scale = Math.max(0, Number(transform.size) || 0) / 100;
        this.currentObject.scale.setScalar(scale);

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
        if (this.currentObject) this.scene.remove(this.currentObject);
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
