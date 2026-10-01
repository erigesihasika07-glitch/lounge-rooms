(()=>{
const $=s=>document.querySelector(s);
// Add a TURN server here if people on strict networks can't connect, e.g. {urls:"turn:HOST:3478",username:"U",credential:"P"}
const ICE=[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}];
let peer,mode="create",me={},local,mic,cam,screen,ac,sharing=false,shareT=null,live=false;
const calls={},names={},allowed=new Set(),pending={},conns={};
const slug=s=>s.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
const rid=r=>"lounge-"+slug(r);
const sha=async s=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,"0")).join("");
let tt;const toast=t=>{const e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(tt);tt=setTimeout(()=>e.classList.remove("on"),4500)};

function setMode(m){mode=m;$("#tCreate").setAttribute("aria-selected",m==="create");$("#tJoin").setAttribute("aria-selected",m==="join");$("#go").textContent=m==="create"?"Create room":"Join room";$("#err").textContent=""}
$("#tCreate").onclick=()=>setMode("create");$("#tJoin").onclick=()=>setMode("join");
const q=new URLSearchParams(location.search).get("room");if(q){$("#fRoom").value=q;setMode("join")}

function fail(t){$("#err").textContent=t;$("#go").disabled=false;live=false;
  [mic,cam].forEach(x=>x&&x.stop());try{peer&&peer.destroy()}catch(e){}peer=null;local=null}

async function getMedia(){
  let s;
  try{s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:{width:640,height:360}})}
  catch(e){try{s=await navigator.mediaDevices.getUserMedia({audio:true})}catch(e2){throw new Error("Allow microphone access in your browser, then try again.")}}
  mic=s.getAudioTracks()[0];cam=s.getVideoTracks()[0];
  if(!cam){const c=document.createElement("canvas");c.width=c.height=16;const x=c.getContext("2d");x.fillStyle="#292548";x.fillRect(0,0,16,16);cam=c.captureStream(1).getVideoTracks()[0];$("#bCam").hidden=true}
  local=new MediaStream([mic,cam]);
}

function layout(){const n=Object.keys(calls).length+1;$("#rCount").textContent=n===1?"Just you so far":`${n} people here`}
function tile(id,name,stream,isMe){
  let t=document.getElementById("t-"+id);
  if(!t){t=document.createElement("div");t.className="tile";t.id="t-"+id;t.title="Click to enlarge";
    t.innerHTML='<video autoplay playsinline></video><span class="nm"></span>';
    t.onclick=()=>{const was=t.classList.contains("spot");document.querySelectorAll(".spot").forEach(x=>x.classList.remove("spot"));
      if(!was)t.classList.add("spot");$("#grid").classList.toggle("has-spot",!was)};
    $("#grid").append(t)}
  t.querySelector(".nm").textContent=name+(isMe?" (you)":"");
  const v=t.querySelector("video");v.muted=!!isMe;if(v.srcObject!==stream){v.srcObject=stream;v.play().catch(()=>{})}
  layout();
}
function apply(c){if(!sharing||!shareT)return;c.peerConnection.getSenders().forEach(s=>{
  if(s.track&&s.track.kind==="video")s.replaceTrack(shareT.v);if(s.track&&s.track.kind==="audio")s.replaceTrack(shareT.a)})}
function hook(c,id){
  calls[id]=c;
  c.on("stream",s=>{tile(id,names[id]||"Guest",s);apply(c)});
  const gone=()=>{if(calls[id]===c){delete calls[id];const t=document.getElementById("t-"+id);if(t){t.remove();if(!document.querySelector(".spot"))$("#grid").classList.remove("has-spot")}layout()}};
  c.on("close",gone);c.on("error",gone);
}
function allow(id,name){names[id]=name;allowed.add(id);if(pending[id]){pending[id]();delete pending[id]}}
function wireCalls(){peer.on("call",c=>{const id=c.peer;
  const go=()=>{names[id]=(c.metadata&&c.metadata.name)||names[id]||"Guest";c.answer(local);hook(c,id)};
  if(allowed.has(id))go();else{pending[id]=go;setTimeout(()=>delete pending[id],8000)}})}

function enter(){
  if(live)return;live=true;
  $("#lobby").hidden=true;$("#room").hidden=false;$("#rName").textContent=me.room;
  tile("me",me.name,local,true);
  $("#bShare").hidden=!(navigator.mediaDevices&&navigator.mediaDevices.getDisplayMedia);
}

function createRoom(){
  peer=new Peer(rid(me.room),{config:{iceServers:ICE}});wireCalls();
  peer.on("open",enter);
  peer.on("error",e=>fail(e.type==="unavailable-id"?"A room with that name is already open. Pick another name, or use Join.":"Connection problem ("+e.type+"). Please try again."));
  peer.on("connection",c=>{
    c.on("data",d=>{
      if(!d||d.type!=="join")return;
      if(d.pw!==me.hash){c.send({type:"denied"});setTimeout(()=>c.close(),400);return}
      const nm=String(d.name||"Guest").slice(0,24);
      const members=[{id:peer.id,name:me.name},...Object.keys(conns).map(i=>({id:i,name:names[i]}))];
      Object.values(conns).forEach(x=>x.send({type:"joined",id:c.peer,name:nm}));
      conns[c.peer]=c;allow(c.peer,nm);c.send({type:"ok",members});
    });
    c.on("close",()=>{delete conns[c.peer];allowed.delete(c.peer)});
  });
}
function joinRoom(){
  peer=new Peer({config:{iceServers:ICE}});wireCalls();
  peer.on("error",e=>fail(e.type==="peer-unavailable"?"No open room has that name. Check the spelling, or ask the host to open it.":"Connection problem ("+e.type+"). Please try again."));
  peer.on("open",()=>{
    const c=peer.connect(rid(me.room),{reliable:true});
    c.on("open",()=>c.send({type:"join",name:me.name,pw:me.hash}));
    c.on("data",d=>{
      if(d.type==="denied")fail("That password isn't right.");
      else if(d.type==="ok"){enter();d.members.forEach(m=>{allow(m.id,m.name);const call=peer.call(m.id,local,{metadata:{name:me.name}});hook(call,m.id)})}
      else if(d.type==="joined")allow(d.id,d.name);
    });
    c.on("close",()=>{if(live)toast("The host left. People already here stay connected, but nobody new can join until the host is back.")});
  });
}

$("#panel").onsubmit=async e=>{
  e.preventDefault();$("#err").textContent="";
  const name=$("#fName").value.trim(),room=$("#fRoom").value.trim(),pw=$("#fPw").value;
  if(!slug(room))return $("#err").textContent="Use letters or numbers in the room name.";
  me={name,room:slug(room),hash:await sha(slug(room)+":"+pw)};
  $("#go").disabled=true;
  try{await getMedia()}catch(x){return fail(x.message)}
  mode==="create"?createRoom():joinRoom();
};

$("#bMic").onclick=e=>{mic.enabled=!mic.enabled;e.target.setAttribute("aria-pressed",!mic.enabled);e.target.textContent=mic.enabled?"Mute":"Unmute"};
$("#bCam").onclick=e=>{cam.enabled=!cam.enabled;e.target.setAttribute("aria-pressed",!cam.enabled);e.target.textContent=cam.enabled?"Camera off":"Camera on"};
function swap(v,a){Object.values(calls).forEach(c=>c.peerConnection.getSenders().forEach(s=>{
  if(s.track&&s.track.kind==="video")s.replaceTrack(v);if(s.track&&s.track.kind==="audio")s.replaceTrack(a)}))}
async function startShare(){
  let s;try{s=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true})}catch(e){return}
  screen=s;const v=s.getVideoTracks()[0];let a=mic;const sa=s.getAudioTracks()[0];
  if(sa){ac=new AudioContext();const d=ac.createMediaStreamDestination();
    ac.createMediaStreamSource(new MediaStream([mic])).connect(d);ac.createMediaStreamSource(new MediaStream([sa])).connect(d);a=d.stream.getAudioTracks()[0]}
  shareT={v,a};sharing=true;swap(v,a);tile("me",me.name,s,true);
  $("#bShare").setAttribute("aria-pressed",true);$("#bShare").textContent="Stop sharing";
  v.onended=stopShare;
  toast(sa?"Sharing your screen with sound.":"Sharing without sound. To include sound, share a Chrome tab and tick “Share tab audio”.");
}
function stopShare(){
  if(!sharing)return;sharing=false;shareT=null;screen.getTracks().forEach(t=>t.stop());if(ac){ac.close();ac=null}
  swap(cam,mic);tile("me",me.name,local,true);
  $("#bShare").setAttribute("aria-pressed",false);$("#bShare").textContent="Share screen";
}
$("#bShare").onclick=()=>sharing?stopShare():startShare();
$("#bLeave").onclick=()=>{try{peer.destroy()}catch(e){}[mic,cam].forEach(x=>x&&x.stop());location.href=location.pathname};
$("#invite").onclick=async()=>{const u=location.origin+location.pathname+"?room="+encodeURIComponent(me.room);
  try{await navigator.clipboard.writeText(u);toast("Link copied. Share the password separately.")}catch(e){prompt("Copy this link:",u)}};
})();
