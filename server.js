const express=require('express'),http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {Server}=require('socket.io');
const app=express(),server=http.createServer(app),io=new Server(server,{maxHttpBufferSize:2*1024*1024});

const PORT=process.env.PORT||10000,TESTER='saba123',TURN=20,START=1000,USERFILE=path.join(__dirname,'users.json');
const VALUES={'6':0,'7':0,'8':0,'9':0,J:2,Q:3,K:4,'10':10,A:11},RANKS=['6','7','8','9','J','Q','K','10','A'],SUITS=['spades','clubs','diamonds','hearts'],TRUMPS=['spades','clubs','diamonds','hearts','no_trump'],AVATARS=['🦊','🐺','🦁','🐯','🐻','🦅','🐼','🐸','🐵','😎','🤠','🧙'],AUDIO=['სიქიიიიიმ!','ყვერო, მალე!','რას შვრები, ძმაო?!','ვაჰ, კოზირი!'];
const rooms=new Map(),tournamentRegs=new Map();

let users=(()=>{
  try{
    return fs.existsSync(USERFILE)
      ?JSON.parse(fs.readFileSync(USERFILE,'utf8'))||{}
      :{};
  }catch{
    return{};
  }
})();

const save=()=>{
  try{
    fs.writeFileSync(
      USERFILE,
      JSON.stringify(users,null,2)
    );
  }catch(e){
    console.error(e.message);
  }
};

const clean=v=>String(v||'')
  .trim()
  .replace(/\s+/g,' ')
  .slice(0,20);

const key=v=>clean(v).toLowerCase();

const id=p=>
  p+'_'+
  Date.now()+
  '_'+
  Math.floor(
    Math.random()*1e9
  );

const ri=c=>
  RANKS.indexOf(c.rank);

const tr=(c,t)=>
  t!=='no_trump'&&
  c.suit===t;

const pts=a=>
  (a||[]).reduce(
    (s,c)=>s+(c.value||0),
    0
  );

const same=a=>
  !!a.length&&
  a.every(
    c=>c.suit===a[0].suit
  );

const mali=a=>
  a.length===5&&
  same(a);

const today=()=>
  new Date()
    .toISOString()
    .slice(0,10);

const level=x=>
  Math.max(
    1,
    Math.floor(
      (x||0)/250
    )+1
  );

const frame=w=>
  w>=25
    ?'diamond'
    :w>=8
      ?'gold'
      :'bronze';

const quests=()=>({
  date:today(),
  wins:0,
  maliutka:0,
  tables:0,
  cw:false,
  cm:false,
  ct:false
});

function shape(u){
  if(!u)return null;

  if(!Number.isFinite(u.xp))
    u.xp=0;

  if(!Number.isFinite(u.wins))
    u.wins=0;

  if(!Number.isFinite(u.games))
    u.games=0;

  if(!Number.isFinite(u.balance))
    u.balance=START;

  if(!u.avatar)
    u.avatar=AVATARS[0];

  if(!Array.isArray(u.achievements))
    u.achievements=[];

  if(
    !u.quests||
    u.quests.date!==today()
  ){
    u.quests=quests();
  }

  u.level=level(u.xp);
  u.frame=frame(u.wins);

  return u;
}

const profile=u=>{
  shape(u);

  return{
    username:u.username,
    avatar:u.avatar,
    xp:u.xp,
    level:u.level,
    wins:u.wins,
    games:u.games,
    balance:u.balance,
    frame:u.frame,
    quests:u.quests,
    achievements:u.achievements
  };
};

const salt=()=>
  crypto.randomBytes(16)
    .toString('hex');

const hash=(p,s)=>
  crypto.scryptSync(
    String(p),
    s,
    64
  ).toString('hex');

function safeAvatar(a){
  a=String(a||'');

  if(AVATARS.includes(a))
    return a;

  if(
    /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/
      .test(a)
    &&
    a.length<700000
  ){
    return a;
  }

  return AVATARS[0];
}

function pushProfile(k){
  if(!users[k])
    return;

  for(
    const s of
    io.sockets.sockets.values()
  ){
    if(s.userKey===k){
      s.emit(
        'profileUpdate',
        profile(users[k])
      );
    }
  }
}

function xp(k,n){
  if(!users[k])
    return;

  shape(users[k]);

  users[k].xp+=n;

  save();

  pushProfile(k);
}

function quest(k,f,n=1){
  if(!users[k])
    return;

  let u=shape(users[k]);

  u.quests[f]=
    (u.quests[f]||0)+n;

  let b=0;

  if(
    u.quests.wins>=3&&
    !u.quests.cw
  ){
    u.quests.cw=true;
    b+=100;
  }

  if(
    u.quests.maliutka>=1&&
    !u.quests.cm
  ){
    u.quests.cm=true;
    b+=250;
  }

  if(
    u.quests.tables>=5&&
    !u.quests.ct
  ){
    u.quests.ct=true;
    b+=50;
  }

  u.xp+=b;

  save();

  pushProfile(k);
}

function achievement(
  room,
  p,
  k,
  title
){
  if(!p)
    return;

  if(
    p.userKey&&
    users[p.userKey]
  ){
    let u=
      shape(
        users[p.userKey]
      );

    if(
      u.achievements
        .includes(k)
    ){
      return;
    }

    u.achievements.push(k);
    u.xp+=50;

    save();

    pushProfile(
      p.userKey
    );
  }else{
    p.achievements=
      p.achievements||[];

    if(
      p.achievements
        .includes(k)
    ){
      return;
    }

    p.achievements
      .push(k);
  }

  io.to(room.id)
    .emit(
      'achievement',
      {
        playerName:p.name,
        title
      }
    );
}

function deck(){
  let d=[];

  for(const s of SUITS){
    for(const r of RANKS){
      d.push({
        suit:s,
        rank:r,
        value:VALUES[r]
      });
    }
  }

  for(
    let i=d.length-1;
    i;
    i--
  ){
    let j=
      Math.floor(
        Math.random()*
        (i+1)
      );

    [
      d[i],
      d[j]
    ]=[
      d[j],
      d[i]
    ];
  }

  return d;
}

function roomList(){
  return[
    ...rooms.values()
  ]
  .filter(
    r=>
      !r.game&&
      r.players.length<
      r.capacity
  )
  .map(
    r=>({
      id:r.id,
      name:r.name,
      stake:r.stake,
      capacity:r.capacity,
      players:r.players.length,
      parties:r.parties
    })
  );
}

function emitRooms(){
  io.emit(
    'lobbyTables',
    roomList()
  );
}

function newRoom(
  capacity,
  parties,
  stake,
  owner,
  name
){
  let r={
    id:id('room'),

    name:
      clean(name)||
      owner+' Table',

    capacity,
    parties,
    stake,

    players:[],

    game:null,

    timer:null
  };

  rooms.set(
    r.id,
    r
  );

  emitRooms();

  return r;
}

function newHand(
  room,
  prev
){
  let d=deck(),
      hands={},
      taken={},
      totals={};

  for(
    const p of
    room.players
  ){
    hands[p.id]=
      d.splice(0,5);

    taken[p.id]=[];

    totals[p.id]=
      prev
        ?(
          prev.totals[p.id]||
          0
        )
        :0;
  }

  let h=
    prev
      ?prev.handIndex+1
      :1;

  let leader=
    prev&&
    Number.isInteger(
      prev.nextLeaderIndex
    )
      ?prev.nextLeaderIndex
      :0;

  return{
    deck:d,

    hands,

    taken,

    totals,

    table:[],

    handIndex:h,

    partyIndex:
      Math.ceil(
        h/5
      ),

    trump:
      TRUMPS[
        (h-1)%
        TRUMPS.length
      ],

    currentTurnIndex:
      leader,

    nextLeaderIndex:
      leader,

    leadCount:null,

    leadWasMaliutka:
      false,

    leadPlayerId:null,

    processing:false,

    gameOver:false,

    lastHandScores:
      prev
        ?(
          prev.lastHandScores||
          {}
        )
        :{},

    history:
      prev
        ?(
          prev.history||
          []
        )
        :[],

    lastTrickOrder:[],

    turnEndsAt:
      Date.now()+
      TURN*1000
  };
}

function beats(
  a,
  b,
  t
){
  let at=tr(a,t),
      bt=tr(b,t);

  if(
    bt&&
    !at
  ){
    return true;
  }

  if(
    at&&
    !bt
  ){
    return false;
  }

  if(
    a.suit!==
    b.suit
  ){
    return false;
  }

  return(
    ri(b)>
    ri(a)
  );
}

/*
  MULTI CARD CUT FIX

  ეს ფუნქცია 2/3/4/5 კარტზე
  ცდის ყველა შესაძლო დაწყვილებას.
*/
function comboBeats(
  base,
  chal,
  t
){
  if(
    base.length!==
    chal.length
  ){
    return false;
  }

  let used=
    Array(
      chal.length
    ).fill(false);

  let b=
    base
      .slice()
      .sort(
        (x,y)=>
          ri(y)-ri(x)
      );

  function dfs(i){
    if(
      i===b.length
    ){
      return true;
    }

    for(
      let j=0;
      j<chal.length;
      j++
    ){
      if(used[j])
        continue;

      if(
        beats(
          b[i],
          chal[j],
          t
        )
      ){
        used[j]=true;

        if(
          dfs(i+1)
        ){
          return true;
        }

        used[j]=false;
      }
    }

    return false;
  }

  return dfs(0);
}

function winner(g){
  if(
    !g.table.length
  ){
    return -1;
  }

  let w=0;

  for(
    let i=1;
    i<g.table.length;
    i++
  ){
    if(
      comboBeats(
        g.table[w].cards,
        g.table[i].cards,
        g.trump
      )
    ){
      w=i;
    }
  }

  return w;
}

function willCut(
  g,
  cards
){
  let w=
    winner(g);

  return(
    !g.table.length
    ||
    (
      w>=0
      &&
      comboBeats(
        g.table[w].cards,
        cards,
        g.trump
      )
    )
  );
}

function valid(
  g,
  hand,
  idxs
){
  if(
    !idxs.length
  ){
    return{
      ok:false,
      message:
        'აირჩიე მინიმუმ 1 კარტი.'
    };
  }

  if(
    idxs.length>5
  ){
    return{
      ok:false,
      message:
        'მაქსიმუმ 5 კარტი.'
    };
  }

  let cards=
    idxs.map(
      i=>hand[i]
    );

  if(
    cards.some(
      x=>!x
    )
  ){
    return{
      ok:false,
      message:
        'კარტის არჩევაში შეცდომაა.'
    };
  }

  /*
    პირველი ჩამოსვლა:
    ყველა არჩეული კარტი
    ერთი მასტის.
  */
  if(
    !g.table.length
  ){
    if(
      !same(cards)
    ){
      return{
        ok:false,
        message:
          'პირველი სვლისას კარტები ერთი მასტის უნდა იყოს.'
      };
    }

    return{
      ok:true,
      cards,
      willCut:true
    };
  }

  /*
    მალიუტკაზე
    მთელი დარჩენილი ხელი.
  */
  if(
    g.leadWasMaliutka
  ){
    if(
      cards.length!==
      hand.length
    ){
      return{
        ok:false,
        message:
          'მალიუტკაზე მთელი ხელი უნდა ჩამოხვიდე.'
      };
    }

    return{
      ok:true,
      cards,
      willCut:
        willCut(
          g,
          cards
        )
    };
  }

  /*
    მთავარი FIX:
    თუ მაგიდაზე N კარტია,
    პასუხიც ზუსტად N კარტი.

    აღარ მოითხოვება,
    რომ საპასუხო კარტები
    ერთმანეთთან ერთი მასტის იყოს.
  */
  let n=
    g.leadCount||
    1;

  if(
    cards.length!==n
  ){
    return{
      ok:false,
      message:
        'უნდა აირჩიო ზუსტად '+
        n+
        ' კარტი.'
    };
  }

  return{
    ok:true,
    cards,
    willCut:
      willCut(
        g,
        cards
      )
  };
}

function pstats(p){
  if(
    p.userKey&&
    users[p.userKey]
  ){
    let u=
      shape(
        users[p.userKey]
      );

    return{
      avatar:u.avatar,
      xp:u.xp,
      level:u.level,
      wins:u.wins,
      frame:u.frame
    };
  }

  return{
    avatar:p.avatar||'🤖',
    xp:p.xp||0,
    level:p.level||1,
    wins:p.wins||0,
    frame:p.frame||'bronze'
  };
}

function state(
  room,
  viewer,
  reveal
){
  let g=room.game,
      vis={};

  if(reveal){
    for(
      const p of
      room.players
    ){
      vis[p.id]=
        g.hands[p.id]||
        [];
    }
  }else{
    vis[viewer]=
      g.hands[viewer]||
      [];
  }

  let w=
    winner(g);

  return{
    roomId:room.id,

    roomName:room.name,

    stake:room.stake,

    capacity:room.capacity,

    parties:room.parties,

    totalHands:
      room.parties*5,

    handIndex:
      g.handIndex,

    partyIndex:
      g.partyIndex,

    trump:
      g.trump,

    deckCount:
      g.deck.length,

    currentTurnIndex:
      g.currentTurnIndex,

    processing:
      g.processing,

    gameOver:
      g.gameOver,

    viewingPlayerId:
      viewer,

    revealAll:
      !!reveal,

    playersCards:
      vis,

    lastHandScores:
      g.lastHandScores,

    history:
      g.history,

    turnEndsAt:
      g.turnEndsAt,

    turnSeconds:
      TURN,

    leadCount:
      g.leadCount,

    leadWasMaliutka:
      g.leadWasMaliutka,

    table:
      g.table.map(
        (p,i)=>({
          playerId:
            p.playerId,

          playerName:
            p.playerName,

          cards:
            p.cards,

          cut:
            !!p.cut,

          isWinning:
            i===w
        })
      ),

    players:
      room.players.map(
        (p,i)=>{
          let s=
            pstats(p);

          return{
            id:p.id,

            name:p.name,

            isBot:
              !!p.isBot,

            isTester:
              !!p.isTester,

            balance:
              p.balance,

            cardCount:
              (
                g.hands[p.id]||
                []
              ).length,

            handPoints:
              pts(
                g.taken[p.id]
              ),

            totalPoints:
              g.totals[p.id]||
              0,

            isCurrent:
              i===
              g.currentTurnIndex,

            ...s
          };
        }
      )
  };
}

function broadcast(r){
  for(
    const p of
    r.players
  ){
    if(!p.isBot){
      io.to(p.id)
        .emit(
          'gameStateUpdate',
          state(
            r,
            p.id,
            p.isTester
          )
        );
    }
  }
}

function setTurn(
  r,
  i
){
  if(
    !r.game||
    r.game.gameOver
  ){
    return;
  }

  clearTimeout(
    r.timer
  );

  r.game
    .currentTurnIndex=i;

  r.game
    .turnEndsAt=
      Date.now()+
      TURN*1000;

  r.timer=
    setTimeout(
      ()=>auto(r),
      TURN*1000+
      100
    );
}

function refill(
  r,
  w
){
  let g=r.game;

  while(
    g.deck.length
  ){
    let dealt=false;

    for(
      let o=0;
      o<r.players.length;
      o++
    ){
      let p=
        r.players[
          (w+o)%
          r.players.length
        ];

      if(
        g.hands[p.id].length<5
        &&
        g.deck.length
      ){
        g.hands[p.id]
          .push(
            g.deck.pop()
          );

        dealt=true;
      }
    }

    if(!dealt)
      break;
  }
}

function nextLeader(
  r,
  g,
  raw
){
  let zeros=
    r.players.filter(
      p=>raw[p.id]===0
    );

  if(
    zeros.length>=2
    &&
    g.lastTrickOrder.length
  ){
    let z=
      new Set(
        zeros.map(
          p=>p.id
        )
      );

    let last=null;

    for(
      const pid of
      g.lastTrickOrder
    ){
      if(
        z.has(pid)
      ){
        last=pid;
      }
    }

    if(last){
      return(
        r.players.findIndex(
          p=>p.id===last
        )+1
      )%
      r.players.length;
    }
  }

  let m=Infinity,
      mi=0;

  r.players.forEach(
    (p,i)=>{
      if(
        raw[p.id]<m
      ){
        m=raw[p.id];
        mi=i;
      }
    }
  );

  return(
    mi+1
  )%
  r.players.length;
}

function finish(r){
  let g=r.game,
      raw={},
      scores={};

  for(
    const p of
    r.players
  ){
    raw[p.id]=
      pts(
        g.taken[p.id]
      );

    scores[p.id]=
      raw[p.id]===0
        ?-120
        :raw[p.id];

    g.totals[p.id]=
      (
        g.totals[p.id]||
        0
      )+
      scores[p.id];

    if(p.userKey){
      xp(
        p.userKey,
        20
      );
    }
  }

  g.lastHandScores={
    ...scores
  };

  g.history.push({
    hand:g.handIndex,
    party:g.partyIndex,
    trump:g.trump,
    rawScores:{
      ...raw
    },
    scores:{
      ...scores
    },
    totals:{
      ...g.totals
    }
  });

  if(
    g.handIndex>=
    r.parties*5
  ){
    g.gameOver=true;

    clearTimeout(
      r.timer
    );

    let win=
      r.players[0];

    for(
      const p of
      r.players
    ){
      if(
        (
          g.totals[p.id]||
          0
        )
        >
        (
          g.totals[win.id]||
          0
        )
      ){
        win=p;
      }
    }

    for(
      const p of
      r.players
    ){
      if(
        p.userKey&&
        users[p.userKey]
      ){
        let u=
          shape(
            users[p.userKey]
          );

        u.games++;
        u.xp+=30;

        if(
          p.id===
          win.id
        ){
          u.wins++;
          u.xp+=100;

          quest(
            p.userKey,
            'wins'
          );
        }

        u.level=
          level(u.xp);

        u.frame=
          frame(u.wins);

        save();

        pushProfile(
          p.userKey
        );
      }
    }

    broadcast(r);

    io.to(r.id)
      .emit(
        'gameWinner',
        {
          playerName:
            win.name
        }
      );

    io.to(r.id)
      .emit(
        'sfxEvent',
        {
          type:'win'
        }
      );

    return;
  }

  g.nextLeaderIndex=
    nextLeader(
      r,
      g,
      raw
    );

  r.game=
    newHand(
      r,
      g
    );

  r.game.lastHandScores={
    ...scores
  };

  setTurn(
    r,
    r.game
      .currentTurnIndex
  );

  broadcast(r);

  io.to(r.id)
    .emit(
      'sfxEvent',
      {
        type:'deal'
      }
    );

  botSchedule(r);
}

function trick(r){
  let g=r.game,
      w=winner(g),
      wp=g.table[w];

  if(!wp)
    return;

  g.taken[
    wp.playerId
  ].push(
    ...g.table.flatMap(
      x=>x.cards
    )
  );

  g.lastTrickOrder=
    g.table.map(
      x=>x.playerId
    );

  let wi=
    r.players.findIndex(
      p=>p.id===
      wp.playerId
    );

  let win=
    r.players[wi];

  if(
    win&&
    w>0
  ){
    achievement(
      r,
      win,
      'clean_cut',
      'უხილავი ჭრა'
    );
  }

  g.processing=true;

  clearTimeout(
    r.timer
  );

  broadcast(r);

  io.to(r.id)
    .emit(
      'sfxEvent',
      {
        type:
          w===0
            ?'take'
            :'cut'
      }
    );

  setTimeout(
    ()=>{
      if(
        !rooms.has(r.id)
        ||
        r.game!==g
      ){
        return;
      }

      g.table=[];

      g.leadCount=null;

      g.leadWasMaliutka=
        false;

      g.leadPlayerId=
        null;

      refill(
        r,
        wi
      );

      g.processing=false;

      let done=
        r.players.every(
          p=>
            (
              g.hands[p.id]||
              []
            ).length===0
        )
        &&
        !g.deck.length;

      if(done){
        return finish(r);
      }

      setTurn(
        r,
        wi
      );

      broadcast(r);

      botSchedule(r);
    },
    850
  );
}

function play(
  r,
  p,
  idx
){
  let g=r.game;

  if(
    !g||
    g.processing||
    g.gameOver
  ){
    return{
      ok:false,
      message:
        'ახლა სვლა შეუძლებელია.'
    };
  }

  let hand=
    g.hands[p.id]||
    [];

  let v=
    valid(
      g,
      hand,
      idx
    );

  if(!v.ok)
    return v;

  if(
    !g.table.length
  ){
    g.leadCount=
      v.cards.length;

    g.leadWasMaliutka=
      mali(
        v.cards
      );

    g.leadPlayerId=
      p.id;

    if(
      g.leadWasMaliutka
    ){
      achievement(
        r,
        p,
        'maliutka_master',
        'მალიუტკის ოსტატი'
      );

      if(p.userKey){
        quest(
          p.userKey,
          'maliutka'
        );
      }
    }
  }

  g.hands[p.id]=
    hand.filter(
      (_,i)=>
        !idx.includes(i)
    );

  g.table.push({
    playerId:p.id,
    playerName:p.name,
    cards:v.cards,
    cut:v.willCut
  });

  io.to(r.id)
    .emit(
      'sfxEvent',
      {
        type:
          g.table.length>1
          &&
          v.willCut
            ?'cut'
            :'play'
      }
    );

  if(
    g.table.length===
    r.players.length
  ){
    trick(r);
  }else{
    setTurn(
      r,
      (
        g.currentTurnIndex+
        1
      )%
      r.players.length
    );

    broadcast(r);

    botSchedule(r);
  }

  return{
    ok:true
  };
}

function combos(n,k){
  let o=[];

  function f(s,a){
    if(
      a.length===k
    ){
      o.push(
        a.slice()
      );

      return;
    }

    for(
      let i=s;
      i<n;
      i++
    ){
      a.push(i);

      f(
        i+1,
        a
      );

      a.pop();
    }
  }

  f(
    0,
    []
  );

  return o;
}

function botPick(
  r,
  p
){
  let g=r.game,
      h=g.hands[p.id]||
      [];

  if(!h.length)
    return[];

  if(
    g.leadWasMaliutka
    &&
    g.table.length
  ){
    return h.map(
      (_,i)=>i
    );
  }

  if(
    !g.table.length
  ){
    for(
      let n=
        Math.min(
          5,
          h.length
        );
      n>=2;
      n--
    ){
      for(
        const s of
        SUITS
      ){
        let x=
          h.map(
            (c,i)=>
              c.suit===s
                ?i
                :-1
          )
          .filter(
            i=>i>=0
          )
          .slice(
            0,
            n
          );

        if(
          x.length===n
          &&
          Math.random()<.25
        ){
          return x;
        }
      }
    }

    return[0];
  }

  let n=
    Math.min(
      g.leadCount||1,
      h.length
    );

  let all=
    combos(
      h.length,
      n
    );

  for(
    const x of all
  ){
    if(
      willCut(
        g,
        x.map(
          i=>h[i]
        )
      )
    ){
      return x;
    }
  }

  return all[0]||[0];
}

function botSchedule(r){
  let g=r.game;

  if(
    !g||
    g.processing||
    g.gameOver
  ){
    return;
  }

  let p=
    r.players[
      g.currentTurnIndex
    ];

  if(
    p&&
    p.isBot
  ){
    setTimeout(
      ()=>{
        if(
          r.game===g
          &&
          r.players[
            g.currentTurnIndex
          ]
          &&
          r.players[
            g.currentTurnIndex
          ].id===p.id
        ){
          play(
            r,
            p,
            botPick(
              r,
              p
            )
          );
        }
      },
      550
    );
  }
}

function auto(r){
  let g=r.game;

  if(
    !g||
    g.processing||
    g.gameOver
  ){
    return;
  }

  let p=
    r.players[
      g.currentTurnIndex
    ];

  let h=
    g.hands[p.id]||
    [];

  if(!h.length)
    return;

  let x=
    g.leadWasMaliutka
    &&
    g.table.length
      ?h.map(
        (_,i)=>i
      )
      :g.table.length
        ?Array.from(
          {
            length:
              Math.min(
                g.leadCount||1,
                h.length
              )
          },
          (_,i)=>i
        )
        :[0];

  io.to(r.id)
    .emit(
      'quickMessage',
      {
        playerId:p.id,
        playerName:p.name,
        text:'⏱ ავტომატური სვლა'
      }
    );

  play(
    r,
    p,
    x
  );
}

function base(
  socket,
  fallback
){
  if(
    socket.userKey&&
    users[socket.userKey]
  ){
    let u=
      shape(
        users[socket.userKey]
      );

    return{
      name:u.username,
      userKey:
        socket.userKey,
      avatar:u.avatar,
      balance:u.balance
    };
  }

  return{
    name:
      clean(fallback)
      ||
      'Guest'+
      Math.floor(
        Math.random()*9999
      ),

    userKey:null,

    avatar:
      AVATARS[0],

    balance:
      START
  };
}

function tours(){
  let n=
    Date.now();

  return[
    {
      id:'sun',
      name:'Sunday Night Bura',
      prize:'$2,500',
      startAt:
        n+
        45*60000,
      registered:18,
      max:32
    },
    {
      id:'mal',
      name:'Maliutka Cup',
      prize:'$5,000',
      startAt:
        n+
        2*3600000,
      registered:43,
      max:64
    },
    {
      id:'vip',
      name:'VIP Masters',
      prize:'$10,000',
      startAt:
        n+
        24*3600000,
      registered:11,
      max:16
    }
  ];
}

io.on(
  'connection',
  s=>{

    s.emit(
      'lobbyTables',
      roomList()
    );

    s.emit(
      'tournaments',
      tours()
    );

    s.on(
      'register',
      d=>{
        let n=
          clean(
            d&&d.username
          );

        let p=
          String(
            d&&d.password||
            ''
          );

        let k=
          key(n);

        if(
          n.length<3
        ){
          return s.emit(
            'authError',
            'Username მინიმუმ 3 სიმბოლო უნდა იყოს.'
          );
        }

        if(
          p.length<4
        ){
          return s.emit(
            'authError',
            'Password მინიმუმ 4 სიმბოლო უნდა იყოს.'
          );
        }

        if(users[k]){
          return s.emit(
            'authError',
            'ეს Username უკვე არსებობს.'
          );
        }

        let sl=
          salt();

        users[k]={
          username:n,

          salt:sl,

          passwordHash:
            hash(
              p,
              sl
            ),

          avatar:
            safeAvatar(
              d&&d.avatar
            ),

          xp:0,

          wins:0,

          games:0,

          balance:
            START,

          achievements:[],

          quests:
            quests()
        };

        save();

        s.userKey=k;

        s.emit(
          'authSuccess',
          profile(
            users[k]
          )
        );
      }
    );

    s.on(
      'login',
      d=>{
        let k=
          key(
            d&&d.username
          );

        let u=
          users[k];

        let p=
          String(
            d&&d.password||
            ''
          );

        if(
          !u
          ||
          hash(
            p,
            u.salt
          )!==
          u.passwordHash
        ){
          return s.emit(
            'authError',
            'Username ან Password არასწორია.'
          );
        }

        s.userKey=k;

        s.emit(
          'authSuccess',
          profile(u)
        );
      }
    );

    s.on(
      'testerLogin',
      ()=>{
        let u=
          users[TESTER];

        if(!u){
          let sl=
            salt();

          u=
            users[TESTER]={
              username:
                TESTER,

              salt:
                sl,

              passwordHash:
                hash(
                  'test',
                  sl
                ),

              avatar:
                '😎',

              xp:0,

              wins:0,

              games:0,

              balance:
                START,

              achievements:[],

              quests:
                quests()
            };

          save();
        }

        s.userKey=
          TESTER;

        s.emit(
          'authSuccess',
          profile(u)
        );
      }
    );

    s.on(
      'registerTournament',
      d=>{
        if(
          !s.userKey
        ){
          return s.emit(
            'authError',
            'ტურნირზე რეგისტრაციისთვის ჯერ შედი პროფილში.'
          );
        }

        let t=
          String(
            d&&d.id||
            ''
          );

        if(!t)
          return;

        if(
          !tournamentRegs
            .has(t)
        ){
          tournamentRegs
            .set(
              t,
              new Set()
            );
        }

        tournamentRegs
          .get(t)
          .add(
            s.userKey
          );

        s.emit(
          'tournamentRegistered',
          {
            id:t
          }
        );
      }
    );

    s.on(
      'joinTable',
      d=>{
        if(s.roomId){
          return s.emit(
            'errorMessage',
            'უკვე მაგიდაზე ხარ.'
          );
        }

        let b=
          base(
            s,
            d&&d.name
          );

        let c=
          Number(
            d&&d.capacity
          );

        if(
          ![3,4]
            .includes(c)
        ){
          c=3;
        }

        let pa=
          Math.max(
            1,
            Math.min(
              4,
              Number(
                d&&d.parties
              )||1
            )
          );

        let st=
          Number(
            d&&d.stake
          );

        if(
          ![
            5,
            10,
            25,
            50,
            100
          ].includes(st)
        ){
          st=5;
        }

        let r=
          d&&d.roomId
            ?rooms.get(
              String(
                d.roomId
              )
            )
            :null;

        if(
          !r||
          r.game||
          r.players.length>=
          r.capacity
        ){
          r=[
            ...rooms.values()
          ].find(
            x=>
              !x.game&&
              x.capacity===c&&
              x.parties===pa&&
              x.stake===st&&
              x.players.length<
              x.capacity
          );
        }

        if(!r){
          r=
            newRoom(
              c,
              pa,
              st,
              b.name,
              d&&d.tableName
            );
        }

        s.roomId=
          r.id;

        s.join(
          r.id
        );

        r.players.push({
          id:s.id,

          name:b.name,

          userKey:
            b.userKey,

          isBot:false,

          isTester:
            key(b.name)===
            TESTER,

          balance:
            b.balance,

          avatar:
            b.avatar
        });

        if(
          b.userKey
        ){
          quest(
            b.userKey,
            'tables'
          );
        }

        if(
          key(b.name)===
          TESTER
        ){
          let n=1;

          while(
            r.players.length<
            r.capacity
          ){
            r.players.push({
              id:id('bot'),

              name:
                'BOT '+
                n++,

              isBot:true,

              isTester:false,

              balance:
                START,

              avatar:
                '🤖'
            });
          }
        }

        emitRooms();

        if(
          r.players.length===
          r.capacity
        ){
          r.game=
            newHand(
              r,
              null
            );

          setTurn(
            r,
            0
          );

          broadcast(r);

          io.to(r.id)
            .emit(
              'sfxEvent',
              {
                type:'deal'
              }
            );

          botSchedule(r);
        }else{
          io.to(r.id)
            .emit(
              'waitingForPlayers',
              {
                current:
                  r.players.length,

                max:
                  r.capacity
              }
            );
        }
      }
    );

    s.on(
      'playCards',
      d=>{
        let r=
          s.roomId
            ?rooms.get(
              s.roomId
            )
            :null;

        if(
          !r||
          !r.game
        ){
          return;
        }

        let p=
          r.players[
            r.game
              .currentTurnIndex
          ];

        if(
          !p||
          p.id!==s.id
        ){
          return s.emit(
            'errorMessage',
            'ახლა შენი სვლა არ არის.'
          );
        }

        let h=
          r.game.hands[
            s.id
          ]||
          [];

        let x=
          Array.isArray(
            d&&d.cardIndices
          )
            ?[
              ...new Set(
                d.cardIndices
              )
            ]
            :[];

        x=
          x.filter(
            i=>
              Number.isInteger(i)
              &&
              i>=0
              &&
              i<h.length
          )
          .sort(
            (a,b)=>
              a-b
          );

        let v=
          play(
            r,
            p,
            x
          );

        if(!v.ok){
          s.emit(
            'errorMessage',
            v.message
          );
        }
      }
    );

    s.on(
      'quickMessage',
      d=>{
        let r=
          s.roomId
            ?rooms.get(
              s.roomId
            )
            :null;

        let p=
          r&&
          r.players.find(
            x=>x.id===s.id
          );

        let text=
          String(
            d&&d.text||
            ''
          );

        if(
          r&&
          p&&
          AUDIO.includes(text)
        ){
          io.to(r.id)
            .emit(
              'quickMessage',
              {
                playerId:p.id,
                playerName:p.name,
                text
              }
            );
        }
      }
    );

    s.on(
      'throwable',
      d=>{
        let r=
          s.roomId
            ?rooms.get(
              s.roomId
            )
            :null;

        let a=
          r&&
          r.players.find(
            x=>x.id===s.id
          );

        let b=
          r&&
          r.players.find(
            x=>
              x.id===
              String(
                d&&
                d.targetPlayerId||
                ''
              )
          );

        let t=
          String(
            d&&d.type||
            ''
          );

        if(
          r&&
          a&&
          b&&
          a.id!==b.id
          &&
          [
            'tomato',
            'egg',
            'paper'
          ].includes(t)
        ){
          io.to(r.id)
            .emit(
              'throwableEvent',
              {
                fromPlayerId:a.id,
                targetPlayerId:b.id,
                type:t
              }
            );
        }
      }
    );

    s.on(
      'disconnect',
      ()=>{
        let r=
          s.roomId
            ?rooms.get(
              s.roomId
            )
            :null;

        if(!r)
          return;

        if(!r.game){
          r.players=
            r.players.filter(
              p=>p.id!==s.id
            );

          if(
            !r.players.length
          ){
            rooms.delete(
              r.id
            );
          }
        }else if(
          !r.players.some(
            p=>
              !p.isBot&&
              p.id!==s.id
          )
        ){
          clearTimeout(
            r.timer
          );

          rooms.delete(
            r.id
          );
        }

        emitRooms();
      }
    );
  }
);

const PAGE=String.raw`
<!doctype html>

<html lang="ka">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>
Written Bura
</title>

<script src="/socket.io/socket.io.js"></script>

<style>

@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Georgian:wght@400;600;800&display=swap');

*{
  box-sizing:border-box
}

body{
  margin:0;
  background:#06100d;
  color:#fff;
  font-family:
    'Noto Sans Georgian',
    sans-serif
}

button,
input,
select{
  font:inherit
}

.glass{
  background:#0c1714dd;
  border:1px solid #ffffff1c;
  border-radius:18px;
  box-shadow:
    0 20px 50px #0007
}

.hide{
  display:none!important
}

#lobby{
  min-height:100vh;
  padding:20px;
  background:
    radial-gradient(
      circle at top,
      #123a2d,
      #06100d 50%
    )
}

.wrap{
  max-width:1180px;
  margin:auto
}

.top{
  display:flex;
  justify-content:space-between;
  align-items:center
}

.brand{
  font-size:24px;
  font-weight:800;
  color:#f2d278
}

.tabs{
  display:flex;
  gap:8px;
  margin:18px 0;
  flex-wrap:wrap
}

.tabBtn,
.smallBtn{
  border:
    1px solid #ffffff22;

  background:
    #ffffff0b;

  color:#fff;

  padding:
    9px 13px;

  border-radius:
    999px;

  cursor:pointer
}

.tabBtn.active{
  border-color:#34d399;
  background:#34d3991f
}

.tab{
  display:none
}

.tab.active{
  display:block
}

.grid{
  display:grid;
  grid-template-columns:
    1fr 360px;
  gap:14px
}

.box{
  padding:18px
}

.field{
  margin:9px 0
}

.field label{
  display:block;
  font-size:11px;
  color:#a8bbb3;
  margin-bottom:5px
}

.field input,
.field select{
  width:100%;
  height:42px;
  border:
    1px solid #ffffff1c;
  background:#0004;
  color:#fff;
  border-radius:10px;
  padding:0 10px
}

.row{
  display:grid;
  grid-template-columns:
    1fr 1fr;
  gap:8px
}

.stakes{
  display:flex;
  gap:6px;
  flex-wrap:wrap;
  margin:10px 0
}

.stake{
  border:
    1px solid #ffffff1c;
  background:#ffffff0b;
  color:#aaa;
  padding:10px 14px;
  border-radius:10px;
  cursor:pointer
}

.stake.active{
  color:#ffe29a;
  border-color:#ffe29a
}

.primary{
  width:100%;
  height:44px;
  border:0;
  border-radius:11px;
  background:
    linear-gradient(
      135deg,
      #34d399,
      #10b981
    );
  font-weight:800;
  color:#032319;
  cursor:pointer
}

.list{
  display:grid;
  gap:8px
}

.item{
  display:flex;
  justify-content:space-between;
  gap:10px;
  align-items:center;
  padding:11px;
  border:
    1px solid #ffffff18;
  border-radius:12px;
  background:#ffffff08
}

.meta{
  font-size:10px;
  color:#9db1a8
}

.avaGrid{
  display:grid;
  grid-template-columns:
    repeat(6,1fr);
  gap:5px
}

.avaOpt{
  height:40px;
  background:#ffffff0b;
  border:
    1px solid #ffffff18;
  border-radius:9px;
  font-size:21px;
  cursor:pointer
}

.avaOpt.active{
  border-color:#ffe29a
}

.quest{
  padding:10px;
  border:
    1px solid #ffffff18;
  border-radius:10px;
  margin:7px 0
}

.bar{
  height:6px;
  background:#ffffff10;
  border-radius:99px;
  overflow:hidden
}

.bar span{
  display:block;
  height:100%;
  background:
    linear-gradient(
      90deg,
      #34d399,
      #ffe29a
    )
}

#game{
  display:none;
  min-height:100vh;
  padding:10px
}

.hud{
  display:flex;
  gap:6px;
  flex-wrap:wrap;
  justify-content:center;
  margin-bottom:7px
}

.pill{
  padding:7px 11px;
  border-radius:999px;
  background:#ffffff0d;
  border:
    1px solid #ffffff1c;
  text-align:center;
  min-width:82px
}

.pill small{
  display:block;
  font-size:8px;
  color:#9db1a8
}

.pill b{
  color:#ffe29a
}

.actions{
  display:flex;
  gap:6px;
  justify-content:center;
  margin-bottom:5px
}

.status{
  text-align:center;
  color:#ffe29a;
  font-weight:800;
  min-height:26px
}

.layout{
  display:grid;
  grid-template-columns:
    1fr 290px;
  gap:10px
}

.table{
  height:700px;
  position:relative;
  overflow:hidden;
  border-radius:28px;
  background:
    linear-gradient(
      145deg,
      #1b120d,
      #080a09
    );
  box-shadow:
    0 25px 70px #000a
}

.wood{
  position:absolute;
  inset:
    38px 55px 72px;
  border-radius:
    50%/38%;
  background:
    linear-gradient(
      145deg,
      #9b6841,
      #52301d
    );
  box-shadow:
    inset 0 0 0 15px
    #321c12cc
}

.felt{
  position:absolute;
  inset:
    76px 98px 110px;
  border-radius:
    50%/38%;

  background:
    repeating-radial-gradient(
      circle at 35% 35%,
      #fff2 0 1px,
      transparent 1px 4px
    ),
    radial-gradient(
      ellipse,
      #0c6047,
      #062e25 75%
    );

  box-shadow:
    inset 0 0 100px #0009
}

.center{
  position:absolute;
  left:50%;
  top:43%;
  transform:
    translate(-50%,-50%);
  display:flex;
  align-items:center;
  gap:20px;
  z-index:3
}

.deck{
  width:55px;
  height:80px;
  border:
    2px solid #fff;
  border-radius:7px;
  background:
    repeating-linear-gradient(
      45deg,
      #203650 0 4px,
      #132238 4px 8px
    )
}

.orb{
  width:76px;
  height:76px;
  border-radius:50%;
  display:grid;
  place-items:center;
  font-size:42px;
  border:
    2px solid #ffe29a;
  background:
    radial-gradient(
      circle at 35% 30%,
      #ffffff44,
      #0007
    );
  box-shadow:
    0 0 28px #f0c65a88
}

.seat{
  position:absolute;
  transform:
    translate(-50%,-50%);
  width:150px;
  text-align:center;
  z-index:7
}

.seatBox{
  position:relative;
  background:#07110ee8;
  border:
    1px solid #ffffff1c;
  border-radius:14px;
  padding:7px
}

.seat.current .seatBox{
  border-color:#ffe29a;
  box-shadow:
    0 0 24px #ffe29a66
}

.avatarWrap{
  width:58px;
  height:58px;
  margin:auto;
  position:relative
}

.avatar{
  position:absolute;
  inset:4px;
  border-radius:50%;
  display:grid;
  place-items:center;
  background:#16221e;
  border:
    3px solid #d6a45d;
  font-size:30px;
  overflow:hidden;
  cursor:pointer
}

.avatar img{
  width:100%;
  height:100%;
  object-fit:cover
}

.ring{
  position:absolute;
  inset:-2px;
  border-radius:50%;
  background:
    conic-gradient(
      #ffe29a
      var(--t,0%),
      #ffffff10 0
    )
}

.lvl{
  position:absolute;
  right:-7px;
  bottom:-3px;
  background:#111;
  border:
    1px solid #ffe29a;
  border-radius:99px;
  padding:2px 5px;
  font-size:8px;
  z-index:5
}

.frame-diamond .avatar{
  border-color:#aeeeff;
  box-shadow:
    0 0 15px #aeeeff99
}

.frame-gold .avatar{
  border-color:#ffd86b;
  box-shadow:
    0 0 15px #ffd86b88
}

.name{
  font-size:10px;
  font-weight:800
}

.sm{
  font-size:8px;
  color:#9db1a8
}

.backs{
  display:flex;
  justify-content:center
}

.back{
  width:16px;
  height:24px;
  margin-left:-6px;
  border:
    1px solid #fff8;
  background:#18304b;
  border-radius:3px
}

.handZone{
  position:absolute;
  left:50%;
  bottom:12px;
  transform:
    translateX(-50%);
  z-index:10;
  width:94%;
  text-align:center
}

.hand{
  height:135px;
  display:flex;
  justify-content:center;
  align-items:flex-end
}

.card{
  width:68px;
  height:100px;
  background:#fff;
  border-radius:9px;
  padding:6px;
  display:flex;
  flex-direction:column;
  justify-content:space-between;
  font-weight:800;
  color:#111;
  box-shadow:
    0 8px 18px #0007;
  user-select:none
}

.hand .card{
  margin-left:-17px;
  transition:.18s
}

.hand .card:first-child{
  margin-left:0
}

.hand .card:hover{
  transform:
    translateY(-16px)!important
}

.hand .card.selected{
  transform:
    translateY(-27px)
    scale(1.05)!important;

  border:
    3px solid #ffe29a;

  box-shadow:
    0 0 25px #ffe29aaa
}

.ct{
  text-align:center;
  font-size:32px
}

.cb{
  transform:
    rotate(180deg)
}

.spades{
  color:#070707
}

.clubs{
  color:#007956
}

.diamonds{
  color:#082966
}

.hearts{
  color:#74152d
}

.tableCards{
  position:absolute;
  left:50%;
  top:57%;
  transform:
    translate(-50%,-50%);
  display:flex;
  gap:7px;
  z-index:6
}

.playGroup{
  text-align:center
}

.playName{
  font-size:8px;
  background:#0008;
  border-radius:99px;
  padding:2px 6px
}

.playGroup.win .card{
  box-shadow:
    0 0 25px #ffe29a
}

.playBtn{
  height:44px;
  min-width:220px;
  border:0;
  border-radius:99px;
  background:#34d399;
  font-weight:800;
  color:#032319;
  cursor:pointer
}

.playBtn:disabled{
  background:#29342f;
  color:#73827b
}

.panel{
  margin-bottom:8px;
  padding:10px
}

.panelHead{
  width:100%;
  background:none;
  border:0;
  color:#fff;
  text-align:left;
  font-weight:800
}

.scoreRow{
  display:grid;
  grid-template-columns:
    30px 1fr 45px 50px;
  gap:4px;
  font-size:9px;
  padding:7px;
  border-top:
    1px solid #ffffff14
}

.hist{
  font-size:8px;
  color:#b7c6bf;
  padding:6px;
  border-top:
    1px solid #ffffff14
}

.quick{
  display:grid;
  gap:5px
}

.reaction{
  position:absolute;
  top:-28px;
  left:50%;
  transform:
    translateX(-50%);
  background:#fff;
  color:#111;
  border-radius:8px;
  padding:4px 7px;
  font-size:9px;
  white-space:nowrap
}

.throwMenu{
  display:none;
  position:fixed;
  z-index:50;
  background:#09130f;
  border:
    1px solid #ffffff22;
  border-radius:12px;
  padding:8px
}

.throwMenu.show{
  display:grid;
  gap:5px
}

.throwFly{
  position:fixed;
  z-index:60;
  font-size:38px;
  transition:
    transform .75s ease
}

.splat{
  position:absolute;
  inset:0;
  z-index:8;
  display:grid;
  place-items:center;
  font-size:40px
}

.paper{
  position:absolute;
  inset:-5px;
  border:
    8px dashed #fff;
  z-index:8;
  border-radius:50%
}

.modal{
  display:none;
  position:fixed;
  inset:0;
  background:#000b;
  z-index:80;
  place-items:center;
  padding:15px
}

.modal.show{
  display:grid
}

.modalBox{
  max-width:720px;
  max-height:88vh;
  overflow:auto;
  padding:18px
}

.rule{
  padding:10px;
  border:
    1px solid #ffffff18;
  border-radius:10px;
  margin:7px 0
}

.toast{
  position:fixed;
  top:65px;
  left:50%;
  transform:
    translateX(-50%);
  z-index:90;
  background:#181208;
  border:
    1px solid #ffe29a;
  padding:12px 18px;
  border-radius:12px
}

.tester{
  font-size:9px;
  margin:4px 0
}

.tester span{
  background:#fff;
  color:#111;
  padding:2px 4px;
  border-radius:4px;
  margin:2px;
  display:inline-block
}

@media(max-width:1000px){
  .grid,
  .layout{
    grid-template-columns:1fr
  }

  .table{
    height:620px
  }
}

@media(max-width:600px){
  #lobby{
    padding:10px
  }

  .row{
    grid-template-columns:1fr
  }

  .table{
    height:540px
  }

  .wood{
    inset:
      28px 5px 60px
  }

  .felt{
    inset:
      65px 25px 105px
  }

  .seat{
    width:95px
  }

  .avatarWrap{
    width:44px;
    height:44px
  }

  .card{
    width:49px;
    height:73px;
    padding:4px
  }

  .ct{
    font-size:21px
  }

  .tableCards{
    gap:3px
  }

  .hand{
    height:100px
  }

  .hand .card{
    margin-left:-15px
  }
}

</style>

</head>

<body>

<section id="lobby">

<div class="wrap">

<div class="top">

<div class="brand">
WRITTEN BURA
</div>

<div id="profileMini"></div>

</div>

<div class="tabs">

<button
  class="tabBtn active"
  data-tab="tablesTab"
>
🎴 მაგიდები
</button>

<button
  class="tabBtn"
  data-tab="tourTab"
>
🏆 ტურნირები
</button>

<button
  class="tabBtn"
  data-tab="questTab"
>
📅 Daily Quests
</button>

</div>

<div
  id="tablesTab"
  class="tab active"
>

<div class="grid">

<div class="box glass">

<h2>
აქტიური მაგიდები
</h2>

<div
  id="tableList"
  class="list"
></div>

<h3>
ახალი მაგიდა
</h3>

<div class="field">

<label>
მაგიდის სახელი
</label>

<input
  id="tableName"
  placeholder="Tbilisi VIP"
>

</div>

<div class="row">

<div class="field">

<label>
მოთამაშეები
</label>

<select id="capacity">
<option>3</option>
<option>4</option>
</select>

</div>

<div class="field">

<label>
პარტიები
</label>

<select id="parties">
<option>1</option>
<option>2</option>
<option>3</option>
<option>4</option>
</select>

</div>

</div>

<input
  id="stake"
  type="hidden"
  value="5"
>

<div class="stakes">

<button
  class="stake active"
  data-stake="5"
>
$5
</button>

<button
  class="stake"
  data-stake="10"
>
$10
</button>

<button
  class="stake"
  data-stake="25"
>
$25
</button>

<button
  class="stake"
  data-stake="50"
>
$50
</button>

<button
  class="stake"
  data-stake="100"
>
$100
</button>

</div>

<button
  id="join"
  class="primary"
>
შექმენი / შეუერთდი მაგიდას
</button>

<div
  id="wait"
  class="meta"
></div>

</div>

<div class="box glass">

<div class="tabs">

<button
  class="auth tabBtn active"
  data-auth="loginBox"
>
შესვლა
</button>

<button
  class="auth tabBtn"
  data-auth="regBox"
>
რეგისტრაცია
</button>

</div>

<div id="loginBox">

<div class="field">

<label>
Username
</label>

<input
  id="loginUser"
  value="saba123"
>

</div>

<div class="field">

<label>
Password
</label>

<input
  id="loginPass"
  type="password"
>

</div>

<button
  id="login"
  class="primary"
>
შესვლა
</button>

<button
  id="tester"
  class="smallBtn"
  style="
    width:100%;
    margin-top:6px
  "
>
🧪 TESTER saba123
</button>

</div>

<div
  id="regBox"
  class="hide"
>

<div class="field">

<label>
Username
</label>

<input id="regUser">

</div>

<div class="field">

<label>
Password
</label>

<input
  id="regPass"
  type="password"
>

</div>

<div
  id="avaGrid"
  class="avaGrid"
></div>

<label
  class="smallBtn"
  style="
    display:block;
    text-align:center;
    margin-top:6px
  "
>

📷 ატვირთე ავატარი

<input
  id="avaUpload"
  type="file"
  accept="image/*"
  class="hide"
>

</label>

<button
  id="register"
  class="primary"
  style="margin-top:7px"
>
რეგისტრაცია
</button>

</div>

<div
  id="authMsg"
  class="meta"
></div>

</div>

</div>

</div>

<div
  id="tourTab"
  class="tab"
>

<div class="box glass">

<h2>
ტურნირები
</h2>

<div
  id="tourList"
  class="list"
></div>

</div>

</div>

<div
  id="questTab"
  class="tab"
>

<div class="box glass">

<h2>
დღიური დავალებები
</h2>

<div id="questList"></div>

</div>

</div>

</div>

</section>

<section id="game">

<div class="hud">

<div class="pill">

<small>
🏆 პარტია
</small>

<b id="party">
-
</b>

</div>

<div class="pill">

<small>
🃏 ხელი
</small>

<b id="handNo">
-
</b>

</div>

<div class="pill">

<small>
⭐ კოზირი
</small>

<b id="trumpHud">
-
</b>

</div>

<div class="pill">

<small>
🎴 დასტა
</small>

<b id="deckNo">
-
</b>

</div>

<div class="pill">

<small>
💰 ფსონი
</small>

<b id="stakeHud">
-
</b>

</div>

</div>

<div class="actions">

<button
  id="rules"
  class="smallBtn"
>
📖 წესები
</button>

<button
  id="sfx"
  class="smallBtn"
>
🔊 SFX
</button>

<button
  id="exit"
  class="smallBtn"
>
გასვლა
</button>

</div>

<div
  id="status"
  class="status"
></div>

<div class="layout">

<div class="table">

<div class="wood"></div>

<div class="felt"></div>

<div class="center">

<div>

<div class="deck"></div>

<div
  class="meta"
  style="text-align:center"
>
DECK
<span id="deckCenter">
36
</span>
</div>

</div>

<div>

<div
  id="orb"
  class="orb"
>
♠
</div>

<div
  class="meta"
  style="text-align:center"
>
კოზირი
</div>

</div>

</div>

<div id="players"></div>

<div
  id="tableCards"
  class="tableCards"
></div>

<div class="handZone">

<div
  id="myCards"
  class="hand"
></div>

<button
  id="play"
  class="playBtn"
  disabled
>
სვლის გაკეთება
</button>

<div
  id="selCount"
  class="meta"
>
არჩეული: 0 / 5
</div>

</div>

</div>

<aside>

<div class="panel glass">

<button class="panelHead">
🏆 LIVE SCORE
</button>

<div id="score"></div>

<div id="history"></div>

</div>

<div class="panel glass">

<button class="panelHead">
🔊 Quick Audio
</button>

<div class="quick">

<button
  class="smallBtn qa"
  data-q="სიქიიიიიმ!"
>
სიქიიიიიმ!
</button>

<button
  class="smallBtn qa"
  data-q="ყვერო, მალე!"
>
ყვერო, მალე!
</button>

<button
  class="smallBtn qa"
  data-q="რას შვრები, ძმაო?!"
>
რას შვრები, ძმაო?!
</button>

<button
  class="smallBtn qa"
  data-q="ვაჰ, კოზირი!"
>
ვაჰ, კოზირი!
</button>

</div>

</div>

<div
  id="testPanel"
  class="panel glass"
>

<b>
🧪 TEST MODE
</b>

<div id="testGrid"></div>

</div>

</aside>

</div>

</section>

<div
  id="throwMenu"
  class="throwMenu"
>

<button
  class="smallBtn throw"
  data-t="tomato"
>
🍅 პამიდორი
</button>

<button
  class="smallBtn throw"
  data-t="egg"
>
🥚 კვერცხი
</button>

<button
  class="smallBtn throw"
  data-t="paper"
>
🧻 ქაღალდი
</button>

</div>

<div
  id="rulesModal"
  class="modal"
>

<div class="modalBox glass">

<button
  id="closeRules"
  class="smallBtn"
  style="float:right"
>
✕
</button>

<h2>
📖 წერითი ბურას წესები
</h2>

<div class="rule">

<b>
ქულები
</b>

<p>
6/7/8/9=0,
J=2,
Q=3,
K=4,
10=10,
A=11.
0 წაღებული ქულა = -120.
</p>

</div>

<div class="rule">

<b>
მრავალკარტიანი ჭრა
</b>

<p>
თუ ჩამოსულია N კარტი
(1-5),
პასუხიც ზუსტად N კარტია.
სისტემა ამოწმებს ყველა შესაძლო
დაწყვილებას და ჭრას მაღალი
იმავე მასტით ან კოზირით.
</p>

</div>

<div class="rule">

<b>
4 კარტი
</b>

<p>
პირველი სვლისას 4 კარტი
შეიძლება, თუ ოთხივე ერთი
მასტისაა.
</p>

</div>

<div class="rule">

<b>
მალიუტკა
</b>

<p>
5 ერთმასტიანი კარტი მალიუტკაა.
დანარჩენები აგდებენ მთელ ხელს;
თუ ვერავინ გაჭრა,
ჩამსვლელი იღებს ამ სვლის
ყველა ქულას.
</p>

</div>

<div class="rule">

<b>
გახიშტვა და რიგი
</b>

<p>
შემდეგ ხელს იწყებს ყველაზე
ცოტა წაღებული ქულის მქონე
მოთამაშის შემდეგი.

თუ რამდენიმე გაიხიშტა,
ბოლო ტრიკზე ბოლოს გახიშტულის
შემდეგი იწყებს.
</p>

</div>

</div>

</div>

<script>

var socket=io();

var cur=null;

var sel=[];

var prof=null;

var ava='🦊';

var upload='';

var target=null;

var timer=null;

var sfxOn=true;

const R=[
  '6',
  '7',
  '8',
  '9',
  'J',
  'Q',
  'K',
  '10',
  'A'
];

const $=x=>
  document.getElementById(x);

const esc=s=>
  String(
    s??''
  )
  .replace(
    /&/g,
    '&amp;'
  )
  .replace(
    /</g,
    '&lt;'
  )
  .replace(
    />/g,
    '&gt;'
  )
  .replace(
    /"/g,
    '&quot;'
  );

const sym=s=>
  ({
    spades:'♠',
    clubs:'♣',
    diamonds:'♦',
    hearts:'♥'
  })[s]||'Ø';

function avhtml(a){
  return String(
    a||''
  ).startsWith(
    'data:image/'
  )
    ?'<img src="'+
      esc(a)+
      '">'
    :esc(a||'🦊');
}

function renderProf(){
  $('profileMini')
    .innerHTML=
      prof
        ?'<b>'+
          avhtml(
            prof.avatar
          )+
          ' '+
          esc(
            prof.username
          )+
          '</b>'+
          '<div class="meta">'+
          'Lv.'+
          prof.level+
          ' · '+
          prof.xp+
          'XP · '+
          prof.wins+
          'W'+
          '</div>'
        :'<span class="meta">'+
          'სტუმარი'+
          '</span>';

  renderQuests();
}

function renderQuests(){
  if(!prof){
    $('questList')
      .innerHTML=
        '<div class="meta">'+
        'ჯერ შედი პროფილში.'+
        '</div>';

    return;
  }

  let q=
    prof.quests||
    {};

  let a=[
    [
      'მოიგე 3 პარტია',
      q.wins||0,
      3,
      100
    ],
    [
      'ჩადი მალიუტკა 1-ხელ',
      q.maliutka||0,
      1,
      250
    ],
    [
      'ითამაშე 5 მაგიდაზე',
      q.tables||0,
      5,
      50
    ]
  ];

  $('questList')
    .innerHTML=
      a.map(
        x=>
          '<div class="quest">'+
          '<b>'+
          x[0]+
          '</b>'+
          '<div class="meta">'+
          x[1]+
          '/'+
          x[2]+
          ' · +'+
          x[3]+
          ' XP'+
          '</div>'+
          '<div class="bar">'+
          '<span style="width:'+
          Math.min(
            100,
            x[1]/
            x[2]*
            100
          )+
          '%">'+
          '</span>'+
          '</div>'+
          '</div>'
      )
      .join('');
}

$('avaGrid')
  .innerHTML=
    [
      '🦊',
      '🐺',
      '🦁',
      '🐯',
      '🐻',
      '🦅',
      '🐼',
      '🐸',
      '🐵',
      '😎',
      '🤠',
      '🧙'
    ]
    .map(
      (x,i)=>
        '<button class="avaOpt '+
        (
          !i
            ?'active'
            :''
        )+
        '" data-a="'+
        x+
        '">'+
        x+
        '</button>'
    )
    .join('');

document
  .querySelectorAll(
    '.avaOpt'
  )
  .forEach(
    b=>
      b.onclick=()=>{
        document
          .querySelectorAll(
            '.avaOpt'
          )
          .forEach(
            x=>
              x.classList
                .remove(
                  'active'
                )
          );

        b.classList
          .add(
            'active'
          );

        ava=
          b.dataset.a;

        upload='';
      }
  );

$('avaUpload')
  .onchange=
    function(){
      let f=
        this.files&&
        this.files[0];

      if(!f)
        return;

      if(
        f.size>
        500000
      ){
        return $('authMsg')
          .textContent=
            'ავატარი მაქს. 500KB';
      }

      let r=
        new FileReader();

      r.onload=()=>{
        upload=
          String(
            r.result||
            ''
          );

        $('authMsg')
          .textContent=
            'ავატარი მზადაა';
      };

      r.readAsDataURL(f);
    };

document
  .querySelectorAll(
    '.tabBtn[data-tab]'
  )
  .forEach(
    b=>
      b.onclick=()=>{
        document
          .querySelectorAll(
            '.tabBtn[data-tab]'
          )
          .forEach(
            x=>
              x.classList
                .remove(
                  'active'
                )
          );

        document
          .querySelectorAll(
            '.tab'
          )
          .forEach(
            x=>
              x.classList
                .remove(
                  'active'
                )
          );

        b.classList
          .add(
            'active'
          );

        $(
          b.dataset.tab
        )
        .classList
        .add(
          'active'
        );
      }
  );

document
  .querySelectorAll(
    '.auth'
  )
  .forEach(
    b=>
      b.onclick=()=>{
        $('loginBox')
          .classList
          .toggle(
            'hide',
            b.dataset.auth!==
            'loginBox'
          );

        $('regBox')
          .classList
          .toggle(
            'hide',
            b.dataset.auth!==
            'regBox'
          );

        document
          .querySelectorAll(
            '.auth'
          )
          .forEach(
            x=>
              x.classList
                .remove(
                  'active'
                )
          );

        b.classList
          .add(
            'active'
          );
      }
  );

document
  .querySelectorAll(
    '.stake'
  )
  .forEach(
    b=>
      b.onclick=()=>{
        document
          .querySelectorAll(
            '.stake'
          )
          .forEach(
            x=>
              x.classList
                .remove(
                  'active'
                )
          );

        b.classList
          .add(
            'active'
          );

        $('stake')
          .value=
            b.dataset.stake;
      }
  );

$('register')
  .onclick=()=>
    socket.emit(
      'register',
      {
        username:
          $('regUser')
            .value,

        password:
          $('regPass')
            .value,

        avatar:
          upload||
          ava
      }
    );

$('login')
  .onclick=()=>
    socket.emit(
      'login',
      {
        username:
          $('loginUser')
            .value,

        password:
          $('loginPass')
            .value
      }
    );

$('tester')
  .onclick=()=>
    socket.emit(
      'testerLogin'
    );

socket.on(
  'authSuccess',
  p=>{
    prof=p;

    $('authMsg')
      .textContent=
        'შესვლა წარმატებულია';

    renderProf();
  }
);

socket.on(
  'profileUpdate',
  p=>{
    prof=p;

    renderProf();
  }
);

socket.on(
  'authError',
  m=>
    $('authMsg')
      .textContent=m
);

function tables(a){
  $('tableList')
    .innerHTML=
      a&&a.length
        ?a.map(
          t=>
            '<div class="item">'+
            '<div>'+
            '<b>'+
            esc(t.name)+
            '</b>'+
            '<div class="meta">'+
            '$'+
            t.stake+
            ' · '+
            t.players+
            '/'+
            t.capacity+
            ' · '+
            t.parties+
            ' პარტია'+
            '</div>'+
            '</div>'+
            '<button class="joinSmall" data-r="'+
            t.id+
            '">'+
            'შეერთება'+
            '</button>'+
            '</div>'
        )
        .join('')
        :'<div class="meta">'+
         'ღია მაგიდა არ არის.'+
         '</div>';

  document
    .querySelectorAll(
      '.joinSmall[data-r]'
    )
    .forEach(
      b=>
        b.onclick=()=>
          join(
            b.dataset.r
          )
    );
}

socket.on(
  'lobbyTables',
  tables
);

function cd(ms){
  if(ms<=0)
    return'იწყება';

  let s=
    Math.floor(
      ms/1000
    );

  let h=
    Math.floor(
      s/3600
    );

  let m=
    Math.floor(
      (
        s%3600
      )/60
    );

  return(
    (
      h
        ?h+'ს '
        :''
    )+
    m+
    'წ '+
    s%60+
    'წმ'
  );
}

socket.on(
  'tournaments',
  a=>{
    window.ts=a;

    function draw(){
      $('tourList')
        .innerHTML=
          (
            window.ts||
            []
          )
          .map(
            t=>
              '<div class="item">'+
              '<div>'+
              '<b>'+
              t.name+
              '</b>'+
              '<div class="meta">'+
              t.prize+
              ' · '+
              t.registered+
              '/'+
              t.max+
              '</div>'+
              '</div>'+
              '<div>'+
              '<b>'+
              cd(
                t.startAt-
                Date.now()
              )+
              '</b>'+
              '<br>'+
              '<button class="joinSmall tr" data-id="'+
              t.id+
              '">'+
              'რეგისტრაცია'+
              '</button>'+
              '</div>'+
              '</div>'
          )
          .join('');

      document
        .querySelectorAll(
          '.tr'
        )
        .forEach(
          b=>
            b.onclick=()=>
              socket.emit(
                'registerTournament',
                {
                  id:b.dataset.id
                }
              )
        );
    }

    draw();

    setInterval(
      draw,
      1000
    );
  }
);

socket.on(
  'tournamentRegistered',
  ()=>
    $('authMsg')
      .textContent=
        'ტურნირზე დარეგისტრირდი'
);

$('join')
  .onclick=()=>
    join(null);

function join(roomId){
  socket.emit(
    'joinTable',
    {
      name:
        prof
          ?prof.username
          :(
            $('loginUser')
              .value||
            'Guest'
          ),

      capacity:
        +$('capacity')
          .value,

      parties:
        +$('parties')
          .value,

      stake:
        +$('stake')
          .value,

      tableName:
        $('tableName')
          .value,

      roomId
    }
  );
}

$('rules')
  .onclick=()=>
    $('rulesModal')
      .classList
      .add(
        'show'
      );

$('closeRules')
  .onclick=()=>
    $('rulesModal')
      .classList
      .remove(
        'show'
      );

$('exit')
  .onclick=()=>
    location.reload();

$('sfx')
  .onclick=
    function(){
      sfxOn=
        !sfxOn;

      this.textContent=
        sfxOn
          ?'🔊 SFX'
          :'🔇 SFX';
    };

socket.on(
  'waitingForPlayers',
  d=>
    $('wait')
      .textContent=
        'ველოდებით: '+
        d.current+
        '/'+
        d.max
);

socket.on(
  'errorMessage',
  m=>
    cur
      ?$('status')
        .textContent=m
      :$('wait')
        .textContent=m
);

socket.on(
  'gameStateUpdate',
  s=>{
    cur=s;

    sel=[];

    $('lobby')
      .style.display=
        'none';

    $('game')
      .style.display=
        'block';

    render(s);
  }
);

socket.on(
  'achievement',
  d=>
    toast(
      '🏅 '+
      d.playerName+
      ' — '+
      d.title
    )
);

socket.on(
  'gameWinner',
  d=>
    toast(
      '🏆 '+
      d.playerName+
      ' — გამარჯვებული'
    )
);

socket.on(
  'quickMessage',
  react
);

socket.on(
  'throwableEvent',
  throwFx
);

socket.on(
  'sfxEvent',
  e=>
    e&&
    sound(e.type)
);

function card(c){
  let e=
    document.createElement(
      'div'
    );

  let s=
    sym(c.suit);

  e.className=
    'card '+
    c.suit;

  e.innerHTML=
    '<div>'+
    c.rank+
    ' '+
    s+
    '</div>'+
    '<div class="ct">'+
    s+
    '</div>'+
    '<div class="cb">'+
    c.rank+
    ' '+
    s+
    '</div>';

  return e;
}

function pos(
  i,
  n,
  me,
  ps
){
  let mi=
    ps.findIndex(
      p=>p.id===me
    );

  if(mi<0)
    mi=0;

  let r=
    (
      i-mi+n
    )%n;

  return(
    n===4
      ?[
        {l:50,t:84},
        {l:14,t:50},
        {l:50,t:16},
        {l:86,t:50}
      ]
      :[
        {l:50,t:84},
        {l:18,t:28},
        {l:82,t:28}
      ]
  )[r];
}

function render(s){
  $('party')
    .textContent=
      s.partyIndex+
      '/'+
      s.parties;

  $('handNo')
    .textContent=
      s.handIndex+
      '/'+
      s.totalHands;

  $('trumpHud')
    .textContent=
      sym(s.trump);

  $('deckNo')
    .textContent=
      s.deckCount;

  $('deckCenter')
    .textContent=
      s.deckCount;

  $('stakeHud')
    .textContent=
      '$'+
      s.stake;

  let o=
    $('orb');

  o.textContent=
    sym(s.trump);

  o.style.color=
    s.trump==='hearts'
      ?'#8d1538'
      :s.trump==='diamonds'
        ?'#082966'
        :s.trump==='clubs'
          ?'#008461'
          :s.trump==='spades'
            ?'#111'
            :'#ffe29a';

  players(s);

  table(s);

  hand(s);

  score(s);

  tester(s);

  status(s);

  clock();
}

function players(s){
  let r=
    $('players');

  r.innerHTML='';

  s.players.forEach(
    (p,i)=>{
      let po=
        pos(
          i,
          s.players.length,
          s.viewingPlayerId,
          s.players
        );

      let e=
        document.createElement(
          'div'
        );

      e.className=
        'seat '+
        (
          p.isCurrent
            ?'current '
            :''
        )+
        'frame-'+
        p.frame;

      e.dataset.id=
        p.id;

      e.style.left=
        po.l+'%';

      e.style.top=
        po.t+'%';

      let backs=
        p.id===
        s.viewingPlayerId
          ?''
          :Array(
            p.cardCount
          )
          .fill(
            '<div class="back"></div>'
          )
          .join('');

      e.innerHTML=
        '<div class="seatBox">'+
        '<div class="avatarWrap">'+
        '<div class="ring"></div>'+
        '<div class="avatar">'+
        avhtml(p.avatar)+
        '</div>'+
        '<div class="lvl">'+
        'Lv.'+
        p.level+
        '</div>'+
        '</div>'+
        '<div class="name">'+
        esc(p.name)+
        (
          p.isBot
            ?' 🤖'
            :''
        )+
        '</div>'+
        '<div class="sm">'+
        p.xp+
        'XP · '+
        p.wins+
        'W · '+
        p.handPoints+
        ' / '+
        p.totalPoints+
        '</div>'+
        '<div class="backs">'+
        backs+
        '</div>'+
        '</div>';

      e.querySelector(
        '.avatar'
      )
      .onclick=
        ev=>{
          ev.stopPropagation();

          if(
            p.id!==
            s.viewingPlayerId
          ){
            openThrow(
              p.id,
              ev.clientX,
              ev.clientY
            );
          }
        };

      r.appendChild(e);
    }
  );
}

function table(s){
  let r=
    $('tableCards');

  r.innerHTML='';

  s.table.forEach(
    p=>{
      let g=
        document.createElement(
          'div'
        );

      g.className=
        'playGroup '+
        (
          p.isWinning
            ?'win'
            :''
        );

      g.innerHTML=
        '<div class="playName">'+
        esc(p.playerName)+
        (
          p.cut
            ?' ✂️'
            :''
        )+
        '</div>';

      p.cards.forEach(
        c=>
          g.appendChild(
            card(c)
          )
      );

      r.appendChild(g);
    }
  );
}

function hand(s){
  let r=
    $('myCards');

  r.innerHTML='';

  let a=
    s.playersCards[
      s.viewingPlayerId
    ]||
    [];

  let m=
    (
      a.length-1
    )/2;

  a.forEach(
    (c,i)=>{
      let e=
        card(c);

      let d=
        i-m;

      e.style.transform=
        'rotate('+
        (
          d*3.6
        )+
        'deg)';

      e.onclick=()=>
        toggle(
          i,
          e
        );

      r.appendChild(e);
    }
  );

  button();
}

function toggle(i,e){
  let x=
    sel.indexOf(i);

  if(x>=0){
    sel.splice(
      x,
      1
    );

    e.classList
      .remove(
        'selected'
      );
  }else if(
    sel.length<5
  ){
    sel.push(i);

    e.classList
      .add(
        'selected'
      );
  }

  sound(
    'select'
  );

  button();
}

function selectedCards(){
  let h=
    cur.playersCards[
      cur.viewingPlayerId
    ]||
    [];

  return sel
    .map(
      i=>h[i]
    )
    .filter(Boolean);
}

function sameC(a){
  return(
    !!a.length
    &&
    a.every(
      c=>
        c.suit===
        a[0].suit
    )
  );
}

function cb(
  a,
  b,
  t
){
  let at=
    t!=='no_trump'
    &&
    a.suit===t;

  let bt=
    t!=='no_trump'
    &&
    b.suit===t;

  if(
    bt&&
    !at
  ){
    return true;
  }

  if(
    at&&
    !bt
  ){
    return false;
  }

  if(
    a.suit!==
    b.suit
  ){
    return false;
  }

  return(
    R.indexOf(
      b.rank
    )
    >
    R.indexOf(
      a.rank
    )
  );
}

function comboC(
  base,
  ch,
  t
){
  if(
    base.length!==
    ch.length
  ){
    return false;
  }

  let used=
    Array(
      ch.length
    ).fill(false);

  let b=
    base
      .slice()
      .sort(
        (x,y)=>
          R.indexOf(
            y.rank
          )
          -
          R.indexOf(
            x.rank
          )
      );

  function f(i){
    if(
      i===b.length
    ){
      return true;
    }

    for(
      let j=0;
      j<ch.length;
      j++
    ){
      if(
        !used[j]
        &&
        cb(
          b[i],
          ch[j],
          t
        )
      ){
        used[j]=true;

        if(
          f(i+1)
        ){
          return true;
        }

        used[j]=false;
      }
    }

    return false;
  }

  return f(0);
}

function winningCards(){
  if(
    !cur.table.length
  ){
    return[];
  }

  let w=0;

  for(
    let i=1;
    i<cur.table.length;
    i++
  ){
    if(
      comboC(
        cur.table[w].cards,
        cur.table[i].cards,
        cur.trump
      )
    ){
      w=i;
    }
  }

  return(
    cur.table[w].cards
  );
}

function cuts(){
  return(
    !cur.table.length
    ||
    comboC(
      winningCards(),
      selectedCards(),
      cur.trump
    )
  );
}

/*
  FRONTEND MULTI-CARD FIX

  პირველი სვლისას:
  1-5 ერთმასტიანი.

  პასუხისას:
  ზუსტად იმდენი კარტი,
  რამდენიც leadCount-შია.
*/
function legal(){
  if(
    !cur||
    !sel.length
  ){
    return false;
  }

  let h=
    cur.playersCards[
      cur.viewingPlayerId
    ]||
    [];

  let a=
    selectedCards();

  if(
    !cur.table.length
  ){
    return sameC(a);
  }

  if(
    cur.leadWasMaliutka
  ){
    return(
      a.length===
      h.length
    );
  }

  return(
    a.length===
    cur.leadCount
  );
}

function button(){
  let n=
    sel.length;

  let b=
    $('play');

  $('selCount')
    .textContent=
      'არჩეული: '+
      n+
      ' / 5';

  if(
    n===5
    &&
    sameC(
      selectedCards()
    )
  ){
    b.textContent=
      'ჩადი მალიუტკა!';
  }else if(
    n
    &&
    cur
    &&
    cur.table.length
    &&
    n===cur.leadCount
    &&
    cuts()
  ){
    b.textContent=
      '✂️ გაჭერი '+
      n+
      ' კარტით';
  }else{
    b.textContent=
      n
        ?'ჩადი '+
         n+
         ' კარტი'
        :'სვლის გაკეთება';
  }

  let p=
    cur&&
    cur.players[
      cur.currentTurnIndex
    ];

  b.disabled=
    !cur
    ||
    !p
    ||
    p.id!==
    cur.viewingPlayerId
    ||
    cur.processing
    ||
    cur.gameOver
    ||
    !legal();
}

$('play')
  .onclick=()=>{
    if(
      !legal()
    ){
      return;
    }

    $('play')
      .disabled=true;

    socket.emit(
      'playCards',
      {
        cardIndices:
          sel.slice()
      }
    );

    sel=[];
  };

function status(s){
  let p=
    s.players[
      s.currentTurnIndex
    ];

  $('status')
    .textContent=
      s.gameOver
        ?'🏆 თამაში დასრულებულია'
        :s.processing
          ?'✨ ითვლება...'
          :p&&
           p.id===
           s.viewingPlayerId
            ?(
              s.leadWasMaliutka
              &&
              s.table.length
                ?'🔥 მალიუტკა — ჩამოდი მთელი ხელით'
                :s.table.length
                  ?'🎯 აირჩიე ზუსტად '+
                   s.leadCount+
                   ' კარტი'
                  :'🎯 შენი სვლაა'
            )
            :(
              p
                ?(
                  p.isBot
                    ?'🤖 '
                    :''
                )+
                p.name+
                ' თამაშობს...'
                :''
            );
}

function score(s){
  let last=
    s.lastHandScores||
    {};

  let a=
    s.players
      .slice()
      .sort(
        (x,y)=>
          y.totalPoints-
          x.totalPoints
      );

  $('score')
    .innerHTML=
      a.map(
        (p,i)=>
          '<div class="scoreRow">'+
          '<div>'+
          (
            i===0
              ?'🥇'
              :i===1
                ?'🥈'
                :i===2
                  ?'🥉'
                  :'#'+
                   (i+1)
          )+
          '</div>'+
          '<div>'+
          esc(p.name)+
          '</div>'+
          '<div>'+
          (
            last[p.id]??
            '-'
          )+
          '</div>'+
          '<b>'+
          p.totalPoints+
          '</b>'+
          '</div>'
      )
      .join('');

  $('history')
    .innerHTML=
      (
        s.history||
        []
      )
      .slice()
      .reverse()
      .map(
        h=>
          '<div class="hist">'+
          '<b>'+
          'Round '+
          h.hand+
          ' ('+
          sym(h.trump)+
          ')'+
          '</b>'+
          '<br>'+
          s.players
            .map(
              p=>
                esc(p.name)+
                ': '+
                (
                  (
                    h.rawScores
                    &&
                    h.rawScores[p.id]
                  )
                  ??
                  0
                )+
                'pt'
            )
            .join(
              ' · '
            )+
          '</div>'
      )
      .join('');
}

function tester(s){
  $('testPanel')
    .classList
    .toggle(
      'hide',
      !s.revealAll
    );

  if(
    !s.revealAll
  ){
    return;
  }

  $('testGrid')
    .innerHTML=
      s.players
        .map(
          p=>
            '<div class="tester">'+
            '<b>'+
            esc(p.name)+
            '</b>'+
            '<br>'+
            (
              s.playersCards[p.id]||
              []
            )
            .map(
              c=>
                '<span>'+
                c.rank+
                sym(c.suit)+
                '</span>'
            )
            .join('')+
            '</div>'
        )
        .join('');
}

function clock(){
  cancelAnimationFrame(
    timer
  );

  function t(){
    if(!cur)
      return;

    let pc=
      Math.max(
        0,
        Math.min(
          100,
          (
            cur.turnEndsAt-
            Date.now()
          )
          /
          (
            cur.turnSeconds*
            1000
          )
          *
          100
        )
      );

    document
      .querySelectorAll(
        '.seat'
      )
      .forEach(
        e=>{
          let r=
            e.querySelector(
              '.ring'
            );

          if(r){
            r.style
              .setProperty(
                '--t',
                e.classList
                  .contains(
                    'current'
                  )
                  ?pc+'%'
                  :'0%'
              );
          }
        }
      );

    timer=
      requestAnimationFrame(
        t
      );
  }

  t();
}

function seatBox(id){
  let e=[
    ...document
      .querySelectorAll(
        '.seat'
      )
  ]
  .find(
    x=>
      x.dataset.id===
      id
  );

  return(
    e&&
    e.querySelector(
      '.seatBox'
    )
  );
}

function react(m){
  let b=
    seatBox(
      m.playerId
    );

  if(!b)
    return;

  let e=
    document.createElement(
      'div'
    );

  e.className=
    'reaction';

  e.textContent=
    m.text;

  b.appendChild(e);

  setTimeout(
    ()=>e.remove(),
    2500
  );
}

document
  .querySelectorAll(
    '.qa'
  )
  .forEach(
    b=>
      b.onclick=()=>{
        socket.emit(
          'quickMessage',
          {
            text:b.dataset.q
          }
        );

        voice(
          b.dataset.q
        );
      }
  );

function openThrow(
  id,
  x,
  y
){
  target=id;

  let m=
    $('throwMenu');

  m.style.left=
    Math.min(
      x,
      innerWidth-
      190
    )+
    'px';

  m.style.top=
    Math.min(
      y,
      innerHeight-
      150
    )+
    'px';

  m.classList
    .add(
      'show'
    );
}

document
  .querySelectorAll(
    '.throw'
  )
  .forEach(
    b=>
      b.onclick=()=>{
        if(target){
          socket.emit(
            'throwable',
            {
              targetPlayerId:
                target,

              type:
                b.dataset.t
            }
          );
        }

        $('throwMenu')
          .classList
          .remove(
            'show'
          );

        target=null;
      }
  );

document
  .addEventListener(
    'click',
    e=>{
      if(
        !e.target.closest(
          '#throwMenu'
        )
        &&
        !e.target.closest(
          '.avatar'
        )
      ){
        $('throwMenu')
          .classList
          .remove(
            'show'
          );
      }
    }
  );

function throwFx(e){
  let a=
    seatBox(
      e.fromPlayerId
    );

  let b=
    seatBox(
      e.targetPlayerId
    );

  if(
    !a||
    !b
  ){
    return;
  }

  let ar=
    a.getBoundingClientRect();

  let br=
    b.getBoundingClientRect();

  let f=
    document.createElement(
      'div'
    );

  f.className=
    'throwFly';

  f.textContent=
    e.type==='tomato'
      ?'🍅'
      :e.type==='egg'
        ?'🥚'
        :'🧻';

  f.style.left=
    (
      ar.left+
      ar.width/2
    )+
    'px';

  f.style.top=
    (
      ar.top+
      ar.height/2
    )+
    'px';

  document.body
    .appendChild(f);

  requestAnimationFrame(
    ()=>
      f.style.transform=
        'translate('+
        (
          br.left-
          ar.left
        )+
        'px,'+
        (
          br.top-
          ar.top
        )+
        'px) rotate(360deg)'
  );

  setTimeout(
    ()=>{
      f.remove();

      let z=
        document.createElement(
          'div'
        );

      z.className=
        e.type==='paper'
          ?'paper'
          :'splat';

      if(
        e.type!==
        'paper'
      ){
        z.textContent=
          e.type===
          'tomato'
            ?'🍅'
            :'🍳';
      }

      b.appendChild(z);

      setTimeout(
        ()=>z.remove(),
        3000
      );
    },
    760
  );

  sound(
    'gift'
  );
}

function toast(t){
  let e=
    document.createElement(
      'div'
    );

  e.className=
    'toast';

  e.textContent=t;

  document.body
    .appendChild(e);

  setTimeout(
    ()=>e.remove(),
    3300
  );
}

function voice(t){
  if(!sfxOn)
    return;

  try{
    let u=
      new SpeechSynthesisUtterance(
        t
      );

    u.lang=
      'ka-GE';

    u.rate=
      1.03;

    speechSynthesis
      .cancel();

    speechSynthesis
      .speak(u);
  }catch{
    sound(
      'voice'
    );
  }
}

function sound(t){
  if(!sfxOn)
    return;

  try{
    let A=
      window.AudioContext||
      window.webkitAudioContext;

    let c=
      new A();

    let o=
      c.createOscillator();

    let g=
      c.createGain();

    let f=
      t==='cut'
        ?300
        :t==='win'
          ?900
          :t==='select'
            ?650
            :t==='gift'
              ?550
              :450;

    o.connect(g);

    g.connect(
      c.destination
    );

    o.frequency.value=f;

    g.gain.value=.025;

    o.start();

    g.gain
      .exponentialRampToValueAtTime(
        .001,
        c.currentTime+
        .08
      );

    o.stop(
      c.currentTime+
      .08
    );
  }catch{}
}

socket.on(
  'connect_error',
  e=>
    $('wait')
      .textContent=
        'კავშირის შეცდომა: '+
        e.message
);

renderProf();

</script>

</body>

</html>
`;

app.get(
  '/',
  (_,res)=>
    res
      .type('html')
      .send(PAGE)
);

app.get(
  '/health',
  (_,res)=>
    res.json({
      ok:true,
      cards:
        deck().length,
      tester:
        TESTER,
      rooms:
        rooms.size,
      users:
        Object.keys(
          users
        ).length
    })
);

server.listen(
  PORT,
  ()=>
    console.log(
      'WRITTEN BURA on',
      PORT
    )
);
