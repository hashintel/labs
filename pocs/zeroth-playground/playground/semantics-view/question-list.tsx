import { QUESTIONS, TOPICS, questionsOf } from "../../semantics/register";
import { hashOf } from "../app/route";
import { stepIndex } from "../ui/roving";

import type { Status } from "../../semantics/register";

import "./question-list.css";

type QuestionListProps = {
  selected: string | null;
};

/** What the status dot says on hover. */
const STATUS_TITLES: Record<Status, string> = {
  open: "Open: nobody has decided",
  proposed: "Proposed: one side proposes an answer",
  settled: "Settled: decided, with the decision on the page",
};

/** The id of a question's row, for the card to hand the focus back to. */
export function rowId(question: string): string {
  return `question-row-${question}`;
}

/** The arrow keys walk the rows; Home and End jump to the ends. Enter and Space press the row. */
function walk(event: React.KeyboardEvent<HTMLDivElement>) {
  const rows = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[href]")];
  const at = rows.indexOf(document.activeElement as HTMLAnchorElement);
  const next = stepIndex(event.key, at, rows.length);
  if (next === null) {
    return;
  }
  event.preventDefault();
  rows[next]?.focus();
}

/**
 * Every question of the register, grouped by topic: a status dot, the title,
 * and who can settle it. Each row is a link to the question's hash; a hover does nothing. The selected
 * row, else the first, is the one Tab reaches, and the arrow keys walk the rest.
 */
export const QuestionList: React.FC<QuestionListProps> = ({ selected }) => {
  const tabStop = selected ?? QUESTIONS[0]?.id;
  return (
    <nav className="question-list" aria-label="Questions" onKeyDown={walk}>
      {TOPICS.map((topic) => {
        const questions = questionsOf(topic.id);
        const titleId = `question-topic-${topic.id}`;
        return questions.length === 0 ? null : (
          <div key={topic.id} role="group" aria-labelledby={titleId} className="question-list__group">
            <div id={titleId} className="caps question-list__topic">
              {topic.title}
            </div>
            {questions.map((question) => (
              <a
                key={question.id}
                id={rowId(question.id)}
                href={hashOf({ view: "semantics", question })}
                className="question-list__row"
                data-question={question.id}
                aria-current={question.id === selected ? "page" : undefined}
                tabIndex={question.id === tabStop ? 0 : -1}
              >
                <span
                  className="question-list__status"
                  data-status={question.status}
                  title={STATUS_TITLES[question.status]}
                  role="img"
                  aria-label={question.status}
                />
                <span className="question-list__title">{question.title}</span>
                <span className="question-list__owner">{question.owner}</span>
              </a>
            ))}
          </div>
        );
      })}
    </nav>
  );
};
