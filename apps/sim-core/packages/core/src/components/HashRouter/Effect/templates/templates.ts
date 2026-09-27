import { ProjectTemplate } from "./types";
import { emptyTemplate } from "./empty";
import { starterTemplate } from "./starter";

export const templates: Record<string, ProjectTemplate> = {
  empty: emptyTemplate,
  starter: starterTemplate,
};
