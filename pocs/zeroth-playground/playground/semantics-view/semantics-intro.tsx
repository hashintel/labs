import Intro from "../../semantics/intro.mdx";
import { TOPICS, questionsOf } from "../../semantics/register";
import { PAGE_COMPONENTS } from "../docs/page-components";

import "./semantics-intro.css";

/** The question panel with nothing selected: the intro, then each topic with what it holds and how many questions. */
export const SemanticsIntro: React.FC = () => {
  return (
    <article className="docs prose semantics-intro">
      <Intro components={PAGE_COMPONENTS} />
      <h3>Topics</h3>
      <dl className="semantics-intro__topics">
        {TOPICS.map((topic) => {
          const count = questionsOf(topic.id).length;
          return (
            <div key={topic.id} className="semantics-intro__topic">
              <dt>
                {topic.title}
                <span className="semantics-intro__count">
                  {count} {count === 1 ? "question" : "questions"}
                </span>
              </dt>
              <dd>{topic.about}</dd>
            </div>
          );
        })}
      </dl>
    </article>
  );
};
