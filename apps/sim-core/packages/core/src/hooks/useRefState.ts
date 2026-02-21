import { Dispatch, useLayoutEffect, useRef, useState } from "react";

/**
 * Wrapper for useState that also provides a ref that always contains the latest value.
 *
 * Unfortunately users of this hook won't know that setState and the ref are
 * constant values, due to restrictions with eslint-plugin-react-hooks.
 *
 * @todo address these restrictions
 */
export function useRefState<S>(
  initialState: S | (() => S),
): [S, Dispatch<S>, { readonly current: S }] {
  const [state, setState] = useState(initialState);
  const ref = useRef(state);

  const setStateRef = useRef((value: S) => {
    ref.current = value;
    setState(value);
  });

  useLayoutEffect(() => {
    ref.current = state;
  });

  return [state, setStateRef.current, ref];
}
