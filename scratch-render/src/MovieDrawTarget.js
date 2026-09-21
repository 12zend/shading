const twgl = require('twgl.js');
const ShaderManager = require('./ShaderManager');

/** Direct Movie submissions to the current Movie framebuffer, including an active frame/group transaction. */
class MovieDrawTarget {
    constructor (renderer) {
        this.renderer = renderer;
        // Keep framebuffer/program bindings across adjacent Movie submissions. Other renderer
        // operations leave this region before changing GL state, including frame/group swaps.
        this.sourceRegion = {
            enter: () => {
                const gl = renderer.gl;
                twgl.bindFramebufferInfo(gl, this.sourceFramebuffer);
                gl.useProgram(this.sourceProgram.program);
                twgl.setBuffersAndAttributes(gl, this.sourceProgram, renderer._bufferInfo);
            },
            exit: () => twgl.bindFramebufferInfo(renderer.gl, null)
        };
    }

    // Batch adjacent motion trails in the shared Movie target. Every source change or transaction
    // boundary exits this draw region, so batches cannot cross a clear, group, effect or frame boundary.
    stroke (bufferId, attributes, x0, y0, x1, y1) {
        const renderer = this.renderer;
        const surface = renderer._allSkins[bufferId];
        if (!this.strokeRegion) this.createStrokeBatch();
        if (this.strokeSurface !== surface) renderer._doExitDrawRegion();
        this.strokeSurface = surface;
        renderer.enterDrawRegion(this.strokeRegion);
        if (this.strokeCount === this.strokeCapacity) this.flushStrokes();
        const diameter = attributes.diameter || 1;
        const offset = diameter === 1 || diameter === 3 ? 0.5 : 0;
        const quality = surface.renderQuality;
        const dx = (x1 - x0) * quality;
        const dy = (y1 - y0) * quality;
        const length = Math.hypot(dx, dy);
        const color = attributes.color4f || [0, 0, 1, 1];
        for (let vertex = 0; vertex < this.strokeCopies; vertex++) {
            let index = ((this.strokeCount * this.strokeCopies) + vertex) * 10;
            this.strokeData[index++] = color[0] * color[3];
            this.strokeData[index++] = color[1] * color[3];
            this.strokeData[index++] = color[2] * color[3];
            this.strokeData[index++] = color[3];
            this.strokeData[index++] = diameter * quality;
            this.strokeData[index++] = length;
            this.strokeData[index++] = (x0 + offset) * quality;
            this.strokeData[index++] = -(y0 + offset) * quality;
            this.strokeData[index++] = dx;
            this.strokeData[index] = -dy;
        }
        this.strokeCount++;
        surface._silhouetteDirty = true;
        renderer.dirty = true;
        if (renderer._penFXEngine) renderer._penFXEngine.invalidateDrawBounds(surface);
    }

    createStrokeBatch () {
        const renderer = this.renderer;
        const gl = renderer.gl;
        renderer._doExitDrawRegion();
        const extension = !gl.drawArraysInstanced && gl.getExtension('ANGLE_instanced_arrays');
        this.strokeInstances = gl.drawArraysInstanced ? {
            draw: gl.drawArraysInstanced.bind(gl), divisor: gl.vertexAttribDivisor.bind(gl)
        } : extension ? {
            draw: extension.drawArraysInstancedANGLE.bind(extension),
            divisor: extension.vertexAttribDivisorANGLE.bind(extension)
        } : null;
        // Allocate only when legacy trails are used; 256 instances use 10 KiB, versus the old permanent 640 KiB.
        this.strokeCapacity = 256;
        this.strokeCopies = this.strokeInstances ? 1 : 6;
        this.strokeCount = 0;
        this.strokeData = new Float32Array(this.strokeCapacity * this.strokeCopies * 10);
        this.strokeBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.strokeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.strokeData.byteLength, gl.STREAM_DRAW);
        const positions = this.strokeInstances ? [1, 0, 0, 0, 1, 1, 0, 1] :
            Array.from({length: this.strokeCapacity}, () => [1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1]).flat();
        this.strokeGeometry = twgl.createBufferInfoFromArrays(gl, {
            a_position: {numComponents: 2, data: positions}
        });
        this.strokeProgram = renderer._shaderManager.getShader(ShaderManager.DRAW_MODE.line, 0);
        this.strokeLocations = ['a_lineColor', 'a_lineThicknessAndLength', 'a_penPoints']
            .map(name => gl.getAttribLocation(this.strokeProgram.program, name));
        this.strokeRegion = {
            enter: () => {
                const surface = this.strokeSurface;
                twgl.bindFramebufferInfo(gl, surface._framebuffer);
                gl.viewport(0, 0, surface._size[0], surface._size[1]);
                gl.useProgram(this.strokeProgram.program);
                twgl.setBuffersAndAttributes(gl, this.strokeProgram, this.strokeGeometry);
                twgl.setUniforms(this.strokeProgram, {u_stageSize: surface._size});
            },
            exit: () => {
                this.flushStrokes();
                twgl.bindFramebufferInfo(gl, null);
            }
        };
    }

    flushStrokes () {
        if (!this.strokeCount) return;
        const gl = this.renderer.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.strokeBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.strokeData.subarray(0, this.strokeCount * this.strokeCopies * 10));
        const sizes = [4, 2, 4];
        const offsets = [0, 16, 24];
        for (let index = 0; index < 3; index++) {
            const location = this.strokeLocations[index];
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location, sizes[index], gl.FLOAT, false, 40, offsets[index]);
        }
        if (this.strokeInstances) {
            for (const location of this.strokeLocations) this.strokeInstances.divisor(location, 1);
            this.strokeInstances.draw(gl.TRIANGLE_STRIP, 0, 4, this.strokeCount);
            for (const location of this.strokeLocations) this.strokeInstances.divisor(location, 0);
        } else {
            gl.drawArrays(gl.TRIANGLES, 0, this.strokeCount * 6);
        }
        this.strokeCount = 0;
    }

    draw (bufferId, source, uniforms, effectBits = 0) {
        const renderer = this.renderer;
        const skin = renderer._allSkins[bufferId];
        if (!skin || !source.texture) return;
        const gl = renderer.gl;
        const width = renderer._nativeSize[0];
        const height = renderer._nativeSize[1];
        const quality = skin.renderQuality;
        // Match stage-pixel boundaries while limiting both fill work and downstream effect bounds.
        const matrix = uniforms.u_modelMatrix;
        let left = Infinity;
        let right = -Infinity;
        let top = -Infinity;
        let bottom = Infinity;
        let crossesCamera = false;
        for (const x of [-0.5, 0.5]) {
            for (const y of [-0.5, 0.5]) {
                const w = (matrix[3] * x) + (matrix[7] * y) + matrix[15];
                if (w <= 0) crossesCamera = true;
                const px = ((matrix[0] * x) + (matrix[4] * y) + matrix[12]) / w;
                const py = ((matrix[1] * x) + (matrix[5] * y) + matrix[13]) / w;
                left = Math.min(left, px);
                right = Math.max(right, px);
                bottom = Math.min(bottom, py);
                top = Math.max(top, py);
            }
        }
        if (crossesCamera) {
            left = -width / 2;
            right = width / 2;
            bottom = -height / 2;
            top = height / 2;
        }
        left = Math.floor(Math.max(-width / 2, left) * quality);
        right = Math.ceil(Math.min(width / 2, right) * quality);
        bottom = Math.floor(Math.max(-height / 2, bottom) * quality);
        top = Math.ceil(Math.min(height / 2, top) * quality);
        if (right <= left || top <= bottom) return;
        const viewportX = (width * quality / 2) + left;
        const viewportY = (height * quality / 2) - top;
        const program = renderer._shaderManager.getShader(ShaderManager.DRAW_MODE.default, effectBits);
        if (this.sourceFramebuffer !== skin._framebuffer || this.sourceProgram !== program) {
            renderer._doExitDrawRegion();
            this.sourceFramebuffer = skin._framebuffer;
            this.sourceProgram = program;
        }
        if (source.dynamic) {
            // Mutable sources upload between draws; keep their immediate submission path.
            renderer._doExitDrawRegion();
            twgl.bindFramebufferInfo(gl, skin._framebuffer);
            gl.useProgram(program.program);
            twgl.setBuffersAndAttributes(gl, program, renderer._bufferInfo);
        } else {
            renderer.enterDrawRegion(this.sourceRegion);
        }
        gl.viewport(viewportX, viewportY, right - left, top - bottom);
        twgl.setTextureParameters(gl, source.texture, {minMag: source.nearest ? gl.NEAREST : gl.LINEAR});
        twgl.setUniforms(program, {
            ...uniforms,
            u_projectionMatrix: twgl.m4.ortho(left / quality, right / quality, top / quality, bottom / quality, -1, 1),
            u_skin: source.texture,
            u_skinSize: source.size
        });
        twgl.drawBufferInfo(gl, renderer._bufferInfo, gl.TRIANGLES);
        if (renderer._penFXEngine) {
            renderer._penFXEngine.noteDrawBounds(skin, viewportX, viewportY, right - left, top - bottom);
        }
        skin._silhouetteDirty = true;
        renderer.dirty = true;
    }
}

module.exports = MovieDrawTarget;
