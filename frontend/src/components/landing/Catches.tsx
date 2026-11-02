/** Four small proofs, each showing the thing itself. */
export function Catches() {
  return (
    <section className="ln-wrap ln-catch" aria-labelledby="catch-title">
      <h2 id="catch-title" data-rise>
        The small things it catches
      </h2>
      <div className="ln-bento">
        <article className="ln-tile ln-tile-ask" data-tilt data-rise data-ui>
          <div>
            <h3>Ask about one item</h3>
            <p>Every line is searchable, not just the total.</p>
          </div>
          <div className="ln-chat">
            <p className="ln-chat-me">How much on oat milk this month?</p>
            <p className="ln-chat-tabby">
              <b>$38.61</b> across nine cartons. That’s $14.61 over your limit.
            </p>
          </div>
        </article>
        <article className="ln-tile ln-tile-price" data-tilt data-rise data-ui>
          <div>
            <h3>Quiet price rises</h3>
            <p>Your usual, tracked shop by shop.</p>
          </div>
          <svg viewBox="0 0 400 90" aria-hidden="true">
            <path data-draw pathLength={1} d="M2 74H130L142 56H262L276 16H398" />
          </svg>
          <p className="ln-price">
            <b data-price>$4.79</b>
            <span>Oat milk, up from $4.29</span>
          </p>
        </article>
        <article className="ln-tile" data-tilt data-rise data-ui>
          <div>
            <h3>Forward the email</h3>
            <p>Your own Cotab address files what lands.</p>
          </div>
          <ul className="ln-inbox">
            <li>
              <span>Your Uber receipt</span>
              <b>$18.40</b>
            </li>
            <li>
              <span>Order confirmed, Target</span>
              <b>$55.53</b>
            </li>
            <li>
              <span>Blue Bottle Coffee</span>
              <b>$6.75</b>
            </li>
          </ul>
        </article>
        <article className="ln-tile ln-tile-link" data-tilt data-rise data-ui>
          <div>
            <h3>Friends never need the app</h3>
            <p>They open a link, see what they had and pay.</p>
          </div>
          <div className="ln-paylink">
            <p>
              <span>Maya, your share of Luna Taqueria</span>
              <b>$20.69</b>
            </p>
            <div>
              <span>Venmo</span>
              <span>PayPal</span>
              <span>Cash App</span>
              <span>Zelle</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
