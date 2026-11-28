"""Synchronize only already-public, hash-verified files from the journal origin."""
import concurrent.futures
import hashlib
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT=pathlib.Path.cwd()
ORIGIN="https://natalya-journal-site.cheloveck4.workers.dev"
MANIFEST=ROOT/".github/journal-migration-manifest.json"
MARKER="journal-release.txt"
REQUIRED={"index.html","articles/index.html","roulette/index.html","sitemap.xml","pinterest.xml","robots.txt","CNAME"}

def get(path, limit, release="manifest"):
    url=ORIGIN+"/"+urllib.parse.quote(path,safe="/")+"?journal_mirror="+release
    req=urllib.request.Request(url,headers={"User-Agent":"NatalyaJournalMirror/1.0","Accept-Encoding":"identity","Cache-Control":"no-cache"})
    with urllib.request.urlopen(req,timeout=45) as res:
        if res.status!=200 or urllib.parse.urlsplit(res.url).netloc!=urllib.parse.urlsplit(ORIGIN).netloc:
            raise RuntimeError("Unexpected response for "+path)
        data=res.read(limit+1)
        if len(data)>limit: raise RuntimeError("Oversized response: "+path)
        return data

def sha(data):
    return hashlib.sha1(("blob "+str(len(data))+"\0").encode()+data).hexdigest()

def validate(m):
    if not re.fullmatch(r"[a-f0-9]{64}",m["release"]):raise ValueError("Invalid release")
    if not 1<=len(m["files"])<=20000:raise ValueError("Invalid file count")
    paths=set()
    for entry in m["files"]:
        path=entry["path"]
        p=pathlib.PurePosixPath(path)
        if (p.is_absolute() or p.as_posix()!=path or any(x.startswith(".") for x in p.parts)
                or path in (MARKER,"journal-mirror.json") or "\\" in path
                or path in paths or not re.fullmatch(r"[a-f0-9]{40}",entry["sha"])
                or not isinstance(entry["size"],int) or not 0<=entry["size"]<=25*1024**2):
            raise ValueError("Unsafe manifest entry: "+path)
        paths.add(path)
    if not REQUIRED<=paths:raise ValueError("Required website paths missing")
    if sum(e["size"] for e in m["files"])>900*1024**2:raise ValueError("Pages site size limit")
    return paths

def sync():
    old=json.loads(MANIFEST.read_text())
    oldpaths=validate(old)
    current=json.loads(get("journal-mirror.json",8*1024**2))
    paths=validate(current)
    release=current["release"]
    def marker():
        if get(MARKER,128,release).decode().strip()!=release:raise RuntimeError("Source release changed")
    def copy(entry):
        path=entry["path"]; dest=ROOT/path
        if dest.exists() and sha(dest.read_bytes())==entry["sha"]:return "reused"
        for attempt in range(3):
            try:
                data=get(path,entry["size"],release)
                if len(data)!=entry["size"] or sha(data)!=entry["sha"]:raise RuntimeError("Hash mismatch: "+path)
                dest.parent.mkdir(parents=True,exist_ok=True)
                dest.write_bytes(data)
                return "copied"
            except Exception:
                if attempt==2:raise
                time.sleep(2**attempt)
    marker()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results=list(pool.map(copy,current["files"]))
    marker()
    for entry in current["files"]:
        if sha((ROOT/entry["path"]).read_bytes())!=entry["sha"]:raise RuntimeError("Final verification failed")
    if (ROOT/"CNAME").read_text().strip()!="xn--c1ajamhiblrj0b.online":raise RuntimeError("Unexpected domain")
    for path in oldpaths-paths:
        (ROOT/path).unlink(missing_ok=True)
    (ROOT/MARKER).write_text(release+"\n")
    (ROOT/".nojekyll").touch()
    MANIFEST.write_text(json.dumps(current,ensure_ascii=False,indent=1)+"\n")
    print("Verified",len(results),"files; copied",results.count("copied"),"reused",results.count("reused"),"release",release)

if __name__=="__main__":sync()

# 2026-11-28: sync owner-authorized recipe photo repair.
