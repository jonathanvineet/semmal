export const metadata = { title: "Credits · Semmal" };

const MODELS = [
  { type: "Inspection drone", source: "Skydio X2", folder: "skydio_x2", license: "Apache-2.0" },
  { type: "Quadruped", source: "Unitree Go2", folder: "unitree_go2", license: "BSD-3-Clause" },
  { type: "Robot arm", source: "Universal Robots UR5e", folder: "universal_robots_ur5e", license: "BSD-3-Clause" },
  { type: "Dexterous hand", source: "Shadow Dexterous Hand", folder: "shadow_hand", license: "Apache-2.0" },
  { type: "Humanoid", source: "Unitree G1", folder: "unitree_g1", license: "BSD-3-Clause" },
  { type: "Mobile manipulator", source: "Google Robot", folder: "google_robot", license: "Apache-2.0" },
  { type: "Compact rover", source: "PAL Robotics TIAGo (mobile base only)", folder: "pal_tiago", license: "Apache-2.0" },
];

export default function Credits() {
  return (
    <section className="section market" aria-labelledby="cr-h">
      <div className="wrap">
        <div className="market-head">
          <h1 id="cr-h">Credits</h1>
          <p className="t-lead muted measure">
            The 3D robots are adapted from MuJoCo Menagerie by Google DeepMind: posed, merged, simplified and restyled for the web.
            Each model keeps its original licence. Robot names are trademarks of their owners; Semmal is not affiliated with them.
          </p>
        </div>
        <ul className="role-list credits-list">
          {MODELS.map((m) => (
            <li key={m.folder}>
              <span><b>{m.type}</b> <span className="muted">· based on {m.source}</span></span>
              <span>
                <a className="link" href={`https://github.com/google-deepmind/mujoco_menagerie/tree/main/${m.folder}`} target="_blank" rel="noreferrer">Source</a>
                {" · "}
                <a className="link" href={`/models/LICENSES/${m.folder}.txt`} target="_blank" rel="noreferrer">{m.license}</a>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
