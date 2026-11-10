"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Mic, Crown, Users, Vote, ScrollText, Plus, Copy, Check, Radio, ArrowRight, RotateCcw } from "lucide-react";
import { questTeamSizes } from "@/lib/rules";

type Player = { id:string; name:string; joined:boolean };
type TeamVote = { playerId:string; choice:"approve"|"reject" };
type Proposal = { id:string; leaderId:string; team:string[]; votes:TeamVote[]; result?:"approved"|"rejected" };
type QuestRecord = { quest:number; team:string[]; success:number; fail:number; result:"success"|"fail"; proposal:number };
type Event = { title:string; detail:string; time:string };
type Game = {
  code:string; players:Player[]; hostId:string; phase:"lobby"|"team"|"approval"|"quest"|"finished";
  quest:number; leader:number; team:string[]; proposals:Proposal[]; currentVotes:TeamVote[];
  questSubmittedCount:number; questSuccess:number; questFail:number; history:QuestRecord[];
  events:Event[]; rejects:number; votesRevealed:boolean; teamVoteCount?:number;
};
type RpcSession = { state:Game; playerId:string; sessionToken?:string; myQuestSubmitted?:boolean; myTeamVoteSubmitted?:boolean; teamVoteCount?:number };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase: SupabaseClient | null = supabaseUrl && supabaseKey ? createClient(supabaseUrl,supabaseKey) : null;
const SpeechRecognition = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

export default function Home(){
  const [game,setGame] = useState<Game|null>(null);
  const [playerId,setPlayerId] = useState("");
  const [sessionToken,setSessionToken] = useState("");
  const [name,setName] = useState("");
  const [room,setRoom] = useState("");
  const [typedName,setTypedName] = useState("");
  const [listening,setListening] = useState(false);
  const [message,setMessage] = useState("");
  const [teamChoice,setTeamChoice] = useState<string[]>([]);
  const [myVoteSubmitted,setMyVoteSubmitted] = useState(false);
  const [questSubmitted,setQuestSubmitted] = useState(false);
  const [historyOpen,setHistoryOpen] = useState(false);
  const [connected,setConnected] = useState(false);
  const [busy,setBusy] = useState(false);
  const [moderatorOn,setModeratorOn] = useState(false);
  const [heardText,setHeardText] = useState("");
  const [detectedTeam,setDetectedTeam] = useState<string[]|null>(null);
  const [voiceNotice,setVoiceNotice] = useState("");
  const voiceRef=useRef<any>(null);
  const moderatorOnRef=useRef(false);
  const gameRef=useRef<Game|null>(null);
  const detectedRef=useRef<string[]|null>(null);
  const recentSpeechRef=useRef("");
  gameRef.current=game;
  detectedRef.current=detectedTeam;

  const sizes = useMemo(()=>game ? questTeamSizes(game.players.length) : [],[game]);
  const currentProposal = game?.proposals[game.proposals.length-1];
  const isHost = !!game && game.hostId===playerId;
  const isLeader=!!game && game.players[game.leader]?.id===playerId;
  const canConfirmTeam=isLeader;
  const isOnQuest = !!game?.team.includes(playerId);
  const myPlayer = game?.players.find(p=>p.id===playerId);
  const isConfigured = !!supabase;
  const voteCount = game?.teamVoteCount ?? 0;
  const questCount = game?.questSubmittedCount ?? 0;

  async function applySession(result:RpcSession, token?:string){
    setGame(result.state); setPlayerId(result.playerId);
    if(token){ setSessionToken(token); localStorage.setItem("avalon-session-token",token); }
    setMyVoteSubmitted(!!result.myTeamVoteSubmitted);
    setQuestSubmitted(!!result.myQuestSubmitted);
    setConnected(true);
  }
  async function refresh(){
    if(!supabase || !sessionToken)return;
    const {data,error}=await supabase.rpc("avalon_get_state",{p_session_token:sessionToken});
    if(error){setConnected(false);setMessage(error.message);return;}
    const result=data as RpcSession;
    setGame({...result.state,teamVoteCount:result.teamVoteCount});
    setPlayerId(result.playerId);
    setMyVoteSubmitted(!!result.myTeamVoteSubmitted);
    setQuestSubmitted(!!result.myQuestSubmitted);
    setConnected(true);
  }
  useEffect(()=>{
    const token=localStorage.getItem("avalon-session-token");
    if(token)setSessionToken(token);
  },[]);
  useEffect(()=>{ if(sessionToken)refresh(); },[sessionToken]);
  useEffect(()=>{
    if(!sessionToken)return;
    const timer=window.setInterval(()=>{refresh();},1600);
    return ()=>window.clearInterval(timer);
  },[sessionToken]);

  async function callRpc(name:string,args:Record<string,unknown>){
    if(!supabase)throw new Error("Supabase is not configured. Check the environment variables.");
    setBusy(true);
    try{
      const {data,error}=await supabase.rpc(name,args);
      if(error)throw error;
      return data;
    } finally { setBusy(false); }
  }
  async function createGame(){
    if(!name.trim())return setMessage("Say or enter your name first.");
    try{
      const data=await callRpc("avalon_create_room",{p_display_name:name.trim()}) as RpcSession;
      await applySession(data,data.sessionToken);
      setMessage("Room created. Share the code with everyone.");
    }catch(e:any){setMessage(e.message||"Could not create room.");}
  }
  async function joinGame(){
    if(!room.trim()||!typedName.trim())return setMessage("Enter a room code and your name.");
    try{
      const data=await callRpc("avalon_join_room",{p_room_code:room.trim().toUpperCase(),p_display_name:typedName.trim()}) as RpcSession;
      await applySession(data,data.sessionToken);
      setMessage("Joined room "+data.state.code+".");
    }catch(e:any){setMessage(e.message||"Could not join room.");}
  }
  function register(nameValue:string){
    const clean=nameValue.trim().replace(/\s+/g," ").slice(0,28);
    if(!clean){setMessage("I didn't catch a name. Try again.");return;}
    setName(clean);setTypedName(clean);setMessage("Name recognized: "+clean+". Confirm it before continuing.");
  }
  function listen(){
    if(!SpeechRecognition){setMessage("Voice recognition isn't supported in this browser. Type your name instead.");return;}
    const rec=new SpeechRecognition();rec.lang="en-US";rec.interimResults=false;rec.maxAlternatives=3;
    rec.onstart=()=>setListening(true);rec.onend=()=>setListening(false);
    rec.onerror=()=>setMessage("Microphone unavailable. Check browser permissions or type your name.");
    rec.onresult=(e:any)=>register(e.results[0][0].transcript);rec.start();
  }
  async function startGame(){
    try{const state=await callRpc("avalon_start_game",{p_session_token:sessionToken}) as Game;setGame(state);setMessage("Game started.");}
    catch(e:any){setMessage(e.message||"Could not start game.");}
  }
  function toggleTeam(id:string){
    if(!game)return;const required=sizes[game.quest-1]||2;
    setTeamChoice(old=>old.includes(id)?old.filter(x=>x!==id):old.length<required?[...old,id]:old);
  }
  function detectNomination(transcript:string, current:Game){
    const text=transcript.toLocaleLowerCase();
    const matches=current.players.filter(p=>{
      const escaped=p.name.toLocaleLowerCase().replace(/[^a-z0-9 ]/g,"").trim();
      return new RegExp("(^|[^\\p{L}\\p{N}])"+escaped+"(?=$|[^\\p{L}\\p{N}])","iu").test(text);
    }).map(p=>p.id);
    const required=questTeamSizes(current.players.length)[current.quest-1];
    // Never finalize a team automatically; suggestions are editable and require a tap.
    if(matches.length===required){
      setDetectedTeam(matches);
      setTeamChoice(matches);
      setVoiceNotice("Possible nomination heard. Check every name before confirming.");
    }else if(matches.length>0){
      setVoiceNotice("Heard "+matches.length+" player name(s). Waiting for a complete team of "+required+".");
    }
  }
  function stopModerator(){
    moderatorOnRef.current=false;
    setModeratorOn(false);
    voiceRef.current?.stop();
    voiceRef.current=null;
  }
  function startModerator(){
    if(!SpeechRecognition){setVoiceNotice("Continuous speech recognition is unavailable in this browser. Use manual team selection.");return;}
    if(!game||game.phase!=="team"||!canConfirmTeam)return;
    const rec=new SpeechRecognition();
    rec.lang="en-US";rec.continuous=true;rec.interimResults=false;rec.maxAlternatives=1;
    rec.onresult=(event:any)=>{
      for(let i=event.resultIndex;i<event.results.length;i++){
        if(!event.results[i].isFinal)continue;
        const phrase=String(event.results[i][0].transcript||"").trim();
        setHeardText(phrase);
        const g=gameRef.current;
        if(g?.phase==="team"&&!detectedRef.current){
          recentSpeechRef.current=(recentSpeechRef.current+" "+phrase).slice(-600);
          detectNomination(recentSpeechRef.current,g);
        }
      }
    };
    rec.onerror=(event:any)=>{
      if(event.error==="not-allowed"||event.error==="service-not-allowed"){stopModerator();setVoiceNotice("Microphone permission denied. Enable microphone access or select manually.");}
      else setVoiceNotice("Speech recognition interrupted. You can still select the team manually.");
    };
    rec.onend=()=>{
      if(moderatorOnRef.current&&gameRef.current?.phase==="team"){
        try{rec.start();}catch{stopModerator();}
      }
    };
    voiceRef.current=rec;moderatorOnRef.current=true;setModeratorOn(true);
    setVoiceNotice("Listening for a team nomination. Audio is processed by the browser speech service; no audio is saved in Avalon.");
    try{rec.start();}catch{stopModerator();setVoiceNotice("Could not start microphone. Select the team manually.");}
  }
  useEffect(()=>{
    if(game?.phase!=="team"&&moderatorOnRef.current)stopModerator();
  },[game?.phase]);
  useEffect(()=>()=>{moderatorOnRef.current=false;voiceRef.current?.stop();},[]);
  async function propose(){
    if(!game||teamChoice.length!==(sizes[game.quest-1]||2))return;
    try{const state=await callRpc("avalon_propose_team",{p_session_token:sessionToken,p_player_ids:teamChoice}) as Game;setGame(state);setTeamChoice([]);setDetectedTeam(null);recentSpeechRef.current="";stopModerator();setMyVoteSubmitted(false);}
    catch(e:any){setMessage(e.message||"Could not propose team.");}
  }
  async function castTeamVote(choice:"approve"|"reject"){
    if(myVoteSubmitted)return;
    try{
      const state=await callRpc("avalon_cast_team_vote",{p_session_token:sessionToken,p_choice:choice}) as Game;
      setMyVoteSubmitted(true);
      if(state.phase)setGame(state);else await refresh();
      setMessage("Vote submitted privately. It will be revealed when everyone has voted.");
    }catch(e:any){setMessage(e.message||"Could not submit vote.");}
  }
  async function castQuestVote(choice:"success"|"fail"){
    if(questSubmitted)return;
    try{
      const state=await callRpc("avalon_cast_quest_vote",{p_session_token:sessionToken,p_choice:choice}) as Game;
      setQuestSubmitted(true);setGame(state);
      setMessage("Card submitted. Your choice is not stored or shown to the room.");
    }catch(e:any){setMessage(e.message||"Could not submit quest card.");}
  }
  function resetLocal(){
    stopModerator();setDetectedTeam(null);setGame(null);setMessage("");setName("");setTypedName("");setRoom("");setPlayerId("");setSessionToken("");setTeamChoice([]);setMyVoteSubmitted(false);setQuestSubmitted(false);
    localStorage.removeItem("avalon-session-token");
  }
  const displayVotes=currentProposal?.votes??[];

  return <main className="shell">
    <header className="top"><div><div className="eyebrow">A social deduction companion</div><h1>AVALON<span> / </span>COMPANION</h1></div><div className="row"><span className="tag"><span className={"dot "+(connected?"online":"")}/>{connected?"Synced":"Not connected"}</span></div></header>
    {!game ? <section className="card hero center">
      <div className="crest">♜</div><div className="eyebrow">The Resistance: Avalon</div><h2>Keep the game moving.<br/><em>Keep secrets secret.</em></h2>
      <p className="muted">A shared game table for nominations, simultaneous votes, anonymous quest cards, and a complete public history.</p>
      <div style={{maxWidth:440,margin:"28px auto 0",textAlign:"left"}}>
        <label className="small muted">Your name</label>
        <div className="row" style={{marginTop:7}}><input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="Say or type your name"/><button className={"mic "+(listening?"listening":"")} onClick={listen} aria-label="Speak your name"><Mic size={21}/></button></div>
        <div className="small muted" style={{margin:"7px 0 18px"}}>Voice recognition turns speech into editable text. No voiceprint or audio recording is stored.</div>
        <button className="btn" style={{width:"100%"}} disabled={busy||!isConfigured} onClick={createGame}><Plus size={17} style={{verticalAlign:"middle",marginRight:7}}/>Create a room</button>
        <div className="divider"/>
        <div className="row"><input className="input" value={room} onChange={e=>setRoom(e.target.value.toUpperCase())} placeholder="Room code"/><input className="input" value={typedName} onChange={e=>setTypedName(e.target.value)} placeholder="Your name"/></div>
        <button className="btn secondary" style={{width:"100%",marginTop:9}} disabled={busy||!isConfigured} onClick={joinGame}>Join a room <ArrowRight size={16} style={{verticalAlign:"middle"}}/></button>
        {!isConfigured&&<div className="notice" style={{marginTop:18}}>Supabase environment variables are missing. Configure them before using multiplayer.</div>}
        {message&&<p className="small" style={{color:"var(--gold)"}}>{message}</p>}
      </div>
    </section> : <div>
      <div className="row between" style={{marginBottom:18,flexWrap:"wrap"}}><div><div className="eyebrow">Room code</div><div className="big">{game.code}</div></div><button className="btn secondary" onClick={()=>navigator.clipboard?.writeText(game.code)}><Copy size={15} style={{verticalAlign:"middle",marginRight:6}}/>Copy code</button></div>
      <div className="grid">
        <section className="card">
          <div className="row between"><h2 className="section-title">Game table</h2><span className="tag">{game.players.length} players</span></div>
          <div className="players">{game.players.map((p,i)=><span className="pill" key={p.id}>{i===game.leader&&game.phase!=="lobby"?"♛ ":""}{p.name}{p.id===playerId?" (you)":""}</span>)}</div>
          <div className="divider"/>
          <div className="row between"><div><div className="eyebrow">Current phase</div><h2 className="section-title" style={{marginTop:5}}>{game.phase==="lobby"?"Waiting room":game.phase==="team"?"Team nomination":game.phase==="approval"?"Team approval":game.phase==="quest"?"Quest cards":"Game complete"}</h2></div><span className="status">Quest {Math.min(game.quest,5)} / 5</span></div>
          <div className="notice">{game.phase==="lobby"?"Players join from their own phones using this room code.":game.phase==="team"?"The leader selects "+(sizes[game.quest-1]||0)+" players for this quest.":game.phase==="approval"?"Everyone votes. Individual choices reveal only after all votes are in.":game.phase==="quest"?"Only the approved team can submit. Individual card choices are never displayed.":"The game has ended. Review the history below."}</div>
          {game.phase==="lobby"&&<div style={{marginTop:18}}><p className="small muted">Share the room code with the other players. Each person joins on their own device. The room creator can start once 5–10 players have joined.</p>{isHost&&<button className="btn" style={{width:"100%",marginTop:8}} disabled={busy||game.players.length<5} onClick={startGame}>Start game</button>}</div>}
          {game.phase==="team"&&<div style={{marginTop:18}}>
            {canConfirmTeam&&<div className="notice" style={{marginBottom:14}}>
              <div className="row between" style={{flexWrap:"wrap"}}><b>Voice team moderator</b><button className="btn secondary" onClick={moderatorOn?stopModerator:startModerator}>{moderatorOn?"Stop listening":"Start listening"}</button></div>
              <p className="small muted">Optional: keep this phone awake and the page open. The microphone is active only while listening is enabled. Browser speech services may process audio remotely. Ask everyone at the table for consent.</p>
              {heardText&&<p className="small">Last heard: “{heardText}”</p>}
              {voiceNotice&&<p className="small">{voiceNotice}</p>}
              {detectedTeam&&<div className="notice" style={{marginTop:10}}>
                <b>Is this the nominated quest team?</b>
                <p>{teamChoice.map(id=>game.players.find(p=>p.id===id)?.name).join(", ")||"Select players below"}</p>
                <p className="small muted">Check the names below, edit any mistakes, then confirm. The AI never submits automatically.</p>
                <button className="btn secondary" onClick={()=>{setDetectedTeam(null);recentSpeechRef.current="";setVoiceNotice("Suggestion dismissed. Listening for the next nomination.");}}>Dismiss suggestion</button>
              </div>}
            </div>}
            <div className="row between"><h3 className="section-title">Select the quest team</h3><span className="tag">{teamChoice.length}/{sizes[game.quest-1]} selected</span></div><div>{game.players.map(p=><div className="player-row" key={p.id}><span>{p.name}{p.id===game.players[game.leader].id?" · Leader":""}</span><button className={"btn "+(teamChoice.includes(p.id)?"":"secondary")} onClick={()=>toggleTeam(p.id)}>{teamChoice.includes(p.id)?"Selected":"Select"}</button></div>)}</div><button className="btn" style={{width:"100%",marginTop:14}} disabled={busy||teamChoice.length!==sizes[game.quest-1]||!isLeader} onClick={propose}>{detectedTeam?"Confirm and propose team":"Propose team"}</button></div>}
          {game.phase==="approval"&&<div style={{marginTop:18}}><h3 className="section-title">Approve this team?</h3><div className="players">{game.team.map(id=><span className="pill" key={id}>{game.players.find(p=>p.id===id)?.name}</span>)}</div><div className="row between" style={{margin:"16px 0 8px"}}><b>Votes received</b><b>{voteCount}/{game.players.length}</b></div><div className="actions"><button className="vote approve" disabled={busy||myVoteSubmitted} onClick={()=>castTeamVote("approve")}>{myVoteSubmitted?"✓ Submitted":"Approve"}</button><button className="vote reject" disabled={busy||myVoteSubmitted} onClick={()=>castTeamVote("reject")}>{myVoteSubmitted?"✓ Submitted":"Reject"}</button></div><p className="small muted">Individual votes are hidden until everyone has voted. You cannot change your vote after submission.</p>{game.votesRevealed&&<div className="notice">{displayVotes.filter(v=>v.choice==="approve").length} approve · {displayVotes.filter(v=>v.choice==="reject").length} reject. {currentProposal?.result==="approved"?"Team approved.":"Team rejected."}<div className="players" style={{marginTop:8}}>{displayVotes.map(v=><span className={"tag "+(v.choice==="approve"?"green":"red")} key={v.playerId}>{game.players.find(p=>p.id===v.playerId)?.name}: {v.choice}</span>)}</div></div>}</div>}
          {game.phase==="quest"&&<div style={{marginTop:18}}><h3 className="section-title">Quest voting</h3><p className="muted small">Authorized participants: {game.team.map(id=>game.players.find(p=>p.id===id)?.name).join(", ")}</p>{isOnQuest?<><div className="actions"><button className="vote success" disabled={busy||questSubmitted} onClick={()=>castQuestVote("success")}>{questSubmitted?"✓ Submitted":"SUCCESS"}</button><button className="vote fail" disabled={busy||questSubmitted} onClick={()=>castQuestVote("fail")}>{questSubmitted?"✓ Submitted":"FAIL"}</button></div><p className="small muted">Your card is private. Neither your choice nor a partial tally is visible to anyone.</p></>:<div className="notice">You are not on this quest. Waiting for the selected players to submit their cards.</div>}<div className="row between" style={{marginTop:14}}><span className="muted small">Cards submitted</span><b>{questCount}/{game.team.length}</b></div></div>}
          {game.phase==="finished"&&<div className="center" style={{padding:20}}><Crown size={38} color="var(--gold)"/><h2 className="section-title" style={{marginTop:10}}>Game complete</h2><button className="btn secondary" onClick={()=>setHistoryOpen(true)}>Review game history</button></div>}
        </section>
        <aside className="card">
          <div className="row between"><h2 className="section-title">Quest track</h2><span className="tag">{game.history.length} resolved</span></div>
          <div className="row" style={{gap:7,marginBottom:17}}>{[1,2,3,4,5].map(n=>{const h=game.history.find(x=>x.quest===n);return <div key={n} style={{flex:1,textAlign:"center"}}><div style={{height:8,borderRadius:8,background:h?(h.result==="success"?"#2d9666":"#a84c54"):"#354454"}}/><div className="small muted" style={{marginTop:6}}>Q{n}</div></div>})}</div>
          <div className="row between"><span className="muted small">Rejected proposals</span><b>{game.rejects}/5</b></div><div className="divider"/><h3 className="section-title">Recent activity</h3>
          <div className="timeline">{game.events.slice(-6).reverse().map((e,i)=><div className="event" key={i}><b>{e.title}</b><div className="small muted">{e.detail}</div><div className="small muted">{e.time}</div></div>)}</div>
          <div className="divider"/><button className="btn secondary" style={{width:"100%"}} onClick={()=>setHistoryOpen(!historyOpen)}><ScrollText size={16} style={{verticalAlign:"middle",marginRight:7}}/>{historyOpen?"Hide":"View"} full history</button>
          <button className="btn ghost" style={{width:"100%",marginTop:8}} onClick={resetLocal}><RotateCcw size={15} style={{verticalAlign:"middle",marginRight:6}}/>Exit room</button>
        </aside>
      </div>
      {historyOpen&&<section className="card" style={{marginTop:18}}><h2 className="section-title">Full game history</h2>{game.proposals.map((p,i)=><div className="event" key={p.id}><b>Proposal {i+1}</b><div className="small muted">Leader: {game.players.find(x=>x.id===p.leaderId)?.name} · Team: {p.team.map(id=>game.players.find(x=>x.id===id)?.name).join(", ")}</div>{p.votes.length>0&&<div className="small" style={{marginTop:7}}>{p.votes.map(v=><span className={"tag "+(v.choice==="approve"?"green":"red")} style={{marginRight:5}} key={v.playerId}>{game.players.find(x=>x.id===v.playerId)?.name}: {v.choice}</span>)}</div>}<div className="small muted">{p.result||"Pending"}</div></div>)}{game.history.map(h=><div className="event" key={h.quest}><b>Quest {h.quest}: {h.result.toUpperCase()}</b><div className="small muted">Team: {h.team.map(id=>game.players.find(x=>x.id===id)?.name).join(", ")} · {h.success} Success / {h.fail} Fail</div></div>)}</section>}
    </div>}
    {message&&<p className="small" style={{color:"var(--gold)",marginTop:12}}>{message}</p>}
    <footer className="center small muted" style={{marginTop:35}}>Avalon Companion · Physical role cards stay physical. The app never stores roles.</footer>
  </main>;
}
