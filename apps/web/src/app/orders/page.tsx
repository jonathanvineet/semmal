import { Orders } from "@/components/Orders";

export const metadata = { title: "Your orders · Semmal" };

export default function OrdersPage() {
  return (
    <section className="section" aria-labelledby="o-h">
      <div className="wrap">
        <header className="wb-head">
          <h1 id="o-h">Your orders</h1>
          <p className="muted">Every robot you booked with this wallet, newest first, with where each one is now.</p>
        </header>
        <Orders />
      </div>
    </section>
  );
}
