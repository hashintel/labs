import * as Sentry from "@sentry/browser";
import SentryFullStory from "@sentry/fullstory";
import {
  identify as fsIdentify,
  init as fsInit,
  setUserVars as fsSetUserVars,
} from "@fullstory/browser";
import { setupIntegration } from "@sentry/core/dist/integration";

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

export const identifyBasicUser = (me?: BasicUser | undefined) => {
  const user = me
    ? {
        email: me.email,
        id: me.id,
        name: me.fullName,
        username: me.shortname,
        staff: me.staffMember,
      }
    : null;

  if (!IS_LOCAL && (user?.staff || IS_DEV)) {
    fsInit({ orgId: "ZCVMD" });
    if (user) {
      fsIdentify(user.id, {
        displayName: user.name,
        email: user.email,
      });
    }
    fsSetUserVars({ staging: IS_DEV, production: !IS_DEV });

    const client = Sentry.getCurrentHub().getClient();
    /**
     * Using private API to add a new integration
     * @todo figure out how to do this without a private API
     */
    if (client) {
      const sentryFullStory = new SentryFullStory("hashintel");
      setupIntegration(sentryFullStory);
      // @ts-ignore
      client._integrations[sentryFullStory.name] = sentryFullStory;
    }
  }

  Sentry.setUser(user);
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
