import { RegisterRobot } from "@/components/RegisterRobot";

export const metadata = { title: "Register a robot · Semmal" };

export default function NewRobotPage() {
  return (
    <section className="section market" aria-labelledby="reg-h">
      <div className="wrap">
        <div className="market-head">
          <h1 id="reg-h">Register a robot</h1>
          <p className="t-lead muted measure">Give it a name, pick its model and skills, link its wallet, and publish it to Arkiv with your own wallet.</p>
        </div>
        <RegisterRobot />
      </div>
    </section>
  );
}
