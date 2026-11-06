"""Builds the Semmal pitch material: two 3-minute decks (Arkiv, 0G), their speaker scripts, and the
4-minute video plan. HTML here; PDFs rendered by render.sh (headless Chrome). Every fact is from the build."""
import html, os
OUT = os.path.dirname(os.path.abspath(__file__))

FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&family=Noto+Sans+Tamil:wght@700&display=swap" rel="stylesheet">'
LOGO = '<svg viewBox="0 0 32 32" class="logo-mark" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 9V5.6"/><rect x="5" y="9" width="22" height="18" rx="7"/><path d="M2.4 15.5v5M29.6 15.5v5"/><path d="M12.6 22.4h6.8" opacity="0.55"/></g><circle cx="11.4" cy="17" r="2.1" fill="currentColor"/><circle cx="20.6" cy="17" r="2.1" fill="currentColor"/><circle cx="16" cy="3.6" r="2.7" fill="#ff4a1f"/></svg>'
BRAND = f'<div class="brand">{LOGO}<span class="ta">செம்மல்</span><span class="rule"></span><span class="en">Semmal</span></div>'

BASE_CSS = """
:root{--bg:#0d0d10;--panel:#15161a;--line:rgba(255,255,255,.09);--ink:#f3f1ec;--muted:#a3a1a8;--accent:#ff4a1f;--ok:#3ecf8e;--ice:#7fd8ff;--warn:#f3cf6b}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:Manrope,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.mono{font-family:'JetBrains Mono',ui-monospace,monospace}.ta{font-family:'Noto Sans Tamil',sans-serif;font-weight:700}
.brand{display:inline-flex;align-items:center;gap:12px}.brand .logo-mark{width:34px;height:34px;color:var(--ink)}.brand .ta{font-size:24px}.brand .rule{width:1px;height:20px;background:rgba(255,255,255,.25)}.brand .en{font-weight:600;color:var(--muted);font-size:20px}
.accent{color:var(--accent)}.ok{color:var(--ok)}.muted{color:var(--muted)}
"""

# ------------------------------------------------------------------ decks
DECK_CSS = BASE_CSS + """
@page{size:1920px 1080px;margin:0}
.deck{display:grid;gap:40px;justify-content:center;padding:40px 0}
.slide{width:1920px;height:1080px;position:relative;overflow:hidden;background:radial-gradient(60% 70% at 85% 15%,rgba(255,74,31,.10),transparent 60%),radial-gradient(50% 60% at 10% 100%,rgba(127,216,255,.07),transparent 60%),var(--bg);padding:96px 120px 90px;display:flex;flex-direction:column;gap:36px;border:1px solid var(--line);border-radius:24px}
.slide .top{display:flex;justify-content:space-between;align-items:center}
.slide .n{font:500 18px 'JetBrains Mono';color:var(--muted)}
.kicker{font:600 22px Manrope;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-size:96px;line-height:1.02;letter-spacing:-.035em;margin:0;font-weight:700}
h2{font-size:64px;line-height:1.06;letter-spacing:-.03em;margin:0;font-weight:700}
.lead{font-size:34px;line-height:1.4;color:#d8d6d0;max-width:1500px;margin:0}
.grid{display:grid;gap:24px}.g2{grid-template-columns:1fr 1fr}.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}
.card{background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.01));border:1px solid var(--line);border-radius:22px;padding:30px 32px;display:grid;gap:10px;align-content:start}
.card b{font-size:30px;letter-spacing:-.01em}.card p{margin:0;font-size:23px;line-height:1.45;color:#cfcdc7}
.card .big{font-size:64px;font-weight:700;letter-spacing:-.03em;line-height:1}
table{border-collapse:collapse;width:100%;font-size:23px}th{text-align:left;color:var(--muted);font-weight:500;padding:12px 16px;border-bottom:1px solid var(--line)}td{padding:13px 16px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}
code,.code{font-family:'JetBrains Mono';font-size:21px}
pre{margin:0;background:#08090b;border:1px solid var(--line);border-radius:18px;padding:26px 30px;font:400 20px/1.55 'JetBrains Mono';color:#dcdad4;white-space:pre-wrap}
.flow{display:flex;align-items:stretch;gap:14px}.flow .step{flex:1;background:#121317;border:1px solid var(--line);border-radius:18px;padding:22px;display:grid;gap:8px;align-content:start}
.flow .step b{font-size:25px}.flow .step span{font-size:19px;color:var(--muted);line-height:1.4}.flow .arrow{align-self:center;color:var(--accent);font-size:34px}
.step.hot{border-color:rgba(255,74,31,.6);background:linear-gradient(180deg,rgba(255,74,31,.14),rgba(255,74,31,.03))}
.checks{display:grid;gap:14px}.chk{display:grid;grid-template-columns:44px 1fr auto;gap:16px;align-items:center;font-size:25px;padding:14px 22px;border-radius:16px;background:#121317;border:1px solid var(--line)}
.chk .tick{width:36px;height:36px;border-radius:50%;background:rgba(62,207,142,.15);color:var(--ok);display:grid;place-items:center;font-weight:700}
.chk .where{font:400 18px 'JetBrains Mono';color:var(--muted)}
.pill{display:inline-block;padding:6px 16px;border-radius:999px;background:rgba(255,74,31,.14);color:#ffb39f;font-size:20px;font-weight:600}
.hook{justify-content:center}.hook h1{font-size:104px;max-width:1600px}
.hook .facts{display:flex;gap:18px;flex-wrap:wrap}.hook .facts span{font-size:24px;padding:12px 22px;border:1px solid var(--line);border-radius:999px;background:#121317}
.foot{position:absolute;left:120px;right:120px;bottom:44px;display:flex;justify-content:space-between;font-size:18px;color:var(--muted)}
/* centre each slide's content block between the header and the footer; larger text for a projector */
.slide>:nth-child(2){margin-top:auto}.slide>:nth-last-child(2){margin-bottom:auto}
.slide:not(.hook) .card p{font-size:27px}.slide:not(.hook) .card b{font-size:33px}table{font-size:27px}td,th{padding:16px 18px}
.flow .step b{font-size:28px}.flow .step span{font-size:22px}pre{font-size:23px}.chk{font-size:28px;padding:18px 24px}.chk .where{font-size:20px}
.slide:not(.hook) .lead{font-size:32px}h2{font-size:70px}
@media screen{body.present .deck{display:block;padding:0}body.present .slide{position:absolute;inset:0 auto auto 0;transform-origin:0 0;display:none;border-radius:0}body.present .slide.on{display:flex}}
@media print{.deck{display:block;padding:0}.slide{page-break-after:always;border:0;border-radius:0}}
"""

DECK_JS = """<script>
(()=>{const s=[...document.querySelectorAll('.slide')];let i=0;const fit=()=>{const k=Math.min(innerWidth/1920,innerHeight/1080);s.forEach(x=>{x.style.transform=`translate(${(innerWidth-1920*k)/2}px,${(innerHeight-1080*k)/2}px) scale(${k})`})};
const show=()=>{s.forEach((x,j)=>x.classList.toggle('on',j===i));};
addEventListener('keydown',e=>{if(e.key==='p'){document.body.classList.toggle('present');fit();show();return}if(!document.body.classList.contains('present'))return;if(['ArrowRight','PageDown',' '].includes(e.key))i=Math.min(s.length-1,i+1);if(['ArrowLeft','PageUp'].includes(e.key))i=Math.max(0,i-1);show()});
addEventListener('resize',fit);if(location.hash==='#present'){document.body.classList.add('present');fit();show()}})();
</script>"""

def deck(title, slides, foot):
    out=[]
    for k,(cls,body) in enumerate(slides,1):
        out.append(f'<section class="slide {cls}"><div class="top">{BRAND}<span class="n">{k:02d} / {len(slides):02d}</span></div>{body}<div class="foot"><span>{foot}</span><span>semmal.vercel.app · github.com/jonathanvineet/semmal</span></div></section>')
    return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title>{FONTS}<style>{DECK_CSS}</style></head><body><div class="deck">{"".join(out)}</div>{DECK_JS}</body></html>'

def chk(text, where): return f'<div class="chk"><span class="tick">✓</span><span>{text}</span><span class="where">{where}</span></div>'

# ---------------- Arkiv deck
arkiv_slides = [
 ("hook", """<div class="kicker">Build on Arkiv · 15 seconds</div>
<h1>Robots that hire AI agents, and <span class="accent">sign their own record</span> on Arkiv.</h1>
<p class="lead">Bookings, quotes, hires, every job and its score are Arkiv entities owned by the party accountable for them, the robot's own wallet included. You can check a robot's record without trusting us.</p>
<div class="facts"><span>8 entity types</span><span>robot-owned evidence</span><span>expiry = deadline</span><span>scores you can re-query</span></div>"""),
 ("", """<div class="kicker">The problem</div><h2>Four parties. None of them should have to trust the platform.</h2>
<div class="grid g4"><div class="card"><b>Customer</b><p>Is this robot any good? Will its record be edited after a bad job?</p></div><div class="card"><b>Robot owner</b><p>My robot did the work. Who decides its score?</p></div><div class="card"><b>The robot</b><p>An autonomous agent with its own wallet. It answers for its price, hires and results.</p></div><div class="card"><b>Agent developer</b><p>My vision agent is listed with a price. Who can delist it or change it?</p></div></div>
<p class="lead">In Postgres the operator could delete a failed job, edit a score or hide an incident. On Arkiv each record is owned by its author, and readers check that.</p>"""),
 ("", """<div class="kicker">What lives on Arkiv</div><h2>Every coordination step is an entity</h2>
<table><tr><th>Entity</th><th>Owner ($owner)</th><th>Expires</th><th>Filtered on</th></tr>
<tr><td>Robot profile</td><td>robot owner</td><td>90 days</td><td class="code">robot_wallet · owner_wallet · skill</td></tr>
<tr><td>Agent listing</td><td>agent developer</td><td>90 days</td><td class="code">kind · trust_mode · price</td></tr>
<tr><td>Booking</td><td>customer</td><td><b>at its deadline</b></td><td class="code">customer · robot_id · task_id</td></tr>
<tr><td>Quote · job claim</td><td class="accent">robot's own wallet</td><td><b>at validUntil / job deadline</b></td><td class="code">task_id · agent_id</td></tr>
<tr><td>Episode (v2) · incident</td><td class="accent">robot's own wallet</td><td>120 days</td><td class="code">robot_id · task_id · <b>task_score</b></td></tr>
<tr><td>Reputation checkpoint</td><td>instance owner</td><td>120 days</td><td class="code">subject_id · score · status</td></tr></table>"""),
 ("", """<div class="kicker">Ownership is the permission system</div><h2>The robot signs its own record. Nobody can alter or withhold it.</h2>
<div class="flow"><div class="step"><b>Robot PC</b><span>device key generated on the robot, never leaves it, may write only 4 evidence schemas under a daily fee cap</span></div><div class="arrow">→</div><div class="step hot"><b>Arkiv entity</b><span>$owner = $creator = robot wallet; body names the same wallet</span></div><div class="arrow">→</div><div class="step"><b>Every reader checks</b><span>owner and creator match the wallet inside, and that wallet is on the robot's registered profile, or the record is ignored</span></div></div>
<p class="lead">People sign in their own browser wallet after an in-app approval showing gas and max fee. There is no platform key anywhere.</p>"""),
 ("", """<div class="kicker">Expiry does the coordination</div><h2>Stale offers clean themselves up</h2>
<div class="grid g3"><div class="card"><span class="big accent">deadline</span><b>Bookings, quotes, job claims</b><p>expire exactly when they stop mattering. No cron job, no stale offers to filter out.</p></div><div class="card"><span class="big">90 d</span><b>Registrations</b><p>a robot or agent nobody maintains (or one excluded by its score) simply lapses.</p></div><div class="card"><span class="big">120 d</span><b>Evidence and scores</b><p>long enough to score recent work; the full bundles live on 0G Storage, with the root on Arkiv.</p></div></div>"""),
 ("", """<div class="kicker">Scores come from Arkiv, and choose who gets work</div><h2>One query anyone can run</h2>
<div class="grid g2"><pre><span class="muted">$ pnpm arkiv:query</span>
task-6f5992c2  COMPLETED  <span class="accent">task_score 100</span>
owner 0x103E…29BC (robot wallet)
  Stops completed      40/40  4 of 4 stops
  Valid 0G decisions   20/20  4 of 4 passed
  Findings dealt with  20/20  1 of 1
  Extra stops done       —    not judged
  On time              10/10  before deadline
  agent agt-house-2b5c20 · 4 jobs · 100 each</pre>
<div class="card"><b>Indexed <span class="code">task_score</span> → ranking</b><p>Robot score = mean of its job scores on Arkiv, minus incidents. Agent score = mean of the job scores the hiring robots signed.</p><p><b>Selection</b> = (judged × score + 3 × 70) / (judged + 3): robots are ranked by it when you book, and agents when a robot hires.</p><p class="muted">SELECT semmal_episode_v2 ORDER BY task_score DESC. No key needed.</p></div></div>"""),
 ("", """<div class="kicker">Every Arkiv feature changes a screen</div><h2>Users read Arkiv everywhere</h2>
<div class="grid g3"><div class="card"><b>Booking map</b><p>robots near your site from robot profiles, ranked by score</p></div><div class="card"><b>Agent market</b><p>listings by kind, trust mode and price</p></div><div class="card"><b>Your orders</b><p>bookings where customer = your wallet</p></div><div class="card"><b>Owner requests</b><p>bookings for your robots, waiting for approval</p></div><div class="card"><b>Evidence log</b><p>episodes and incidents, checked against the 0G Storage proof and signature</p></div><div class="card"><b>What went to Arkiv</b><p>the job's entity read back: schema, columns, body, owner, expiry, score maths</p></div></div>
<p class="lead">Live now: <b>2</b> robots · <b>2</b> agents · <b>5</b> bookings · <b>5</b> robot quotes · <b>7</b> episodes · <b>21</b> incidents, all signed by their owners.</p>"""),
 ("", """<div class="kicker">Deliverables</div><h2>Everything the track asks for</h2>
<div class="checks">"""+chk("Writes to Rabdi with @arkiv-network/sdk 1.0.1; users see data read from Arkiv","8 schemas, 6 screens")+chk("README: the writer wallets and one query to run","pnpm arkiv:query")+chk("arkiv/schema.md: entities, queried fields, owners, expiry","arkiv/schema.md")+chk("One file per criterion: friction, reach, why Arkiv, how we use it","arkiv/*.md")+chk("Feedback from real friction: 9 issues with repro + workaround","arkiv/friction.md")+chk("Public repo, MIT licence, AI use disclosed, built at Mumbai","github.com/jonathanvineet/semmal")+"""</div>"""),
 ("hook", """<div class="kicker">Why Arkiv</div><h1>Swap Arkiv for Postgres and users lose the one thing that matters: <span class="accent">a robot record they don't have to trust us for.</span></h1>
<p class="lead">Kept off Arkiv on purpose: live position, exact addresses, camera frames, sessions and keys.</p>
<div class="facts"><span>Team Semmal</span><span>Telegram · X: jonathan_vineet</span><span>semmal.vercel.app</span></div>"""),
]

# ---------------- 0G deck
zerog_slides = [
 ("hook", """<div class="kicker">0G · Physical AI + Private Computer · 15 seconds</div>
<h1>A robot that <span class="accent">cannot pass a checkpoint without 0G.</span></h1>
<p class="lead">At every stop it pays an AI agent in 0G, which asks a private TEE model on 0G Private Computer what it sees. The answer and its request ID go into a signed episode on 0G Storage. If 0G is down it stops safely. It never fakes a decision.</p>
<div class="facts"><span>private TEE inference</span><span>request ID per decision</span><span>paid in native 0G</span><span>episodes on 0G Storage</span><span>safe stop</span></div>"""),
 ("", """<div class="kicker">0G is the brain, not the spinal cord</div><h2>The decision loop, at every checkpoint</h2>
<div class="flow"><div class="step"><b>1 · Drive</b><span>ROS 2 + Gazebo; navigation and safety stay on the robot</span></div><div class="arrow">→</div><div class="step"><b>2 · Look</b><span>one camera frame, never stored</span></div><div class="arrow">→</div><div class="step"><b>3 · Hire + pay</b><span>robot pays the agent owner in 0G; the transfer is checked on chain before 0G is called</span></div><div class="arrow">→</div><div class="step hot"><b>4 · 0G PC</b><span>0gm-1.0-35b-a3b, private mode, TEE providers only</span></div><div class="arrow">→</div><div class="step"><b>5 · Check</b><span>exact JSON, allowed action, confidence ≥ 0.6</span></div><div class="arrow">→</div><div class="step"><b>6 · Act</b><span>clear the toys, report, hold or go home: bounded actions only</span></div></div>
<p class="lead">Model output is advisory. It picks one of five actions; it never touches motors, money or keys.</p>"""),
 ("", """<div class="kicker">A real call, as the customer sees it</div><h2>"How it decided": every 0G call, in full</h2>
<div class="grid g2"><pre>Sent through the 0G Router to <span class="accent">0gm-1.0-35b-a3b</span>
in <b>private</b> mode, provider 0xf4FB…79B250
0G request ID  985498df-94a2-4e3d-9f1d-21ffe9f8a472
Time           24,464 ms
Billed to      the agent's own Router key · cap 0.5 USD/day
Answer  { "observation": "Colorful blocks on the floor",
          "anomaly_type": "toys on floor",
          "confidence": 0.95,
          "recommended_action": "clear_and_continue" }
Checked  ✓ exact format  ✓ allowed action  ✓ 0.95 ≥ 0.6
Did      picked the toys up and put them in the bin</pre>
<div class="card"><b>Privacy on demand</b><p>Private mode routes only to TEE providers; a model without TEE is never used for a private job. No silent downgrade.</p><b>Per-agent compute</b><p>Each agent calls 0G with its own Router key, created with a daily credit cap, allowed models and trust mode.</p></div></div>"""),
 ("", """<div class="kicker">Native 0G money, on 0G Galileo</div><h2>The robot has its own wallet and its own budget</h2>
<div class="flow"><div class="step"><b>Customer → robot</b><span>pays the robot's signed quote after confirming arrival (memo semmal:quote:&lt;id&gt;)</span></div><div class="arrow">→</div><div class="step hot"><b>Robot → agent owner</b><span>one transfer per agent job (semmal:job:&lt;id&gt;), within the paid budget, never twice</span></div><div class="arrow">→</div><div class="step"><b>Agent → 0G PC</b><span>its price covers its own capped 0G inference</span></div><div class="arrow">→</div><div class="step"><b>Robot → owner / customer</b><span>the margin if done; the unspent rest refunded if not</span></div></div>
<p class="lead">Allowlisted recipients, per-payment and daily caps, idempotent. The only key is the robot's device key on the robot PC.</p>"""),
 ("", """<div class="kicker">0G Storage: the episode log</div><h2>Every job ends as a signed bundle, with a request ID per decision</h2>
<div class="grid g2"><pre>episode bundle (canonical JSON)
  decisions[]  stop · providerRequestId · model
               trust mode · latency · verdict
  purchases[]  agent · 0G payment tx · job score
  actions[] · transitions[] · money · quote
  score        task-score-v1
  manifest_hash  sha256 · robot_signature

0G Storage root  0x45645ef9…7aefef
Arkiv index      task_score 100 · root · request IDs</pre>
<div class="card"><b>Saved locally first</b><p>LOCAL_DURABLE → STORAGE_CONFIRMED → ARKIV_CONFIRMED, with retries and no duplicates.</p><b>Verified on read</b><p>The evidence view downloads with the Storage proof and checks the hash, the robot signature and the Arkiv link.</p></div></div>"""),
 ("", """<div class="kicker">Safe stop: no fake decisions</div><h2>If 0G can't answer, the robot doesn't guess</h2>
<div class="grid g3"><div class="card"><span class="big">hold</span><b>no answer, late, invalid</b><p>The robot holds position and retries once with the same paid job.</p></div><div class="card"><span class="big accent">SAFE_STOP</span><b>still no valid answer</b><p>It stops safely and records why. Nothing is invented. Tested: "0G fails twice → SAFE_STOP, nothing invented".</p></div><div class="card"><span class="big">local</span><b>motor overcurrent</b><p>The safety supervisor stops the robot with no network and no AI; the incident is signed and queued until it reaches Storage and Arkiv.</p></div></div>"""),
 ("", """<div class="kicker">Deliverables</div><h2>Both 0G tracks, checked</h2>
<div class="checks">"""+chk("0G call inside the decision loop (vision at every stop)","services/robot-master/src/mission.ts")+chk("Episode log on 0G Storage with a request ID per decision","evidence.ts · decisions[].providerRequestId")+chk("Replayable simulation: deterministic Gazebo worlds","scripts/robot/scenario.sh · demo video")+chk("Safe stop when 0G is unreachable; never a faked decision","mission.test.ts")+chk("0G PC in the main user flow, request IDs shown to the customer","How it decided")+chk("Repo + setup, live link, addresses, team","README · semmal.vercel.app")+"""</div>"""),
 ("hook", """<div class="kicker">What breaks if 0G is removed</div><h1>The robot can't decide at a single checkpoint, so it <span class="accent">safe-stops</span>: no job done, no agent paid.</h1>
<p class="lead">0G is the brain at each checkpoint, the money, and the memory, and the robot keeps the motion and the safety.</p>
<div class="facts"><span>Team Semmal</span><span>Telegram · X: jonathan_vineet</span><span>semmal.vercel.app</span></div>"""),
]

# ------------------------------------------------------------------ documents (scripts + video plan)
DOC_CSS = BASE_CSS + """
@page{size:A4;margin:16mm 15mm}
body{background:#fff;color:#141518;font-size:11pt;line-height:1.5}
.doc{max-width:180mm;margin:0 auto;padding:10mm 0}
.doc .brand .logo-mark{color:#141518}.doc .brand .en{color:#555}.doc .brand .rule{background:#bbb}
h1{font-size:24pt;letter-spacing:-.02em;margin:10px 0 4px}h2{font-size:15pt;margin:22px 0 8px;letter-spacing:-.01em;border-bottom:2px solid #ff4a1f;padding-bottom:4px}h3{font-size:12pt;margin:14px 0 6px}
p{margin:6px 0}.sub{color:#555}
table{border-collapse:collapse;width:100%;font-size:9.5pt;margin:6px 0 10px}th{background:#f3f1ec;text-align:left;padding:6px 8px;border:1px solid #ddd}td{padding:6px 8px;border:1px solid #ddd;vertical-align:top}
td.t{white-space:nowrap;font-family:'JetBrains Mono';font-weight:500;color:#c2391a}
.vo{font-style:normal}.vo q{quotes:none}
.box{border:1.5px solid #ff4a1f;background:#fff4f0;border-radius:8px;padding:10px 14px;margin:10px 0}
.hl{background:#ffe2d8;padding:1px 4px;border-radius:3px;font-weight:600}
ul{margin:4px 0 8px 18px;padding:0}li{margin:2px 0}
.pb{page-break-before:always}
code{font-family:'JetBrains Mono';font-size:9pt;background:#f3f1ec;padding:1px 4px;border-radius:3px}
.ok{color:#14894f;font-weight:700}
"""
def doc(title, body):
    return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{html.escape(title)}</title>{FONTS}<style>{DOC_CSS}</style></head><body><div class="doc">{BRAND}{body}</div></body></html>'
def rows(r): return "".join(f'<tr><td class="t">{a}</td>' + "".join(f"<td>{c}</td>" for c in rest) + "</tr>" for a,*rest in r)

# ---------------- Arkiv speaker script (3 min)
arkiv_script = doc("Semmal · Arkiv pitch script (3 min)", """
<h1>Arkiv pitch: 3-minute script</h1><p class="sub">Track: <b>Build on Arkiv (from scratch)</b> · deck: <code>docs/pitch/arkiv-deck.html</code> (press <b>p</b> to present, arrows to move) · ~400 words at a calm pace.</p>
<div class="box"><b>The 15-second hook (say it first, word for word):</b><br>
"Semmal is a marketplace where robots hire AI agents. Every booking, quote, hire, job and score is an Arkiv entity, owned by whoever is accountable for it, including the robot's own wallet. So you can check a robot's record without trusting us."</div>
<h2>Minute by minute</h2>
<table><tr><th>Time</th><th>Slide</th><th>Say</th><th>Show / point at</th></tr>"""+rows([
("0:00–0:15","1 · Hook","The hook above.","The headline and the four fact pills."),
("0:15–0:35","2 · The problem","\"Four parties: customers, robot owners, the robots themselves and agent developers. In a normal database the operator could delete a failed job or edit a score. So the record has to belong to its author.\"","The four cards."),
("0:35–1:00","3 · Entities","\"Every coordination step is an entity: robot and agent profiles, bookings, the robot's quotes, its job claims for the agents it hires, its episodes and incidents, and reputation checkpoints. We index only what we filter on: wallet, robot, task, kind, trust mode, price, and the job score.\"","The owner column: robot's own wallet in orange."),
("1:00–1:25","4 · Ownership","\"The robot has its own key, made on the robot PC, never sent anywhere. It can write only its four evidence schemas under a fee cap. Every reader checks that owner, creator and the wallet inside match, and that it's the wallet on the robot's profile. People sign in their own wallet; there is no platform key.\"","The three-step flow."),
("1:25–1:45","5 · Expiry","\"Expiry does our coordination: bookings, quotes and job claims expire at their own deadline. Registrations lapse after 90 days unless renewed; evidence and scores live 120.\"","The three numbers."),
("1:45–2:15","6 · Scores","\"After each job the robot scores itself, part by part, and writes the score as an indexed column. A robot's reputation is the mean of its job scores on Arkiv; an agent's comes from the scores the hiring robots signed. That ranks robots when you book and agents when a robot hires. Anyone can recompute it with one query, no key needed.\"","The query output: task_score 100, the parts."),
("2:15–2:35","7 · Screens","\"Every feature reads Arkiv: the booking map, the agent market, your orders, owner requests, the evidence log, and 'What went to Arkiv', which reads a job's entity back with the score maths. Live now: 2 robots, 2 agents, 5 bookings, 7 episodes, 21 incidents.\"","The six cards and the live numbers."),
("2:35–2:50","8 · Deliverables","\"Everything the track asks for is in the repo: schema.md, friction with 9 real issues, reach, why Arkiv, how we use it, writer wallets and a query in the README, MIT licence.\"","The checklist."),
("2:50–3:00","9 · Close","\"Swap Arkiv for Postgres and users lose a robot record they don't have to trust us for. That's Semmal.\"","Team and links."),
])+"""</table>
<h2>Deliverables to point at (Arkiv track)</h2><table><tr><th>Requirement</th><th>Where</th></tr>
<tr><td>Writes to Arkiv's testnet with the SDK; a user-visible feature reads it</td><td>8 schemas on Rabdi; booking map, agent market, orders, evidence, "What went to Arkiv"</td></tr>
<tr><td>README: writer wallet addresses + one query</td><td>README → "ETHGlobal Mumbai submission"; <code>pnpm arkiv:query</code></td></tr>
<tr><td>/arkiv/schema.md and /arkiv/friction.md</td><td><code>arkiv/schema.md</code>, <code>arkiv/friction.md</code></td></tr>
<tr><td>One file per criterion</td><td><code>arkiv/reach.md</code>, <code>arkiv/why-arkiv.md</code>, <code>arkiv/how-you-use-arkiv.md</code></td></tr>
<tr><td>Public repo, open-source licence, AI use stated</td><td>github.com/jonathanvineet/semmal · MIT · README "How AI was used"</td></tr></table>
<h2>Likely questions</h2><ul>
<li><b>Why not a contract?</b> We need queryable records with owners and lifetimes, not logic; Arkiv gives us filters and expiry; payments are plain 0G transfers.</li>
<li><b>Can a robot lie?</b> Arkiv proves who wrote what and when, not that a sensor was right. The robot's identity is a signed challenge from its own key at registration.</li>
<li><b>What's off Arkiv?</b> Live position, exact addresses, camera frames, sessions, keys (see why-arkiv.md).</li></ul>""")

# ---------------- 0G speaker script (3 min)
zerog_script = doc("Semmal · 0G pitch script (3 min)", """
<h1>0G pitch: 3-minute script</h1><p class="sub">Tracks: <b>Physical AI: Agents with a Body</b> and <b>Build with 0G Private Computer</b> · deck: <code>docs/pitch/zerog-deck.html</code> (press <b>p</b> to present).</p>
<div class="box"><b>The 15-second hook (say it first, word for word):</b><br>
"Our robot cannot pass a checkpoint without 0G. At every stop it pays an AI agent in 0G, which asks a private TEE model on 0G Private Computer what it sees. The answer and its request ID go into a signed episode on 0G Storage. If 0G is down, it stops safely. It never fakes a decision."</div>
<h2>Minute by minute</h2>
<table><tr><th>Time</th><th>Slide</th><th>Say</th><th>Show / point at</th></tr>"""+rows([
("0:00–0:15","1 · Hook","The hook above.","Headline and the five pills."),
("0:15–0:45","2 · Decision loop","\"0G is the brain, not the spinal cord. ROS 2 drives and keeps safety on the robot. At each checkpoint it takes one frame, hires a vision agent, pays it in 0G, and the agent runs 0gm on 0G Private Computer in private mode, TEE providers only. The robot checks the answer: exact JSON, an allowed action, confidence at least 0.6, and only then acts.\"","The six steps; 0G PC highlighted."),
("0:45–1:15","3 · A real call","\"This is what the customer sees for every call: the model, private mode, the provider, the 0G request ID, 24 seconds, billed to the agent's own capped Router key. The answer said toys on the floor at 0.95, the checks passed, and the robot picked them up and put them in the bin.\"","Request ID 985498df…, the checks, 'Did'."),
("1:15–1:40","4 · Money","\"Everything is paid in native 0G on Galileo. The customer pays the robot's signed quote after it arrives. The robot pays the agent owner once per job, and the transfer is checked on chain before 0G is called. The margin goes to the owner, and anything unspent goes back to the customer.\"","The four arrows."),
("1:40–2:05","5 · 0G Storage","\"Every job ends as a bundle signed by the robot: each decision with its request ID, model, trust mode and latency, each payment, each action. It's saved locally first, then 0G Storage, then indexed on Arkiv, and verified with the Storage proof when you open it.\"","Bundle contents and the root."),
("2:05–2:30","6 · Safe stop","\"No answer, a late one or an invalid one: the robot holds and retries once. Still nothing: SAFE_STOP, recorded, nothing invented, and that's a test. A motor fault stops it locally with no network at all.\"","SAFE_STOP card."),
("2:30–2:50","7 · Deliverables","\"Both tracks' requirements are here: 0G in the loop, a request ID per decision on Storage, the Gazebo worlds you can rerun, safe stop, and 0G PC in the main flow with request IDs shown to the user.\"","The checklist."),
("2:50–3:00","8 · Close","\"Remove 0G and the robot can't decide at a single checkpoint. It safe-stops, no job gets done, no agent gets paid. That's Semmal.\"","Team and links."),
])+"""</table>
<h2>Deliverables to point at</h2><table><tr><th>Requirement</th><th>Where</th></tr>
<tr><td>Physical AI: 0G call inside the decision loop</td><td><code>services/robot-master/src/mission.ts</code> (stop loop); "How it decided"</td></tr>
<tr><td>Episode log on 0G Storage with a request ID per decision</td><td><code>evidence.ts</code>; bundle <code>decisions[].providerRequestId</code>; root on Arkiv</td></tr>
<tr><td>Replayable simulation</td><td>Gazebo house / warehouse / forest from <code>scripts/robot/scenario.sh</code>; shown in the video</td></tr>
<tr><td>Safe stop, no faked decision</td><td>test "0G fails twice: hold, SAFE_STOP, nothing invented"</td></tr>
<tr><td>0G PC in the main flow, with request IDs</td><td>every booked job; "How it decided" shows each request ID</td></tr>
<tr><td>What breaks if 0G is removed (one sentence)</td><td>"The robot can't decide at any checkpoint, so it safe-stops: no job done, no agent paid."</td></tr>
<tr><td>Name, description, repo + setup, video, live link, addresses, team</td><td>README "ETHGlobal Mumbai submission"; no contracts deployed (addresses listed)</td></tr></table>
<h2>Likely questions</h2><ul>
<li><b>Is the private answer verified?</b> Private mode routes only to TEE providers; the Router returns no per-answer signature, and we say so on screen. A non-TEE model is never used for a private job.</li>
<li><b>Why 24 seconds?</b> It's a checkpoint decision, not motor control; the robot holds while waiting.</li>
<li><b>Separate 0G accounts per agent?</b> Each agent has its own Router key with a daily cap; all keys draw on one deposit: a per-agent cap and usage record, not a separate wallet.</li></ul>""")

# ---------------- 4-minute video plan
video = doc("Semmal · 4-minute video plan", """
<h1>4-minute video: plan, shot list and voiceover</h1>
<p class="sub">Goal: say the most important points in the first 40 seconds, then prove each one on screen. ~560 words of voiceover at about 140 words per minute.</p>
<div class="box"><b>The important points, up front (0:00–0:40):</b>
<ul><li><b>Robots are their own agents</b>: they price the job, hire AI agents and pay them in 0G.</li>
<li><b>0G is the brain at every checkpoint</b>: private TEE inference on 0G Private Computer, request ID per decision.</li>
<li><b>The robot signs its own record</b>: episode bundle on 0G Storage, indexed on Arkiv, owned by the robot's wallet.</li>
<li><b>Safe by design</b>: no answer from 0G means a safe stop, never a guess; motor faults stop it with no network.</li>
<li><b>Scores choose who gets work</b>: robots and agents ranked by scores anyone can recompute from Arkiv.</li></ul></div>

<h2>What you need before recording</h2>
<table><tr><th>Item</th><th>Detail</th></tr>
<tr><td>Robot PC (Ubuntu)</td><td><code>scripts/robot/scenario.sh house</code> running (Gazebo window visible), <code>pnpm start house</code> linked to the platform; toys and spill reset (they reset at each job start)</td></tr>
<tr><td>Platform (Mac)</td><td><code>pnpm dev:api</code> + web on <b>http://localhost:3000</b> (avoids MetaMask's vercel.app warning); or a custom domain</td></tr>
<tr><td>Wallets</td><td>Two browser profiles: <b>customer</b> and <b>robot owner</b>, both signed in. Customer: Rabdi tGLM (booking write) + Galileo 0G (to pay). Robot wallet: 0G to pay agents, tGLM for Arkiv writes</td></tr>
<tr><td>Agent</td><td>A vision agent published in <b>private</b> mode on <code>0gm-1.0-35b-a3b</code>; 0G Router deposit funded</td></tr>
<tr><td>Fault demo</td><td><code>scripts/robot/inject_fault.sh</code> ready in a terminal (left motor overcurrent)</td></tr>
<tr><td>Recording</td><td>1920×1080, browser zoom 110%, bookmarks hidden, notifications off, mic test. Record each segment separately; cut long waits (a 0G call takes about 20–25 s; travel uses the fast-forward button)</td></tr>
<tr><td>Captions / annotations</td><td>Add the on-screen labels in the "Caption" column below in your editor (big, 2–3 s each). Blur nothing: there are no secrets on screen</td></tr></table>

<h2 class="pb">Shot list and voiceover</h2>
<table><tr><th>Time</th><th>On screen</th><th>Caption (annotation)</th><th>Voiceover</th></tr>"""+rows([
("0:00–0:12","Home page hero: செம்மல் logo, network animation","Semmal: robots that hire AI agents","\"This is Semmal: a marketplace where every robot is its own AI agent. It prices the job, hires the AI agents it needs, pays them in 0G and answers for the result.\""),
("0:12–0:40","Fast montage (2–3 s each): How it decided (request ID) → Gazebo robot → What went to Arkiv (task_score 100) → SAFE_STOP state → Scores table","0G decides · 0G Storage remembers · Arkiv proves · safe stop · scores","\"At every checkpoint the robot asks a private model on 0G Private Computer, and every decision has a request ID. Its record goes to 0G Storage and Arkiv, signed by the robot's own key. If 0G can't answer, it stops safely and never guesses. And every robot and agent is scored on that record, which decides who gets the next job.\""),
("0:40–1:05","/quote: pick a site on the map, robots ranked; open the robot's score; Book (wallet approval card → wallet)","Ranked by score · booking signed by your wallet, on Arkiv","\"A customer picks a spot on the map. Robots that cover it are ranked by their score. Booking writes an entity on Arkiv, signed by the customer's own wallet. There is no platform key anywhere.\""),
("1:05–1:25","Robot's offer appears; owner profile: requests → Approve","The robot prices it itself","\"The robot works out its own price from live agent prices on Arkiv and 0G model costs, signs the quote and publishes it. Its owner approves the job.\""),
("1:25–1:45","Map: robot travelling (fast-forward) → 'Arrived: confirm' → Pay 0G","Paid in native 0G on 0G Galileo","\"The robot travels to the site. The customer confirms it has arrived and pays the quote in native 0G. The robot checks the payment on chain before it starts.\""),
("1:45–2:25","Gazebo: robot drives to the living room; cut to How it decided: hired agent, payment tx, model, private mode, request ID, answer 'toys on floor', checks ✓; back to Gazebo: toys move to the bin","Hires and pays the agent · private TEE inference · request ID · it clears the space itself","\"At each room it takes one camera frame and hires a vision agent, paying the agent's owner in 0G. The agent runs a private model on 0G Private Computer. Here's the request ID, the model, private mode and the answer: toys on the floor, 95 percent. The robot checks the format, the action and the confidence, then does the job itself: it picks the toys up and puts them in the bin.\""),
("2:25–2:40","Booking page: Extra stops → choose bedroom → 'added'","Ask for more during the job: the robot decides","\"While it works, the customer can ask for another room. The robot decides: only if the place fits the job and what was paid still covers the extra check.\""),
("2:40–3:05","Terminal: inject_fault.sh → Gazebo robot stops instantly; dashboard: E_STOP, incident signed and queued","Safety on the robot: no network, no AI needed","\"Safety never waits for the cloud. Here a motor overcurrent is detected and the robot stops immediately, with no network and no AI. The incident is signed and queued, then written to 0G Storage and Arkiv. And if 0G stops answering, the robot holds, retries once, then stops safely. Nothing is made up.\""),
("3:05–3:35","Orders → What went to Arkiv: entity link, indexed columns, task_score 100, score table, agent scores, robot score maths; explorer page","Read back from Arkiv · score: 100 · anyone can recompute","\"When the job ends, the robot scores itself: stops done, valid 0G decisions, findings handled, on time. That score and the agents' scores are in its signed bundle on 0G Storage and its entity on Arkiv. This screen reads it straight back from Arkiv, and anyone can recompute it with one query.\""),
("3:35–3:50","Scores table: score + selection for robots and agents","Scores pick who gets hired","\"Those scores rank robots for customers and agents for robots. Bad ones drop out, and a safe stop never counts against a robot.\""),
("3:50–4:00","Logo end card: செம்மல் · Semmal · github.com/jonathanvineet/semmal · Telegram/X jonathan_vineet","Semmal: built at ETHGlobal Mumbai","\"Semmal: Tamil for a person of eminence. Robots that earn that name job by job. Built on 0G and Arkiv.\""),
])+"""</table>

<h2 class="pb">Full voiceover transcript</h2>
<p><b>[0:00]</b> This is Semmal: a marketplace where every robot is its own AI agent. It prices the job, hires the AI agents it needs, pays them in 0G and answers for the result.</p>
<p><b>[0:12]</b> At every checkpoint the robot asks a private model on 0G Private Computer, and every decision has a request ID. Its record goes to 0G Storage and Arkiv, signed by the robot's own key. If 0G can't answer, it stops safely and never guesses. And every robot and agent is scored on that record, which decides who gets the next job.</p>
<p><b>[0:40]</b> A customer picks a spot on the map. Robots that cover it are ranked by their score. Booking writes an entity on Arkiv, signed by the customer's own wallet. There is no platform key anywhere.</p>
<p><b>[1:05]</b> The robot works out its own price from live agent prices on Arkiv and 0G model costs, signs the quote and publishes it. Its owner approves the job.</p>
<p><b>[1:25]</b> The robot travels to the site. The customer confirms it has arrived and pays the quote in native 0G. The robot checks the payment on chain before it starts.</p>
<p><b>[1:45]</b> At each room it takes one camera frame and hires a vision agent, paying the agent's owner in 0G. The agent runs a private model on 0G Private Computer. Here's the request ID, the model, private mode and the answer: toys on the floor, 95 percent. The robot checks the format, the action and the confidence, then does the job itself: it picks the toys up and puts them in the bin.</p>
<p><b>[2:25]</b> While it works, the customer can ask for another room. The robot decides: only if the place fits the job and what was paid still covers the extra check.</p>
<p><b>[2:40]</b> Safety never waits for the cloud. Here a motor overcurrent is detected and the robot stops immediately, with no network and no AI. The incident is signed and queued, then written to 0G Storage and Arkiv. And if 0G stops answering, the robot holds, retries once, then stops safely. Nothing is made up.</p>
<p><b>[3:05]</b> When the job ends, the robot scores itself: stops done, valid 0G decisions, findings handled, on time. That score and the agents' scores are in its signed bundle on 0G Storage and its entity on Arkiv. This screen reads it straight back from Arkiv, and anyone can recompute it with one query.</p>
<p><b>[3:35]</b> Those scores rank robots for customers and agents for robots. Bad ones drop out, and a safe stop never counts against a robot.</p>
<p><b>[3:50]</b> Semmal: Tamil for a person of eminence. Robots that earn that name job by job. Built on 0G and Arkiv.</p>

<h2>Deliverables this video must show (highlight them)</h2>
<table><tr><th>Track</th><th>Must show</th><th>At</th></tr>
<tr><td>0G Physical AI</td><td><span class="hl">0G call inside the decision loop</span></td><td>1:45–2:25</td></tr>
<tr><td>0G Physical AI</td><td><span class="hl">Episode log on 0G Storage with a request ID per decision</span></td><td>3:05–3:35</td></tr>
<tr><td>0G Physical AI</td><td><span class="hl">Replayable simulation</span> (the Gazebo world, rerun from scratch)</td><td>1:45, 2:40</td></tr>
<tr><td>0G Physical AI</td><td><span class="hl">Safe stop if 0G is unreachable, no faked decision</span></td><td>2:40–3:05</td></tr>
<tr><td>0G Private Computer</td><td><span class="hl">Inference in the main user flow, with request IDs</span>; a reason to come back (recurring jobs, scored robots)</td><td>1:45–2:25, 3:35</td></tr>
<tr><td>Arkiv</td><td><span class="hl">A feature users see reading Arkiv data</span> (ranked robots, orders, What went to Arkiv)</td><td>0:40, 3:05</td></tr>
<tr><td>All</td><td>Under the time limit: 0G asks for <b>under 3 min</b>. Cut this 4-minute version to 2:55 by dropping 2:25–2:40 (extras) and 3:35–3:50 (scores table) and shortening the montage</td><td></td></tr></table>
<p class="sub">Also needed with the submission: project name and description, public repo with setup, live demo link, contract addresses (none deployed; Arkiv contract and wallets listed in the README), team: Semmal, Telegram/X jonathan_vineet.</p>""")

for name, content in [("arkiv-deck.html", deck("Semmal · Arkiv", arkiv_slides, "Build on Arkiv · ETHGlobal Mumbai 2026")),
                      ("zerog-deck.html", deck("Semmal · 0G", zerog_slides, "0G Physical AI + Private Computer · ETHGlobal Mumbai 2026")),
                      ("arkiv-script.html", arkiv_script), ("zerog-script.html", zerog_script), ("video-plan.html", video)]:
    open(os.path.join(OUT, name), "w").write(content)
print("written")
