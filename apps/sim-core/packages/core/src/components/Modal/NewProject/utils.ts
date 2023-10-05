import { useSelector } from "react-redux";

import { SITE_URL } from "../../../util/api/paths";
import { getUserOrgs } from "../../HashCore/utils";
import { selectCurrentUser } from "../../../features/user";

export const namespacePrefix = SITE_URL.replace(/^(.*?):\/\//, "");

export const USER_ORG_VALUE = "#_USER_ORG_VALUE";

export const useOrgs = () => getUserOrgs(useSelector(selectCurrentUser));
