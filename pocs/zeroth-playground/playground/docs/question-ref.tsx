import { questionById } from "../../semantics/register";
import { useNavigation } from "../app/navigation";

import "./question-ref.css";

/**
 * A question of the semantics register, named on a page: who can settle it,
 * its status and its title, and a way to open it in the Semantics view. The
 * text of the question lives in the register alone. An id the register does
 * not hold throws, so the page render test catches it.
 */
export const Question: React.FC<{ id: string }> = ({ id }) => {
  const question = questionById(id);
  if (question === undefined) {
    throw new Error(`no question ${id} in semantics/`);
  }
  const { openQuestion } = useNavigation();
  return (
    <aside className="question-ref" data-question={id} data-status={question.status}>
      <span className="caps question-ref__meta">
        For {question.owner} · {question.status}
      </span>
      <p className="question-ref__title">{question.title}</p>
      <button type="button" className="question-ref__open" onClick={() => openQuestion(id)}>
        Open in Semantics
      </button>
    </aside>
  );
};
