/**
 * The page's statement: one claim set large, sized to the screen with CSS alone (no measuring
 * script), so it never clips at any width.
 */
export function Statement() {
  return (
    <section className="statement" style={{ ["--h" as string]: 1 }} aria-labelledby="statement-h">
      <div className="wrap statement__inner">
        <h2 className="statement__line" id="statement-h">
          The robot does the hiring<span className="statement__stop">.</span>
        </h2>
        <p className="statement__sub">
          The marketplace assigns the task. Every hire after that is the robot&apos;s own decision, inside its budget.
        </p>
      </div>
    </section>
  );
}
