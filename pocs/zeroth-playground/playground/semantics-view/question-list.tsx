import { QUESTIONS } from "../../semantics/register";
import { hashOf } from "../app/route";
import { stepIndex } from "../ui/roving";

import "./question-list.css";

function walk(event: React.KeyboardEvent<HTMLElement>) {
  const rows = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[href]")];
  const at = rows.indexOf(document.activeElement as HTMLAnchorElement);
  const next = stepIndex(event.key, at, rows.length);
  if (next === null) return;
  event.preventDefault();
  rows[next]?.focus();
}

export const QuestionList: React.FC<{ selected: string | null }> = ({ selected }) => (
  <nav className="question-list" aria-label="Questions for Zeroth" onKeyDown={walk}>
    {QUESTIONS.map((question) => (
      <a
        key={question.id}
        href={hashOf({ view: "semantics", question })}
        className="question-list__row"
        data-question={question.id}
        aria-current={question.id === selected ? "page" : undefined}
        tabIndex={question.id === (selected ?? QUESTIONS[0]?.id) ? 0 : -1}
      >
        {question.title}
      </a>
    ))}
  </nav>
);
