import { API_URL } from "./paths";

const parseQueryForName = (graphql: string) =>
  graphql.match(/^(?:[\s\n]*(?:query|mutation) )(\w+)/)?.[1];

const apiUrl = (graphql: string) => {
  const queryName = parseQueryForName(graphql);
  const url = `${API_URL}${
    queryName ? `?${encodeURIComponent(queryName)}` : ""
  }`;

  return { queryName, url };
};

interface ApiError {
  message: string;
  extensions?: {
    code: string;
    arguments?: object;
  };
}

type Variables = Record<string, any>;

export class QueryError extends Error {
  queryName: string | undefined;
  variables: Variables | null;
  errorCodes: string[];
  errors: ApiError[];
  onlyError: ApiError | null;
  onlyErrorCode: string | null;
  onlyErrorMessage: string | null;

  constructor(payload: {
    graphql: string;
    variables: Variables | null;
    errors: ApiError[];
  }) {
    const errorCodes = payload.errors
      .map((error) => error.extensions?.code)
      .filter((code): code is string => !!code);

    super(`Unhandled API Error (${errorCodes.join(", ")})`);

    this.queryName = parseQueryForName(payload.graphql);
    this.variables = payload.variables;
    this.errorCodes = errorCodes;
    this.errors = payload.errors;
    this.onlyError = this.errors.length === 1 ? this.errors[0] : null;
    this.onlyErrorCode =
      this.errorCodes.length === 1 ? this.errorCodes[0] : null;
    this.onlyErrorMessage =
      this.errors.length === 1 ? this.errors[0].message : null;
  }
}

async function baseQuery<T, V = {} | undefined>(
  graphql: string,
  variables?: V,
  signal?: AbortSignal,
): Promise<{
  data: T;
  errors?: ApiError[] | null;
  queryName: string | undefined;
}> {
  const { queryName, url } = apiUrl(graphql);
  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify({
      query: graphql,
      variables,
    }),
    headers: {
      "Content-Type": "application/json",
      "apollographql-client-name": "core",
    },
    credentials: "include",
    signal,
  });

  const { data, errors } = await response.json();

  return { data, errors, queryName };
}

export async function query<T, V = {} | undefined>(
  graphql: string,
  variables?: V,
  signal?: AbortSignal,
): Promise<T> {
  const { data, errors } = await baseQuery<T, V>(graphql, variables, signal);

  if (errors) {
    throw new QueryError({
      graphql,
      variables: variables ?? null,
      errors: errors,
    });
  }

  return data;
}

export const curriedQuery =
  <T, V = {} | undefined>(graphql: string) =>
  (variables: V, signal?: AbortSignal) =>
    query<T, V>(graphql, variables, signal);
