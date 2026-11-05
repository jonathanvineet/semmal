import { QuoteTask } from "@/components/QuoteTask";

export const metadata = { title: "Get a quote · Semmal" };

export default function QuotePage() {
  return (
    <section className="section market" aria-labelledby="q-h">
      <div className="wrap">
        <div className="market-head">
          <h1 id="q-h">Get a quote from a robot</h1>
          <p className="t-lead muted measure">Pick a robot and describe the job. It prices the work from what the job really costs, inside its owner&apos;s limits.</p>
        </div>
        <QuoteTask />
      </div>
    </section>
  );
}
