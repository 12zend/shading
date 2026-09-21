const twgl = require('twgl.js');

/** A renderer-owned image resource. It is never registered as a sprite skin. */
class MovieTexture {
    constructor (renderer) {
        this.renderer = renderer;
        this.texture = null;
        this.nearest = true;
        this.width = 0;
        this.height = 0;
    }

    update (bitmap, resolution = 2, rotationCenter) {
        const gl = this.renderer.gl;
        const width = bitmap.videoWidth || bitmap.naturalWidth || bitmap.width;
        const height = bitmap.videoHeight || bitmap.naturalHeight || bitmap.height;
        if (!width || !height) throw new Error('Movie texture has no pixels');
        if (!this.texture) {
            this.texture = twgl.createTexture(gl, {auto: false, wrap: gl.CLAMP_TO_EDGE});
        }
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        try {
            if (width === this.width && height === this.height) {
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
            } else {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
            }
        } finally {
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        }
        this.width = width;
        this.height = height;
        this.size = [width / resolution, height / resolution];
        this.rotationCenter = rotationCenter || [this.size[0] / 2, this.size[1] / 2];
        this.pixels = width * height;
        return this;
    }

    dispose () {
        if (this.texture) this.renderer.gl.deleteTexture(this.texture);
        this.texture = null;
    }
}

module.exports = MovieTexture;
