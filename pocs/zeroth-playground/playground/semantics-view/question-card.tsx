import { flushSync } from "react-dom";

import { topicById } from "../../semantics/register";
import { PAGE_COMPONENTS } from "../docs/page-components";
import { BackLink } from "../ui/back-link";
import { QUESTION_PAGES } from "./question-pages";
import { rowId } from "./question-list";
import { ShowingView } from "./showing-view";

import type { Question } from "../../semantics/register";

import "./question-card.css";

type QuestionCardProps = {
  question: Question;
  /** Deselects the question; the card hands the focus back to its row in the list. */
  onBack: () => void;
};

/**
 * The selected question: its topic, owner and status over its title, the
 * page, and then where it shows, one block per example compiled at the
 * options that bring the behaviour out.
 */
export const QuestionCard: React.FC<QuestionCardProps> = ({ question, onBack }) => {
  const Page = QUESTION_PAGES[question.id];
  const topic = topicById(question.topic);
  return (
    <div className="question-card">
      <div className="question-card__head">
        <BackLink
          onClick={() => {
            // The link goes with the card: hand the focus to the question's row in the list.
            flushSync(onBack);
            document.getElementById(rowId(question.id))?.focus();
          }}
        >
          All questions
        </BackLink>
        <p className="caps kicker">
          {topic.title} · For {question.owner} · {question.status}
        </p>
      </div>
      <article className="question-card__doc prose">
        <h2 className="question-card__title">{question.title}</h2>
        {Page === undefined ? (
          <p className="note">This question has no page.</p>
        ) : (
          <Page components={PAGE_COMPONENTS} />
        )}
      </article>
      <section className="question-card__shows" aria-label="Shows in">
        <h3 className="caps question-card__shows-title">Shows in</h3>
        {question.shows.length === 0 ? (
          <p className="note">No example brings this out yet.</p>
        ) : (
          question.shows.map((showing, index) => <ShowingView key={index} showing={showing} />)
        )}
      </section>
    </div>
  );
};
