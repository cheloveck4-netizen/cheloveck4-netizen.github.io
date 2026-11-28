export const wrap=(i,n)=>((i%n)+n)%n;
export const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
export const SPIN_MS=4500;
export const MIN_SPIN_STEPS=42;
export function planSpin(n,current,rng=Math.random){
 if(!Number.isInteger(n)||n<2)return {steps:0,target:0};
 const delta=1+Math.min(n-2,Math.floor(clamp(rng(),0,.999999999)*(n-1)));
 const target=wrap(current+delta,n);
 // Equal chance for every different dish; full turns keep the selected outcome exact.
 const steps=delta+Math.max(0,Math.ceil((MIN_SPIN_STEPS-delta)/n))*n;
 return {steps,target};
}
export function pose(pos){
 const a=Math.abs(pos);
 return {scale:Math.max(.50,1-.20*a),angle:clamp(-pos*13,-35,35),opacity:clamp((3.6-a)*.65,0,1),z:100-Math.round(a*20)};
}
// Smooth velocity ramp, cruise, and a long braking tail; position is its integral.
export function spinEase(t){
 t=clamp(t,0,1);
 const ramp=.14,cruise=.30,brake=1-ramp-cruise;
 const area=ramp/2+cruise+brake/2;
 const integral=x=>x*x*x-.5*x*x*x*x;
 if(t<ramp)return ramp*integral(t/ramp)/area;
 if(t<ramp+cruise)return (ramp/2+t-ramp)/area;
 const x=(t-ramp-cruise)/brake;
 return (ramp/2+cruise+brake*(x-integral(x)))/area;
}
export function dragTarget(position,velocity,start){
 const v=clamp(velocity,-.035,.035);
 let target=Math.round(position+clamp(v*370,-12,12));
 if(target===Math.round(start)&&Math.abs(position-start)>.15)target=Math.round(start)+Math.sign(position-start);
 return target;
}
export function settleEase(t){return 1-Math.pow(1-clamp(t,0,1),3);}

// A fixed circular set for a small catalogue. Wrap only where both ends are invisible.
export function ringCount(n){return n>=2&&n<=5?Math.ceil(9/n)*n:0;}
export function ringOffset(slot,position,count){return wrap(slot-position+count/2,count)-count/2;}
export function ringStyle(offset,step){
 if(Math.abs(offset)<1e-9)offset=0;
 const p=pose(offset);
 return {transform:"translate3d(calc(-50% + "+(offset*step).toFixed(2)+"px),-50%,"+(-Math.abs(offset)*24).toFixed(2)+"px) scale("+p.scale.toFixed(4)+") rotateY("+p.angle.toFixed(2)+"deg)",opacity:Number(p.opacity.toFixed(4))};
}
export function inverseSpinEase(x){
 if(x<=0)return 0;if(x>=1)return 1;
 let lo=0,hi=1;for(let k=0;k<25;k++){const mid=(lo+hi)/2;if(spinEase(mid)<x)lo=mid;else hi=mid;}
 return (lo+hi)/2;
}
// Keyframes are prepared once. Native animation interpolates transforms without DOM updates.
export function ringFrames(count,from,to,step){
 const frames=Array.from({length:count},()=>[]);
 const segments=Math.max(1,Math.ceil(Math.abs(to-from)));
 const styles=new Map();
 for(let i=0;i<=segments;i++){
  const f=i/segments,time=inverseSpinEase(f),pos=from+(to-from)*i/segments;
  for(let slot=0;slot<count;slot++){
   const offset=ringOffset(slot,pos,count);
   if(!styles.has(offset))styles.set(offset,ringStyle(offset,step));
   frames[slot].push({offset:time,...styles.get(offset)});
  }
 }
 return frames;
}

// Center the cached geometry on slot zero and reuse it for any starting index.
const geometryCache = new Map();
export function nativeTracks(count, from, to, step) {
 const start = Math.round(from);
 if (Math.abs(from - start) > .001) return ringFrames(count, from, to, step);
 const distance = to - start;
 const key = [count, distance, step].join(':');
 if (!geometryCache.has(key)) {
  if (geometryCache.size >= 8) geometryCache.delete(geometryCache.keys().next().value);
  geometryCache.set(key, ringFrames(count, 0, distance, step));
 }
 const geometry = geometryCache.get(key);
 return geometry.map((_, slot) => geometry[wrap(slot - start, count)]);
}

// The logical catalogue is independent of the nine rendered slots.
export function prepareReel(pool) { return [...pool]; }

// Pure draw: do not consume a result until the animation actually completes.
export function drawUnseen(pool, seen, currentId, rng = Math.random) {
  if (!pool.length) return null;
  let candidates = pool.filter(row => !seen.has(row.id));
  const reset = !candidates.length || (pool.length > 1 && candidates.length === 1 &&
    candidates[0].id === currentId);
  if (reset) candidates = [...pool];
  const different = candidates.filter(row => row.id !== currentId);
  if (different.length) candidates = different;
  return { row: candidates[Math.floor(clamp(rng(),0,.999999999)*candidates.length)], reset };
}

export function spinTo(count, current, target) {
  if (count < 2) return 0;
  const delta = wrap(target-current,count);
  return delta + Math.max(0,Math.ceil((MIN_SPIN_STEPS-delta)/count))*count;
}
