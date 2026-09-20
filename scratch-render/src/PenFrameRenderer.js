/* Atomic pen frame publication and bounded GPU target reuse, owned by scratch-render. */
const frameMethods = {
beginFrame () {
const gl = this.gl;
const renderer = this.renderer;
  if (this.frameTransaction) return false;
  const skin = this._penSkin();
  if (!skin || !skin._texture || !skin._framebuffer || !skin._size) return false;
  if (typeof renderer._doExitDrawRegion === 'function') renderer._doExitDrawRegion();
  this._resize(skin._size[0], skin._size[1]);
  const staging = this.frameBuffer || this._createBufferTexture();
  this.frameBuffer = null;
  gl.bindTexture(gl.TEXTURE_2D, staging.texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const hadOwnGetTexture = Object.prototype.hasOwnProperty.call(skin, 'getTexture');
  const originalGetTexture = skin.getTexture;
  const baselineTexture = skin._texture;
  this.frameTransaction = {
    baselineFramebuffer: skin._framebuffer,
    baselineTexture,
    hadOwnGetTexture,
    originalGetTexture,
    skin,
    stagingFramebuffer: staging.framebuffer,
    stagingTexture: staging.texture
  };
  skin._texture = staging.texture;
  skin._framebuffer = {
    attachments: [staging.texture],
    framebuffer: staging.framebuffer,
    height: this.height,
    width: this.width
  };
  // Pen operations use _texture/_framebuffer, while stage drawing asks getTexture(). Keep the completed
  // previous frame visible until the staged pen texture is committed.
  skin.getTexture = () => baselineTexture;
  this._clearTransparent(staging.framebuffer);
  this._restoreGLState();
  return true;
},
restoreFrameTextureGetter (transaction) {
const gl = this.gl;
const renderer = this.renderer;
  this._restoreTextureGetter(transaction.skin, transaction.hadOwnGetTexture, transaction.originalGetTexture);
},
commitFrame () {
const gl = this.gl;
const renderer = this.renderer;
  const transaction = this.frameTransaction;
  if (!transaction) return false;
  if (typeof renderer._doExitDrawRegion === 'function') renderer._doExitDrawRegion();
  this.frameTransaction = null;
  this.restoreFrameTextureGetter(transaction);
  const baselineFramebuffer = transaction.baselineFramebuffer.framebuffer || transaction.baselineFramebuffer;
  this.retainFrameBuffer({
    framebuffer: baselineFramebuffer,
    texture: transaction.baselineTexture
  });
  this._markSkinChanged(transaction.skin);
  return true;
},
cancelFrame () {
const gl = this.gl;
const renderer = this.renderer;
  const transaction = this.frameTransaction;
  if (!transaction) return false;
  if (typeof renderer._doExitDrawRegion === 'function') renderer._doExitDrawRegion();
  this.frameTransaction = null;
  this.retainFrameBuffer({
    framebuffer: transaction.stagingFramebuffer,
    texture: transaction.stagingTexture
  });
  transaction.skin._texture = transaction.baselineTexture;
  transaction.skin._framebuffer = transaction.baselineFramebuffer;
  this.restoreFrameTextureGetter(transaction);
  this._restoreGLState();
  return true;
},
 retainFrameBuffer (buffer) {
  this.clearFrameBuffer();
  if (this.disableFrameReuse) {
   this.gl.deleteFramebuffer(buffer.framebuffer);
   this.gl.deleteTexture(buffer.texture);
  } else this.frameBuffer = buffer;
 },
 clearFrameBuffer () {
  if (!this.frameBuffer) return;
  this.gl.deleteFramebuffer(this.frameBuffer.framebuffer);
  this.gl.deleteTexture(this.frameBuffer.texture);
  this.frameBuffer = null;
 }
};
export default frameMethods;
