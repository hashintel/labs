import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconHCoreMono: FC<IconProps> = ({ size = 98 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 98 48"
    fill="none"
    className="Icon IconHCoreMono"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M74 48L49.5 0 25 48h49zm-12.747-7.482L49.689 16.52 38.004 40.584l23.249-.066z"
      fill="#fff"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M98 12v9l-55.754 9L98 12z"
      fill="url(#prefix__paint0_linear)"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M98 21v9H42l56-9z"
      fill="url(#prefix__paint1_linear)"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M42 30h56v9l-56-9z"
      fill="url(#prefix__paint2_linear)"
    />
    <path
      opacity={0.671}
      fillRule="evenodd"
      clipRule="evenodd"
      d="M4.305 15L43 29.912 0 38l4.305-23z"
      fill="url(#prefix__paint3_linear)"
    />
    <defs>
      <linearGradient
        id="prefix__paint0_linear"
        x1={72.348}
        y1={8.443}
        x2={63.266}
        y2={35.145}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fff" stopOpacity={0.01} />
        <stop offset={1} stopColor="#fff" />
      </linearGradient>
      <linearGradient
        id="prefix__paint1_linear"
        x1={91.719}
        y1={22.262}
        x2={51.418}
        y2={22.262}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fff" stopOpacity={0.01} />
        <stop offset={1} stopColor="#fff" />
      </linearGradient>
      <linearGradient
        id="prefix__paint2_linear"
        x1={20.773}
        y1={33.595}
        x2={22.636}
        y2={48.099}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fff" />
        <stop offset={1} stopColor="#fff" stopOpacity={0.01} />
      </linearGradient>
      <linearGradient
        id="prefix__paint3_linear"
        x1={-4.384}
        y1={34.324}
        x2={16.547}
        y2={51.364}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fff" stopOpacity={0.01} />
        <stop offset={1} stopColor="#D8D8D8" />
      </linearGradient>
    </defs>
  </svg>
);
