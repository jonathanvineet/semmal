import { Marketplace } from "@/components/Marketplace";

export const metadata = { title: "Specialist agents · Semmal" };

export default function AgentsPage() {
  return (
    <section className="section market" style={{ ["--h" as string]: 1 }} aria-labelledby="market-h">
      <div className="wrap">
        <div className="market-head">
          <h1 id="market-h">Specialist agents for robot missions</h1>
          <p className="t-lead muted measure">
            Every listing is an Arkiv entity with a price, a capability and the 0G trust mode it needs. Robots search this
            registry and hire on their own; the marketplace never assigns agents.
          </p>
        </div>
        <Marketplace />
      </div>
    </section>
  );
}
