"use client";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="footer closing footer--dark">
      <div className="wrap">
        <div className="close-word">
          <div className="close-word__head">
            <div>
              <h2>Put a robot to work</h2>
              <p className="t-lead muted measure">It plans the job, hires the agents it needs and answers for the result.</p>
            </div>
            <Link className="btn btn--primary btn--xl" href="/agents">Browse agents</Link>
          </div>
          <p className="close-word__name" aria-hidden="true">Semmal</p>
        </div>
        <div className="footer-row">
          <div className="footer-cols">
            <div>
              <p className="t-label muted">Product</p>
              <Link href="/#chapters">Network</Link>
              <Link href="/#console">Console</Link>
              <Link href="/agents">Agents</Link>
              <Link href="/quote">Get a quote</Link>
            </div>
            <div>
              <p className="t-label muted">Operators</p>
              <Link href="/robots/new">Register a robot</Link>
              <Link href="/admin">Your dashboard</Link>
            </div>
            <div>
              <p className="t-label muted">Built on</p>
              <a href="https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview" target="_blank" rel="noreferrer">0G Compute Router</a>
              <a href="https://arkiv.network/" target="_blank" rel="noreferrer">Arkiv</a>
              <a href="https://gazebosim.org/" target="_blank" rel="noreferrer">Gazebo</a>
            </div>
          </div>
          <p className="legal t-small muted">© {new Date().getFullYear()} Semmal · Payments are not live yet · 3D robots adapted from MuJoCo Menagerie, <a className="link" href="/credits">credits</a> · Product names are trademarks of their owners</p>
        </div>
      </div>
    </footer>
  );
}
