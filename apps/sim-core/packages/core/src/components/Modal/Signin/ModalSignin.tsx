import React, { FC, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import classNames from "classnames";

import { API_LOGIN_URL } from "../../../util/api/paths";
import { AppDispatch } from "../../../features/types";
import { Link } from "../../Link/Link";
import { ModalFullScreen } from "../FullScreen/ModalFullScreen";
import { bootstrapApp } from "../../../features/thunks";

import "./ModalSignin.css";

export const ModalSignin: FC<{ onClose: VoidFunction; route: string }> = ({
  onClose,
  route,
}) => {
  const emailRef = useRef<HTMLInputElement | null>(null);
  const dispatch = useDispatch<AppDispatch>();
  const [movedMouse, setMovedMouse] = useState(false);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    const onMessage = async (message: any) => {
      if (message.origin === API_LOGIN_URL) {
        window.removeEventListener("message", onMessage, false);
        await dispatch(bootstrapApp());
      }
    };

    const onMouseMove = () => {
      setMovedMouse(true);
      window.removeEventListener("mousemove", onMouseMove);
    };

    window.addEventListener("message", onMessage, false);
    window.addEventListener("mousemove", onMouseMove);

    return () => {
      window.removeEventListener("message", onMessage, false);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, [dispatch]);

  return (
    <ModalFullScreen
      onClose={onClose}
      modalClassName="ModalSignin"
      theme="light"
    >
      <iframe
        className="ModalSignin__Frame"
        src={API_LOGIN_URL}
        scrolling="no"
      />
      <p
        className={classNames("ModalSignin__Signup", {
          "ModalSignin__Signup--visible": movedMouse,
        })}
      >
        Don't have an account?{" "}
        <Link path="/signup" query={{ route }}>
          Sign up here.
        </Link>
      </p>
    </ModalFullScreen>
  );
};
