import React, { FC } from "react";
import ReactTimeago from "react-timeago";
import { format, isToday } from "date-fns";

import "./ActivityTime.scss";

export const ActivityTime: FC<{ time: number }> = ({ time }) => (
  <span className="ActivityTime">
    <ReactTimeago
      date={time}
      minPeriod={60}
      title={format(time, "yyyy/MM/dd HH:mm:ss")}
      formatter={(quantity, unit) => {
        if (isToday(time)) {
          return format(time, "h:mma");
        }

        if (["second", "minute", "hour"].includes(unit)) {
          return "1 DAY";
        }

        return `${quantity} ${unit}${quantity === 1 ? "" : "s"}`.toUpperCase();
      }}
    />
  </span>
);
