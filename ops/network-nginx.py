#!/usr/bin/env python3
"""Add explicit retired-document responses inside the existing app server only."""
import pathlib,re,sys,json,os
backup=pathlib.Path(sys.argv[1]);root='/srv/apps/gpunode/current/frontend/dist'
old=['public-offer-aethermind.pdf','public-offer-aethermind-2026-09-21.pdf','public-offer-aethermind-2026-09-30-trc-bep.pdf','public-offer-aethermind-ton-2026-10-07.pdf','public-offer-aethermind-network-2026-10-10.pdf']
block='\n    # BEGIN AETHERMIND NETWORK DOCUMENTS\n'+''.join('    location = /documents/'+name+' { return 410; }\n' for name in old)+'    location ^~ /contracts/ { return 404; }\n    # END AETHERMIND NETWORK DOCUMENTS\n'
seen=set();changed=[]
for entry in sorted((pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else pathlib.Path('/etc/nginx/sites-enabled')).glob('*')):
 file=entry.resolve()
 if file in seen or not file.is_file():continue
 seen.add(file);text=file.read_text()
 # A small lexer locates server ranges, preserving unrelated hosts and directives.
 stack=[];servers=[];quote=None;comment=False;escaped=False;token=''
 for i,ch in enumerate(text):
  if comment:
   if ch=='\n':comment=False
   continue
  if quote:
   if escaped:escaped=False
   elif ch=='\\':escaped=True
   elif ch==quote:quote=None
   continue
  if ch=='#':comment=True;continue
  if ch in "\"'":quote=ch;continue
  if ch=='{':stack.append((i,token.strip()));token=''
  elif ch=='}':
   if not stack:raise SystemExit('Unbalanced nginx braces')
   start,name=stack.pop()
   if name=='server':servers.append((start,i))
   token=''
  elif ch==';':token=''
  else:token+=ch
 edits=[]
 for start,end in servers:
  content=text[start+1:end]
  if not re.search(r'\broot\s+'+re.escape(root)+r'\s*;',content):continue
  cleaned=re.sub(r'\n\s*# BEGIN AETHERMIND NETWORK DOCUMENTS.*?# END AETHERMIND NETWORK DOCUMENTS\s*\n','\n',content,flags=re.S)
  if any(re.search(r'location\s*=\s*/documents/'+re.escape(name)+r'\b',cleaned) for name in old):raise SystemExit('Existing document location requires explicit configuration reconciliation')
  edits.append((start+1,end,block+cleaned))
 if not edits:continue
 original=backup/('nginx-'+str(len(changed))+'.conf');original.write_text(text);original.chmod(0o600)
 for start,end,value in sorted(edits,reverse=True):text=text[:start]+value+text[end:]
 changed.append({'path':str(file),'backup':str(original)});(backup/'nginx-changes.json').write_text(json.dumps(changed));file.write_text(text)
(backup/'nginx-changes.json').write_text(json.dumps(changed));
if not changed:raise SystemExit('App nginx root was not found; no unrelated configuration changed')
print('Nginx: current app root, private archive guard and retired PDF 410 configured')
