import json,re,subprocess,pathlib

def webgl(code, stage):
    code=code.replace('#version 430','#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;')
    code=re.sub(r', binding = \d+', '', code)
    code=re.sub(r'layout\(binding = \d+\) ', '', code)
    # ES 3.0 links varyings by name; desktop GLSL links them by location.
    def interface(m):
        location, qualifier, typ, name, suffix = m.groups()
        if (stage=='vert' and qualifier=='out') or (stage=='frag' and qualifier=='in'):
            names[name]='gs_varying_'+location
            return re.sub(r'^(flat|noperspective|centroid|smooth) (.*)$', r'\1 '+qualifier+r' \2', typ)+' '+name+suffix if ' ' in typ else qualifier+' '+typ+' '+name+suffix
        return m.group(0)
    names={}
    code=re.sub(r'layout\(location = (\d+)\) ((?:flat |noperspective |centroid |smooth )+)(in|out) ',r'layout(location = \1) \3 \2',code)
    code=re.sub(r'layout\(location = (\d+)\) (in|out) ((?:flat |noperspective |centroid |smooth )?\w+) (\w+)([^;]*;)',interface,code)
    for a,b in names.items(): code=re.sub(r'\b'+a+r'\b',b,code)
    code=re.sub(r'\bgl_VertexID\b','uint(gl_VertexID)',code)
    code=code.replace('#if GL_EXT_control_flow_attributes', '#if defined(GL_EXT_control_flow_attributes)')
    code=re.sub(r'layout\(location = (\d+)\) ((?:flat |noperspective |centroid |smooth )+)(in|out) ',r'layout(location = \1) \3 \2',code)
    code=code.replace('fma(', 'gs_fma(').replace('ldexp(', 'gs_ldexp(').replace('textureOffset(', 'gs_textureOffset(').replace('textureGather(', 'gs_textureGather(').replace('textureGatherOffset(', 'gs_textureGatherOffset(')
    helpers=''
    for t in ['float','vec2','vec3','vec4']:
        it='int' if t=='float' else 'i'+t
        helpers+=f'{t} gs_fma({t} a,{t} b,{t} c) {{return a*b+c;}}\n'
        helpers+=f'{t} gs_ldexp({t} a,{it} b) {{return a*exp2({t}(b));}}\n'
    helpers+='vec4 gs_textureOffset(sampler2D s,vec2 p,ivec2 o) {return texture(s,p+vec2(o)/vec2(textureSize(s,0)));}\n'
    helpers+='vec4 gs_textureGather(sampler2D s,vec2 p,int c) {vec2 z=vec2(textureSize(s,0)); vec2 q=(floor(p*z-0.5)+0.5)/z; return vec4(textureLod(s,q+vec2(0.,1.)/z,0.)[c],textureLod(s,q+vec2(1.,1.)/z,0.)[c],textureLod(s,q+vec2(1.,0.)/z,0.)[c],textureLod(s,q,0.)[c]);}\n'
    helpers+='vec4 gs_textureGatherOffset(sampler2D s,vec2 p,ivec2 o,int c) {return gs_textureGather(s,p+vec2(o)/vec2(textureSize(s,0)),c); }\n'
    code=code.replace('precision highp sampler2D;','precision highp sampler2D;\n'+helpers)
    return code

if __name__=='__main__':
    errors=[];total=0
    for r in json.load(open('/tmp/genshade-compile-results.json')):
        m=json.load(open(r['module']))
        stages={p[s]:ext for t in m['techniques'] for p in t['passes'] for s,ext in [('vertex','vert'),('fragment','frag')] if p[s]}
        for entry,stage in stages.items():
            total+=1;code=webgl(m['entries'][entry],stage)
            p=pathlib.Path('/tmp/genshade-check.'+stage);p.write_text(code)
            result=subprocess.run(['glslangValidator',str(p)],capture_output=True,text=True)
            if result.returncode: errors.append({'file':r['file'],'entry':entry,'stage':stage,'error':result.stdout})
    pathlib.Path('/tmp/genshade-glsl-errors.json').write_text(json.dumps(errors,indent=2))
    print('Shaders',total,'errors',len(errors))
    for r in errors[:20]: print(r['file'],r['entry'],r['error'][:400])
