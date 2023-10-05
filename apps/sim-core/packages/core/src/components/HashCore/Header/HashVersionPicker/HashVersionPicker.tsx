import React, { FC, useCallback, useState } from "react";
import { Autocomplete } from "@material-ui/lab";
import {
  Button,
  Popover,
  TextField,
  ThemeProvider,
  Typography,
  makeStyles,
  withStyles,
} from "@material-ui/core";

import { getUrlForCurrentRouteWithBuildStamp } from "../../../../routes";
import { muiTheme } from "../../../../util/material";
import { promoteToLive } from "../../../../util/api/queries";

import "./HashVersionPicker.css";

type HashVersionPickerProps = {
  versions: string[]; //TODO: @ulyssesp create a type for versions
};

const useStyles = makeStyles((theme) => ({
  typography: {
    padding: theme.spacing(2),
  },
  buttons: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  button: {
    marginRight: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
}));

const fontSize13 = { fontSize: 13 };
const widthMaxContent = { width: "max-content !important" };

const PromoteButton = withStyles(() => ({
  root: {
    backgroundColor: "var(--theme-dark)",
    borderRadius: 0,
    color: "var(--theme-grey)",
    fontWeight: "bold",
    textTransform: "none",
    "&:hover": {
      backgroundColor: "var(--theme-red)",
    },
    paddingTop: 6,
  },
  label: fontSize13,
}))(Button);

const HashVersionAutocomplete = withStyles(() => ({
  root: { paddingTop: 1 },
  input: { ...fontSize13, ...widthMaxContent },
  popper: { ...fontSize13, ...widthMaxContent },
  paper: fontSize13,
}))(Autocomplete);

export const HashVersionPicker: FC<HashVersionPickerProps> = ({ versions }) => {
  const classes = useStyles();
  const [anchorEl, setAnchorEl] = useState<Element>();
  const open = Boolean(anchorEl);
  const [confirmationIndex, setConfirmationIndex] = useState<
    number | undefined
  >(0);

  const confirmationDialogs = [
    `Promote ${WEBPACK_BUILD_STAMP} to production?`,
    "You've tested everything?",
    "Ok...",
  ];

  const confirmationButtons = ["Promote", "Yes", "Let's do this!"];

  const promoteToLiveCb = useCallback(() => {
    if (
      confirmationIndex !== undefined &&
      confirmationIndex + 1 < confirmationDialogs.length
    ) {
      setConfirmationIndex(confirmationIndex + 1);
    } else {
      const controller = new AbortController();
      promoteToLive({ stamp: WEBPACK_BUILD_STAMP }, controller.signal)
        .then(() => setConfirmationIndex(undefined))
        .catch((err) => {
          console.error(err);
          setConfirmationIndex(0);
        });
      return controller.abort.bind(controller);
    }
  }, [confirmationIndex, confirmationDialogs.length]);

  return (
    <ThemeProvider theme={muiTheme}>
      <div className="HashVersionPicker">
        <HashVersionAutocomplete
          size="small"
          options={versions}
          getOptionLabel={(version) => `${version}`}
          value={WEBPACK_BUILD_STAMP}
          onChange={(_, newValue) => {
            if (newValue) {
              // Add "hash-prod-" so it doesn't have to come down in the version list
              window.location.replace(
                getUrlForCurrentRouteWithBuildStamp(`hash-prod-${newValue}`)
              );
            }
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              margin="none"
              InputProps={{
                ...params.InputProps,
                disableUnderline: true,
                margin: "none",
              }}
            />
          )}
          disableClearable={true}
        />
        <PromoteButton
          size="small"
          variant="contained"
          disableElevation={true}
          aria-describedby="confirm-popover"
          onClick={(evt) => setAnchorEl(evt.currentTarget)}
        >
          Promote to Prod
        </PromoteButton>
        <Popover
          id="confirm-popover"
          open={open}
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(undefined)}
        >
          {confirmationIndex === undefined ? (
            <div className="confirmed">Good stuff.</div>
          ) : (
            <>
              <Typography className={classes.typography}>
                {confirmationDialogs[confirmationIndex]}
              </Typography>
              <div className={classes.buttons}>
                <Button
                  variant="text"
                  onClick={() => {
                    setConfirmationIndex(0);
                    setAnchorEl(undefined);
                  }}
                  className={classes.button}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={promoteToLiveCb}
                  className={classes.button}
                >
                  {confirmationButtons[confirmationIndex]}
                </Button>
              </div>
            </>
          )}
        </Popover>
      </div>
    </ThemeProvider>
  );
};
