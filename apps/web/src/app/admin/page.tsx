import { AdminDashboard } from "@/components/AdminDashboard";

export const metadata = { title: "Your dashboard · Semmal" };

export default function AdminPage() {
  return (
    <section className="section market" style={{ ["--h" as string]: 1 }} aria-labelledby="admin-h">
      <div className="wrap">
        <div className="market-head">
          <h1 id="admin-h">Your dashboard</h1>
          <p className="t-lead muted measure">Your wallet is your login. See the robots you own on Arkiv, register new ones and test the 0G connection.</p>
        </div>
        <AdminDashboard />
      </div>
    </section>
  );
}
