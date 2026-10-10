#!/usr/bin/env python3
import datetime,json,os,pathlib,re,sys,tempfile
registry,flags=map(pathlib.Path,sys.argv[1:3]);version=sys.argv[3];digest=sys.argv[4]
if not re.fullmatch('[0-9a-f]{64}',digest):raise SystemExit('Invalid offer hash')
if registry.exists():
 record=json.loads(registry.read_text())
 if record['version']!=version or record['sha256']!=digest:raise SystemExit('Publication registry belongs to another document')
 published=datetime.datetime.fromisoformat(record['publishedAt'].replace('Z','+00:00'))
 effective=datetime.datetime.fromisoformat(record['effectiveAt'].replace('Z','+00:00'))
 if published.tzinfo is None or published>datetime.datetime.now(datetime.timezone.utc) or effective!=published+datetime.timedelta(days=7):raise SystemExit('Invalid publication window')
else:
 now=datetime.datetime.now(datetime.timezone.utc)
 record={'schema':1,'version':version,'sha256':digest,'publishedAt':now.isoformat(timespec='milliseconds').replace('+00:00','Z'),'effectiveAt':(now+datetime.timedelta(days=7)).isoformat(timespec='milliseconds').replace('+00:00','Z')}
 # The publication identity is retained even after a failed visible release.
 with registry.open('x') as file:json.dump(record,file,indent=2);file.write('\n')
 registry.chmod(0o600)
text=flags.read_text();text='\n'.join(line for line in text.splitlines() if not re.match(r'^\s*(?:export\s+)?NETWORK_PUBLISHED_AT\s*=',line))+'\nNETWORK_PUBLISHED_AT='+record['publishedAt']+'\n'
fd,name=tempfile.mkstemp(dir=flags.parent,prefix=flags.name+'.')
try:
 with os.fdopen(fd,'w') as file:file.write(text)
 os.chmod(name,0o600);os.replace(name,flags)
finally:
 if os.path.exists(name):os.unlink(name)
print(json.dumps(record))
