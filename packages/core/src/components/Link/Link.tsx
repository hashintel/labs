import React, { FC, forwardRef, HTMLProps } from "react";
import { navigate } from "hookrouter";

import { Scope, useScope } from "../../features/scopes";

export type LinkProps = Omit<
  HTMLProps<HTMLAnchorElement>,
  "href" | "size" | "scope" | "ref"
> & {
  path?: string;
  query?: Record<string, any>;
  replace?: boolean;
  scope?: Scope | null;
  forceLogin?: boolean;
};

const getHref = (route: string | undefined, query: Record<string, any>) =>
  `${route ?? "#"}${
    Object.keys(query).length > 0
      ? `?${new URLSearchParams(query).toString()}`
      : ""
  }`;

export const Link: FC<LinkProps> = forwardRef<HTMLAnchorElement, LinkProps>(
  function Link(
    {
      path,
      onClick,
      query = {},
      children,
      replace = false,
      scope = null,
      forceLogin,
      target,
      ...props
    },
    ref,
  ) {
    /**
     * defaulting to Scope.login because we cannot dynamically call this hook.
     * We'll only use the result of this if scope is passed in.
     */
    const hasScope = useScope(scope ?? Scope.login);

    const absolute = path?.startsWith("http");

    if (scope !== null && absolute) {
      throw new Error("Cannot scope absolute URL");
    }

    let filteredQuery = Object.fromEntries(
      Object.entries(query).filter(
        ([_, value]) => value !== null && typeof value !== "undefined",
      ),
    );

    let route = path;
    let mappedOnClick = onClick;

    if ((scope !== null && !hasScope) || forceLogin) {
      filteredQuery = path ? { route: getHref(path, filteredQuery) } : {};
      route = "/signin";
      mappedOnClick = undefined;
    }

    const href = getHref(route, filteredQuery);

    return (
      <a
        target={target}
        href={href}
        ref={ref}
        onClick={
          target || absolute
            ? mappedOnClick
            : (evt) => {
                if (!(evt.metaKey || evt.ctrlKey || evt.altKey)) {
                  evt.preventDefault();
                  if (route) {
                    navigate(route, replace, filteredQuery);
                  }
                }

                mappedOnClick?.(evt);
              }
        }
        {...props}
      >
        {children}
      </a>
    );
  },
);
