"use client";
/* eslint-disable @next/next/no-img-element -- Tabby's art is served as is */

import { useState } from "react";

import { Raised } from "@/components/newui/parts";
import { tabbyPose } from "@/lib/tabby";

const PLAN = 2400;
const DAYS = 30;
const MOMENTS = [
  { day: 1, spent: 0, pose: "hello", say: "New month. The plan is set." },
  { day: 4, spent: 1452.92, pose: "reading", say: "Rent is filed. Nothing else to do." },
  { day: 11, spent: 1604.3, pose: "scanning", say: "Groceries read, line by line." },
  { day: 17, spent: 1766.1, pose: "wow", say: "Maya paid you back for dinner." },
  { day: 23, spent: 2012.45, pose: "worried", say: "Dining is close to its limit." },
  { day: 30, spent: 2190.8, pose: "happy", say: "Month closed, $209.20 under plan." },
];
const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Drag through a month and watch the one number Tabby keeps for you. */
export function Month() {
  const [day, setDay] = useState(14);
  const now = [...MOMENTS].reverse().find((m) => m.day <= day) ?? MOMENTS[0];
  const left = PLAN - now.spent;
  return (
    <div className="ln-month">
      <div aria-live="polite">
        <p className="ln-month-label">Safe to spend on day {day}</p>
        <p className="ln-month-figure">
          <Raised text={usd(left)} />
        </p>
        <p className="ln-month-say">{now.say}</p>
      </div>
      <img key={now.pose} src={tabbyPose(now.pose)} alt="" width={640} height={640} />
      <label className="ln-month-rule">
        <span className="sr-only">Day of the month</span>
        <input
          type="range"
          min={1}
          max={DAYS}
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
