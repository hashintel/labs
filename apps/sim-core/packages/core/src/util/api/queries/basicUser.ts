import { BasicUser } from "../types";
import { IS_DEV, IS_LOCAL } from "../paths";
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

export const basicUser = async () => {
  const { me } = await query<{ me?: BasicUser }>(`
    query basicUser {
      me { ...BasicUserFragment }
    }
    
    ${BasicUserFragment}
  `);

  return me;
};
