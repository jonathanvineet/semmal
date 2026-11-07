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
 ("hook", """<div class="kicker">The problem</div>
<h1>Robots are about to work for hire. <span class="accent">Their track record will belong to whoever runs the platform.</span></h1>
<p class="lead">A failed job can be deleted, a score edited, an incident hidden. Customers, robot owners and the people who sell AI agents to robots have no shared record none of them controls, and stale bookings and offers pile up in someone's database.</p>"""),
 ("", """<div class="kicker">What we built</div><h2>Semmal: robots that sign their own record on Arkiv</h2>
<div class="grid g3"><div class="card"><span class="big accent">1</span><b>The robot owns its record</b><p>Quotes, the agents it hires, every job and every incident are Arkiv entities owned by the robot's own wallet.</p></div><div class="card"><span class="big accent">2</span><b>Scores pick who gets work</b><p>Each job's score is an indexed column; it ranks robots for customers and agents for robots, and anyone can recompute it.</p></div><div class="card"><span class="big accent">3</span><b>Expiry is the coordination</b><p>Bookings, quotes and job claims expire at their own deadline: no stale offers, no clean-up.</p></div></div>"""),
 ("", """<div class="kicker">Deliverable 1 · the robot owns its record</div><h2>Nobody, not even its owner, can edit or withhold it</h2>
<div class="flow"><div class="step"><b>Key made on the robot</b><span>never leaves the robot PC; may write only its 4 evidence schemas, under a daily fee cap</span></div><div class="arrow">→</div><div class="step hot"><b>Arkiv entity</b><span>$owner = $creator = robot wallet, and the body names the same wallet</span></div><div class="arrow">→</div><div class="step"><b>Readers enforce it</b><span>a record counts only if that wallet is on the robot's registered profile</span></div></div>
<p class="lead">Live: <b>7</b> episodes and <b>21</b> incidents signed by robot wallet <span class="code">0x103E…29BC</span>. There is no platform key anywhere.</p>"""),
 ("", """<div class="kicker">Deliverable 2 · scores from Arkiv choose who gets work</div><h2>One query, and anyone gets the same answer</h2>
<div class="grid g2"><pre><span class="muted">$ pnpm arkiv:query</span>
task-6f5992c2  COMPLETED  <span class="accent">task_score 100</span>
owner 0x103E…29BC (robot wallet)
  Stops completed      40/40  4 of 4 stops
  Valid 0G decisions   20/20  4 of 4 passed
  Findings dealt with  20/20  1 of 1
  On time              10/10  before deadline
  agent agt-house-2b5c20 · 4 jobs · 100 each</pre>
<div class="card"><b>Indexed <span class="code">task_score</span></b><p>The robot scores each job itself, and every agent it paid. Robot and agent reputations are the mean of those signed scores.</p><p>They rank robots when a customer books, and agents when a robot hires. A safe stop never counts against a robot.</p></div></div>"""),
 ("", """<div class="kicker">Deliverable 3 · expiry does the coordination</div><h2>Stale offers clean themselves up</h2>
<div class="grid g3"><div class="card"><span class="big accent">deadline</span><b>Bookings, quotes, job claims</b><p>expire exactly when they stop mattering.</p></div><div class="card"><span class="big">90 d</span><b>Robot and agent registrations</b><p>unmaintained or badly scored ones simply lapse.</p></div><div class="card"><span class="big">120 d</span><b>Evidence and scores</b><p>recent work is scored; full bundles stay on 0G Storage.</p></div></div>
<p class="lead">Every booking shows <b>"What went to Arkiv"</b>: the entity read back, its columns, body, owner, expiry and the score maths.</p>"""),
 ("hook", """<div class="kicker">Why Arkiv</div><h1>Swap Arkiv for Postgres and users lose <span class="accent">a robot record they don't have to trust us for.</span></h1>
<div class="facts"><span>arkiv/*.md · schema, friction, reach</span><span>pnpm arkiv:query</span><span>Team Semmal · jonathan_vineet</span><span>semmal.vercel.app</span></div>"""),
]

# ---------------- 0G deck
zerog_slides = [
 ("hook", """<div class="kicker">The problem</div>
<h1>Robots now act on what an AI tells them. <span class="accent">Nobody can see what it was shown, who paid, or whether the decision was real.</span></h1>
<p class="lead">Camera images go to a model you can't inspect. When the cloud AI is slow or down, a robot either guesses or freezes. And the record of what it decided lives in the operator's logs.</p>"""),
 ("", """<div class="kicker">What we built</div><h2>Semmal: a robot that can't pass a checkpoint without 0G</h2>
<div class="flow"><div class="step"><b>Drive</b><span>ROS 2 on the robot</span></div><div class="arrow">→</div><div class="step"><b>Hire + pay</b><span>an AI agent, in native 0G</span></div><div class="arrow">→</div><div class="step hot"><b>Decide on 0G</b><span>private TEE model, request ID</span></div><div class="arrow">→</div><div class="step"><b>Check + act</b><span>bounded actions only</span></div><div class="arrow">→</div><div class="step"><b>Record</b><span>signed episode on 0G Storage</span></div></div>
<p class="lead">0G is the brain at each checkpoint, the money and the memory. Motion and safety stay on the robot.</p>"""),
 ("", """<div class="kicker">Deliverable 1 · private 0G decision in the loop, with its request ID</div><h2>The customer sees every call, in full</h2>
<div class="grid g2"><pre>0gm-1.0-35b-a3b · <b>private</b> (TEE providers only)
0G request ID  985498df-94a2-4e3d-9f1d-21ffe9f8a472
Time           24,464 ms
Billed to      the agent's own Router key · 0.5 USD/day cap
Answer         "toys on floor" · confidence 0.95
               → clear_and_continue
Checked        ✓ exact format  ✓ allowed action  ✓ ≥ 0.6
Did            picked the toys up, put them in the bin</pre>
<div class="card"><b>No silent downgrade</b><p>A model without TEE is never used for a private job.</p><b>Advisory only</b><p>The model picks one of five actions; it never touches motors, money or keys.</p></div></div>"""),
 ("", """<div class="kicker">Deliverable 2 · the robot pays its own agents in 0G</div><h2>A robot with its own wallet and budget</h2>
<div class="flow"><div class="step"><b>Customer → robot</b><span>pays the robot's signed quote, after it arrives</span></div><div class="arrow">→</div><div class="step hot"><b>Robot → agent owner</b><span>one transfer per job, checked on chain before 0G is called, never twice</span></div><div class="arrow">→</div><div class="step"><b>Agent → 0G PC</b><span>its own capped key</span></div><div class="arrow">→</div><div class="step"><b>Unspent → back</b><span>margin to the owner, or a refund</span></div></div>"""),
 ("", """<div class="kicker">Deliverable 3 · signed episode on 0G Storage · safe stop</div><h2>Every decision is on record. A missing one is never faked.</h2>
<div class="grid g2"><pre>episode bundle → 0G Storage (root 0x45645ef9…7aefef)
  decisions[]  providerRequestId · model · trust · latency
  purchases[]  0G payment tx · agent job score
  manifest_hash · robot_signature   (robot's own key)</pre>
<div class="card"><b>No answer, late or invalid</b><p>The robot holds, retries once, then <b class="accent">SAFE_STOP</b>. Nothing is invented; this is tested.</p><b>Motor fault</b><p>It stops locally with no network and no AI; the incident is signed and queued.</p></div></div>"""),
 ("hook", """<div class="kicker">What breaks if 0G is removed</div><h1>The robot can't decide at a single checkpoint, so it <span class="accent">safe-stops</span>: no job done, no agent paid.</h1>
<div class="facts"><span>Physical AI · Private Computer</span><span>Team Semmal · jonathan_vineet</span><span>semmal.vercel.app</span></div>"""),
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
<div class="box"><b>The first 30 seconds: the problem (say it word for word):</b><br>
"Robots are about to work for hire: cleaning homes, inspecting warehouses. But a robot's track record will belong to whoever runs the platform. A failed job can be deleted, a score edited, an incident hidden. Customers, robot owners and the people who sell AI agents to robots have no shared record that none of them controls. That's what we fixed with Arkiv."</div>
<h2>Minute by minute</h2>
<table><tr><th>Time</th><th>Slide</th><th>Say</th><th>Show / point at</th></tr>"""+rows([
("0:00–0:30","1 · Problem","The problem paragraph above.","Let the headline sit; no bullet points."),
("0:30–0:50","2 · What we built","\"Semmal is a robot-for-hire marketplace where the robot signs its own record on Arkiv. Three things matter: the robot owns its record, scores from that record choose who gets work, and expiry does our coordination.\"","The three numbered cards."),
("0:50–1:30","3 · Robot owns its record","\"The robot has its own key, made on the robot PC. It writes its quotes, the agents it hires, every job and incident as Arkiv entities it owns. Readers only count a record if owner, creator and the wallet inside match the robot's registered wallet. So not even its owner can edit or withhold it. Live: seven episodes and twenty-one incidents signed by this robot.\"","The three-step flow; the live numbers."),
("1:30–2:10","4 · Scores choose who gets work","\"After each job the robot scores itself and every agent it paid, and writes the job score as an indexed column. Those signed scores rank robots for customers and agents for robots. Anyone can recompute them with one query. Here, task score 100, part by part.\"","The query output."),
("2:10–2:40","5 · Expiry","\"Bookings, quotes and job claims expire at their own deadline, so stale offers clean themselves up. Unmaintained registrations lapse. And every booking shows what went to Arkiv, read back from Arkiv.\"","The three numbers; mention 'What went to Arkiv'."),
("2:40–3:00","6 · Close","\"Swap Arkiv for Postgres and users lose a robot record they don't have to trust us for. The schema, friction and reach files are in the repo. That's Semmal.\"","Links."),
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
<div class="box"><b>The first 30 seconds: the problem (say it word for word):</b><br>
"Robots now act on what an AI tells them. But nobody can see what the AI was shown, whether the camera images stayed private, who paid for the decision, or whether it was real at all. When the cloud AI is slow or down, a robot either guesses or freezes. And the record of what it decided lives in the operator's logs. That's what we fixed with 0G."</div>
<h2>Minute by minute</h2>
<table><tr><th>Time</th><th>Slide</th><th>Say</th><th>Show / point at</th></tr>"""+rows([
("0:00–0:30","1 · Problem","The problem paragraph above.","Let the headline sit."),
("0:30–0:50","2 · What we built","\"Semmal's robot can't pass a checkpoint without 0G. It drives on its own, hires and pays an AI agent in 0G, decides with a private model on 0G Private Computer, and records it on 0G Storage. Motion and safety stay on the robot.\"","The five-step flow."),
("0:50–1:35","3 · Private decision, request ID","\"This is a real call the customer sees: 0gm in private mode, TEE providers only, the request ID, 24 seconds, billed to the agent's own capped key. Toys on the floor at 0.95. The robot checks the format, the action and the confidence, then clears them itself. The model can only pick from five actions; it never touches motors or money.\"","Request ID, checks, 'Did'."),
("1:35–2:05","4 · Robot pays its agents","\"The robot has its own wallet. The customer pays its signed quote; the robot pays each agent's owner once per job in native 0G, and the payment is checked on chain before 0G is called. Whatever it doesn't spend goes back.\"","The four arrows."),
("2:05–2:45","5 · 0G Storage + safe stop","\"Every job ends as a bundle signed by the robot on 0G Storage, with a request ID per decision. And if 0G doesn't answer, the robot holds, retries once, then stops safely. It never invents a decision, and that's tested. A motor fault stops it locally with no network at all.\"","Bundle; SAFE_STOP card."),
("2:45–3:00","6 · Close","\"Remove 0G and the robot can't decide at a single checkpoint: it safe-stops, no job done, no agent paid. That's Semmal.\"","Links."),
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
<p class="sub">Goal: open on the problem (first 30 seconds), then show only the deliverables that matter, each proven on screen. ~560 words of voiceover at about 140 words per minute.</p>
<div class="box"><b>0:00–0:28 is the problem. 0:28–0:40 names what we built. Then each of these is proven on screen:</b>
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
("0:00–0:28","Black screen, then the home page hero fades in under the voice","Robots work for hire. Who checks them?","\"Robots are starting to work for hire: cleaning homes, inspecting warehouses. They act on what an AI tells them. But nobody can see what that AI was shown, whether it stayed private, who paid for it, or whether the decision was real. When the AI is down, the robot guesses. And its track record belongs to whoever runs the platform.\""),
("0:28–0:40","Fast montage (2 s each): How it decided (request ID) → What went to Arkiv (task_score 100) → SAFE_STOP","Private 0G decisions · signed record · safe stop","\"Semmal fixes that. The robot decides with a private model on 0G, signs its own record on 0G Storage and Arkiv, and stops safely instead of guessing.\""),
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
<p><b>[0:00]</b> Robots are starting to work for hire: cleaning homes, inspecting warehouses. They act on what an AI tells them. But nobody can see what that AI was shown, whether it stayed private, who paid for it, or whether the decision was real. When the AI is down, the robot guesses. And its track record belongs to whoever runs the platform.</p>
<p><b>[0:28]</b> Semmal fixes that. The robot decides with a private model on 0G, signs its own record on 0G Storage and Arkiv, and stops safely instead of guessing.</p>
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
