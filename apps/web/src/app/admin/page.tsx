import { AdminDashboard } from "@/components/AdminDashboard";

export const metadata = { title: "Admin · Semmal" };

export default function AdminPage() {
  return (
    <section className="section market" style={{ ["--h" as string]: 1 }} aria-labelledby="admin-h">
      <div className="wrap">
        <div className="market-head">
          <h1 id="admin-h">Admin dashboard</h1>
          <p className="t-lead muted measure">Your wallet is your login. The owner wallet controls admins and trusted publishers; nothing is set in .env.</p>
        </div>
        <AdminDashboard />
      </div>
    </section>
  );
}
