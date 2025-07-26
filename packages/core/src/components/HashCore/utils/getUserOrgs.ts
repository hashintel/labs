import type { Org, User } from "../../../util/api/types";

export const getUserOrgs: (u: User | null) => Org[] = (currentUser) =>
  currentUser
    ? [
        {
          id: "user",
          shortname: currentUser.shortname,
          name: currentUser.fullName,
        },
      ].concat(
        (currentUser.memberOf ?? []).map(
          ({ org: { id, shortname, name } }) => ({
            id,
            shortname,
            name,
          }),
        ),
      )
    : [];
