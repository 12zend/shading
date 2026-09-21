import Skin from 'scratch-render/src/Skin';
import SVGSkin from 'scratch-render/src/SVGSkin';
import MovieSourceRenderer from 'scratch-render/src/MovieSourceRenderer';

test('direct costume drawing always requests the largest SVG raster and reuses its cache', () => {
    const skin = Object.create(SVGSkin.prototype);
    Object.assign(skin, {_maxTextureScale: 8, _svgImageLoaded: true, _scaledMIPs: [],
        _size: [180, 120], _rotationCenter: [90, 60], createMIP: jest.fn(() => ({texture: 'maximum'}))});
    const source = new MovieSourceRenderer({_allSkins: [skin]});
    const small = source.prepare({kind: 'costume', skinId: 0, scale: [5, 5]});
    const large = source.prepare({kind: 'costume', skinId: 0, scale: [400, 400]});
    expect(skin.createMIP).toHaveBeenCalledTimes(1);
    expect(skin.createMIP).toHaveBeenCalledWith(8);
    expect(small.texture).toBe(large.texture);
    expect(small.size).toEqual([180, 120]);
    expect(small.rotationCenter).toEqual([90, 60]);
    expect(small.nearest).toBe(false);
    // Ordinary sprite rendering still selects its normal display-dependent MIP.
    skin.getTexture([25, 25]);
    expect(skin.createMIP).toHaveBeenLastCalledWith(0.25);
});

test('bitmap costumes retain their original source texture and native logical dimensions', () => {
    const skin = Object.create(Skin.prototype);
    const texture = {};
    skin.getTexture = jest.fn(() => texture);
    Object.defineProperty(skin, 'size', {value: [240, 180]});
    skin._rotationCenter = [12, 34];
    const result = new MovieSourceRenderer({_allSkins: [skin]}).prepare({kind: 'costume', skinId: 0});
    expect(result.texture).toBe(texture);
    expect(result.size).toEqual([240, 180]);
    expect(result.rotationCenter).toEqual([12, 34]);
    expect(skin.getTexture).toHaveBeenCalledWith([100, 100]);
});

test('unloaded SVGs do not allocate a raster until loading finishes', () => {
    const skin = Object.create(SVGSkin.prototype);
    Object.assign(skin, {_maxTextureScale: 4, _svgImageLoaded: false, _scaledMIPs: [], createMIP: jest.fn()});
    expect(skin.getMaximumTexture()).toBeUndefined();
    expect(skin.createMIP).not.toHaveBeenCalled();
});
