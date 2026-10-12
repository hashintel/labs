import { PAGE_COMPONENTS } from "../docs/page-components";
import { QUESTION_PAGES } from "./question-pages";

import type { Question } from "../../semantics/register";

import "./question-card.css";

export const QuestionCard: React.FC<{ question: Question }> = ({ question }) => {
  const Page = QUESTION_PAGES[question.id];
  return (
    <article className="question-card prose">
      <h2>{question.title}</h2>
      {Page === undefined ? <p>This question has no page.</p> : <Page components={PAGE_COMPONENTS} />}
    </article>
  );
};
