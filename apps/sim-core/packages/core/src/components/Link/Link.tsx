import React, { FC, forwardRef, HTMLProps } from "react";
import { navigate } from "../../util/navigation";

import { Scope } from "../../features/scopes";

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
      scope: _scope,
      forceLogin: _forceLogin,
      target,
      ...props
    },
    ref
  ) {
    const absolute = path?.startsWith("http");

    const filteredQuery = Object.fromEntries(
      Object.entries(query).filter(
        ([_, value]) => value !== null && typeof value !== "undefined"
      )
    );

    const route = path;
    const href = getHref(route, filteredQuery);

    return (
      <a
        target={target}
        href={href}
        ref={ref}
        onClick={
          target || absolute
            ? onClick
            : (evt) => {
                if (!(evt.metaKey || evt.ctrlKey || evt.altKey)) {
                  evt.preventDefault();
                  if (route) {
                    navigate(route, replace, filteredQuery);
                  }
                }

                onClick?.(evt);
              }
        }
        {...props}
      >
        {children}
      </a>
    );
  }
);
