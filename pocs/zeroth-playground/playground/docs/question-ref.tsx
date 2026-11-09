import { questionById } from "../../semantics/register";
import { hashOf } from "../app/route";

import "./question-ref.css";

export const Question: React.FC<{ id: string }> = ({ id }) => {
  const question = questionById(id);
  if (question === undefined) throw new Error(`no question ${id}`);
  return <p className="question-ref" data-question={id}>
    <a href={hashOf({ view: "semantics", question })}>{question.title}</a>
  </p>;
};
