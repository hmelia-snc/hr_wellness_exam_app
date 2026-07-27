import { renderLayout } from "./layout.js";

export function renderHomePage(): string {
  const body = `
<h1>Wellness Exam Verification</h1>
<p>Employees access their own upload/download page through the unique link
sent to them by email — there's no lookup here.</p>
<section>
  <h2>HR</h2>
  <p><a class="button" href="/dashboard">Go to HR Dashboard</a></p>
</section>
`;
  return renderLayout("Standard Nutrition Company — Wellness Exam Verification", body);
}
