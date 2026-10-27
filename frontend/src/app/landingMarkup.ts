/* Generated from the approved landing design; edit the markup here directly. */
/* eslint-disable */
export const LANDING_BODY = `<div id="top">
  <div class="lp-field" aria-hidden="true"></div>
  <section class="hero">
    <div class="wrap">
      <div>
        <h1>Receipts, read for you.</h1>
        <p class="lede">Snap or forward any receipt. Cotab reads every line, keeps your budgets honest and splits the bill with friends, with Tabby the cat.</p>
        <div class="ctas">
          <a class="btn btn-citron" href="/register">Get started free
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
          <a class="btn btn-ghost" href="#cat">Meet Tabby</a>
        </div>
        <div class="trust"><span class="faces"><span><img src="/cat-v3-stock/png/cool.png" alt=""></span><span><img src="/cat-v3-stock/png/love.png" alt=""></span><span><img src="/cat-v3-stock/png/payday.png" alt=""></span></span>Every line item, read in about 4 seconds</div>
      </div>

      <div class="stage" id="stage" aria-label="A receipt is read and Tabby, the Cotab cat, waves hello">
        <div class="blob"></div>
        <div class="tilt" id="tilt">
          <div class="receipt" id="receipt" aria-hidden="true">
            <div class="store">Corner Market</div>
            <div class="meta">214 Valencia St, 6:42 pm</div>
            <div class="row"><span>Oat milk 1L</span><span>3.49</span></div>
            <div class="row"><span>Sourdough</span><span>6.25</span></div>
            <div class="row"><span>Avocado ×3</span><span>4.47</span></div>
            <div class="row"><span>Eggs</span><span>5.99</span></div>
            <div class="row"><span>Coffee beans</span><span>14.50</span></div>
            <div class="row"><span>Spinach</span><span>2.80</span></div>
            <div class="row"><span>Bag</span><span>0.10</span></div>
            <div class="row total"><span>Total</span><span>41.20</span></div>
            <span class="stamp" id="stamp">Read</span>
          </div>
          <span class="floor" id="floor"></span>
          <img class="herocat" id="herocat" src="/cat-v3-stock/png/hi.png" alt="Tabby, the Cotab cat, waving">
          <div class="say" id="say">Hi, I'm Tabby! Got all 7 items.</div>
          <div class="chip c1" id="chip1"><span class="ico" style="background:#EEF7CF"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h11v4a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M8 4c0 1 1 1 1 2M12 4c0 1 1 1 1 2" fill="none" stroke="#4D6B05" stroke-width="2" stroke-linecap="round"/></svg></span><span>Coffee budget<small class="num">$14.50 of $40</small><span class="bar"><i></i></span></span></div>
          <div class="chip c2" id="chip2"><span class="face"><img src="/cat-v3-stock/png/cool.png" alt=""></span><span>Alex owes you<small class="num">$20.60 · half of Corner Market</small></span></div>
        </div>
      </div>
    </div>
  </section>

  <section class="block" id="how">
    <div class="wrap">
      <h2>Three steps. Tabby does the boring part.</h2>
      <div class="steps">
        <article class="step">
          <h3>Snap or forward</h3>
          <p>Take a photo, or forward the email receipt to your Cotab address.</p>
          <div class="art" style="background:#DCF3EF">
            <div class="mini-ui" aria-hidden="true">
              <div class="mscan"><i></i><div><span>Oat milk 1L</span><span>3.49</span></div><div><span>Sourdough</span><span>6.25</span></div><div><b>Total</b><b>41.20</b></div></div>
              <div class="mrow"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M4 6h16v12H4zM4 7l8 6 8-6" fill="none" stroke="#0F3D31" stroke-width="2.2" stroke-linejoin="round"/></svg>Forwarded from email</div>
            </div>
            <img class="mini hopin" src="/cat-v3-stock/png/hi.png" alt=""></div>
        </article>
        <article class="step">
          <h3>Every line, sorted</h3>
          <p>Each item is read and filed against your budgets, down to the coffee beans.</p>
          <div class="art" style="background:#FFF2CA">
            <div class="mini-ui" aria-hidden="true">
              <div class="mrow">Oat milk<span class="tag" style="background:#E2F1E5;color:#2F7D49">Groceries</span><small>$3.49</small></div>
              <div class="mrow">Coffee beans<span class="tag" style="background:#F1E9DF;color:#7A4E25">Coffee</span><small>$14.50</small></div>
              <div class="mrow">Coffee budget<span class="mbar"><b style="width:36%"></b></span><small>36%</small></div>
            </div>
            <img class="mini hopin" src="/cat-v3-stock/png/hmm.png" alt=""></div>
        </article>
        <article class="step">
          <h3>Split and settle</h3>
          <p>Tap who shared it. Cotab tracks who owes what and nudges them for you.</p>
          <div class="art" style="background:#FFE2EA">
            <div class="mini-ui" aria-hidden="true">
              <div class="mrow"><span class="mface" style="background:#D6EFE2"><img src="/cat-v3-stock/png/cool.png" alt=""></span>Alex owes you<small style="color:#2F7D49">$20.60</small></div>
              <div class="mrow"><span class="mface" style="background:#DAECFB"><img src="/cat-v3-stock/png/salute.png" alt=""></span>Jordan<small style="color:#2F7D49">$35.00</small></div>
              <div class="mrow" style="background:#0F3D31;color:#fff"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M5 13l4 4 10-10" fill="none" stroke="#D7F45B" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>Reminder sent</div>
            </div>
            <img class="mini hopin" src="/cat-v3-stock/png/love.png" alt=""></div>
        </article>
      </div>
    </div>
  </section>

  <section class="band" id="cat">
    <div class="wrap">
      <div>
        <h2>Tabby reacts to your money.</h2>
        <p class="lede">Tabby watches your budget with you. Drag the slider to spend, or tap something that happens.</p>
        <div class="panel">
          <div class="amt num"><span id="amt">$900</span> <span class="of">spent of a $1,800 October budget</span></div>
          <label for="spend" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Amount spent this month</label>
          <input id="spend" type="range" min="0" max="2400" step="10" value="900">
          <div class="events">
            <button type="button" data-event="payday"><img src="/cat-v3-stock/png/payday.png" alt="">A friend pays you back</button>
            <button type="button" data-event="bill-shock"><img src="/cat-v3-stock/png/bill-shock.png" alt="">A $260 receipt lands</button>
            <button type="button" data-event="salute"><img src="/cat-v3-stock/png/celebrate.png" alt="">You hit a goal</button>
            <button type="button" data-event="love"><img src="/cat-v3-stock/png/love.png" alt="">You split dinner</button>
          </div>
        </div>
      </div>
      <div class="moodstage" id="moodstage">
        <div class="disc" id="disc"></div>
        <span class="ground"></span>
        <div class="moodlabel" id="moodlabel" aria-live="polite">Cool</div>
        <img class="moodcat" data-mood="cool" src="/cat-v3-stock/png/cool.png" alt="The cat in sunglasses, looking cool">
        <img class="moodcat" data-mood="hmm" src="/cat-v3-stock/png/hmm.png" alt="The cat thinking, paw on chin">
        <img class="moodcat" data-mood="over-budget" src="/cat-v3-stock/png/over-budget.png" alt="The cat grumpy with arms folded">
        <img class="moodcat" data-mood="out-of-cash" src="/cat-v3-stock/png/out-of-cash.png" alt="The cat holding an empty wallet">
        <img class="moodcat" data-mood="payday" src="/cat-v3-stock/png/payday.png" alt="The cat holding a fan of cash">
        <img class="moodcat" data-mood="bill-shock" src="/cat-v3-stock/png/bill-shock.png" alt="The cat shocked, paws on cheeks">
        <img class="moodcat" data-mood="salute" src="/cat-v3-stock/png/celebrate.png" alt="The cat cheering with a trophy">
        <img class="moodcat" data-mood="love" src="/cat-v3-stock/png/love.png" alt="The cat hugging a red heart">
        <div class="fx" id="fx"></div>
      </div>
    </div>
  </section>

  <section class="block" id="splits">
    <div class="wrap">
      <h2>Settle up without the awkward texts.</h2>
      <div class="duo">
        <article class="card">
          <img class="peek hopin" src="/cat-v3-stock/png/need-money.png" alt="">
          <h3>Who owes you</h3>
          <p>Split any receipt in two taps. Cotab keeps the running tab and sends the reminder.</p>
          <div class="people">
            <div class="person"><span class="face" style="background:#D6EFE2"><img src="/cat-v3-stock/png/cool.png" alt=""></span><span><b>Alex</b><small>Corner Market · today</small></span><span class="amt num">+$20.60</span></div>
            <div class="person"><span class="face" style="background:#FFE2EA"><img src="/cat-v3-stock/png/love.png" alt=""></span><span><b>Priya</b><small>Dinner at Nopa · Friday</small></span><span class="amt num">+$22.00</span></div>
            <div class="person"><span class="face" style="background:#DAECFB"><img src="/cat-v3-stock/png/salute.png" alt=""></span><span><b>Jordan</b><small>Concert tickets · 2 Oct</small></span><span class="amt num">+$35.00</span></div>
          </div>
          <div class="duos">
            <figure><img src="/cat-v3-stock/png/celebrate.png" alt="Tabby celebrating a settled tab"><figcaption>Settled up</figcaption></figure>
            <figure><img src="/cat-v3-stock/png/done.png" alt="Tabby marking a payment done"><figcaption>Payment confirmed</figcaption></figure>
            <figure><img src="/cat-v3-stock/png/remember.png" alt="Tabby remembering to send a nudge"><figcaption>Friendly nudge</figcaption></figure>
          </div>
        </article>
        <article class="card">
          <h3>Ask Tabby</h3>
          <p>Tabby has read every receipt, so just ask, in plain words.</p>
          <div class="chat">
            <div class="me">How much did I spend on coffee this month?</div>
            <div class="bot"><span class="face"><img src="/cat-v3-stock/png/hmm.png" alt=""></span><p><strong>$58.50</strong> across 9 visits. That's 32% more than September. Want a $40 monthly limit?</p></div>
            <span class="act">Set a $40 coffee budget</span>
          </div>
        </article>
      </div>
    </div>
  </section>

  <section class="final">
    <div class="wrap">
      <div class="box">
        <div>
          <h2>Let Tabby watch your spending.</h2>
          <p>Free to start. Scan your first receipt in under a minute.</p>
          <a class="btn btn-forest" href="/register">Get started free
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
        </div>
        <img class="salute hopin" src="/cat-v3-stock/png/celebrate.png" alt="Tabby cheering">
      </div>
    </div>
  </section>
</div>

<footer>
  <div class="wrap">
    <p class="sign">cotab</p>
    <div class="fine"><span>© 2026 Cotab</span><span>Tabby says hi. Made for people who lose receipts.</span><a href="/login">Sign in</a></div>
  </div>
</footer>

`;
