"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const names=["Alex","Blair","Casey","Drew","Elliot"];
const sizes=[2,3,2,3,3];
type Phase="team"|"approval"|"quest"|"finished";
type Ballot="approve"|"reject";
export default function Demo(){
  const [phase,setPhase]=useState<Phase>("team");
  const [quest,setQuest]=useState(1);
  const [leader,setLeader]=useState(0);
  const [team,setTeam]=useState<number[]>([]);
  const [candidate,setCandidate]=useState<number[]>([]);
  const [spoken,setSpoken]=useState("");
  const [notice,setNotice]=useState("Say: I'm sending Alex and Casey.");
  const [listening,setListening]=useState(false);
  const [votes,setVotes]=useState<Ballot[]>([]);
  const [questCards,setQuestCards]=useState<("success"|"fail")[]>([]);
  const [rejects,setRejects]=useState(0);
  const [wins,setWins]=useState({good:0,evil:0});
  const [log,setLog]=useState<string[]>([]);
  const recRef=useRef<any>(null);
  const phaseRef=useRef<Phase>("team");
  phaseRef.current=phase;
  function detect(text:string){
    const clean=text.toLowerCase();
    const found=names.map((n,i)=>({i,n})).filter(x=>new RegExp("\\b"+x.n.toLowerCase()+"\\b").test(clean)).map(x=>x.i);
    setSpoken(text);
    if(found.length===sizes[quest-1]){setCandidate(found);setNotice("Possible team detected. Review and confirm below.");}
    else setNotice("Heard "+found.length+" player names; this quest requires "+sizes[quest-1]+". You can select names manually.");
  }
  function stop(){recRef.current?.stop();recRef.current=null;setListening(false);}
  function start(){
    const Speech=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
    if(!Speech){setNotice("Speech recognition unavailable in this browser. Try Chrome or use manual selection.");return;}
    const r=new Speech();r.lang="en-US";r.continuous=true;r.interimResults=false;
    r.onresult=(e:any)=>{for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)detect(String(e.results[i][0].transcript));};
    r.onerror=(e:any)=>{setNotice("Microphone issue: "+e.error);if(e.error==="not-allowed")stop();};
    r.onend=()=>{if(recRef.current===r&&phaseRef.current==="team"){try{r.start();}catch{setListening(false);}}};
    recRef.current=r;try{r.start();setListening(true);setNotice("Listening. Keep this page active.");}catch{setNotice("Could not start microphone.");}
  }
  useEffect(()=>()=>{recRef.current?.stop();},[]);
  function toggle(i:number){setCandidate(old=>old.includes(i)?old.filter(x=>x!==i):old.length<sizes[quest-1]?[...old,i]:old);}
  function nominate(){
    if(candidate.length!==sizes[quest-1])return;
    stop();setTeam([...candidate]);setPhase("approval");setVotes([]);setLog(old=>[...old,"Quest "+quest+": "+names[leader]+" nominated "+candidate.map(i=>names[i]).join(", ")]);
  }
  function teamVote(choice:Ballot){
    const next=[...votes,choice];setVotes(next);
    if(next.length<5)return;
    const yes=next.filter(v=>v==="approve").length;
    if(yes>=3){setPhase("quest");setQuestCards([]);setRejects(0);setLog(old=>[...old,"Team approved "+yes+"–"+(5-yes)]);}
    else{
      const n=rejects+1;setRejects(n);setLeader(l=>(l+1)%5);setCandidate([]);setPhase(n>=5?"finished":"team");
      setLog(old=>[...old,"Team rejected "+yes+"–"+(5-yes)]);
      if(n>=5)setWins(w=>({...w,evil:3}));
    }
  }
  function questVote(choice:"success"|"fail"){
    const next=[...questCards,choice];setQuestCards(next);
    if(next.length<team.length)return;
    const fails=next.filter(x=>x==="fail").length;
    const success=fails===0;
    const w={good:wins.good+(success?1:0),evil:wins.evil+(success?0:1)};
    setWins(w);setLog(old=>[...old,"Quest "+quest+" "+(success?"succeeded":"failed")+" ("+fails+" fails)"]);
    if(w.good>=3||w.evil>=3||quest===5)setPhase("finished");
    else{setQuest(q=>q+1);setLeader(l=>(l+1)%5);setCandidate([]);setTeam([]);setPhase("team");}
  }
  function reset(){stop();setPhase("team");setQuest(1);setLeader(0);setTeam([]);setCandidate([]);setVotes([]);setQuestCards([]);setRejects(0);setWins({good:0,evil:0});setLog([]);setNotice("Say: I'm sending Alex and Casey.");setSpoken("");}
  return <main className="shell">
    <header className="top"><div><div className="eyebrow">Private local simulation</div><h1>AVALON / SOLO DEMO</h1></div><Link href="/" className="btn secondary">Back to real game</Link></header>
    <section className="card"><h2 className="section-title">Play without five people</h2>
      <p className="muted">Five simulated players. No room, database writes, or real votes. You control every ballot on this device. Voice recognition may send audio to your browser provider; get consent before recording others.</p>
      <p><b>Quest {quest} / 5</b> · Leader: {names[leader]} · Rejections: {rejects}/5 · Good: {wins.good} · Evil: {wins.evil}</p>
      {phase==="team"&&<div>
        <h3>Nominate {sizes[quest-1]} players</h3>
        <button className="btn" onClick={listening?stop:start}>{listening?"Stop listening":"Start listening"}</button>
        <p className="small muted">{notice}</p>
        {spoken&&<p>Last heard: “{spoken}”</p>}
        {names.map((n,i)=><div key={n} className="player-row"><span>{n}</span><button className={"btn "+(candidate.includes(i)?"":"secondary")} onClick={()=>toggle(i)}>{candidate.includes(i)?"Selected":"Select"}</button></div>)}
        <p>Proposed: {candidate.map(i=>names[i]).join(", ")||"None"}</p>
        <button className="btn" disabled={candidate.length!==sizes[quest-1]} onClick={nominate}>Confirm team and start approval</button>
      </div>}
      {phase==="approval"&&<div><h3>Team approval</h3><p>{team.map(i=>names[i]).join(", ")}</p><p>Cast vote {votes.length+1} of 5 (simulated players)</p><div className="actions"><button className="vote approve" onClick={()=>teamVote("approve")}>Approve</button><button className="vote reject" onClick={()=>teamVote("reject")}>Reject</button></div><p className="small muted">Votes are simulated locally. The result appears after all five votes.</p></div>}
      {phase==="quest"&&<div><h3>Quest cards</h3><p>Approved team: {team.map(i=>names[i]).join(", ")}</p><p>Submit simulated anonymous card {questCards.length+1} of {team.length}</p><div className="actions"><button className="vote success" onClick={()=>questVote("success")}>Success</button><button className="vote fail" onClick={()=>questVote("fail")}>Fail</button></div></div>}
      {phase==="finished"&&<div><h2>Game finished</h2><p>{wins.good>=3?"Good wins!":"Evil wins!"}</p></div>}
      <div className="divider"/><button className="btn secondary" onClick={reset}>Reset demo</button>
    </section>
    <section className="card" style={{marginTop:16}}><h2 className="section-title">Demo history</h2>{log.length?log.map((x,i)=><p key={i}>{x}</p>):<p className="muted">No actions yet.</p>}</section>
  </main>;
}
