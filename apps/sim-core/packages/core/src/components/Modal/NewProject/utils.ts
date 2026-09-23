import { SITE_URL } from "../../../util/api/paths";
import { getUserOrgs } from "../../HashCore/utils";
import { useUser } from "../../../features/user/UserContext";

export const namespacePrefix = SITE_URL.replace(/^(.*?):\/\//, "");

export const USER_ORG_VALUE = "#_USER_ORG_VALUE";

export const useOrgs = () => getUserOrgs(useUser().currentUser);
