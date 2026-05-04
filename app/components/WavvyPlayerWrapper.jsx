"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { updateProgress, getProgress } from "../lib/crypto";

const PEACH_API = "/api/peach";
const TMDB_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY || "5263089f83877823a641b104f4f8d041";
// Provider order: videasy first (primary), then moviebox, then piexe fallback
const ALL_PROVIDERS=["videasy","moviebox","piexe"];
const PCOL={"piexe":"#f59e0b","moviebox":"#10b981","videasy":"#8b5cf6"};
const fmt=(t)=>{if(!isFinite(t)||isNaN(t))return"0:00";const s=Math.floor(t%60),m=Math.floor((t/60)%60),h=Math.floor(t/3600);const p=n=>String(n).padStart(2,"0");return h?`${h}:${p(m)}:${p(s)}`:`${m}:${p(s)}`;}

// Each fetcher returns { provider, sources:[{url,type,label,dub?,quality?}] }
async function fetchMoviebox(type,id,season,episode){
  const path=type==="movie"?`${PEACH_API}/moviebox/movie/${id}`:`${PEACH_API}/moviebox/tv/${id}/season/${season}/episode/${episode}`;
  const d=await fetch(path).then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.json();});
  if(!d.sources?.length)throw new Error("MB_NO_SOURCES");
  const sorted=[...d.sources].sort((a,b)=>{
    if(a.dub==="English"&&b.dub!=="English")return -1;
    if(b.dub==="English"&&a.dub!=="English")return 1;
    return (b.quality||0)-(a.quality||0);
  });
  return{provider:"moviebox",sources:sorted.map(s=>({url:s.url,type:(s.url.includes('.m3u8')?"hls":(s.type||"mp4")),dub:s.dub||"Original",quality:s.quality||0,label:[s.quality&&`${s.quality}p`,s.dub&&s.dub!=="Original"?s.dub:null].filter(Boolean).join(" ")||"Default"}))};
}
async function fetchVideasy(type,id,season,episode){
  const p=new URLSearchParams({id,type});
  if(season){p.set("season",season);p.set("ep",episode);}
  const d=await fetch(`/api/videasy?${p}`).then(r=>{if(!r.ok)throw new Error("VD_"+r.status);return r.json();});
  if(!d.sources?.length)throw new Error(d.error||"VD_NO_SOURCES");
  return{provider:"videasy",sources:d.sources.map(s=>({url:s.url,type:"hls",label:s.label||"Default"}))};
}
async function fetchPiexe(type,id,season,episode){
  const p=new URLSearchParams({id,type});
  if(season){p.set("season",season);p.set("ep",episode);}
  const d=await fetch(`/api/piexe?${p}`).then(r=>{if(!r.ok)throw new Error("PX_"+r.status);return r.json();});
  if(!d.sources?.length)throw new Error(d.error||"PX_NO_SOURCES");
  return{provider:"piexe",sources:d.sources.map(s=>({url:s.url,type:"hls",label:s.label||"Default"}))};
}
const FETCHERS={moviebox:fetchMoviebox,videasy:fetchVideasy,piexe:fetchPiexe};

// ── Server definitions — each maps to a dub/provider combination ──────────────────
const SERVERS=[
  {id:"en-vd",cc:"gb",name:"Hexa",   provider:"videasy", dub:null,              dubLabel:"Original audio"},
  {id:"en-mb",cc:"us",name:"Orbit",  provider:"moviebox",dub:["English","Original"],dubLabel:"Original audio"},
  {id:"hi-px",cc:"in",name:"Delta",  provider:"piexe",   dub:null,              dubLabel:"Hindi audio"},
  {id:"hi-mb",cc:"in",name:"Flux",   provider:"moviebox",dub:["Hindi"],          dubLabel:"Hindi audio"},
  {id:"fr-mb",cc:"fr",name:"Gama",   provider:"moviebox",dub:["French"],         dubLabel:"French audio"},
  {id:"pt-mb",cc:"pt",name:"Nova",   provider:"moviebox",dub:["Portuguese","Brazil"],dubLabel:"Portuguese audio"},
  {id:"jp-mb",cc:"jp",name:"Sakura", provider:"moviebox",dub:["Japanese"],       dubLabel:"Japanese audio"},
  {id:"ar-mb",cc:"sa",name:"Zara",   provider:"moviebox",dub:["Arabic"],          dubLabel:"Arabic audio"},
  {id:"ru-mb",cc:"ru",name:"Storm",  provider:"moviebox",dub:["Russian"],         dubLabel:"Russian audio"},
];

// Resolve a server → { available, source }
function resolveServer(srv,allSources){
  const cached=allSources[srv.provider];
  const srcs=cached ? cached.sources : [];
  if(!srcs.length)return{available:false,source:null};
  if(srv.dub===null){return{available:true,source:srcs[0]};}
  const match=srcs.find(s=>srv.dub.some(d=>(s.dub||"Original").toLowerCase().includes(d.toLowerCase())));
  return{available:!!match,source:match||null};
}

// ── Rose Curve Spinner ───────────────────────────────────────────────────
const RC={particleCount:78,trailSpan:0.32,durationMs:5400,rotationDurationMs:28000,
  pulseDurationMs:4600,strokeWidth:4.5,roseA:9.2,roseABoost:0.6,roseBreathBase:0.72,
  roseBreathBoost:0.28,roseK:5,roseScale:3.25};
function RoseCurveSpinner({size=72}){
  const ref=useRef(null);
  useEffect(()=>{
    const svg=ref.current;if(!svg)return;
    const NS="http://www.w3.org/2000/svg";
    const g=document.createElementNS(NS,"g");
    const p=document.createElementNS(NS,"path");
    p.setAttribute("stroke","currentColor");p.setAttribute("stroke-linecap","round");
    p.setAttribute("stroke-linejoin","round");p.setAttribute("opacity","0.15");
    p.setAttribute("fill","none");p.setAttribute("stroke-width",String(RC.strokeWidth));
    g.appendChild(p);
    const dots=Array.from({length:RC.particleCount},()=>{
      const c=document.createElementNS(NS,"circle");c.setAttribute("fill","currentColor");
      g.appendChild(c);return c;
    });
    svg.appendChild(g);
    const norm=v=>((v%1)+1)%1;
    const ds=t=>0.52+((Math.sin((t%RC.pulseDurationMs)/RC.pulseDurationMs*Math.PI*2+0.55)+1)/2)*0.48;
    const pt=(prog,scale)=>{const t=prog*Math.PI*2,a=RC.roseA+scale*RC.roseABoost,r=a*(RC.roseBreathBase+scale*RC.roseBreathBoost)*Math.cos(RC.roseK*t);return{x:50+Math.cos(t)*r*RC.roseScale,y:50+Math.sin(t)*r*RC.roseScale};};
    const buildPath=scale=>{const n=480;return Array.from({length:n+1},(_,i)=>{const q=pt(i/n,scale);return`${i===0?"M":"L"} ${q.x.toFixed(2)} ${q.y.toFixed(2)}`;}).join(" ");};
    const t0=performance.now();let raf;
    const render=now=>{
      const t=now-t0,prog=(t%RC.durationMs)/RC.durationMs,scale=ds(t),rot=-((t%RC.rotationDurationMs)/RC.rotationDurationMs)*360;
      g.setAttribute("transform",`rotate(${rot} 50 50)`);
      p.setAttribute("d",buildPath(scale));
      dots.forEach((node,i)=>{const off=i/(RC.particleCount-1),q=pt(norm(prog-off*RC.trailSpan),scale),fade=Math.pow(1-off,0.56);
        node.setAttribute("cx",q.x.toFixed(2));node.setAttribute("cy",q.y.toFixed(2));
        node.setAttribute("r",(0.9+fade*2.7).toFixed(2));node.setAttribute("opacity",(0.04+fade*0.96).toFixed(3));});
      raf=requestAnimationFrame(render);
    };
    raf=requestAnimationFrame(render);
    return()=>{cancelAnimationFrame(raf);try{svg.removeChild(g);}catch{}};
  },[]);
  return <svg ref={ref} viewBox="0 0 100 100" width={size} height={size} style={{color:"#fff",overflow:"visible"}} aria-hidden="true"/>;
}

export default function WavvyPlayerWrapper({type,id,season,episode}){
  const containerRef=useRef(null),videoRef=useRef(null),hlsRef=useRef(null);
  const hideRef=useRef(null),progRef=useRef(null);
  // ── Refs (always-current, no stale closures) ──────────────────────────────
  const loadJobRef=useRef(null);
  const provCacheRef=useRef({});
  const failedRef=useRef(new Set());
  const activeProvRef=useRef(null);
  const mediaRef=useRef({type,id,season,episode});
  useEffect(()=>{mediaRef.current={type,id,season,episode};},[type,id,season,episode]);

  // ── UI State ──────────────────────────────────────────────────────────────
  const [loading,setLoading]=useState(true);
  const [err,setErr]=useState(null);
  const [switchMsg,setSwitchMsg]=useState(null);
  const [buffering,setBuffering]=useState(false);
  const [isPlaying,setIsPlaying]=useState(false);
  const [cur,setCur]=useState(0);
  const [dur,setDur]=useState(0);
  const [buf,setBuf]=useState(0);
  const [vol,setVol]=useState(1);
  const [muted,setMuted]=useState(false);
  const [fs,setFs]=useState(false);
  const [showCtrl,setShowCtrl]=useState(true);
  const [showMenu,setShowMenu]=useState(false);
  const [showSettings,setShowSettings]=useState(false);
  const [settSect,setSettSect]=useState(null);
  const [speed,setSpeedState]=useState("1");
  const [subs,setSubs]=useState([]);
  const [activeSub,setActiveSub]=useState(null);
  const [cues,setCues]=useState([]);
  const [hlsLevels,setHlsLevels]=useState([]);
  const [hlsCurrentLevel,setHlsCurrentLevel]=useState(-1);
  const [poster,setPoster]=useState(null);
  const [activeProv,setActiveProv]=useState(null);
  const [activeSource,setActiveSource]=useState(null);
  const [allSources,setAllSources]=useState({});
  const [srcType,setSrcType]=useState(null);

  useEffect(()=>{
    fetch(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}`)
      .then(r=>r.json()).then(d=>{if(d.backdrop_path)setPoster(`https://image.tmdb.org/t/p/w1280${d.backdrop_path}`);})
      .catch(()=>{});
  },[type,id]);

  useEffect(()=>{
    if(!id)return;
    setSubs([]);setActiveSub(null);
    const params=new URLSearchParams({id});
    if(season&&episode){params.set('season',season);params.set('episode',episode);}
    fetch(`/api/subs?${params}`).then(r=>r.ok?r.json():[])
      .then(data=>{if(Array.isArray(data)&&data.length>0){setSubs(data);console.log(`[VidzenPlayer] Loaded ${data.length} subtitle track(s)`);}})
      .catch(()=>{});
  },[type,id,season,episode]);


  // ── Core imperative loader ─────────────────────────────────────────────────
  const playSource=useCallback((url,type_,prov,srcObj)=>{
    const v=videoRef.current;if(!v)return;
    const job={cancelled:false};
    if(loadJobRef.current)loadJobRef.current.cancelled=true;
    loadJobRef.current=job;
    if(hlsRef.current){hlsRef.current.destroy();hlsRef.current=null;}
    v.pause();v.removeAttribute('src');v.load();
    setHlsLevels([]);setHlsCurrentLevel(-1);setBuffering(false);
    activeProvRef.current=prov;
    setActiveProv(prov);setSrcType(type_);
    if(srcObj)setActiveSource(srcObj);
    const onReady=()=>{if(!job.cancelled){setLoading(false);setSwitchMsg(null);}};
    if(type_==="hls"&&Hls.isSupported()){
      const h=new Hls({enableWorker:true,backBufferLength:60,maxBufferLength:30,
        startLevel:-1,levelLoadingTimeOut:15000,fragLoadingTimeOut:20000,
        levelLoadingMaxRetry:3,fragLoadingMaxRetry:3,maxMaxBufferLength:120});
      h.on(Hls.Events.MANIFEST_PARSED,(_,d)=>{
        if(job.cancelled)return;
        console.log('[VidzenPlayer] Manifest OK, levels:',d.levels.length,'src:',url.slice(0,80));
        setHlsLevels(d.levels);onReady();v.play().catch(()=>{});
      });
      h.on(Hls.Events.FRAG_BUFFERED,()=>{if(!job.cancelled)setBuffering(false);});
      h.on(Hls.Events.ERROR,(_,d)=>{
        if(job.cancelled||!d.fatal)return;
        console.warn('[VidzenPlayer] HLS fatal:',d.type,d.details);
        if(d.type===Hls.ErrorTypes.MEDIA_ERROR&&d.details!=='bufferAddCodecError'){
          h.recoverMediaError();return;
        }
        h.destroy();hlsRef.current=null;autoFallback();
      });
      h.on(Hls.Events.LEVEL_SWITCHED,(_,d)=>setHlsCurrentLevel(d.level));
      console.log('[VidzenPlayer] loadSource:',url.slice(0,100));
      h.loadSource(url);h.attachMedia(v);hlsRef.current=h;
    }else if(type_==="hls"){
      v.src=url;v.addEventListener('loadedmetadata',onReady,{once:true});
      v.play().catch(()=>{});
    }else{
      setTimeout(()=>{
        if(job.cancelled)return;
        const onErr=()=>{
          if(job.cancelled)return;
          console.warn('[VidzenPlayer] MP4 error:',v.error?.message||'code:'+v.error?.code);
          const cache=provCacheRef.current[prov]||[];
          const idx=cache.findIndex(s=>s.url===url);
          const next=cache[idx+1];
          if(next&&next.type==='mp4'){playSource(next.url,'mp4',prov,next);return;}
          autoFallback();
        };
        v.addEventListener('error',onErr,{once:true});
        v.addEventListener('loadedmetadata',onReady,{once:true});
        const {type:mt,id:mi,season:ms,episode:me}=mediaRef.current;
        const key=`${mt}-${mi}${ms?`-s${ms}e${me}`:''}`;
        getProgress(key).then(prog=>{if(prog?.watched>5){const fn=()=>{v.currentTime=prog.watched;v.removeEventListener('loadedmetadata',fn);};v.addEventListener('loadedmetadata',fn);}});
        v.src=url;v.load();v.play().catch(()=>{});
      },150);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const autoFallback=useCallback(async()=>{
    const {type:mt,id:mi,season:ms,episode:me}=mediaRef.current;
    const failed=failedRef.current;
    failed.add(activeProvRef.current);
    for(const prov of ALL_PROVIDERS){
      if(failed.has(prov))continue;
      try{
        setSwitchMsg(`Trying ${prov}…`);setLoading(true);
        let sources=provCacheRef.current[prov];
        if(!sources?.length){
          const r=await FETCHERS[prov](mt,mi,ms,me);
          sources=r.sources;provCacheRef.current[prov]=sources;
          setAllSources(prev=>({...prev,[prov]:{sources,ts:Date.now()}}));
        }
        const src0=sources[0];
        playSource(src0.url,src0.type||'hls',prov,src0);
        return;
      }catch{failed.add(prov);}
    }
    setErr('All providers failed — please try again later');
    setLoading(false);setSwitchMsg(null);
  },[playSource]);


  useEffect(()=>{
    failedRef.current=new Set();provCacheRef.current={};activeProvRef.current=null;
    setAllSources({});setActiveProv(null);setActiveSource(null);setSrcType(null);
    setErr(null);setLoading(true);setSwitchMsg(null);
    setCues([]);setActiveSub(null);setIsPlaying(false);setCur(0);setDur(0);setBuf(0);
    let cancelled=false;
    const go=async()=>{
      const promises={};
      ALL_PROVIDERS.forEach(prov=>{
        promises[prov]=FETCHERS[prov](type,id,season,episode).then(r=>{
          if(!cancelled){provCacheRef.current[prov]=r.sources;setAllSources(prev=>({...prev,[prov]:{sources:r.sources,ts:Date.now()}}));}
          return r;
        });
      });
      for(const prov of ALL_PROVIDERS){
        try{
          const r=await promises[prov];
          if(!cancelled){const src0=r.sources[0];playSource(src0.url,src0.type||'hls',prov,src0);}
          return;
        }catch{}
      }
      if(!cancelled){setErr('All providers failed');setLoading(false);}
    };
    go();
    return()=>{cancelled=true;if(loadJobRef.current)loadJobRef.current.cancelled=true;};
  },[type,id,season,episode,playSource]);

  const handleServerClick=useCallback(async(srv)=>{
    setShowMenu(false);setErr(null);
    const tsOk=allSources[srv.provider]?.ts&&(Date.now()-allSources[srv.provider].ts<15*60*1000);
    let sources=(tsOk&&provCacheRef.current[srv.provider]?.length)?provCacheRef.current[srv.provider]:null;
    if(!sources){
      setSwitchMsg(`Loading ${srv.name}…`);setLoading(true);
      try{
        const r=await FETCHERS[srv.provider](type,id,season,episode);
        sources=r.sources;provCacheRef.current[srv.provider]=sources;
        setAllSources(prev=>({...prev,[srv.provider]:{sources,ts:Date.now()}}));
      }catch(e){setErr(e.message);setLoading(false);setSwitchMsg(null);return;}
    }
    let src0=sources[0];
    if(srv.dub!==null)src0=sources.find(s=>srv.dub.some(d=>(s.dub||'Original').toLowerCase().includes(d.toLowerCase())))||sources[0];
    failedRef.current=new Set();
    setSwitchMsg(`Switching to ${srv.name}…`);setLoading(true);
    playSource(src0.url,src0.type||'hls',srv.provider,src0);
  },[type,id,season,episode,allSources,playSource]);

  const switchSource=useCallback((source,prov)=>{
    setShowSettings(false);setSwitchMsg('Switching…');setLoading(true);
    playSource(source.url,source.type||'hls',prov,source);
  },[playSource]);

  useEffect(()=>{
    const v=videoRef.current;if(!v||srcType!=='hls')return;
    const key=`${type}-${id}${season?`-s${season}e${episode}`:''}`;
    const fn=()=>{getProgress(key).then(prog=>{if(prog?.watched>5)v.currentTime=prog.watched;});v.removeEventListener('loadedmetadata',fn);};
    v.addEventListener('loadedmetadata',fn);
    return()=>v.removeEventListener('loadedmetadata',fn);
  },[srcType,type,id,season,episode]);



  // Video events
  useEffect(()=>{
    const v=videoRef.current;if(!v)return;
    const onT=()=>{setCur(v.currentTime);setBuf(v.buffered.length>0?v.buffered.end(v.buffered.length-1):0);};
    const onD=()=>setDur(v.duration);
    const onPl=()=>setIsPlaying(true);
    const onPa=()=>setIsPlaying(false);
    const onV=()=>{setVol(v.volume);setMuted(v.muted);};
    const onWait=()=>setBuffering(true);
    const onPlayg=()=>setBuffering(false);
    const onCanPl=()=>setBuffering(false);
    v.addEventListener("timeupdate",onT);v.addEventListener("progress",onT);
    v.addEventListener("durationchange",onD);v.addEventListener("play",onPl);
    v.addEventListener("pause",onPa);v.addEventListener("volumechange",onV);
    v.addEventListener("waiting",onWait);v.addEventListener("playing",onPlayg);v.addEventListener("canplay",onCanPl);
    return()=>{
      v.removeEventListener("timeupdate",onT);v.removeEventListener("progress",onT);
      v.removeEventListener("durationchange",onD);v.removeEventListener("play",onPl);
      v.removeEventListener("pause",onPa);v.removeEventListener("volumechange",onV);
      v.removeEventListener("waiting",onWait);v.removeEventListener("playing",onPlayg);v.removeEventListener("canplay",onCanPl);
    };
  },[]);

  useEffect(()=>{
    const fn=()=>setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange",fn);
    return()=>document.removeEventListener("fullscreenchange",fn);
  },[]);

  // Progress save (encrypted via crypto.js)
  useEffect(()=>{
    progRef.current=setInterval(()=>{
      if(videoRef.current&&isPlaying&&cur>5){
        const key=`${type}-${id}${season?`-s${season}e${episode}`:""}`;
        updateProgress(key,{watched:cur,duration:dur,type,season,episode});
      }
    },5000);
    return()=>clearInterval(progRef.current);
  },[isPlaying,cur,dur,type,id,season,episode]);

  // Auto-hide controls
  const resetHide=useCallback(()=>{
    setShowCtrl(true);clearTimeout(hideRef.current);
    hideRef.current=setTimeout(()=>{if(isPlaying)setShowCtrl(false);},3000);
  },[isPlaying]);
  useEffect(()=>{if(!isPlaying)setShowCtrl(true);},[isPlaying]);
  // Watchdog for silent MSE stalls (fixes Piexe timestamp freezes)
  useEffect(()=>{
    let lastTime=-1;let stuckCount=0;
    const intv=setInterval(()=>{
      const v=videoRef.current;if(!v)return;
      if(isPlaying && !v.paused && v.readyState>=2){
        if(Math.abs(v.currentTime-lastTime)<0.05){
          stuckCount++;
          if(stuckCount>=3){
            console.warn('[VidzenPlayer] Silent MSE stall detected at',v.currentTime,'nudging...');
            v.currentTime+=0.1;stuckCount=0;
          }
        }else{
          lastTime=v.currentTime;stuckCount=0;
        }
      }else{
        lastTime=v?.currentTime||-1;stuckCount=0;
      }
    },1000);
    return()=>clearInterval(intv);
  },[isPlaying]);

  // Subtitle parsing
  useEffect(()=>{
    if(!activeSub){setCues([]);return;}
    fetch(activeSub).then(r=>r.text()).then(txt=>{
      const toS=s=>{const[hh,mm,ss]=s.replace(",",".").split(":");return+hh*3600+ +mm*60+ +ss;};
      setCues(txt.replace(/\r\n/g,"\n").split("\n\n").map(b=>{
        const m=b.match(/(\d{2}:\d{2}[:.].+?)\s*-->\s*(.+?)\n([\s\S]+)/);
        return m?{start:toS(m[1]),end:toS(m[2]),text:m[3].trim()}:null;
      }).filter(Boolean));
    }).catch(()=>setCues([]));
  },[activeSub]);

  // Controls
  const togglePlay=useCallback(()=>{const v=videoRef.current;if(!v)return;if(isPlaying)v.pause();else v.play().catch(e=>{if(e.name!=="AbortError")console.warn('[VidzenPlayer] play():',e.message);});},[isPlaying]);

  const seek=useCallback(t=>{const v=videoRef.current;if(!v)return;v.currentTime=t;setCur(t);},[]);
  const skipB=useCallback(()=>{const v=videoRef.current;if(!v)return;const t=Math.max(0,v.currentTime-10);v.currentTime=t;setCur(t);},[]);
  const skipF=useCallback(()=>{const v=videoRef.current;if(!v)return;const t=Math.min(v.duration||0,v.currentTime+10);v.currentTime=t;setCur(t);},[]);
  const chgVol=useCallback(v2=>{const v=videoRef.current;if(!v)return;v.volume=v2;if(v2>0&&v.muted)v.muted=false;},[]);
  const togMute=useCallback(()=>{const v=videoRef.current;if(!v)return;v.muted=!v.muted;},[]);
  const togFs=useCallback(()=>{const el=containerRef.current;if(!el)return;if(!fs)el.requestFullscreen();else document.exitFullscreen();},[fs]);
  const togPiP=useCallback(async()=>{const v=videoRef.current;if(!v)return;try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else await v.requestPictureInPicture();}catch{}},[]);
  const chgSpeed=useCallback(s=>{const v=videoRef.current;if(!v)return;v.playbackRate=parseFloat(s);setSpeedState(s);setShowSettings(false);setSettSect(null);},[]);

  // Keyboard
  useEffect(()=>{
    const fn=e=>{
      if(e.target.tagName==="INPUT")return;
      if(e.code==="Space"){e.preventDefault();togglePlay();}
      if(e.code==="ArrowLeft")skipB();if(e.code==="ArrowRight")skipF();
      if(e.code==="KeyM")togMute();if(e.code==="KeyF")togFs();
    };
    window.addEventListener("keydown",fn);return()=>window.removeEventListener("keydown",fn);
  },[togglePlay,skipB,skipF,togMute,togFs]);

  const pct=dur>0?(cur/dur)*100:0;
  const bpct=dur>0?(buf/dur)*100:0;
  const activeCue=cues.find(c=>cur>=c.start&&cur<=c.end);
  const SPEEDS=["0.25","0.5","0.75","1","1.25","1.5","1.75","2"];
  const btnStyle={background:"none",border:"none",color:"rgba(255,255,255,0.85)",cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center"};
  const hov=(e,on)=>e.currentTarget.style.color=on?"#fff":"rgba(255,255,255,0.85)";

  return (
    <div suppressHydrationWarning ref={containerRef} style={{position:"fixed",inset:0,background:"#000",zIndex:9999,userSelect:"none",cursor:showCtrl?"default":"none"}}
      onMouseMove={resetHide} onTouchStart={resetHide} onClick={()=>{setShowSettings(false);setShowMenu(false);}}>
      <style>{`.wv-r{-webkit-appearance:none;appearance:none;background:transparent;cursor:pointer;width:100%;height:24px;}.wv-r::-webkit-slider-thumb{-webkit-appearance:none;width:0;height:0;}.wv-r::-moz-range-thumb{border:none;width:0;height:0;}@keyframes wvspin{to{transform:rotate(360deg);}}`}</style>

      {(loading||buffering)&&<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20,background:"rgba(0,0,0,0.5)",zIndex:40,pointerEvents:"none"}}>
        <RoseCurveSpinner size={72}/>
        <p style={{color:"rgba(255,255,255,0.7)",fontSize:13,fontFamily:"system-ui,sans-serif",textAlign:"center",maxWidth:280,lineHeight:1.5,marginTop:4}}>
          {switchMsg||"Loading…"}
        </p>
      </div>}

      {!loading&&err&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"#000",zIndex:50}}>
        <div style={{textAlign:"center",color:"#fff",fontFamily:"system-ui,sans-serif"}}>
          <div style={{fontSize:36,marginBottom:12}}>⚠️</div>
          <div style={{fontSize:15,color:"rgba(255,255,255,0.7)",marginBottom:6}}>{err}</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>All providers failed</div>
        </div>
      </div>}

      <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"contain",display:"block",background:"#000"}}
        playsInline preload="auto" poster={poster||undefined}
        onClick={e=>{e.stopPropagation();togglePlay();}} onDoubleClick={togFs} suppressHydrationWarning/>

      {/* Center Controls (Play/Pause, Skip Back/Forward) */}
      {!loading && !buffering && !err && activeSource?.url && (
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",gap:80,zIndex:40,opacity:showCtrl?1:0,transition:"opacity 0.2s",pointerEvents:"none"}}>
          <button onClick={e=>{e.stopPropagation();skipB();}} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",padding:0,display:"flex",transition:"transform 0.15s, color 0.15s",pointerEvents:"auto"}} onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.15)";e.currentTarget.style.color="#3b82f6";}} onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.color="#fff";}} aria-label="Back 10s">
            <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5"><path strokeLinejoin="round" d="m12 5l-1.104-1.545c-.41-.576-.617-.864-.487-1.13c.13-.268.46-.283 1.12-.314Q11.763 2 12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12a9.99 9.99 0 0 1 4-8"/><path d="M7.992 11.004C8.52 10.584 9 9.891 9.3 10.02s.204.552.204 1.212v4.776m6.498-3.408c0-1.38.066-1.752-.198-2.196s-.924-.406-1.584-.406s-1.14-.038-1.458.322c-.39.42-.222 1.2-.27 2.28c.108 1.44-.186 2.58.264 3.06c.324.396.9.336 1.584.348c.68-.008 1.092.024 1.428-.36c.372-.336.192-1.668.234-3.048Z"/></g></svg>
          </button>

          <button onClick={e=>{e.stopPropagation();togglePlay();}} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",padding:0,display:"flex",transition:"transform 0.15s, color 0.15s",pointerEvents:"auto"}} onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.15)";e.currentTarget.style.color="#3b82f6";}} onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.color="#fff";}} aria-label={isPlaying?"Pause":"Play"}>
            {isPlaying?<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 24 24"><path fill="currentColor" d="M2 6c0-1.886 0-2.828.586-3.414S4.114 2 6 2s2.828 0 3.414.586S10 4.114 10 6v12c0 1.886 0 2.828-.586 3.414S7.886 22 6 22s-2.828 0-3.414-.586S2 19.886 2 18zm12 0c0-1.886 0-2.828.586-3.414S16.114 2 18 2s2.828 0 3.414.586S22 4.114 22 6v12c0 1.886 0 2.828-.586 3.414S19.886 22 18 22s-2.828 0-3.414-.586S14 19.886 14 18z"/></svg>:<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 24 24"><path fill="currentColor" d="M21.409 9.353a2.998 2.998 0 0 1 0 5.294L8.597 21.614C6.534 22.737 4 21.277 4 18.968V5.033c0-2.31 2.534-3.769 4.597-2.648z"/></svg>}
          </button>

          <button onClick={e=>{e.stopPropagation();skipF();}} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",padding:0,display:"flex",transition:"transform 0.15s, color 0.15s",pointerEvents:"auto"}} onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.15)";e.currentTarget.style.color="#3b82f6";}} onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.color="#fff";}} aria-label="Forward 10s">
            <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5"><path strokeLinejoin="round" d="m12 5l1.104-1.545c.41-.576.617-.864.487-1.13c-.13-.268-.46-.283-1.12-.314Q12.237 2 12 2C6.477 2 2 6.477 2 12s4.477 10 10 10s10-4.477 10-10a9.99 9.99 0 0 0-4-8"/><path d="M7.992 11.004C8.52 10.584 9 9.891 9.3 10.02s.204.552.204 1.212v4.776m6.498-3.408c0-1.38.066-1.752-.198-2.196s-.924-.406-1.584-.406s-1.14-.038-1.458.322c-.39.42-.222 1.2-.27 2.28c.108 1.44-.186 2.58.264 3.06c.324.396.9.336 1.584.348c.68-.008 1.092.024 1.428-.36c.372-.336.192-1.668.234-3.048Z"/></g></svg>
          </button>
        </div>
      )}

      {activeCue&&<div style={{position:"absolute",bottom:100,left:0,right:0,textAlign:"center",pointerEvents:"none"}}>
        <span style={{background:"rgba(0,0,0,0.78)",color:"#fff",padding:"4px 14px",borderRadius:4,fontSize:16,fontFamily:"system-ui,sans-serif"}}>{activeCue.text}</span>
      </div>}

      {/* Server list menu */}
      <div style={{position:"absolute",top:8,left:8,zIndex:30}} onClick={e=>e.stopPropagation()}>
        <button onClick={()=>{setShowMenu(v=>!v);setShowSettings(false);}}
          style={{background:"rgba(0,0,0,0.6)",border:"none",color:"#fff",padding:6,borderRadius:8,cursor:"pointer",display:"flex",backdropFilter:"blur(8px)"}} aria-label="Servers">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M14.381 9.027a5.8 5.8 0 0 1 1.905-.321c.654 0 1.283.109 1.87.309m-11.04 2.594a4.4 4.4 0 0 0-.83-.08C3.919 11.53 2 13.426 2 15.765S3.919 20 6.286 20h10C19.442 20 17.472 22 14.353 22c0-2.472-1.607-4.573-3.845-5.338M7.116 11.609a5.6 5.6 0 0 1-.354-1.962C6.762 6.528 9.32 4 12.476 4c2.94 0 5.361 2.194 5.68 5.015m-11.04 2.594a4.3 4.3 0 0 1 1.55.634"/></svg>
        </button>
        {showMenu&&<div style={{position:"absolute",top:54,left:0,background:"rgba(18,18,22,0.92)",backdropFilter:"blur(24px)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,boxShadow:"0 32px 64px rgba(0,0,0,0.7)",minWidth:280,maxHeight:"70vh",overflowY:"auto",zIndex:50,fontFamily:"system-ui,sans-serif"}}>
          <div style={{padding:"18px 14px 12px"}}>
            <div style={{color:"rgba(255,255,255,0.4)",fontWeight:600,fontSize:11,letterSpacing:"0.12em",textTransform:"uppercase",paddingLeft:10,marginBottom:10}}>Servers</div>
            {SERVERS.map(srv=>{
              const {available,source}=resolveServer(srv,allSources);
              const isActive=available&&activeSource?.url===source?.url;
              return(
                <button key={srv.id}
                  onClick={()=>handleServerClick(srv)}
                  style={{width:"100%",textAlign:"left",padding:"10px 10px",color:isActive?"#60a5fa":available?"#fff":"rgba(255,255,255,0.5)",background:isActive?"rgba(59,130,246,0.15)":"transparent",border:"none",borderRadius:12,cursor:"pointer",display:"flex",alignItems:"center",gap:10,marginBottom:2,transition:"background 0.15s"}}
                  onMouseEnter={e=>{if(!isActive)e.currentTarget.style.background="rgba(255,255,255,0.05)";}}
                  onMouseLeave={e=>{if(!isActive)e.currentTarget.style.background="transparent";}}>
                  {/* Flag image — flagcdn.com works on all platforms incl. Windows */}
                  <img src={`https://flagcdn.com/20x15/${srv.cc}.png`} width="20" height="15"
                    alt={srv.cc} style={{borderRadius:2,flexShrink:0,objectFit:"cover"}}/>
                  {/* Name + sub-label */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:500,fontSize:14,lineHeight:1.2}}>{srv.name}</div>
                    <div style={{fontSize:11,marginTop:3,color:available?"rgba(255,255,255,0.38)":"rgba(255,255,255,0.22)",fontStyle:available?"normal":"italic"}}>
                      {available?srv.dubLabel:"Unavailable"}
                    </div>
                  </div>
                  {/* Star icon */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" style={{flexShrink:0}}><path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/></svg>
                  {/* Chevron or checkmark */}
                  {isActive
                    ?<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" style={{flexShrink:0}}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                    :available
                      ?<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" style={{flexShrink:0}}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
                      :<span style={{width:14}}/>}
                </button>);
            })}
          </div>
        </div>}
      </div>

      {/* Controls bar */}
      <div style={{position:"absolute",bottom:0,left:0,right:0,opacity:showCtrl?1:0,transition:"opacity 0.3s",pointerEvents:showCtrl?"auto":"none"}} onClick={e=>e.stopPropagation()}>
        <div style={{background:"linear-gradient(to top,rgba(0,0,0,0.9),rgba(0,0,0,0.6) 60%,transparent)",padding:"32px 16px 16px"}}>

          {/* Progress bar */}
          <div style={{position:"relative",marginBottom:16,height:24,display:"flex",alignItems:"center"}}>
            <div style={{position:"absolute",left:0,right:0,top:"50%",transform:"translateY(-50%)",height:6,background:"rgba(255,255,255,0.2)",borderRadius:3}}/>
            <div style={{position:"absolute",left:0,top:"50%",transform:"translateY(-50%)",height:6,width:`${bpct}%`,background:"rgba(255,255,255,0.3)",borderRadius:3}}/>
            <div style={{position:"absolute",left:0,top:"50%",transform:"translateY(-50%)",height:6,width:`${pct}%`,background:"linear-gradient(90deg,#3b82f6,#60a5fa)",borderRadius:3}}/>
            <input type="range" className="wv-r" min="0" max={dur||0} value={cur} step="0.1" onChange={e=>seek(parseFloat(e.target.value))} style={{position:"absolute",inset:0,zIndex:10}}/>
            <div style={{position:"absolute",top:"50%",transform:"translateY(-50%)",width:12,height:12,background:"#fff",borderRadius:"50%",boxShadow:"0 0 4px rgba(0,0,0,0.5)",pointerEvents:"none",left:`calc(${pct}% - 6px)`}}/>
          </div>

          {/* Button row */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            {/* Left */}
            <div style={{display:"flex",alignItems:"center",gap:16}}>

              {/* Volume */}
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button onClick={togMute} style={{background:"none",border:"none",color:"rgba(255,255,255,0.85)",cursor:"pointer",padding:0,display:"flex"}} onMouseEnter={e=>e.currentTarget.style.color="#fff"} onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.85)"} aria-label={muted?"Unmute":"Mute"}>
                  {muted?<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="1.5" d="M5.035 10.971c.073-1.208.11-1.813.424-2.394a3.2 3.2 0 0 1 1.38-1.3C7.44 7 8.127 7 9.5 7c.512 0 .768 0 1.016-.042q.37-.063.712-.214c.23-.101.444-.242.871-.524l.22-.144C14.86 4.399 16.132 3.56 17.2 3.925c.205.07.403.17.58.295c.922.648.992 2.157 1.133 5.174A68 68 0 0 1 19 12c0 .532-.035 1.488-.087 2.605c-.14 3.018-.21 4.526-1.133 5.175a2.3 2.3 0 0 1-.58.295c-1.067.364-2.339-.474-4.882-2.151l-.219-.144c-.427-.282-.64-.423-.871-.525a3 3 0 0 0-.712-.213C10.268 17 10.012 17 9.5 17c-1.374 0-2.06 0-2.66-.277a3.2 3.2 0 0 1-1.381-1.3c-.314-.582-.35-1.186-.424-2.395A17 17 0 0 1 5 12c0-.323.013-.671.035-1.029Z"/><path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M22 2L2 22"/></svg>:vol<0.5?<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.535 10.971c.073-1.208.11-1.813.424-2.394a3.2 3.2 0 0 1 1.38-1.3C3.94 7 4.627 7 6 7c.512 0 .768 0 1.016-.042a3 3 0 0 0 .712-.214c.23-.101.444-.242.871-.524l.22-.144C11.36 4.399 12.632 3.56 13.7 3.925c.205.07.403.17.58.295c.922.648.993 2.157 1.133 5.174A68 68 0 0 1 15.5 12c0 .532-.035 1.488-.087 2.605c-.14 3.018-.21 4.526-1.133 5.175a2.3 2.3 0 0 1-.58.295c-1.067.364-2.339-.474-4.882-2.151L8.6 17.78c-.427-.282-.64-.423-.871-.525a3 3 0 0 0-.712-.213C6.768 17 6.512 17 6 17c-1.374 0-2.06 0-2.66-.277a3.2 3.2 0 0 1-1.381-1.3c-.314-.582-.35-1.186-.424-2.395A17 17 0 0 1 1.5 12c0-.323.013-.671.035-1.029Z"/><path strokeLinecap="round" d="M18 9s.5.9.5 3s-.5 3-.5 3"/></g></svg>:<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.535 10.971c.073-1.208.11-1.813.424-2.394a3.2 3.2 0 0 1 1.38-1.3C3.94 7 4.627 7 6 7c.512 0 .768 0 1.016-.042a3 3 0 0 0 .712-.214c.23-.101.444-.242.871-.524l.22-.144C11.36 4.399 12.632 3.56 13.7 3.925c.205.07.403.17.58.295c.922.648.993 2.157 1.133 5.174A68 68 0 0 1 15.5 12c0 .532-.035 1.488-.087 2.605c-.14 3.018-.21 4.526-1.133 5.175a2.3 2.3 0 0 1-.58.295c-1.067.364-2.339-.474-4.882-2.151L8.6 17.78c-.427-.282-.64-.423-.871-.525a3 3 0 0 0-.712-.213C6.768 17 6.512 17 6 17c-1.374 0-2.06 0-2.66-.277a3.2 3.2 0 0 1-1.381-1.3c-.314-.582-.35-1.186-.424-2.395A17 17 0 0 1 1.5 12c0-.323.013-.671.035-1.029Z"/><path strokeLinecap="round" d="M20 6s1.5 1.8 1.5 6s-1.5 6-1.5 6m-2-9s.5.9.5 3s-.5 3-.5 3"/></g></svg>}
                </button>
                <div style={{position:"relative",width:80,height:6,background:"rgba(255,255,255,0.2)",borderRadius:3}}>
                  <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${(muted?0:vol)*100}%`,background:"linear-gradient(90deg,#3b82f6,#60a5fa)",borderRadius:3}}/>
                  <input type="range" className="wv-r" min="0" max="1" step="0.01" value={muted?0:vol} onChange={e=>chgVol(parseFloat(e.target.value))} style={{position:"absolute",top:-9,left:0,margin:0,width:80}}/>
                  <div style={{position:"absolute",top:"50%",transform:"translateY(-50%)",width:12,height:12,background:"#fff",borderRadius:"50%",pointerEvents:"none",left:`calc(${(muted?0:vol)*100}% - 6px)`}}/>
                </div>
              </div>
              <span style={{color:"#fff",fontSize:12,fontFamily:"system-ui,sans-serif",whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>
                {fmt(cur)} / {fmt(dur)}
              </span>
            </div>

            {/* Right */}
            <div style={{display:"flex",alignItems:"center",gap:16}}>
              {subs.length>0&&<button onClick={()=>{setShowSettings(v=>!v);setSettSect("captions");}} style={{background:"none",border:"none",color:activeSub?"#3b82f6":"rgba(255,255,255,0.85)",cursor:"pointer",padding:0,display:"flex"}} onMouseEnter={e=>e.currentTarget.style.color="#fff"} onMouseLeave={e=>e.currentTarget.style.color=activeSub?"#3b82f6":"rgba(255,255,255,0.85)"} aria-label="Captions">
                <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"><path fill="currentColor" d="M18.75 4A3.25 3.25 0 0 1 22 7.25v9.505a3.25 3.25 0 0 1-3.25 3.25H5.25A3.25 3.25 0 0 1 2 16.755V7.25a3.25 3.25 0 0 1 3.066-3.245L5.25 4zm0 1.5H5.25l-.144.006A1.75 1.75 0 0 0 3.5 7.25v9.505c0 .966.784 1.75 1.75 1.75h13.5a1.75 1.75 0 0 0 1.75-1.75V7.25a1.75 1.75 0 0 0-1.75-1.75M5.5 12c0-3.146 2.713-4.775 5.122-3.401A.75.75 0 0 1 9.878 9.9C8.481 9.104 7 9.994 7 12c0 2.005 1.484 2.896 2.88 2.103a.75.75 0 0 1 .74 1.304C8.216 16.775 5.5 15.143 5.5 12m7.5 0c0-3.146 2.713-4.775 5.122-3.401a.75.75 0 0 1-.744 1.302C15.981 9.104 14.5 9.994 14.5 12c0 2.005 1.484 2.896 2.88 2.103a.75.75 0 0 1 .74 1.304C15.716 16.775 13 15.143 13 12"/></svg>
              </button>}
              <button onClick={togPiP} style={{background:"none",border:"none",color:"rgba(255,255,255,0.85)",cursor:"pointer",padding:0,display:"flex"}} onMouseEnter={e=>e.currentTarget.style.color="#fff"} onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.85)"} aria-label="PiP">
                <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"><path fill="currentColor" fillRule="evenodd" d="M9.944 2.25h4.112c1.838 0 3.294 0 4.433.153c1.172.158 2.121.49 2.87 1.238c.748.749 1.08 1.698 1.238 2.87c.153 1.14.153 2.595.153 4.433V11a.75.75 0 0 1-1.5 0c0-1.907-.002-3.261-.14-4.29c-.135-1.005-.389-1.585-.812-2.008s-1.003-.677-2.009-.812c-1.027-.138-2.382-.14-4.289-.14h-4c-1.907 0-3.261.002-4.29.14c-1.005.135-1.585.389-2.008.812S3.025 5.705 2.89 6.71c-.138 1.029-.14 2.383-.14 4.29v2c0 1.907.002 3.262.14 4.29c.135 1.005.389 1.585.812 2.008s1.003.677 2.009.812c1.028.138 2.382.14 4.289.14h1a.75.75 0 0 1 0 1.5H9.944c-1.838 0-3.294 0-4.433-.153c-1.172-.158-2.121-.49-2.87-1.238c-.748-.749-1.08-1.698-1.238-2.87c-.153-1.14-.153-2.595-.153-4.433v-2.112c0-1.838 0-3.294.153-4.433c.158-1.172.49-2.121 1.238-2.87c.749-.748 1.698-1.08 2.87-1.238c1.14-.153 2.595-.153 4.433-.153m7.004 10h1.104c.899 0 1.648 0 2.242.08c.628.084 1.195.27 1.65.726c.456.455.642 1.022.726 1.65c.08.594.08 1.343.08 2.242v.104c0 .899 0 1.648-.08 2.242c-.084.628-.27 1.195-.726 1.65c-.455.456-1.022.642-1.65.726c-.594.08-1.343.08-2.242.08h-1.104c-.899 0-1.648 0-2.242-.08c-.628-.084-1.195-.27-1.65-.726c-.456-.455-.642-1.022-.726-1.65c-.08-.594-.08-1.343-.08-2.242v-.104c0-.899 0-1.648.08-2.242c.084-.628.27-1.195.726-1.65c.455-.456 1.022-.642 1.65-.726c.594-.08 1.343-.08 2.242-.08m-2.043 1.566c-.461.063-.659.17-.789.3s-.237.328-.3.79c-.064.482-.066 1.13-.066 2.094s.002 1.612.066 2.095c.063.461.17.659.3.789s.328.237.79.3c.482.064 1.13.066 2.094.066h1c.964 0 1.612-.002 2.095-.067c.461-.062.659-.169.789-.3s.237-.327.3-.788c.064-.483.066-1.131.066-2.095s-.002-1.612-.067-2.095c-.062-.461-.169-.659-.3-.789s-.327-.237-.788-.3c-.483-.064-1.131-.066-2.095-.066h-1c-.964 0-1.612.002-2.095.066" clipRule="evenodd"/></svg>
              </button>

              {/* Settings */}
              <div style={{position:"relative",marginTop:4}}>
                <button onClick={()=>{setShowSettings(v=>!v);setSettSect(null);}} style={{background:"none",border:"none",color:"rgba(255,255,255,0.85)",cursor:"pointer",padding:0,display:"flex"}} onMouseEnter={e=>e.currentTarget.style.color="#fff"} onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.85)"} aria-label="Settings">
                  <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M13.765 2.152C13.398 2 12.932 2 12 2s-1.398 0-1.765.152a2 2 0 0 0-1.083 1.083c-.092.223-.129.484-.143.863a1.62 1.62 0 0 1-.79 1.353a1.62 1.62 0 0 1-1.567.008c-.336-.178-.579-.276-.82-.308a2 2 0 0 0-1.478.396C4.04 5.79 3.806 6.193 3.34 7s-.7 1.21-.751 1.605a2 2 0 0 0 .396 1.479c.148.192.355.353.676.555c.473.297.777.803.777 1.361s-.304 1.064-.777 1.36c-.321.203-.529.364-.676.556a2 2 0 0 0-.396 1.479c.052.394.285.798.75 1.605c.467.807.7 1.21 1.015 1.453a2 2 0 0 0 1.479.396c.24-.032.483-.13.819-.308a1.62 1.62 0 0 1 1.567.008c.483.28.77.795.79 1.353c.014.38.05.64.143.863a2 2 0 0 0 1.083 1.083C10.602 22 11.068 22 12 22s1.398 0 1.765-.152a2 2 0 0 0 1.083-1.083c.092-.223.129-.483.143-.863c.02-.558.307-1.074.79-1.353a1.62 1.62 0 0 1 1.567-.008c.336.178.579.276.819.308a2 2 0 0 0 1.479-.396c.315-.242.548-.646 1.014-1.453s.7-1.21.751-1.605a2 2 0 0 0-.396-1.479c-.148-.192-.355-.353-.676-.555A1.62 1.62 0 0 1 19.562 12c0-.558.304-1.064.777-1.36c.321-.203.529-.364.676-.556a2 2 0 0 0 .396-1.479c-.052-.394-.285-.798-.75-1.605c-.467-.807-.7-1.21-1.015-1.453a2 2 0 0 0-1.479-.396c-.24.032-.483.13-.82.308a1.62 1.62 0 0 1-1.566-.008a1.62 1.62 0 0 1-.79-1.353c-.014-.38-.05-.64-.143-.863a2 2 0 0 0-1.083-1.083Z"/></g></svg>
                </button>
                {showSettings&&<div style={{position:"absolute",bottom:52,right:0,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(20px)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:16,boxShadow:"0 25px 50px rgba(0,0,0,0.6)",width:220,zIndex:50,fontFamily:"system-ui,sans-serif",overflow:"hidden"}}>
                  {!settSect&&<div style={{padding:8}}>
                    <div style={{padding:"8px 12px",fontSize:10,textTransform:"uppercase",letterSpacing:"0.05em",color:"rgba(255,255,255,0.4)",fontWeight:600}}>Settings</div>
                    {[
                      ["speed","Playback Speed",speed+"x"],
                      ...(hlsLevels.length>0?[["quality","Quality",hlsCurrentLevel===-1?"Auto":(hlsLevels[hlsCurrentLevel]?.height?hlsLevels[hlsCurrentLevel].height+"p":"Auto")]]:[] ),
                      ...(srcType==="mp4"&&(allSources[activeProv]?.sources?.length||0)>1?[["mpquality","Quality",activeSource?.quality?`${activeSource.quality}p`:"Default"]]:[] ),
                      ["captions","Captions",activeSub?"On":"Off"]
                    ].map(([k,label,val])=>(
                      <button key={k} onClick={()=>setSettSect(k)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",background:"transparent",border:"none",color:"rgba(255,255,255,0.8)",cursor:"pointer",borderRadius:8,fontSize:14}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <span>{label}</span><span style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>{val}</span>
                      </button>
                    ))}
                  </div>}
                  {settSect==="speed"&&<div style={{padding:8}}>
                    <button onClick={()=>setSettSect(null)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"transparent",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:13}}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>Back
                    </button>
                    <div style={{borderTop:"1px solid rgba(255,255,255,0.1)",paddingTop:8}}>
                      {SPEEDS.map(s=><button key={s} onClick={()=>chgSpeed(s)} style={{width:"100%",textAlign:"left",padding:"8px 12px",background:speed===s?"rgba(59,130,246,0.3)":"transparent",border:"none",color:speed===s?"#60a5fa":"rgba(255,255,255,0.7)",cursor:"pointer",borderRadius:8,fontSize:13}}>{s}x</button>)}
                    </div>
                  </div>}
                  {settSect==="mpquality"&&<div style={{padding:8}}>
                    <button onClick={()=>setSettSect(null)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"transparent",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:13}}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>Back
                    </button>
                    <div style={{borderTop:"1px solid rgba(255,255,255,0.1)",paddingTop:8}}>
                      {(allSources[activeProv]?.sources||[]).filter(s=>!activeSource?.dub||s.dub===activeSource.dub).map((s,i)=>{
                        const isAct=activeSource?.url===s.url;
                        return<button key={i} onClick={()=>{switchSource(s,activeProv);setShowSettings(false);}}
                          style={{width:"100%",textAlign:"left",padding:"8px 12px",background:isAct?"rgba(59,130,246,0.3)":"transparent",border:"none",color:isAct?"#60a5fa":"rgba(255,255,255,0.7)",cursor:"pointer",borderRadius:8,fontSize:13}}>
                          {s.quality?`${s.quality}p`:s.label||"Default"}
                        </button>;
                      })}
                    </div>
                  </div>}
                  {settSect==="quality"&&<div style={{padding:8}}>
                    <button onClick={()=>setSettSect(null)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"transparent",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:13}}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>Back
                    </button>
                    <div style={{borderTop:"1px solid rgba(255,255,255,0.1)",paddingTop:8}}>
                      <button onClick={()=>{if(hlsRef.current)hlsRef.current.currentLevel=-1;setHlsCurrentLevel(-1);setShowSettings(false);}} style={{width:"100%",textAlign:"left",padding:"8px 12px",background:hlsCurrentLevel===-1?"rgba(59,130,246,0.3)":"transparent",border:"none",color:hlsCurrentLevel===-1?"#60a5fa":"rgba(255,255,255,0.7)",cursor:"pointer",borderRadius:8,fontSize:13}}>Auto</button>
                      {hlsLevels.map((lvl,i)=>(
                        <button key={i} onClick={()=>{if(hlsRef.current)hlsRef.current.currentLevel=i;setHlsCurrentLevel(i);setShowSettings(false);}}
                          style={{width:"100%",textAlign:"left",padding:"8px 12px",background:hlsCurrentLevel===i?"rgba(59,130,246,0.3)":"transparent",border:"none",color:hlsCurrentLevel===i?"#60a5fa":"rgba(255,255,255,0.7)",cursor:"pointer",borderRadius:8,fontSize:13,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <span>{lvl.height?`${lvl.height}p`:lvl.name||`Level ${i+1}`}</span>
                          {lvl.bitrate&&<span style={{color:"rgba(255,255,255,0.35)",fontSize:11}}>{Math.round(lvl.bitrate/1000)}k</span>}
                        </button>
                      ))}
                    </div>
                  </div>}
                  {settSect==="captions"&&<div style={{padding:8}}>
                    <button onClick={()=>setSettSect(null)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"transparent",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:13}}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>Back
                    </button>
                    <div style={{borderTop:"1px solid rgba(255,255,255,0.1)",paddingTop:8}}>
                      <button onClick={()=>{setActiveSub(null);setShowSettings(false);}} style={{width:"100%",textAlign:"left",padding:"8px 12px",background:!activeSub?"rgba(59,130,246,0.3)":"transparent",border:"none",color:!activeSub?"#60a5fa":"rgba(255,255,255,0.7)",cursor:"pointer",borderRadius:8,fontSize:13}}>Off</button>
                      {subs.map((s,i)=><button key={i} onClick={()=>{setActiveSub(s.file||s.url||s);setShowSettings(false);}} style={{width:"100%",textAlign:"left",padding:"8px 12px",background:activeSub===(s.file||s.url||s)?"rgba(59,130,246,0.3)":"transparent",border:"none",color:activeSub===(s.file||s.url||s)?"#60a5fa":"rgba(255,255,255,0.7)",cursor:"pointer",borderRadius:8,fontSize:13}}>{s.label||s.lang||`Track ${i+1}`}</button>)}
                    </div>
                  </div>}
                </div>}
              </div>

              <button onClick={togFs} style={{background:"none",border:"none",color:"rgba(255,255,255,0.85)",cursor:"pointer",padding:0,display:"flex"}} onMouseEnter={e=>e.currentTarget.style.color="#fff"} onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.85)"} aria-label="Fullscreen">
                {fs?<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"><path fill="currentColor" fillRule="evenodd" d="M14 1.25a.75.75 0 0 1 .75.75c0 1.907.002 3.261.14 4.29c.135 1.005.389 1.585.812 2.008s1.003.677 2.009.812c1.027.138 2.382.14 4.289.14a.75.75 0 0 1 0 1.5h-.056c-1.838 0-3.294 0-4.433-.153c-1.172-.158-2.121-.49-2.87-1.238c-.748-.749-1.08-1.698-1.238-2.87c-.153-1.14-.153-2.595-.153-4.433V2a.75.75 0 0 1 .75-.75m-4 0a.75.75 0 0 1 .75.75v.056c0 1.838 0 3.294-.153 4.433c-.158 1.172-.49 2.121-1.238 2.87c-.749.748-1.698 1.08-2.87 1.238c-1.14.153-2.595.153-4.433.153H2a.75.75 0 0 1 0-1.5c1.907 0 3.261-.002 4.29-.14c1.005-.135 1.585-.389 2.008-.812s.677-1.003.812-2.009c.138-1.028.14-2.382.14-4.289a.75.75 0 0 1 .75-.75M1.25 14a.75.75 0 0 1 .75-.75h.056c1.838 0 3.294 0 4.433.153c1.172.158 2.121.49 2.87 1.238c.748.749 1.08 1.698 1.238 2.87c.153 1.14.153 2.595.153 4.433V22a.75.75 0 0 1-1.5 0c0-1.907-.002-3.262-.14-4.29c-.135-1.005-.389-1.585-.812-2.008s-1.003-.677-2.009-.812c-1.028-.138-2.382-.14-4.289-.14a.75.75 0 0 1-.75-.75m20.694-.75H22a.75.75 0 0 1 0 1.5c-1.907 0-3.262.002-4.29.14c-1.005.135-1.585.389-2.008.812s-.677 1.003-.812 2.009c-.138 1.027-.14 2.382-.14 4.289a.75.75 0 0 1-1.5 0v-.056c0-1.838 0-3.294.153-4.433c.158-1.172.49-2.121 1.238-2.87c.749-.748 1.698-1.08 2.87-1.238c1.14-.153 2.595-.153 4.433-.153" clipRule="evenodd"/></svg>:<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"><path fill="currentColor" fillRule="evenodd" d="M9.944 1.25H10a.75.75 0 0 1 0 1.5c-1.907 0-3.261.002-4.29.14c-1.005.135-1.585.389-2.008.812S3.025 4.705 2.89 5.71c-.138 1.029-.14 2.383-.14 4.29a.75.75 0 0 1-1.5 0v-.056c0-1.838 0-3.294.153-4.433c.158-1.172.49-2.121 1.238-2.87c.749-.748 1.698-1.08 2.87-1.238c1.14-.153 2.595-.153 4.433-.153m8.345 1.64c-1.027-.138-2.382-.14-4.289-.14a.75.75 0 0 1 0-1.5h.056c1.838 0 3.294 0 4.433.153c1.172.158 2.121.49 2.87 1.238c.748.749 1.08 1.698 1.238 2.87c.153 1.14.153 2.595.153 4.433V10a.75.75 0 0 1-1.5 0c0-1.907-.002-3.261-.14-4.29c-.135-1.005-.389-1.585-.812-2.008s-1.003-.677-2.009-.812M2 13.25a.75.75 0 0 1 .75.75c0 1.907.002 3.262.14 4.29c.135 1.005.389 1.585.812 2.008s1.003.677 2.009.812c1.028.138 2.382.14 4.289.14a.75.75 0 0 1 0 1.5h-.056c-1.838 0-3.294 0-4.433-.153c-1.172-.158-2.121-.49-2.87-1.238c-.748-.749-1.08-1.698-1.238-2.87c-.153-1.14-.153-2.595-.153-4.433V14a.75.75 0 0 1 .75-.75m20 0a.75.75 0 0 1 .75.75v.056c0 1.838 0 3.294-.153 4.433c-.158 1.172-.49 2.121-1.238 2.87c-.749.748-1.698 1.08-2.87 1.238c-1.14.153-2.595.153-4.433.153H14a.75.75 0 0 1 0-1.5c1.907 0 3.262-.002 4.29-.14c1.005-.135 1.585-.389 2.008-.812s.677-1.003.812-2.009c.138-1.027.14-2.382.14-4.289a.75.75 0 0 1 .75-.75" clipRule="evenodd"/></svg>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
