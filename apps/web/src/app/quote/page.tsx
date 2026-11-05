import { QuoteTask } from "@/components/QuoteTask";

export const metadata = { title: "Get a quote · Semmal" };

export default function QuotePage() {
  return (
    <section className="section workbench" aria-labelledby="q-h">
      <div className="wrap">
        <header className="wb-head">
          <h1 id="q-h">Get a quote</h1>
          <p className="muted">Pick a robot and the job. It prices the work from real costs, inside its owner&apos;s limits.</p>
        </header>
        <QuoteTask />
      </div>
    </section>
  );
}
