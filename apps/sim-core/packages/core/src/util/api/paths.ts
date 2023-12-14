// CORS restrict prod to access from hash.ai domains
// Prod API only accessed through core.hash.ai
import urljoin from "url-join";

export const IS_DEV =
  self.location && self.location.origin !== "https://core.hash.ai";

export const IS_STAGING =
  self.location && self.location.origin === "https://staging.hash.ai";

export const IS_LOCAL = process.env.NODE_ENV !== "production";

export const SITE_URL = "http://localhost:8080";

export const API_LOGIN_URL = "http://localhost:5000";

export const API_URL = urljoin(API_LOGIN_URL, "graphql");

export const ACCOUNT_URL = urljoin(SITE_URL, "account");

export const SIMULATIONS_URL = urljoin(SITE_URL, "simulations");

export const SIM_DOCS_URL = "https://hash.ai/docs/simulation";
