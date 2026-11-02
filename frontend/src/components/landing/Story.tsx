/* eslint-disable @next/next/no-img-element -- Tabby's art is served as is */
import { Raised } from "@/components/newui/parts";
import { tabbyPose } from "@/lib/tabby";

const ITEMS: Record<string, [string, string]> = {
  tacos: ["Carne asada tacos", "13.50"],
  fish: ["Fish tacos", "12.00"],
  chips: ["Chips & guacamole", "9.00"],
  fries: ["Fries", "5.50"],
  horchata: ["Horchata ×2", "8.00"],
  burrito: ["Bean burrito", "11.75"],
};

const STEPS = [
  ["Snap it", "A photo, a PDF or a forwarded email. That’s the whole job.", "scanning"],
  ["Tabby reads every line", "Each item is sorted and checked against the total.", "looking"],
  ["Tap who had what", "Tax follows the food, so every cent lands on someone.", "love"],
  ["Only your share counts", "Your number moves by $23.95, not the whole $65.05.", "happy"],
  ["Settled, no awkward text", "Friends get a link and pay however they like.", "celebrate"],
];

function Slots({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id) => (
        <span key={id} className="ln-slot" data-slot={id}>
          <span>{ITEMS[id][0]}</span>
          <span>{ITEMS[id][1]}</span>
        </span>
      ))}
    </>
  );
}

const SCENES = [
  <>
    <div className="ln-box ln-box-bill" data-pop>
      <p className="ln-box-head">
        <b>Luna Taqueria</b>
        <span>Fri Oct 24 · Table 6</span>
      </p>
      <Slots ids={Object.keys(ITEMS)} />
      <p className="ln-box-foot">
        <span>Total with tax</span>
        <b>$65.05</b>
      </p>
    </div>
    <span className="ln-source ln-source-a" data-source>
      Photo
    </span>
    <span className="ln-source ln-source-b" data-source>
      PDF
    </span>
    <span className="ln-source ln-source-c" data-source>
      Email
    </span>
  </>,
  <>
    <div className="ln-box" data-pop>
      <p className="ln-box-head">
        <b>Dining</b>
        <b>$51.75</b>
      </p>
      <Slots ids={["tacos", "fish", "chips", "fries", "burrito"]} />
    </div>
    <div className="ln-side">
      <div className="ln-box" data-pop>
        <p className="ln-box-head">
          <b>Drinks</b>
          <b>$8.00</b>
        </p>
        <Slots ids={["horchata"]} />
      </div>
      <div className="ln-box ln-box-ok" data-pop>
        <p>Every line adds up</p>
        <b>$65.05 ✓</b>
      </div>
    </div>
  </>,
  <>
    <div className="ln-box" data-pop>
      <p className="ln-box-head">
        <b>You</b>
        <b>$23.95</b>
      </p>
      <Slots ids={["tacos", "fries"]} />
    </div>
    <div className="ln-box" data-pop>
      <p className="ln-box-head">
        <b>Maya</b>
        <b>$20.69</b>
      </p>
      <Slots ids={["fish"]} />
    </div>
    <div className="ln-box" data-pop>
      <p className="ln-box-head">
        <b>Ben</b>
        <b>$20.41</b>
      </p>
      <Slots ids={["burrito"]} />
    </div>
    <div className="ln-box ln-box-wide" data-pop>
      <p className="ln-box-head">
        <b>Shared</b>
        <span>Split between the people who had it</span>
      </p>
      <div className="ln-pair">
        <Slots ids={["chips", "horchata"]} />
      </div>
    </div>
  </>,
  <>
    <div className="ln-box" data-pop>
      <p className="ln-box-head">
        <b>Your share</b>
        <b>$23.95</b>
      </p>
      <Slots ids={["tacos", "fries", "chips"]} />
    </div>
    <div className="ln-box ln-box-big" data-pop>
      <p>Safe to spend</p>
      <b data-count>
        <Raised text="$2,242.65" />
      </b>
      <i className="ln-meter">
        <i data-meter />
      </i>
      <p>−$23.95 Luna Taqueria</p>
    </div>
  </>,
  <>
    <div className="ln-box ln-box-paid" data-pop>
      <p>Maya paid you</p>
      <b>$20.69</b>
      <span>by Venmo</span>
    </div>
    <div className="ln-box ln-box-paid" data-pop>
      <p>Ben paid you</p>
      <b>$20.41</b>
      <span>by Cash App</span>
    </div>
    <div className="ln-box ln-box-done" data-pop>
      <b>All settled</b>
      <span>$65.05, every cent accounted for</span>
    </div>
  </>,
];

/** One dinner, told by its own items: a short film that plays itself, or by the step buttons. */
export function Story() {
  return (
    <section className="ln-story" id="how" data-story aria-labelledby="how-title">
      <div className="ln-story-bg" data-story-bg aria-hidden="true" />
      <div className="ln-story-pin" data-pin>
        <h2 id="how-title">One dinner, start to finish</h2>
        <div className="ln-story-main" data-main>
          {STEPS.map(([title, text, pose], n) => (
            <article key={title} className="ln-step" data-step={n}>
              <div className="ln-step-copy" data-copy>
                <h3>{title}</h3>
                <p>{text}</p>
                <img src={tabbyPose(pose)} alt="" loading="lazy" />
              </div>
              <div className={`ln-scene ln-scene-${n}`} data-scene={n} data-ui>
                {SCENES[n]}
              </div>
            </article>
          ))}
          {Object.entries(ITEMS).map(([id, [name, price]]) => (
            <span key={id} className="ln-item" data-item={id} aria-hidden="true">
              <span>{name}</span>
              <span>{price}</span>
            </span>
          ))}
        </div>
        <div className="ln-progress" role="group" aria-label="Story steps">
          {STEPS.map(([title]) => (
            <button key={title} data-mark>
              <i>
                <i data-fill />
              </i>
              {title}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
