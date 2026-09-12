import type { CourseContext } from "../types";

interface Props {
  course: CourseContext;
  onChange: (course: CourseContext) => void;
  onContinue: () => void;
}

export default function CourseSetup({ course, onChange, onContinue }: Props) {
  function update<K extends keyof CourseContext>(key: K, value: CourseContext[K]) {
    onChange({ ...course, [key]: value });
  }

  const canContinue = course.name.trim().length > 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Course</h2>
        <p>
          What is this team for? The grading notes matter — they're what "pass," "grade A," "research," and
          "deep mastery" get judged against later, so a course context of "pass/fail, no research component"
          changes how goals get read the same way "30% of the grade, publishable work encouraged" does.
        </p>
      </div>

      <div className="field-grid">
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="course-name">Course or cohort name</label>
          <input
            id="course-name"
            value={course.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="e.g. 94-800 Negotiation"
          />
        </div>

        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="grading-notes">Grading / project notes</label>
          <textarea
            id="grading-notes"
            rows={3}
            value={course.grading_notes}
            onChange={(e) => update("grading_notes", e.target.value)}
            placeholder="e.g. Group project worth 30% of the grade, graded on process and outcome."
          />
        </div>

        <div className="field">
          <label htmlFor="team-min">Minimum team size</label>
          <input
            id="team-min"
            type="number"
            min={2}
            max={course.team_size_max}
            value={course.team_size_min}
            onChange={(e) => update("team_size_min", Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="team-max">Maximum team size</label>
          <input
            id="team-max"
            type="number"
            min={course.team_size_min}
            max={8}
            value={course.team_size_max}
            onChange={(e) => update("team_size_max", Number(e.target.value))}
          />
        </div>
      </div>

      <div className="panel-actions">
        <button className="btn primary" type="button" disabled={!canContinue} onClick={onContinue}>
          Continue to roster →
        </button>
      </div>
    </section>
  );
}
