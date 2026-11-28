import concurrent.futures, hashlib, json, pathlib, urllib.request, urllib.parse, time, os
root=pathlib.Path.cwd()
source="https://xn--c1ajamhiblrj0b.online"
manifest=json.loads((root/".github/journal-migration-manifest.json").read_text())
release=manifest["release"]
def get(path, maxsize):
    url=source+"/"+urllib.parse.quote(path,safe="/")+"?journal_mirror="+release
    req=urllib.request.Request(url,headers={"User-Agent":"NatalyaJournalMirror/1.0","Accept-Encoding":"identity","Cache-Control":"no-cache"})
    with urllib.request.urlopen(req,timeout=45) as res:
        if res.status!=200 or urllib.parse.urlsplit(res.url).netloc!=urllib.parse.urlsplit(source).netloc:
            raise RuntimeError("Unexpected response for "+path)
        data=res.read(maxsize+1)
        if len(data)>maxsize: raise RuntimeError("Oversized response: "+path)
        return data
def marker():
    if get("journal-release.txt",128).decode().strip()!=release: raise RuntimeError("Source release changed")
def sha(data):
    return hashlib.sha1(("blob "+str(len(data))+"\0").encode()+data).hexdigest()
def copy(entry):
    path=entry["path"]
    p=pathlib.PurePosixPath(path)
    if p.is_absolute() or any(x.startswith(".") for x in p.parts): raise RuntimeError("Unsafe path")
    dest=root.joinpath(*p.parts)
    if dest.exists() and sha(dest.read_bytes())==entry["sha"]:return "reused"
    for attempt in range(3):
        try:
            data=get(path,entry["size"])
            if len(data)!=entry["size"] or sha(data)!=entry["sha"]: raise RuntimeError("Hash mismatch: "+path)
            dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_bytes(data)
            return "copied"
        except Exception:
            if attempt==2:raise
            time.sleep(2**attempt)
marker()
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results=list(pool.map(copy,manifest["files"]))
marker()
for entry in manifest["files"]:
    if sha((root/entry["path"]).read_bytes())!=entry["sha"]:raise RuntimeError("Final check failed")
(root/"journal-release.txt").write_text(release+"\n")
(root/".nojekyll").touch()
print("Verified",len(results),"files; copied",results.count("copied"),"reused",results.count("reused"))
