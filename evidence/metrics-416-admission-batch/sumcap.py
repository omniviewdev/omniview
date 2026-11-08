import json,sys,glob,os
d=os.path.expanduser('~/.omniview-dev/profiles/93e1a28f-8f10-457b-8576-966d15613691/state/diagnostics/captures/')
def load(i): return json.load(open(d+i+'.json'))
def delta(c):
    s=c['samples']; out={}
    for key,idx in (('first',0),('last',-1)): pass
    a,b=s[0],s[-1]
    def idxs(x):
        o={}
        for m in x['metrics']:
            if not (m['name'].startswith('omniview.metric.pipeline') or m['name'].startswith('omniview.plugin.process') or m['name'].startswith('omniview.resource') or m['name'].startswith('omniview.operation') or m['name'].startswith('rpc.')): continue
            for p in m['points']:
                o[(m['name'],m['kind'],json.dumps(p['attributes'],sort_keys=True))]=p
        return o
    ia,ib=idxs(a),idxs(b)
    for k,p in sorted(ib.items()):
        q=ia.get(k)
        if k[1]=='gauge': print('  G',k[0],k[2],p['value']); continue
        if k[1]=='histogram':
            dc=p['count']-(q['count'] if q else 0); ds=p['sum']-(q['sum'] if q else 0)
            print('  H',k[0],k[2],'count',dc,'sum',round(ds,1),'mean',round(ds/dc,1) if dc else 0)
        else:
            dv=p['value']-(q['value'] if q else 0)
            print('  C',k[0],k[2],dv)
if __name__=='__main__':
    for i in sys.argv[1:]:
        c=load(i); print(c['name'],c['status'],round(c['elapsedSeconds'],1)); delta(c)
