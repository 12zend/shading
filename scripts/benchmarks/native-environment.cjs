const fs=require('fs'),path=require('path'),Module=require('module');
const root=path.resolve(__dirname, '../..');
const dependencies=process.env.SHADING_BENCHMARK_DEPS;
if (!dependencies) throw new Error('Set SHADING_BENCHMARK_DEPS to the benchmark dependency node_modules directory.');
const native=require(dependencies+'/@napi-rs/canvas');
const imageSource=Object.getOwnPropertyDescriptor(native.Image.prototype,'src');
Object.defineProperty(native.Image.prototype,'src',{get:imageSource.get,set(value){if(typeof value==='string'&&value.startsWith('data:image/svg+xml;utf8,'))value=Buffer.from(decodeURIComponent(value.slice(value.indexOf(',')+1)));imageSource.set.call(this,value);}});
const sdl=require(dependencies+'/@kmamal/sdl');
const createGL=require(dependencies+'/@kmamal/gl');
const babel=require(root+'/node_modules/@babel/core');
const oldResolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...args){
 if(name.startsWith('scratch-render/src/'))name=root+'/'+name;
 if(name.includes('!'))return path.resolve(path.dirname(parent.filename),name.slice(name.lastIndexOf('!')+1));
 return oldResolve.call(this,name,parent,...args);
};
const js=Module._extensions['.js'];
Module._extensions['.js']=function(m,file){if((file.startsWith(root+'/scratch-vm/src/')||file.startsWith(root+'/scratch-render/src/'))&&/\b(?:import|export)\s/.test(fs.readFileSync(file,'utf8'))){const result=babel.transformFileSync(file,{babelrc:false,configFile:false,plugins:[require.resolve(root+'/node_modules/@babel/plugin-transform-modules-commonjs')]});m._compile(result.code,file);}else js(m,file);};
for(const ext of ['.vert','.frag','.css'])Module._extensions[ext]=(m,f)=>m.exports=fs.readFileSync(f,'utf8');
Module._extensions['.zip']=(m,f)=>m.exports=fs.readFileSync(f);
const element=()=>({style:{},appendChild(){},removeChild(){},setAttribute(){},addEventListener(){},removeEventListener(){},classList:{add(){},remove(){}}});
const canvas=()=>{
 const c=native.createCanvas(480,360);c.style={};c.addEventListener=()=>{};c.removeEventListener=()=>{};c.getBoundingClientRect=()=>({width:c.width,height:c.height,left:0,top:0});
 const getContext=c.getContext.bind(c);let gl;
 c.getContext=(type,opts)=>{if(type==='2d')return getContext(type,opts);if(type==='webgl2')return null;if(type==='webgl'||type==='experimental-webgl'){
 if(!gl){const win=sdl.video.createWindow({width:1920,height:1080,visible:false,opengl:true});gl=createGL(c.width,c.height,{...opts,window:win.native,preserveDrawingBuffer:true});if(!gl)throw Error('Native WebGL context creation failed');gl.canvas=c;const shaderSource=gl.shaderSource.bind(gl);gl.shaderSource=(shader,source)=>shaderSource(shader,source.replace(/\bnoise([1234])\b/g,'shading_noise$1'));
 const upload=gl.texImage2D.bind(gl);gl.texImage2D=(...a)=>{if(a.length===6){const src=a[5];let ctx;if(src.getContext)ctx=src.getContext('2d');else{const t=native.createCanvas(src.width,src.height);ctx=t.getContext('2d');ctx.drawImage(src,0,0);}const im=ctx.getImageData(0,0,src.width,src.height);return upload(a[0],a[1],a[2],im.width,im.height,0,a[3],a[4],im.data);}return upload(...a);};
 const subUpload=gl.texSubImage2D.bind(gl);gl.texSubImage2D=(...a)=>{if(a.length===7){const src=a[6];let ctx;if(src.getContext)ctx=src.getContext('2d');else{const t=native.createCanvas(src.width,src.height);ctx=t.getContext('2d');ctx.drawImage(src,0,0);}const im=ctx.getImageData(0,0,src.width,src.height);return subUpload(a[0],a[1],a[2],a[3],im.width,im.height,a[4],a[5],im.data);}return subUpload(...a);};

 }if(process.env.TRACE_GL&&!gl._traced){gl._traced=true;for(const name of ['drawArrays','drawElements','texImage2D','texSubImage2D','framebufferTexture2D','clear']){const original=gl[name].bind(gl);gl[name]=(...args)=>{const result=original(...args);const error=gl.getError();if(error)console.error('GL ERROR',name,error,new Error().stack);return result;};}}return gl;}return null;};return c;
};
global.HTMLVideoElement=class HTMLVideoElement {};global.ImageBitmap=native.Image;global.Image=native.Image;global.ImageData=native.ImageData;global.HTMLImageElement=native.Image;global.HTMLCanvasElement=native.CanvasElement;
global.document={createElement(tag){if(tag==='canvas')return canvas();if(tag==='img')return new native.Image();return element();},head:element(),body:element(),addEventListener(){},removeEventListener(){}};
global.window={devicePixelRatio:1,addEventListener(){},removeEventListener(){},document:global.document};
Object.assign(global.window,{ImageBitmap:native.Image,ImageData:native.ImageData,HTMLElement:native.CanvasElement});
global.HTMLElement=native.CanvasElement;
global.requestAnimationFrame=()=>0;global.cancelAnimationFrame=()=>{};
const {DOMParser,XMLSerializer}=require(root+'/node_modules/@xmldom/xmldom');global.DOMParser=DOMParser;global.XMLSerializer=XMLSerializer;
const svg=require(root+'/node_modules/@turbowarp/scratch-svg-renderer');
svg.loadSvgString=(source)=>{const el=new DOMParser().parseFromString(source,'text/xml').documentElement;const box=(el.getAttribute('viewBox')||`0 0 ${parseFloat(el.getAttribute('width'))||480} ${parseFloat(el.getAttribute('height'))||360}`).split(/[\s,]+/).map(Number);el.viewBox={baseVal:{x:box[0],y:box[1],width:box[2],height:box[3]}};return el;};
svg.serializeSvgToString=el=>new XMLSerializer().serializeToString(el);
module.exports={root,canvas,native};
