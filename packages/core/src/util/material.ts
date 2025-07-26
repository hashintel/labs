import { createMuiTheme } from "@material-ui/core/styles";

import { theme } from "./theme";

export const muiTheme = createMuiTheme({
  palette: {
    type: "dark",
    primary: {
      main: theme.white,
    },
  },
});
