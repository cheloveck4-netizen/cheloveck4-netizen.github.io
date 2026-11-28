"""Verify old candidate photos against licensed Wikimedia originals. Fail closed."""
import hashlib, html, io, json, pathlib, re, sys, time, urllib.parse, urllib.request, urllib.error
from PIL import Image, ImageOps
import numpy as np
ROOT=pathlib.Path("verified-recipe-photos")
ROOT.mkdir(exist_ok=True)
UA="NatalyaRecipePhotoReview/1.0 (https://github.com/cheloveck4-netizen/cheloveck4-netizen.github.io; Wikimedia photo attribution verification)"
HOSTS=("commons.wikimedia.org","upload.wikimedia.org","thumb.wikimedia.org","theunitools.com")
def request(url,limit=20*1024*1024):
    if urllib.parse.urlsplit(url).hostname not in HOSTS:raise ValueError("Unapproved host")
    req=urllib.request.Request(url,headers={"User-Agent":UA})
    for i in range(3):
        try:
            with urllib.request.urlopen(req,timeout=18) as r:
                if urllib.parse.urlsplit(r.url).hostname not in HOSTS:raise ValueError("Unapproved redirect")
                data=r.read(limit+1)
                if len(data)>limit:raise ValueError("File too large")
                return data
        except urllib.error.HTTPError as e:
            if e.code not in (429,502,503,504) or i==2:raise
            time.sleep(8*(i+1))
def clean(s):return html.unescape(re.sub(r"<[^>]*>","",s)).strip()
def norm(s):return re.sub(r"\W+"," ",s.casefold()).strip()
def image(b):return ImageOps.exif_transpose(Image.open(io.BytesIO(b))).convert("RGB")
def compare(a,b):
    ratio=a.width/a.height
    target=(max(8,int(96*ratio)),96) if ratio<=1 else (96,max(8,int(96/ratio)))
    x=np.asarray(a.resize(target,Image.Resampling.LANCZOS),dtype=np.float32).reshape(-1)
    best=(-1,999)
    for centering in ((.5,.5),(.5,0),(.5,1),(0,.5),(1,.5)):
        y=np.asarray(ImageOps.fit(b,target,Image.Resampling.LANCZOS,centering=centering),dtype=np.float32).reshape(-1)
        if x.std()<8 or y.std()<8:continue
        corr=float(np.corrcoef(x,y)[0,1]);mae=float(np.abs(x-y).mean())
        if corr>best[0]:best=(corr,mae)
    return best
def candidates(term):
    q=urllib.parse.urlencode({"action":"query","generator":"search","gsrsearch":term,"gsrnamespace":6,"gsrlimit":12,"prop":"imageinfo","iiprop":"url|extmetadata|sha1","iiurlwidth":480,"format":"json","formatversion":"2"})
    return json.loads(request("https://commons.wikimedia.org/w/api.php?"+q)).get("query",{}).get("pages",[])
rows=json.loads(pathlib.Path(".github/recipe-photo-candidates.json").read_text())
part=int(sys.argv[1])
out={};results={}
for row in rows[part::5]:
    ident=row["id"]
    try:
        url=row["candidate"]
        if urllib.parse.urlsplit(url).hostname!="theunitools.com":raise ValueError("No direct candidate image")
        a=image(request(url))
        slug=urllib.parse.unquote(pathlib.PurePosixPath(urllib.parse.urlsplit(url).path).stem)
        term=slug.replace("-"," ");author=row["author"];matched=None;seen=set()
        for query in ('"'+term+'" "'+author+'"','"'+term+'"'):
            for page in candidates(query):
                if page.get("pageid") in seen:continue
                seen.add(page.get("pageid"));ii=page.get("imageinfo",[])
                if not ii:continue
                info=ii[0];meta=info.get("extmetadata",{})
                actual=clean(meta.get("Artist",{}).get("value",""))
                lic=clean(meta.get("LicenseShortName",{}).get("value",""))
                link=meta.get("LicenseUrl",{}).get("value","").replace("http://","https://",1)
                if not norm(author) or norm(author) not in norm(actual):continue
                if lic.casefold()!=row["license"].casefold():continue
                if not re.fullmatch(r"https://creativecommons\.org/(licenses/by(-sa)?/[234]\.0|publicdomain/zero/1\.0)/?",link):continue
                try:corr,mae=compare(a,image(request(info.get("thumburl",info["url"]))))
                except Exception:continue
                if corr>=.985 and mae<=12:matched=(info,lic,link);break
            if matched:break
            time.sleep(1.5)
        if matched is None:raise ValueError("No original matches strict pixel/credit/license checks")
        info,lic,link=matched
        original=image(request(info["url"]))
        corr,mae=compare(a,original)
        if corr<.985 or mae>12:raise ValueError("Original failed pixel check")
        original.thumbnail((720,720),Image.Resampling.LANCZOS)
        dest=ROOT/(ident+".webp");original.save(dest,"WEBP",quality=82,method=6)
        out[ident]={"file":dest.name,"sha256":hashlib.sha256(dest.read_bytes()).hexdigest(),"credit":author,"creditUrl":info["descriptionurl"],"license":lic,"licenseUrl":link,"width":original.width,"height":original.height,"original":info["url"],"review":"matched-original","contentMatch":True,"pixelCorrelation":round(corr,5),"meanAbsoluteDifference":round(mae,3)}
        results[ident]="verified"
        print("VERIFIED",ident,round(corr,5),round(mae,3),flush=True)
    except Exception as e:
        results[ident]=str(e)[:180];print("SKIP",ident,repr(e),flush=True)
    time.sleep(1.5)
(ROOT/f"manifest-part-{part}.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n")
(ROOT/f"review-part-{part}.json").write_text(json.dumps(results,ensure_ascii=False,indent=2)+"\n")
print("Confirmed",len(out),"of",len(results),flush=True)
