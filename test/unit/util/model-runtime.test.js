import * as THREE from 'three';

import {
    DEFAULT_FOCAL_LENGTH,
    bindAnimationToMesh,
    cameraLookAt,
    focalLengthFromFOV,
    fovFromFocalLength,
    moviePositionToThree,
    movieRotationToThreeQuaternion,
    projectPosition,
    resampleAnimationClip,
    restoreMMDBoneHierarchy,
    verticalFOVFromFocalLength
} from '../../../src/lib/model-runtime';

const camera = {
    focalLength: DEFAULT_FOCAL_LENGTH,
    position: {x: 0, y: 0, z: 0},
    rotation: {x: 0, y: 0, z: 0},
    rotationOrder: 'XYZ'
};

describe('Movie 3D projection', () => {
    test('binds MMD bone tracks to the skinned mesh before GLB export', () => {
        const root = new THREE.Group();
        const mesh = new THREE.SkinnedMesh();
        const bone = new THREE.Bone();
        bone.name = 'センター';
        mesh.name = 'mesh_0';
        mesh.add(bone);
        mesh.bind(new THREE.Skeleton([bone]));
        root.add(mesh);
        const clip = new THREE.AnimationClip('motion', 1, [
            new THREE.VectorKeyframeTrack('.bones[センター].position', [0, 1], [0, 0, 0, 1, 0, 0])
        ]);

        bindAnimationToMesh(clip, mesh);

        expect(clip.tracks[0].name).toBe('mesh_0.bones[センター].position');
        const binding = THREE.PropertyBinding.parseTrackName(clip.tracks[0].name);
        const trackMesh = THREE.PropertyBinding.findNode(root, binding.nodeName);
        expect(trackMesh).toBe(mesh);
        expect(trackMesh.skeleton.getBoneByName(binding.objectIndex)).toBe(bone);
    });

    test('restores MMD root bones beneath the skinned mesh for IK matrix updates', () => {
        const root = new THREE.Group();
        const mesh = new THREE.SkinnedMesh();
        const bone = new THREE.Bone();
        bone.position.set(1, 2, 3);
        mesh.geometry.userData.MMD = {bones: []};
        mesh.bind(new THREE.Skeleton([bone]));
        root.add(mesh, bone);
        root.position.set(4, 5, 6);
        root.updateMatrixWorld(true);
        const worldPosition = bone.getWorldPosition(new THREE.Vector3());

        expect(restoreMMDBoneHierarchy(root)).toBe(mesh);

        expect(bone.parent).toBe(mesh);
        expect(bone.getWorldPosition(new THREE.Vector3()).distanceTo(worldPosition)).toBeCloseTo(0);
    });

    test('samples MMD interpolation at every rendered frame before GLB export', () => {
        const track = new THREE.VectorKeyframeTrack(
            '.bones[センター].position',
            [0, 2 / 30],
            [0, 0, 0, 1, 0, 0]
        );
        track.createInterpolant = () => ({
            evaluate: time => new Float32Array([time * time, 0, 0])
        });
        const clip = new THREE.AnimationClip('motion', 2 / 30, [track]);

        const sampled = resampleAnimationClip(clip);

        expect(sampled.duration).toBeCloseTo(2 / 30);
        expect(sampled.tracks[0].times[0]).toBeCloseTo(0);
        expect(sampled.tracks[0].times[1]).toBeCloseTo(1 / 30);
        expect(sampled.tracks[0].times[2]).toBeCloseTo(2 / 30);
        expect(sampled.tracks[0].values[3]).toBeCloseTo(1 / 900);
        expect(sampled.tracks[0].getInterpolation()).toBe(THREE.InterpolateLinear);
    });

    test('derives focal length from FOV using half of the stage long side', () => {
        expect(focalLengthFromFOV(60, 480, 360)).toBeCloseTo(240 / Math.tan(Math.PI / 6));
        expect(focalLengthFromFOV(60, 360, 640)).toBeCloseTo(320 / Math.tan(Math.PI / 6));
        expect(fovFromFocalLength(focalLengthFromFOV(72, 480, 360), 480, 360)).toBeCloseTo(72);
    });

    test('converts the Movie positive-z camera into Three.js negative-z view space', () => {
        const zeroRotation = movieRotationToThreeQuaternion({x: 0, y: 0, z: 0}, 'XYZ');
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(zeroRotation);
        expect(forward.toArray()).toEqual([0, 0, -1]);

        const yaw = movieRotationToThreeQuaternion({x: 0, y: 90, z: 0}, 'XYZ');
        const turnedForward = new THREE.Vector3(0, 0, -1).applyQuaternion(yaw);
        expect(turnedForward.x).toBeCloseTo(1);
        expect(turnedForward.y).toBeCloseTo(0);
        expect(turnedForward.z).toBeCloseTo(0);
    });

    test('uses focal length to derive the vertical FOV for a stage-sized render', () => {
        expect(verticalFOVFromFocalLength(480, 360)).toBeCloseTo(
            2 * Math.atan(180 / 480) * (180 / Math.PI)
        );
    });

    test('keeps camera position in world space when camera rotation changes', () => {
        const threeCamera = new THREE.PerspectiveCamera();
        threeCamera.position.copy(moviePositionToThree({x: 100, y: 0, z: 0}));
        threeCamera.quaternion.copy(movieRotationToThreeQuaternion({
            x: 0,
            y: -Math.atan2(100, 480) * (180 / Math.PI),
            z: 0
        }, 'XYZ'));
        threeCamera.updateMatrixWorld(true);

        const cameraSpaceTarget = moviePositionToThree({x: 0, y: 0, z: 480})
            .applyMatrix4(threeCamera.matrixWorldInverse);
        expect(threeCamera.position.x).toBeCloseTo(100);
        expect(threeCamera.position.y).toBeCloseTo(0);
        expect(threeCamera.position.z).toBeCloseTo(0);
        expect(cameraSpaceTarget.x).toBeCloseTo(0);
        expect(cameraSpaceTarget.z).toBeLessThan(0);
    });

    test('uses focalLength*x/z and focalLength*y/z for 2.5D sprites', () => {
        expect(projectPosition({x: 120, y: -60, z: 240}, camera)).toMatchObject({
            inFront: true,
            perspective: 2,
            x: 240,
            y: -120
        });
    });

    test('camera translation is applied before perspective', () => {
        const movedCamera = {
            ...camera,
            position: {x: 20, y: 10, z: 100}
        };
        expect(projectPosition({x: 70, y: 35, z: 300}, movedCamera)).toMatchObject({
            perspective: 2.4,
            x: 120,
            y: 60
        });
    });

    test('look at keeps a camera facing positive z at zero rotation', () => {
        const rotation = cameraLookAt(
            {x: 0, y: 0, z: 0},
            {x: 0, y: 0, z: 480},
            'XYZ'
        );
        expect(rotation.x).toBeCloseTo(0);
        expect(rotation.y).toBeCloseTo(0);
        expect(rotation.z).toBeCloseTo(0);
    });
});
