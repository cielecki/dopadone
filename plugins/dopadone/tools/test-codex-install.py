import subprocess,sys,json,os,selectors,time,tempfile,shutil
from pathlib import Path

def requests(home,cwd,queries):
 env=dict(os.environ,CODEX_HOME=str(home))
 p=subprocess.Popen([os.environ.get('CODEX_BINARY') or shutil.which('codex'),'app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,env=env,cwd=cwd,bufsize=1)
 def send(obj):p.stdin.write(json.dumps(obj)+'\n');p.stdin.flush()
 def recv(want):
  sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ)
  end=time.monotonic()+25
  while time.monotonic()<end:
   if not sel.select(max(0,end-time.monotonic())):break
   line=p.stdout.readline()
   if not line:raise RuntimeError('app-server exited')
   obj=json.loads(line)
   if obj.get('id')==want:return obj
  raise TimeoutError(want)
 try:
  send({'id':1,'method':'initialize','params':{'clientInfo':{'name':'migration-verifier','version':'1.0'},'capabilities':{'experimentalApi':True}}});recv(1)
  send({'method':'initialized','params':{}})
  results=[]
  for i,(method,params) in enumerate(queries,2):
   send({'id':i,'method':method,'params':params});results.append(recv(i))
  return results
 finally:
  p.terminate()
  try:p.wait(timeout=3)
  except subprocess.TimeoutExpired:p.kill();p.wait()

if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[3]
    binary = os.environ.get("CODEX_BINARY") or shutil.which("codex")
    if not binary:
        raise SystemExit("Install Codex CLI first, or set CODEX_BINARY")
    with tempfile.TemporaryDirectory(prefix="dopadone-codex-test-") as tmp:
        home = Path(tmp)
        env = dict(os.environ, CODEX_HOME=tmp)
        for args in [["plugin","marketplace","add",str(repo)], ["plugin","add","dopadone@dopadone","--json"]]:
            result = subprocess.run([binary,*args],env=env,cwd=tmp,text=True,capture_output=True,check=True)
        results = requests(home,tmp,[("skills/list",{"cwds":[tmp],"forceReload":True}),("hooks/list",{"cwds":[tmp]})])
        for result in results:
            assert "error" not in result, result
            for row in result["result"]["data"]:
                assert not row.get("errors"), row
                assert not row.get("warnings"), row
        skills = [skill for row in results[0]["result"]["data"] for skill in row["skills"] if skill.get("pluginId")=="dopadone@dopadone"]
        assert len(skills)==1 and skills[0]["name"]=="dopadone:do" and skills[0]["enabled"], skills
        assert all(not row["hooks"] for row in results[1]["result"]["data"]), results[1]
        print("PASS: clean native install, exactly one enabled do skill, no inherited hooks or warnings")
