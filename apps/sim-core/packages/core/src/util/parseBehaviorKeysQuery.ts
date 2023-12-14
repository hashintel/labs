import urljoin from "url-join";

import { BehaviorKeyFields } from "../features/files/behaviorKeys";
import { HcBehaviorFile } from "../features/files/types";
import { SITE_URL } from "./api";
import { validateBehaviorKeyName } from "../features/files/validate";

export const parseBehaviorKeysQuery = async (
  file: HcBehaviorFile,
  signal?: AbortSignal,
): Promise<BehaviorKeyFields> => {
  let result: {
    error?: { code: string } | null;
    success?: boolean;
    keys?: BehaviorKeyFields;
  } = {};

  try {
    const req = await fetch(urljoin(SITE_URL, "behavior-keys"), {
      method: "post",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lang: file.path.ext.slice(1),
        source: file.contents,
      }),
      signal,
    });

    result = await req.json();

    if (!req.ok || (result.error ?? !result.success)) {
      console.error("Cannot fetch behavior keys", result);
    }
  } catch (err) {
    console.error("Cannot fetch behavior keys", err);
  }

  if (result?.keys) {
    return Object.fromEntries(
      Object.entries(result.keys).filter(
        ([key]) => validateBehaviorKeyName(key).length === 0,
      ),
    );
  }

  return {};
};
