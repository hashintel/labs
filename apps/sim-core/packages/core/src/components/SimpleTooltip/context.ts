import { createContext, useContext } from "react";

export const SimpleTooltipContext = createContext(() => {});
export const useCloseTooltip = () => useContext(SimpleTooltipContext);
