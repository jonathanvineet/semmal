/**
 * Three guarantees, each with a small pulsing diagram card (taste-skill diagrams: a hub with
 * branches; one input, a processor, three lanes). Diagrams are drawn for this page.
 */
function HubDiagram() {
  // registry: one hub, five branches
  const pts = [
    [40, 30], [40, 110], [150, 18], [150, 122], [196, 70],
  ];
  return (
    <svg viewBox="0 0 220 140" className="dg" aria-hidden="true">
      {pts.map(([x, y], i) => (
        <g key={i}>
          <line x1="104" y1="70" x2={x} y2={y} className="dg__ln" />
          <circle r="2.6" className="dg__pulse" style={{ offsetPath: `path('M104 70 L${x} ${y}')`, animationDelay: `${i * 0.55}s` }} />
          <circle cx={x} cy={y} r="5" className="dg__node" />
        </g>
      ))}
      <rect x="84" y="56" width="40" height="28" rx="7" className="dg__hub" />
      <text x="104" y="74" className="dg__t">Arkiv</text>
    </svg>
  );
}

function LaneDiagram() {
  // one input -> enclave -> result, no path out
  return (
    <svg viewBox="0 0 220 140" className="dg" aria-hidden="true">
      <line x1="18" y1="70" x2="82" y2="70" className="dg__ln" />
      <line x1="138" y1="70" x2="202" y2="70" className="dg__ln" />
      <circle r="2.6" className="dg__pulse" style={{ offsetPath: "path('M18 70 L82 70')" }} />
      <circle r="2.6" className="dg__pulse dg__pulse--ice" style={{ offsetPath: "path('M138 70 L202 70')", animationDelay: "1.2s" }} />
      <rect x="82" y="40" width="56" height="60" rx="12" className="dg__enclave" />
      <rect x="92" y="50" width="36" height="40" rx="8" className="dg__core" />
      <text x="110" y="74" className="dg__t">TEE</text>
      <text x="18" y="56" className="dg__s">keyframe</text>
      <text x="202" y="56" className="dg__s" textAnchor="end">JSON</text>
    </svg>
  );
}

function StopDiagram() {
  // the robot's own loop: sensor -> safety -> wheels, cloud dashed and cut
  return (
    <svg viewBox="0 0 220 140" className="dg" aria-hidden="true">
      <line x1="30" y1="96" x2="110" y2="96" className="dg__ln" />
      <line x1="110" y1="96" x2="190" y2="96" className="dg__ln" />
      <circle r="2.6" className="dg__pulse" style={{ offsetPath: "path('M30 96 L190 96')" }} />
      <circle cx="30" cy="96" r="5" className="dg__node" />
      <rect x="92" y="82" width="36" height="28" rx="7" className="dg__hub dg__hub--stop" />
      <circle cx="190" cy="96" r="5" className="dg__node" />
      <line x1="110" y1="82" x2="110" y2="38" className="dg__ln dg__ln--cut" />
      <rect x="84" y="18" width="52" height="22" rx="11" className="dg__cloud" />
      <text x="110" y="33" className="dg__s" textAnchor="middle">network</text>
      <text x="110" y="100" className="dg__t">stop</text>
      <text x="30" y="122" className="dg__s" textAnchor="middle">motor</text>
      <text x="190" y="122" className="dg__s" textAnchor="middle">wheels</text>
    </svg>
  );
}

const CARDS = [
  { title: "Publishes every agent in public", body: "Robots and agents are Arkiv entities; the marketplace shows only those its owner trusts.", d: <HubDiagram /> },
  { title: "Keeps prompts inside the enclave", body: "Private mode runs on TeeML providers only. No private provider means no answer, not a weaker one.", d: <LaneDiagram /> },
  { title: "Stops without asking the cloud", body: "Overcurrent, heat or a stale encoder latch an emergency stop on the robot itself.", d: <StopDiagram /> },
];

export function Trust() {
  return (
    <section id="trust" className="section ground-inverse-dark" aria-labelledby="trust-h">
      <div className="wrap">
        <div className="section-head">
          <h2 id="trust-h">Private and safe by default <span className="muted">not as an add-on</span></h2>
        </div>
        <div className="trust-grid">
          {CARDS.map((c) => (
            <article key={c.title} className="trust-card">
              <div className="trust-card__panel">{c.d}</div>
              <h3 className="t-card">{c.title}</h3>
              <p>{c.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
