import React, { FC, useEffect, useRef, useState } from "react";
import urljoin from "url-join";

import { FancyButton } from "../../Fancy/Button";
import { Link } from "../../Link/Link";
import { ModalFullScreen } from "../FullScreen/ModalFullScreen";
import { SITE_URL } from "../../../util/api/paths";

import "./ModalSignup.css";

export const ModalSignup: FC<{ onClose: VoidFunction; route: string }> = ({
  onClose,
  route,
}) => {
  const year = new Date().getFullYear();
  const [email, setEmail] = useState("");
  const emailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  return (
    <ModalFullScreen onClose={onClose} modalClassName="ModalSignup">
      <div style={{ flex: 1 }} />
      <div>
        <h2>Create an account</h2>
        <h3>Enter your email address to continue</h3>
        <form method="get" action={SITE_URL}>
          <input
            type="email"
            name="email"
            required
            placeholder="your.email@example.com"
            value={email}
            onChange={(evt) => {
              setEmail(evt.target.value);
            }}
            ref={emailRef}
          />
          <FancyButton type="submit">
            <strong>Continue</strong>
          </FancyButton>
        </form>
        <p className="ModalSignup__Signin">
          Already have an account?{" "}
          <Link path="/signin" query={{ route }}>
            Sign in here.
          </Link>
        </p>
      </div>
      <div style={{ flex: 1 }} />
      <p className="ModalSignup__Legal">
        <span className="ModalSignup__Legal__Copyright">© HASH {year}</span> By
        continuing, you agree to our{" "}
        <a
          href={urljoin(SITE_URL, "legal", "terms")}
          target="_blank"
          rel="noreferrer"
        >
          Terms of Service
        </a>{" "}
        and{" "}
        <a
          href={urljoin(SITE_URL, "legal", "privacy")}
          target="_blank"
          rel="noreferrer"
        >
          Privacy Policy
        </a>
        .
      </p>
    </ModalFullScreen>
  );
};
