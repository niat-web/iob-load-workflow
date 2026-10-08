import type { ReactNode } from "react";
import { cardClass } from "../components/ui/styles";
import { cn } from "../utils/cn";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold text-ink">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
        <article className={cn(cardClass, "space-y-6 p-6 sm:p-8")}>
          <header className="space-y-1">
            <p className="text-xs font-bold tracking-wider text-primary uppercase">Job Flow Automation</p>
            <h1 className="text-2xl font-bold text-ink">Privacy notice</h1>
            <p className="text-sm text-muted">
              Job Flow Automation is an internal NxtWave tool for loading company jobs, reaching eligible students and
              sharing shortlisted profiles with hiring companies.
            </p>
          </header>

          <Section title="Who uses it">
            <p>
              Only NxtWave staff added by an admin can sign in. Companies open only the shared profiles link sent to
              them. Students only receive emails, calls and interview invites; they do not sign in.
            </p>
          </Section>

          <Section title="What it stores">
            <ul className="list-disc space-y-1 pl-5">
              <li>Staff sign-in: name, work email and role, from Google sign-in.</li>
              <li>Deals: job details read from HubSpot.</li>
              <li>
                Students: name, email, mobile, campus, application details, resume, scores, call results and answers to
                job update forms, used to run each job's application and review.
              </li>
              <li>Company interviewer emails and interview Meet details.</li>
              <li>
                For interviews, the connected Google account's permission to create calendar events and Meet settings.
                It is stored encrypted and used only to create and update interview Meets.
              </li>
            </ul>
          </Section>

          <Section title="How Google data is used">
            <p>
              Google sign-in is used only to confirm who is signing in. Google Calendar and Google Meet access is used
              only to create interview events with a Meet link, send the invites and turn on recording for those
              Meets. Google data is not sold, shared for advertising or used for anything else.
            </p>
          </Section>

          <Section title="Who it is shared with">
            <p>
              Data stays within NxtWave and the services the tool runs on: HubSpot, the NxtWave Learning Portal,
              Google, AWS (email), NxtDial (calls), Gemini (resume scoring), MongoDB Atlas, Redis Cloud, Northflank
              and Vercel. A hiring company sees only the profile columns chosen for its shared link, never student
              contact details.
            </p>
          </Section>

          <Section title="Removal">
            <p>
              Admins can remove staff access and delete deals at any time. Access to Google Calendar and Meet can be
              removed with Disconnect on the Interviews page or from the Google account's security settings. For any
              other request, contact the NxtWave placements team.
            </p>
          </Section>
        </article>
      </main>
    </div>
  );
}
