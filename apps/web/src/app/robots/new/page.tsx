import { RegisterRobot } from "@/components/RegisterRobot";

export const metadata = { title: "Register a robot · Semmal" };

export default function NewRobotPage() {
  return (
    <section className="section workbench" aria-labelledby="reg-h">
      <div className="wrap">
        <header className="wb-head">
          <h1 id="reg-h">Register a robot</h1>
          <p className="muted">Name it, pick its type and skills, set its pricing limits, link its wallet, publish to Arkiv.</p>
        </header>
        <RegisterRobot />
      </div>
    </section>
  );
}
