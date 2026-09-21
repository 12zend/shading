/* Native Node/WebGL benchmark. No browser, Electron or GUI playback. */
const {root, canvas}=require('./benchmarks/native-environment.cjs');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const VM=require('../scratch-vm/src');
const Renderer=require('../scratch-render/src');
const Storage=require('@turbowarp/scratch-storage');
const input=process.argv[2];
const output=process.argv[3] || '/tmp/shading-benchmark.json';
const baseline=process.argv.includes('--baseline');
let seed=123456;
Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
(async()=>{
 if (!input) throw Error('Usage: node scripts/benchmark-shade.cjs project.shade output.json [--baseline]');
 const vm=new VM();const renderer=new Renderer(canvas(),-240,240,-135,135);
 vm.setStageSize(480,270);vm.attachRenderer(renderer);renderer.setUseHighQualityRender(true);
 vm.attachStorage(new Storage());vm.attachV2BitmapAdapter(new (require('@turbowarp/scratch-svg-renderer').BitmapAdapter)());
 vm.installShadingFeatures();
 await vm.loadProject(fs.readFileSync(input));
 // Native image decoding is asynchronous, just like browser image decoding. Wait before timing.
 for(let attempt=0;attempt<1000;attempt++){
  const pending=renderer._allSkins.some(skin=>skin&&skin._svgImage&& !skin._svgImageLoaded);
  if(!pending)break;
  if(attempt===999)throw Error('SVG images did not finish decoding');
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 const manager=vm.runtime.movieAssetManager;
 manager.resizeRendererForTimeline();
 const engine=vm.runtime.penFX._getEngine();
 if(baseline){engine._directSinglePass=()=>false;engine.lensKernelSupported=false;engine.disableDirectGroupBlend=true;engine.disablePenBounds=true;engine.disableFrameReuse=true;}
 if(process.env.BENCHMARK_NO_KERNEL)engine.lensKernelSupported=false;
 if(process.env.BENCHMARK_NO_SWAP)engine._directSinglePass=()=>false;
 if(process.env.BENCHMARK_DIAG){
  const lens=engine.lensBlur;let n=0;engine.lensBlur=function(...args){if(n++<55)console.log('LENS',JSON.stringify({args,opacity:this.blendOpacity,scope:this.groupEffectScope,group:this.groupStack.map(g=>g.bounds)}));return lens.apply(this,args);};
 }
 const gl=renderer.gl;
 // Renderer picking setup can leave a packed depth/stencil compatibility error in this native backend.
 while(gl.getError()){};
 const step=Number(process.env.BENCHMARK_STEP||2);
 const times=process.env.BENCHMARK_TIMES ? process.env.BENCHMARK_TIMES.split(',').map(Number) :
  Array.from({length:Math.ceil(manager.timeline.duration/step)},(_,i)=>i*step);
 const results=[];
 let errors=[];
 const consoleError=console.error;
 console.error=(...args)=>{errors.push(args.map(String).join(' '));consoleError(...args);};
 const frame=async(time)=>{
  manager.seekTimeline(time);
  for(let i=0;i<10000;i++){
   vm.runtime._step();await new Promise(r=>setImmediate(r));
   if(!manager.timeline.pendingFrame&&!manager.timeline.waitingForFrame&&!manager.hasPendingVisualRenders()&&!manager.hasActiveRenderFrameThreads())return;
  }
  throw Error('Unfinished frame at '+time);
 };
 for(const time of times){
  await frame(time); // Warm the exact shaders/assets needed by this scene.
  const durations=[];let pixels;
  for(let repeat=0;repeat<3;repeat++){
   const start=performance.now();await frame(time);gl.finish();durations.push(performance.now()-start);
  }
  const skin=engine._drawSurface();pixels=new Uint8Array(engine.width*engine.height*4);
  gl.bindFramebuffer(gl.FRAMEBUFFER,skin._framebuffer.framebuffer);
  gl.readPixels(0,0,engine.width,engine.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const glError=gl.getError();if(glError||errors.length)throw Error(JSON.stringify({time,glError,errors}));
  durations.sort((a,b)=>a-b);
  const record={time,ms:durations[1],sha256:crypto.createHash('sha256').update(pixels).digest('hex')};
  results.push(record);
  if(process.env.BENCHMARK_PIXELS)fs.writeFileSync(path.join(process.env.BENCHMARK_PIXELS,`${baseline?'baseline':'optimized'}-${time}.rgba`),pixels);
  console.log(JSON.stringify(record));
 }
 fs.writeFileSync(output,JSON.stringify({input: path.basename(input),baseline,width:engine.width,height:engine.height,
  renderer:gl.getParameter(gl.RENDERER),node:process.version,step,results},null,2));
 process.exit(0);
})().catch(error=>{console.error(error);process.exit(1);});
