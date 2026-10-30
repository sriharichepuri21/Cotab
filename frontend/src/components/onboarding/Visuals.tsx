import { Camera, FileText, Inbox, Lock, ShoppingBag, Users, Wallet } from "lucide-react";

import { GlassRings } from "@/components/landing/GlassRings";

/** The mark at the centre, the six ways a receipt arrives orbiting it. */
export function OrbitVisual() {
  const ways = [Camera, FileText, Inbox, Wallet, ShoppingBag, Users];
  return (
    <div className="ob-orbit" aria-hidden="true">
      <span className="ob-orbit-ring" />
      <div className="ob-orbit-core">
        <GlassRings uid="ob-core" />
      </div>
      <div className="ob-orbit-spin">
        {ways.map((Icon, i) => (
          <span key={i} className="ob-bead" style={{ ["--i" as string]: i }}>
            <Icon />
          </span>
        ))}
      </div>
    </div>
  );
}

/** A gauge drawn as one of the mark's glass tubes, filling to the share of the plan used. */
export function GaugeVisual({ value = 79 }: { value?: number }) {
  // A 270° arc: from 135° to 405°.
  const r = 100;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75;
  const end = (135 + 270 * (value / 100)) * (Math.PI / 180);
  return (
    <div className="ob-gauge" aria-hidden="true">
      <svg viewBox="0 0 260 260">
        <circle
          className="ob-gauge-well"
          cx="130"
          cy="130"
          r={r}
          strokeDasharray={`${arc} ${c}`}
          transform="rotate(135 130 130)"
        />
        <circle
          className="ob-gauge-fill"
          cx="130"
          cy="130"
          r={r}
          stroke="url(#ob-tube)"
          filter="url(#ob-glass)"
          strokeDasharray={`${arc * (value / 100)} ${c}`}
          transform="rotate(135 130 130)"
        />
        <circle
          className="ob-gauge-knob"
          cx={130 + r * Math.cos(end)}
          cy={130 + r * Math.sin(end)}
          r="13"
          fill="url(#ob-tube)"
          filter="url(#ob-glass)"
        />
      </svg>
      <p className="ob-gauge-read">
        <b>{value}%</b>
        <span>On plan</span>
      </p>
    </div>
  );
}

/** A receipt slab and the dark glass card that says who owes what. */
export function SplitVisual() {
  return (
    <div className="ob-split" aria-hidden="true">
      <div className="ob-slab">
        <p className="ob-slab-head">
          Luna Taqueria <span>Table 6</span>
        </p>
        {[
          ["Carne asada tacos", "13.50", "y"],
          ["Fish tacos", "12.00", "m"],
          ["Fries", "5.50", "b"],
          ["Horchata ×2", "8.00", "m"],
        ].map(([item, price, who]) => (
          <p key={item} className="ob-slab-row">
            <span>{item}</span>
            <b>{price}</b>
            <i className={`ob-dot ob-dot-${who}`} />
          </p>
        ))}
      </div>
      <div className="ob-owes">
        <p>
          <i className="ob-dot ob-dot-m" />
          Maya owes you <b>$20.69</b>
        </p>
        <p>
          <i className="ob-dot ob-dot-b" />
          Ben owes you <b>$20.41</b>
        </p>
      </div>
    </div>
  );
}

/** A shield of the mark's glass with a lock, and the approval it stands for. */
export function SafeVisual() {
  return (
    <div className="ob-safe" aria-hidden="true">
      <svg viewBox="0 0 200 230">
        <path
          d="M100 12 C130 30 160 34 184 34 C184 120 160 182 100 216 C40 182 16 120 16 34 C40 34 70 30 100 12 Z"
          fill="url(#ob-tube)"
          filter="url(#ob-glass)"
        />
      </svg>
      <span className="ob-safe-lock">
        <Lock />
      </span>
      <p className="ob-safe-chip">
        <b>Split $22.50 with Maya?</b>
        <span>Approve</span>
      </p>
    </div>
  );
}
