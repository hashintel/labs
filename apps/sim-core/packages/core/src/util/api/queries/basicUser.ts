import { BasicUser } from "../types";
import { query } from "../query";

export const BasicUserFragment = /* GraphQL */ `
  fragment BasicUserFragment on User {
    id
    email
    fullName
    shortname
    staffMember
  }
`;

export const identifyBasicUser = (_me?: BasicUser | undefined) => {
  // User identification removed with Sentry/FullStory
};

export const basicUser = async () => {
  const { me } = await query<{ me?: BasicUser }>(`
    query basicUser {
      me { ...BasicUserFragment }
    }
    
    ${BasicUserFragment}
  `);

  identifyBasicUser(me);

  return me;
};
