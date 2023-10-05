import { curriedQuery } from "./../query";

export const promoteToLive = curriedQuery<
  { promoteToLive: boolean },
  { stamp: string }
>(
  `mutation promoteToLive($stamp: String!) {
        promoteToLive(stamp: $stamp)
     }`
);
