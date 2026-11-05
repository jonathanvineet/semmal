import { Publisher } from "@/components/Publisher";

export const metadata = { title: "Publish to Arkiv · Semmal" };

export default function PublishPage() {
  return (
    <section className="section market" style={{ ["--h" as string]: 1 }} aria-labelledby="pub-h">
      <div className="wrap">
        <div className="market-head">
          <h1 id="pub-h">Publish robots and agents to Arkiv</h1>
          <p className="t-lead muted measure">Your own wallet signs each registry entry. No private key is stored or entered anywhere in Semmal.</p>
        </div>
        <Publisher />
      </div>
    </section>
  );
}
