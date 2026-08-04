import {
    DEFAULT_FOCAL_LENGTH,
    cameraLookAt,
    focalLengthFromFOV,
    fovFromFocalLength,
    projectPosition
} from '../../../src/lib/model-runtime';

const camera = {
    focalLength: DEFAULT_FOCAL_LENGTH,
    position: {x: 0, y: 0, z: 0},
    rotation: {x: 0, y: 0, z: 0},
    rotationOrder: 'XYZ'
};

describe('Movie 3D projection', () => {
    test('derives focal length from FOV using half of the stage long side', () => {
        expect(focalLengthFromFOV(60, 480, 360)).toBeCloseTo(240 / Math.tan(Math.PI / 6));
        expect(focalLengthFromFOV(60, 360, 640)).toBeCloseTo(320 / Math.tan(Math.PI / 6));
        expect(fovFromFocalLength(focalLengthFromFOV(72, 480, 360), 480, 360)).toBeCloseTo(72);
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
