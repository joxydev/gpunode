#!/usr/bin/env python3
"""Publish one current edition; retain publication identities and the program origin."""
import datetime,json,os,pathlib,re,sys,tempfile
registry,flags=map(pathlib.Path,sys.argv[1:3]);version,digest=sys.argv[3:5]
if not re.fullmatch('[0-9a-f]{64}',digest):raise SystemExit('Invalid offer hash')
now=datetime.datetime.now(datetime.timezone.utc)
def instant(text):
 value=datetime.datetime.fromisoformat(text.replace('Z','+00:00'))
 if value.tzinfo is None or value>now:raise SystemExit('Invalid publication timestamp')
 return value
previous=None
if registry.exists():
 previous=json.loads(registry.read_text());published=instant(previous['publishedAt']);effective=instant(previous['effectiveAt']) if previous.get('schema')==2 else datetime.datetime.fromisoformat(previous['effectiveAt'].replace('Z','+00:00'))
 expected=published if previous.get('schema')==2 else published+datetime.timedelta(days=7)
 if effective!=expected:raise SystemExit('Invalid publication window')
 if previous['version']==version:
  if previous['sha256']!=digest:raise SystemExit('Publication hash changed')
  if previous.get('schema')!=2:raise SystemExit('A new edition is required for immediate effectiveness')
  record=previous
 elif previous['version']=='88-2026-AI-NETWORK-2026-10-10' and previous['sha256']=='acd5ee451e7b2d609f797c81520e2b87c87d96760f94a377401db54301a93792' and version=='88-2026-AI-NETWORK-2026-10-10-R2':
  stamp=now.isoformat(timespec='milliseconds').replace('+00:00','Z')
  record={'schema':2,'version':version,'sha256':digest,'publishedAt':stamp,'effectiveAt':stamp,'programStartedAt':previous.get('programStartedAt',previous['publishedAt']),'history':previous.get('history',[])+[previous]}
 else:raise SystemExit('Publication registry belongs to another document')
else:
 stamp=now.isoformat(timespec='milliseconds').replace('+00:00','Z')
 record={'schema':2,'version':version,'sha256':digest,'publishedAt':stamp,'effectiveAt':stamp,'programStartedAt':stamp,'history':[]}
if instant(record['programStartedAt'])>instant(record['publishedAt']):raise SystemExit('Invalid program origin')
def atomic(path,text):
 fd,name=tempfile.mkstemp(dir=path.parent,prefix=path.name+'.')
 try:
  with os.fdopen(fd,'w') as file:file.write(text)
  os.chmod(name,0o600);os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)
if record!=previous:atomic(registry,json.dumps(record,indent=2)+'\n')
text='\n'.join(line for line in flags.read_text().splitlines() if not re.match(r'^\s*(?:export\s+)?NETWORK_(?:PUBLISHED_AT|PROGRAM_STARTED_AT)\s*=',line))+'\nNETWORK_PUBLISHED_AT='+record['publishedAt']+'\nNETWORK_PROGRAM_STARTED_AT='+record['programStartedAt']+'\n'
atomic(flags,text)
print(json.dumps(record))
