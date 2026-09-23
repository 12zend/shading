/* eslint-disable */
// The two shipped compute effects are lowered to synchronous WebGL fragment passes.
// Their kernels retain the original histogram binning and radix-2 butterfly math.
const vertex = `#version 300 es
precision highp float;
void main() { vec2 p=vec2(gl_VertexID==2?3.:-1.,gl_VertexID==1?3.:-1.); gl_Position=vec4(p,0.,1.); }`;
const header = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
`;
const fft = `${header}
uniform sampler2D u_real; uniform sampler2D u_imag;
uniform int u_axis; uniform int u_stage; uniform int u_inverse; uniform int u_initial;
layout(location=0) out vec4 result;
int reverse8(int x) {int r=0;for(int i=0;i<8;i++){r=(r<<1)|(x&1);x=x>>1;}return r;}
vec2 sampleInput(ivec2 p) {
    ivec2 size=textureSize(u_real,0);
    if(any(greaterThanEqual(p,size)))return vec2(0.);
    vec4 re=texelFetch(u_real,p,0);
    if(u_initial==1)return vec2(dot(re.rgb,vec3(.299,.587,.114)),0.);
    if(u_stage==0)return vec2(re.r,texelFetch(u_imag,p,0).r);
    return re.rg;
}
void main() {
    ivec2 p=ivec2(gl_FragCoord.xy);int pos=u_axis==0?p.x:p.y;int x=pos%256;
    int width=2<<u_stage;int halfWidth=width/2;
    int first=(x&~(width-1))+(x&(halfWidth-1));int second=first+halfWidth;
    if(u_stage==0){first=reverse8(first);second=reverse8(second);}
    ivec2 a=p,b=p;
    if(u_axis==0){a.x=pos-x+first;b.x=pos-x+second;}else{a.y=pos-x+first;b.y=pos-x+second;}
    vec2 A=sampleInput(a),B=sampleInput(b);
    float angle=6.28318530718*float(x&(width-1))/float(width);
    vec2 w=vec2(cos(angle),-sin(angle));
    if(u_inverse==1)result=vec4((A+vec2(w.x*B.x+w.y*B.y,-w.y*B.x+w.x*B.y))*.5,0.,1.);
    else result=vec4(A+vec2(w.x*B.x-w.y*B.y,w.y*B.x+w.x*B.y),0.,1.);
}`;
const split = `${header}
uniform sampler2D u_real;
layout(location=0) out vec4 realPart;layout(location=1) out vec4 imaginaryPart;
void main(){vec2 v=texelFetch(u_real,ivec2(gl_FragCoord.xy),0).rg;
realPart=vec4(v.rrr,1.);imaginaryPart=vec4(v.ggg,1.);}`;
const histogram = `${header}
uniform sampler2D u_real; uniform int u_dispatchX;
layout(location=0) out vec4 result;
void main(){ivec2 pixel=ivec2(gl_FragCoord.xy);int tile=pixel.x;int bin=pixel.y;
ivec2 origin=ivec2(tile%u_dispatchX,tile/u_dispatchX)*64;
ivec2 size=textureSize(u_real,0);vec4 sum=vec4(0.);
for(int y=0;y<32;y++)for(int x=0;x<32;x++){
    ivec2 base=origin+ivec2(x,y)*2;
    if(base.x+1>=size.x||base.y+1>=size.y||(x%8==7&&y%8==7))continue;
    for(int dy=0;dy<2;dy++)for(int dx=0;dx<2;dx++){
        vec3 rgb=texelFetch(u_real,base+ivec2(dx,dy),0).rgb;
        ivec4 bins=ivec4(vec4(rgb,dot(rgb,vec3(.299,.587,.114)))*255.5);
        sum+=vec4(equal(bins,ivec4(bin)));
    }
}
// The source stores RGBA16 UNORM before the merge step.
result=floor(clamp(sum/4096.,0.,1.)*65535.+.5)/65535.;
}`;
const merge = `${header}
uniform sampler2D u_real;
layout(location=0) out vec4 result;
void main(){int bin=int(gl_FragCoord.x);int count=textureSize(u_real,0).x;uvec4 sum=uvec4(0);
for(int i=0;i<count;i++)sum+=uvec4(texelFetch(u_real,ivec2(i,bin),0)*4096.);result=vec4(sum);}`;
class GenshadeCompute {
    constructor(renderer){this.renderer=renderer;this.gl=renderer.gl;this.programs=new Map();}
    program(source){
        if(this.programs.has(source))return this.programs.get(source);
        const gl=this.gl,e=this.renderer.engine;
        const vs=e._compileShader(gl.VERTEX_SHADER,vertex),fs=e._compileShader(gl.FRAGMENT_SHADER,source);
        const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
        gl.deleteShader(vs);gl.deleteShader(fs);
        if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const message=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error(message);}
        this.programs.set(source,p);return p;
    }
    draw(source,targets,real,imag,uniforms={}){
        const gl=this.gl,p=this.program(source);
        gl.bindFramebuffer(gl.FRAMEBUFFER,targets[0].framebuffer);
        targets.forEach((target,i)=>gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,target.texture,0));
        gl.drawBuffers(targets.map((t,i)=>gl.COLOR_ATTACHMENT0+i));
        gl.viewport(0,0,targets[0].width,targets[0].height);gl.useProgram(p);
        gl.disable(gl.BLEND);gl.disable(gl.STENCIL_TEST);gl.colorMask(true,true,true,true);
        [real,imag||real].forEach((texture,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindSampler(i,null);
            gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(gl.getUniformLocation(p,i?'u_imag':'u_real'),i);});
        Object.entries(uniforms).forEach(([name,value])=>gl.uniform1i(gl.getUniformLocation(p,name),value));
        gl.drawArrays(gl.TRIANGLES,0,3);
        targets.slice(1).forEach((target,i)=>gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1+i,gl.TEXTURE_2D,null,0));
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    }
    render(effect,pass,front){
        const targets=effect.targets;
        const find=suffix=>{const match=Array.from(targets).find(([name])=>name.endsWith(`__${suffix}`));if(!match)throw new Error(`Missing compute target ${suffix}`);return match[1];};
        if(pass.compute.includes('HistogramTilesCS')){
            this.draw(histogram,[find('HistogramTiles')],front.texture,null,{u_dispatchX:Math.ceil(effect.width/64)});return;
        }
        if(pass.compute.includes('TileMergeCS')){this.draw(merge,[find('Histogram')],find('HistogramTiles').texture);return;}
        if(!/Row(?:Inverse)?CS|Column(?:Inverse)?CS/.test(pass.compute))throw new Error(`Unknown compute kernel ${pass.compute}`);
        const row=pass.compute.includes('Row'),inverse=pass.compute.includes('Inverse');
        const initial=row&&!inverse;
        const inputReal=initial?front:find(row?'FFTReal':'RowFFTReal');
        const inputImag=initial?front:find(row?'FFTImaginary':'RowFFTImaginary');
        const outputReal=find(row?'RowFFTReal':inverse?'InverseFFT':'FFTReal');
        const outputImag=inverse&&!row?null:find(row?'RowFFTImaginary':'FFTImaginary');
        const work=find('FFTReal');
        for(const name of ['$computeA','$computeB']) if(!targets.has(name))targets.set(name,this.renderer.createTarget(work.width,work.height,16));
        let current=inputReal;
        for(let stage=0;stage<8;stage++){
            const target=targets.get(stage%2?'$computeB':'$computeA');
            this.draw(fft,[target],current.texture,inputImag.texture,{u_stage:stage,u_axis:row?0:1,u_inverse:inverse?1:0,u_initial:initial&&stage===0?1:0});
            current=target;
        }
        this.draw(split,outputImag?[outputReal,outputImag]:[outputReal],current.texture);
    }
}
export default GenshadeCompute;
