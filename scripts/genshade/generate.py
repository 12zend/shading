"""Compile every bundled FX file and regenerate the built-in catalog, without silently skipping errors."""
import json,pathlib,subprocess,sys,re,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
source=ROOT/'static/genshade/Shaders'
compiler=sys.argv[1] if len(sys.argv)>1 else '/tmp/genshade-fxc'
modules={};catalog=[];used=set();results=[]
manifest=json.loads((ROOT/'scratch-vm/src/lib/pen-fx/default-shader-package/shading-shader.json').read_text())
used.update(b['name'].casefold() for b in manifest['blocks'])
for p in sorted(source.rglob('*.fx')):
    rel=p.relative_to(source).as_posix();out=pathlib.Path('/tmp/genshade-modules')/(hashlib.sha1(rel.encode()).hexdigest()+'.json')
    out.parent.mkdir(exist_ok=True)
    r=subprocess.run([compiler,str(p),str(source),str(out)],capture_output=True,text=True)
    results.append({'file':rel,'module':str(out),'ok':r.returncode==0,'error':r.stderr})
    if r.returncode: print(r.stderr);sys.exit(1)
    m=json.loads(out.read_text());m.pop('code',None);modules[rel]=m
    for technique in m['techniques']:
        original=technique['annotations'].get('ui_label') or technique['name']
        name=original
        if name.casefold() in used: name=f'{original} — {p.parent.name if p.parent!=source else "Genshade"}'
        serial=2;base=name
        while name.casefold() in used: name=f'{base} {serial}';serial+=1
        used.add(name.casefold())
        slug=re.sub('[^a-z0-9]+','-',f'{rel[:-3]}-{technique["name"]}'.lower()).strip('-')
        key='genshade-'+slug
        if len(key)>48: key=key[:35]+'-'+hashlib.sha1(key.encode()).hexdigest()[:12]
        catalog.append({'id':key,'name':name,'file':rel,'technique':technique['name'],
            'parameters':[{k:u[k] for k in ['name','type','rows','cols','value','annotations']} for u in m['uniforms'] if not u['annotations'].get('source')]})
(ROOT/'static/genshade/modules.json').write_text(json.dumps(modules,separators=(',',':')))
(ROOT/'static/genshade/sources.json').write_text(json.dumps({p.relative_to(source).as_posix():p.read_text() for p in sorted(source.rglob('*')) if p.suffix.lower() in ['.fx','.fxh']},separators=(',',':')))
(ROOT/'scratch-render/src/pen-fx/genshade/catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
pathlib.Path('/tmp/genshade-compile-results.json').write_text(json.dumps(results,indent=2))
print(f'{len(modules)} FX files, {len(catalog)} techniques. No compilation failures.')
