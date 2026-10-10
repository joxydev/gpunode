#!/usr/bin/env python3
"""Execute with literal protected environment values; never evaluate shell text."""
import os,pathlib,re,subprocess,sys
args=sys.argv[1:];release=pathlib.Path(args.pop(0)).resolve();env=os.environ.copy()
while args and args[0]!='--':
 file=pathlib.Path(args.pop(0))
 for line in file.read_text().splitlines():
  line=line.strip()
  if not line or line.startswith('#'):continue
  match=re.fullmatch(r'(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)',line)
  if not match:raise SystemExit('Invalid runtime assignment')
  value=match[2]
  if len(value)>=2 and value[0]==value[-1] and value[0] in "\"'":value=value[1:-1]
  if '\x00' in value:raise SystemExit('Invalid runtime value')
  env[match[1]]=value
if not args or args.pop(0)!='--' or not args:raise SystemExit('Command required')
# Credentials remain in the child environment; captured failures are redacted.
result=subprocess.run(args,cwd=release,env=env,capture_output=True,text=True)
output=result.stdout+result.stderr
for key,value in sorted(env.items(),key=lambda x:len(x[1]),reverse=True):
 if len(value)>=6 and re.search(r'SECRET|TOKEN|KEY|PASSWORD|DATABASE_URL',key):output=output.replace(value,'[REDACTED]')
output=re.sub(r'postgres(?:ql)?://[^\s\"\']+','[DATABASE_URL]',output)
print(output,end='');raise SystemExit(result.returncode)
