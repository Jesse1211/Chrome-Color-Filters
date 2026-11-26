# Attention Economy & Commerce: Color and Visual Salience as Deliberate Engagement Levers

> **Research date:** 2026-11-25. Every figure below is labeled with its own as-of date.
>
> **CRITICAL EPISTEMIC NOTE FOR THE REPORT WRITER:** This topic is unusually polluted with
> unsourced tech folklore, and the pollution gets *worse* the more specific the number looks.
> During this research, searches returned several extremely precise-sounding "RCT" results
> (e.g. "412 participants, 27.4% reduction over 6 weeks"; "217 users, 32% reduction, effects
> persisting at 6-month follow-up") that traced back to **content-farm / app-marketing domains**
> (`lifetips.alibaba.com`, `staygray.app`, `detox.so`, `habbitunlock.com`, `minulo.app`) selling
> grayscale or screen-time products. **I have deliberately excluded those numbers.** They do not
> appear in any journal and are almost certainly fabricated or garbled. Likewise the YouTube
> thumbnail CTR statistics (see §2.3) come overwhelmingly from vendors selling thumbnail tools.
> Please do not reintroduce such figures into the final report, however quotable they look.

---

## Q1: THE BUSINESS MODEL — how ad-supported attention businesses monetize time-on-app

### Takeaway
The monetization chain is directly documented in filings: Meta earned **$196.2B of advertising
revenue in FY2025 from 3.58B daily users**, and Alphabet's advertising revenue was reported at
**~$294.7B for FY2025**. The structural point is solid and primary-sourced — ad revenue scales with
impressions, which scale with time-on-app — but **"revenue per hour of attention" is not a metric
any company discloses**; any such figure in the final report must be flagged as a derived estimate.

### Cited Findings
- Meta FY2025 total revenue **$200.966B**; FY2025 advertising revenue **$196.175B**; Q4 2025 total
  revenue **$59.893B**, Q4 2025 advertising revenue **$58.137B** — [Meta Q4/FY2025 results press release, investor.atmeta.com (reported Jan 2026)](https://investor.atmeta.com/investor-news/press-release-details/2026/Meta-Reports-Fourth-Quarter-and-Full-Year-2025-Results/default.aspx)
- Meta **Family daily active people (DAP) = 3.58 billion** average for December 2025 — [Meta Q4/FY2025 results press release](https://investor.atmeta.com/investor-news/press-release-details/2026/Meta-Reports-Fourth-Quarter-and-Full-Year-2025-Results/default.aspx)
- Meta Q3 2025 **Family DAP = 3.54 billion** average for September 2025, +8% YoY — [Meta Q3 2025 results (Oct 2025), via SEC/IR reporting](https://www.sec.gov/Archives/edgar/data/1326801/000162828025047240/meta-20250930.htm)
- Meta Q3 2025 **Family average revenue per person (ARPP) = $14.46**, vs. a $14.08 analyst consensus.
  Note that Meta **renamed and re-based its per-user metric**: "Family average revenue per person
  (ARPP)" replaced the older "ARPU," and is computed as Family-of-Apps revenue for the quarter
  divided by the average of DAP at the start and end of that quarter — [Zacks/Yahoo Finance summary of Meta Q3 2025 key metrics (Oct 2025)](https://finance.yahoo.com/news/heres-key-metrics-tell-us-220002979.html)
- Alphabet **FY2025 Google advertising revenue ≈ $294.691B of $402.836B total revenue (~73.2%)** —
  [FourWeekMBA compilation of Alphabet FY2025 figures](https://fourweekmba.com/google-advertising-revenue/); primary filing is [Alphabet FY2025 Form 10-K, SEC EDGAR](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/goog-20251231.htm)
- **YouTube advertising revenue FY2025 ≈ $40.37B**, up 11.7% from $36.15B in FY2024; YouTube ads +
  subscriptions together exceeded **$60B** in 2025 — [FourWeekMBA / Alphabet FY2025 revenue breakdown](https://fourweekmba.com/google-revenue-breakdown/)
- **YouTube total daily watch time ≈ 1 billion hours/day** (long-standing company figure); UK regulator
  Ofcom measured **41 minutes/day** of in-home YouTube viewing per person aged 4+ in 2025 — [DigitalApplied YouTube statistics 2026 compilation](https://www.digitalapplied.com/blog/youtube-statistics-2026-platform-data-points)
- **TikTok: ~95 minutes/day per user globally (2025)**; US adults **52–55 minutes/day (2025)**;
  TikTok 2025 revenue **$33.6B** (+46.08% YoY); implied **~$17.42 annual revenue per MAU in 2025**,
  up from $13.88 in 2024 — [Backlinko TikTok statistics](https://backlinko.com/tiktok-users); [DemandSage TikTok user statistics](https://www.demandsage.com/tiktok-user-statistics/)

### Inferences
- Meta's own ARPP arithmetic makes the attention-to-revenue link explicit and auditable: **$196.2B
  advertising revenue ÷ ~3.58B daily users ≈ $55 of ad revenue per daily user for FY2025**. Each
  additional session is literally additional inventory.
- A crude "revenue per hour" can be derived (e.g. TikTok ~95 min/day × 365 ≈ 578 hours/user/year
  against ~$17.42 revenue/MAU implies roughly **$0.03/hour**), but the denominators come from
  different populations (DAU vs. MAU) and different sources, so such a number is **illustrative
  only, not a disclosed metric**. Recommend the report present it as an order-of-magnitude estimate
  with the arithmetic shown, or omit it.
- The low revenue-per-hour figure is itself the key commercial insight: because each hour is worth
  only cents, the business model requires **enormous aggregate volume**, which is precisely what
  creates the incentive to optimize every salience cue.

### Gaps
- **No company publishes "revenue per hour of attention."** Not in Meta's, Alphabet's or ByteDance's
  disclosures. Any such figure is third-party derived.
- Alphabet's exact FY2025 line items could not be read directly from the 10-K: WebFetch retrieved only
  the cover page / business description, not the Consolidated Statements of Income (Part II, Item 8).
  The $294.691B / $402.836B / $40.37B figures are from a secondary compilation and **should be
  re-verified against the filing's income statement** before publication.
- Meta's FY2025 (Q4) ARPP figure was not stated in the press release text retrieved; only Q3 2025's
  $14.46 was obtainable, and that via a secondary source rather than Meta's own release.
- ByteDance/TikTok is private; all TikTok revenue and ARPU figures are third-party estimates
  (Statista-derived chains), not audited disclosures.

---

## Q2: COLOR AS AN ENGAGEMENT LEVER — hard evidence

### Takeaway
The strongest *verified* evidence that color is deliberately revenue-optimized is the **Google
"41 shades of blue" test**, which has a genuine named primary source (Google UK MD Dan Cobley, quoted
in The Guardian) — **but the famous "$200M/year" figure is NOT traceable to Google and should be
treated as unconfirmed**. The Bing equivalent has a named Microsoft source. By contrast, the red-badge
A/B literature and the button-color CRO literature are **largely folklore**: I found no published
platform A/B test isolating badge color.

### 2.1 The "41 shades of blue" test — provenance, verified vs. unconfirmed

**VERIFIED (named source, direct quote):** Dan Cobley, then Google's UK Managing Director, described
the methodology on the record to The Guardian:

> "We ran '1%' experiments, showing 1% of users one blue, and another experiment showing 1% another
> blue. And actually, to make sure we covered all our bases, we ran forty other experiments showing
> all the shades of blue you could possibly imagine. And we saw which shades of blue people liked the
> most, demonstrated by how much they clicked on them. As a result we learned that a slightly purpler
> shade of blue was more conducive to clicking than a slightly greener shade of blue."

— Dan Cobley, quoted in The Guardian; reproduced in [Bambrick.com.au](https://bambrick.com.au/blog/google-increased-revenue-200-million-just-finding-perfect-shade-blue/) and widely elsewhere.

**Cited Findings**
- The test is generally dated to **2009**, run by a team under **Marissa Mayer** (then VP/head of
  product), comparing the differing blue link colors used in Gmail vs. Search — [Medium/Accredian write-up](https://medium.com/accredian/googles-41-shades-of-blue-a-b-testing-impact-185c6067f3c9); [cs4fn blog, QMUL](https://cs4fn.blog/2023/03/10/marissa-mayer-lemons-linking-41-shades-of-blue-a-b-testing/)
- **"41 shades" arises from Cobley's own wording** — 1 baseline + 40 further experiments — rather than
  from any Google statement naming the number 41 — [Cobley quote as above](https://bambrick.com.au/blog/google-increased-revenue-200-million-just-finding-perfect-shade-blue/)
- **The $200M figure is NOT attributable to Google.** A dedicated attempt to trace it found no original
  Google publication; the earliest documentation located was a third-party slide deck, *Metrics Driven
  Design* by Joshua Porter, which the investigator describes as "not entirely accurate" — [insights4print.ceo investigation (Feb 2022)](https://www.insights4print.ceo/2022/02/the-google-41-shades-of-blue-test-is-fundamentally-flawed/)
- The same investigation argues the test is **methodologically flawed as usually reported** because it
  did not control for **users' monitor calibration** — the "winning" shade is not reliably the shade
  users actually saw — [insights4print.ceo](https://www.insights4print.ceo/2022/02/the-google-41-shades-of-blue-test-is-fundamentally-flawed/)
- Sources **conflict on the date the $200M applies to**: some retellings attach it to the 2009 test,
  others claim Google "earned an additional $200 million in **2014**" from the blue change — a
  five-year discrepancy that is itself evidence the figure is folklore — [Bambrick](https://bambrick.com.au/blog/google-increased-revenue-200-million-just-finding-perfect-shade-blue/) vs. [Medium/Accredian](https://medium.com/accredian/googles-41-shades-of-blue-a-b-testing-impact-185c6067f3c9)
- A skeptical analysis published under the title **"Google's £200M A/B Test Cobblers"** disputes the
  claim — note it also **switches the currency to pounds**, another sign of uncontrolled retelling —
  [webtorque.org](https://webtorque.org/googles-200m-ab-test-cobblers/)
- Scale context: against Google's then search-advertising revenue of **$22.89B**, $200M is **<1%** —
  i.e. even if true, the figure is a plausible-magnitude optimization, not a transformative one —
  [insights4print.ceo](https://www.insights4print.ceo/2022/02/the-google-41-shades-of-blue-test-is-fundamentally-flawed/)
- Related and separately sourced: Google was publicly **testing changing result links from blue to
  black** in 2016 — independent confirmation that link color remains an actively tested revenue
  surface — [Christian Science Monitor (May 2016)](https://www.csmonitor.com/Technology/2016/0510/Google-tests-turning-search-results-from-blue-to-black); [Fortune (May 2016)](https://fortune.com/2016/05/09/google-search-results-links)

### 2.2 The Bing blue-shade test — better attributed than Google's
- **Paul Ray, a user-experience manager for Bing**, stated that choosing the blue **#0044CC** over
  other hues was worth an additional **~$80M/year** in revenue, counting added ad clicks and
  engagement; the claim originates in a **2010 MIX10 conference presentation** — [Forbes/Xerox BrandVoice, "Finding The Right Shade Of Blue Can Be Worth $80 Million" (Sept 2013)](https://www.forbes.com/sites/xerox/2013/09/11/finding-colors-that-sell/); discussed as "Behind Bing's Blue Links" via [WebmasterWorld thread](https://www.webmasterworld.com/msn_microsoft_search/4099702.htm)
- Some retellings widen the figure to **"$80m to $100m a year"** — minor drift, but drift — [iamchrisnunn.com](https://iamchrisnunn.com/how-a-small-design-tweak-led-to-80-million/)

**Inference:** The Bing claim is in some ways the *better* citation for the report's thesis: it has a
**named Microsoft employee, a specific hex value, a dated venue**, and a stated mechanism. Google's
has a named executive for the *method* but an orphan number for the *result*. The report should lead
with Cobley's quote (for intent) and Ray's claim (for magnitude), and explicitly retire the
"Google made $200M from blue" formulation as unverified.

### 2.3 The red notification badge
- **Mechanism/origin:** icon badges date to the original iPhone; **Apple Push Notification service
  (iPhone OS 3.0, 2009)** made the red number **remotely controllable by an app's servers at any
  moment** — the architectural change that turned a static count into a push-driven attention lever —
  [Medium, "Why Are Notification Badges Almost Always Red?"](https://medium.com/@deferare/why-are-notification-badges-almost-always-red-259dc7e6ec83)
- Red is used because it **combines high chromatic salience with a learned urgency/warning
  association**, stacking color salience + a disambiguating numeral + a peripherally detectable shape —
  [aimlessscrolling.com analysis](https://aimlessscrolling.com/notifications-and-the-lock-screen/the-red-badge-and-your-brain/); [keyphone.tech](https://keyphone.tech/latest-news/why-red-notification-badges-are-hard-to-ignore)

**Gaps — important:**
- **I found no published, credibly sourced A/B test isolating badge *color*** (red vs. grey vs. blue vs.
  none) from any platform. Search results asserting that "in large-scale UX experiments" a red "1"
  badge "dramatically increased" first-click probability came from **blog/SEO sources with no
  underlying citation**, and I could not locate a primary study or insider account behind them. The
  report should state plainly that the red badge's efficacy is **near-universally assumed and
  convergently adopted across platforms, but not publicly evidenced by a disclosed experiment.**
- No insider testimony specifically about badge-color A/B testing was found (unlike the Like button
  and infinite scroll, which do have insider accounts — see Q3).

### 2.4 Thumbnail / preview design (YouTube, TikTok)
**Takeaway: the available numbers here are commercially motivated and should not be reported as
research.** Every quantitative thumbnail-CTR claim I found came from **companies selling thumbnail
creation, testing, or analytics tools**.

- Claims encountered, **all vendor-sourced and unverifiable**: contrast "accounting for 73% of CTR
  performance variance"; high-contrast (WCAG ≥7:1) thumbnails averaging 6.5% CTR vs. 4.7% below 4:1
  ("+38% lift"); "bright, saturated color backgrounds +8–14% CTR vs. muted/dark"; "yellow on black
  11.2% CTR"; an aggregate "CTRpilot study" of 3,200+ thumbnails and 127 A/B tests — [thumbnailcreator.com](https://www.thumbnailcreator.com/blog/color-choices-boost-thumbnail-ctr); [tubeanalytics.net](https://www.tubeanalytics.net/resources/research/thumbnail-ctr-patterns-study-2026); [mer.vin](https://mer.vin/2026/09/youtube-thumbnail-ctr-for-song-videos-what-3200-thumbnails-teach-us/)
- Qualitative claim that is uncontroversial and safe to assert: saturated, vivid colors are noticed
  faster than muted/grey tones **within a feed where competing thumbnails are themselves vivid** —
  i.e. salience is positional/competitive, an arms race rather than an absolute property —
  [thumbnailcreator.com](https://www.thumbnailcreator.com/blog/color-choices-boost-thumbnail-ctr)

**Gaps:**
- **I found no official YouTube or TikTok platform guidance document, and no peer-reviewed study,**
  quantifying a saturation/contrast → CTR relationship. YouTube Creator Academy–style guidance on
  "high-contrast, well-lit thumbnails" is widely paraphrased but I could not retrieve the primary
  page. This is a genuine hole; the report should either cite platform documentation directly (needs
  further research) or confine itself to the qualitative claim.
- The "arms race" dynamic is an **inference**, not a measured finding.

### 2.5 Button-color CRO literature — honestly, this is weak
- The $80M Bing blue claim has been **absorbed into CRO marketing content** under headlines such as
  "One 'Unbelievable' Call-to-Action Color Makes $80 Million," illustrating how a single UX anecdote
  becomes generalized sales copy — [shockmarketer.com](https://www.shockmarketer.com/call-to-action-color/)

**Gaps / honest assessment:**
- The classic "red button beat green by 21%" CRO result (the widely circulated HubSpot/Performable
  test) **did not surface in these searches** and I did not verify it. The report should note that
  such single-site A/B results are **context-dependent, rarely replicated, usually underpowered, and
  not generalizable to "red converts better"** — the effect in those tests is plausibly about
  *contrast against the surrounding page*, not about the hue itself. I did not find a meta-analysis or
  replication study of button color; absent one, the report should characterize this literature as
  **folklore with weak evidentiary standing**, consistent with the research brief's own caution.

---

## Q3: INSIDER TESTIMONY

### Takeaway
Insider testimony is the **strongest-sourced part of this topic**: multiple named senior figures have
stated on the record that engagement mechanics were built deliberately to exploit psychology. Harris
specifically and repeatedly advocates grayscale. Note, however, that the insiders' confessions concern
**dopamine loops, likes, and infinite scroll — not color A/B testing**; Harris's grayscale advocacy is
a *remedy* he proposes, not an admission that he ran color experiments.

### Cited Findings

**Tristan Harris (ex-Google design ethicist; Center for Humane Technology) — grayscale advocacy**
- Harris's stated rationale, in his own words: "This step is going to make my phone seem a little less
  appealing, a little less addictive"; "If you leave it in black and white for just long enough, you'll
  start to get used to it, and then color will feel overwhelming"; "Instagram and Snapchat are going to
  be a lot less appealing in black and white than they are in technicolor" — [Boing Boing (Jan 2018)](https://boingboing.net/2018/01/17/googles-former-design-ethici.html); [Scripps News](https://www.scrippsnews.com/science-and-tech/take-control-of-your-smartphone-by-going-grayscale)
- On the involuntariness of the color response: "you get to see the difference between what's the
  difference when I look at my phone and all those colors light up my brain? **I didn't choose for
  those colors to light up my brain. It just did that.** When it's gray... I feel a little bit calmer."
  — [NPR, TED Radio Hour transcript](https://www.npr.org/transcripts/614075065)
- Harris is the founder of the Center for Humane Technology and a former Google design ethicist —
  [Wikipedia: Tristan Harris](https://en.wikipedia.org/wiki/Tristan_Harris); [Connecticut Public (Feb 2018)](https://www.ctpublic.org/2018-02-06/former-google-executive-warns-smartphones-keep-us-hooked)

**Sean Parker (founding president of Facebook)** — at an Axios event in Philadelphia, November 2017:
- "That means that we needed to sort of give you a little **dopamine hit** every once in a while because
  someone liked or commented on a photo or a post or whatever... It's a **social validation feedback
  loop**... You're **exploiting a vulnerability in human psychology**."
- "The inventors, creators — it's me, it's Mark [Zuckerberg], it's Kevin Systrom on Instagram, it's all
  of these people — **understood this consciously. And we did it anyway.**"
- He also called the premise "exactly the kind of thing that a hacker like myself would come up with."
  — [Axios (Nov 2017)](https://www.axios.com/2017/12/15/sean-parker-facebook-was-designed-to-exploit-human-vulnerability-1513306782); [CNBC (Nov 9, 2017)](https://www.cnbc.com/2017/11/09/facebooks-sean-parker-on-social-media.html); [ABC News Australia](https://www.abc.net.au/news/2017-11-10/facebook-exploits-human-weakness-ex-president-says/9140052)

**Chamath Palihapitiya (Facebook VP of User Growth, 2005–2011)** — Stanford GSB "View From The Top,"
November 2017:
- "The **short-term, dopamine-driven feedback loops** we've created are destroying how society works."
- "We have created tools that are **ripping apart the social fabric** of how society works."
- "No civil discourse, no cooperation; misinformation, mistruth. And it's not an American problem —
  this is not about Russian ads. This is a global problem."
- He reported feeling "tremendous guilt" and said he does not use social media because he doesn't want
  to be "programmed" — [Gizmodo](https://gizmodo.com/former-facebook-exec-you-don-t-realize-it-but-you-are-1821181133); [Quartz](https://qz.com/1153007/former-facebook-executive-chamath-palihapitiya-you-dont-realize-it-but-you-are-being-programmed); [Stanford GSB Insights (Dec 12, 2017)](https://www.gsb.stanford.edu/insights/chamath-palihapitiya-why-failing-fast-fails)

**Aza Raskin (inventor of infinite scroll, 2006; co-founder, Center for Humane Technology)**
- Raskin invented infinite scroll in 2006 to remove "next page" clicking; he told **BBC Panorama in
  July 2018** that he did not set out to addict people and now feels guilty — [Wikipedia: Infinite scrolling](https://en.wikipedia.org/wiki/Infinite_scrolling); [dam-it.io history of infinite scroll](https://dam-it.io/guides/infinite-scroll-history)
- Mechanism in his own framing: "**if you don't give your brain time to catch up with your impulses,
  you just keep scrolling**" — [dam-it.io](https://dam-it.io/guides/infinite-scroll-history)
- On his own professional ideology: "I used to believe that my job as a designer was **optimizing for
  ease of use. That was myopic.** It can lead to dire consequences." — [Aza Raskin on X/Twitter (June 2021)](https://x.com/aza/status/1405007568255078402)
- "I regret it: the founder of infinite scroll was blind to how it would be used" — he describes being
  "blind to the way that all of his best intentions were sort of irrelevant in the face of this machine
  with an incentive now to capture human attention," estimating **~half a million human lifetimes are
  wasted every month scrolling** — [Masters of Scale](https://mastersofscale.com/video/he-invented-infinite-scroll-and-says-he-regrets-it/)

### Inferences
- The insider corpus establishes **intent and mechanism** (variable reward, social validation, removal
  of stopping cues) with named, on-the-record sources. It does **not** establish that *color
  saturation* was specifically engineered for engagement. The report must not blur these: the color
  case rests on the Google/Bing A/B evidence (§2.1–2.2), while the insider case rests on reward loops.
- Harris's grayscale advocacy functions as the **bridge** between the two bodies of evidence: an
  insider identifying color salience as part of the hijacking mechanism and prescribing its removal.
- Palihapitiya's and Parker's remarks cluster in **Nov–Dec 2017**, which is when the "tech insider
  regret" genre crystallized into public discourse — useful framing for a historical narrative.

### Gaps
- **Nir Eyal:** I did not research his *Hooked* (2014) / *Indistractable* (2019) positions in this
  pass and have **no verified quotes** for him. Notably, Eyal is a *dissenter* from the "tech
  addiction" framing and has publicly criticized Harris-style arguments — the report should not
  assume he is part of the confessional chorus. **Needs dedicated research.**
- **Justin Rosenstein on the Like button:** not verified in this pass. His widely cited remarks (to
  The Guardian, Oct 2017, on "bright dings of pseudo-pleasure" and his own use of restriction tools)
  were **not retrieved or confirmed here.** Do not report without verification.
- No insider has, to my knowledge, testified specifically about **color or badge A/B testing** as an
  engagement lever.

---

## Q4: THE GRAYSCALE COUNTERMOVEMENT — what actually shipped

### Takeaway
Both major mobile OSes shipped grayscale, but **asymmetrically scoped**: Google put grayscale inside
**Bedtime mode** (time-boxed to sleep, 2018/2020) and as a **pre-timeout warning** for app timers,
while Apple ships it only as an **Accessibility Color Filter** — never framed as a wellbeing feature.
Neither ships an always-on, default-on, or app-specific "make this boring" mode. **No adoption-rate
data exists publicly.**

### Cited Findings

**Android / Google**
- Grayscale arrived via Google's broader **Digital Wellbeing** effort in **2018**, originally as
  **"Wind Down"** — [Zapier, "The quiet brilliance of Bedtime Mode on Android"](https://zapier.com/blog/bedtime-mode-android/); [Android Authority](https://www.androidauthority.com/android-feature-grayscale-bedtime-mode-3492944/)
- **Wind Down was renamed "Bedtime mode"** in a Digital Wellbeing update reported **April 21, 2020**;
  Bedtime mode bundles **grayscale, Night Light, and Do Not Disturb** — [9to5Google (Apr 21, 2020)](https://9to5google.com/2020/04/21/google-digital-wellbeing-bedtime-mode/); [Android Community (Apr 23, 2020)](https://androidcommunity.com/digital-wellbeing-wind-down-mode-renamed-to-bedtime-mode-20200423/)
- **July 2020:** Digital Wellbeing added a mechanic where apps **fade to grayscale shortly before an
  app timer expires** — i.e. desaturation used explicitly as a *disengagement* signal — [Android Police (Jul 27, 2020)](https://www.androidpolice.com/2020/07/27/digital-wellbeing-switches-apps-to-grayscale-before-they-time-out/)
- **Android 11 (Aug 2020):** Bedtime mode gained the ability to disable always-on display at night —
  [9to5Google (Aug 20, 2020)](https://9to5google.com/2020/08/20/android-11-bedtime-mode-aod-off/)
- **Android 13 (mid-2022):** Bedtime mode redesigned, adding "Dim the wallpaper" — [9to5Google (Aug 5, 2022)](https://9to5google.com/2022/08/05/android-13-bedtime-mode/)
- Samsung ships its own Digital Wellbeing implementation on Galaxy devices — [Samsung support](https://www.samsung.com/us/support/answer/ANS10001357/)

**iOS / Apple**
- Grayscale on iOS lives at **Settings → Accessibility → Display & Text Size → Color Filters →
  Grayscale** (with an Intensity slider) — an **accessibility** feature, *not* part of Screen Time
  or any wellbeing surface — [TechWiser](https://techwiser.com/ways-to-turn-grayscale-on-or-off-on-iphone/); [Vox Silva](https://blog.alexbeals.com/posts/make-your-phone-grayscale)
- Users can bind it to **Settings → Accessibility → Accessibility Shortcut** for a **triple-click** of
  the side button, or to **Back Tap** (double/triple tap on the device back) — [TechWiser](https://techwiser.com/ways-to-turn-grayscale-on-or-off-on-iphone/)

### Inferences
- **The asymmetry is the finding.** Google scoped grayscale to contexts where reduced engagement is
  commercially harmless (asleep; timer already expiring). Apple — which does not primarily monetize
  attention — nonetheless never promoted grayscale as a wellbeing tool, leaving it in accessibility.
  Neither offers per-app desaturation, scheduled grayscale outside bedtime, or any default-on variant.
- Android's "fade to grayscale before timeout" is **implicit platform acknowledgement that
  desaturation reduces app appeal** — arguably the closest thing to a platform admission that color
  drives engagement, and a strong exhibit for the report.
- Tim Ferriss's role in popularizing grayscale (named in the brief) was **not verified**; Harris is the
  documented originator of the advocacy.

### Gaps
- **No adoption-rate data whatsoever.** I found no figures from Apple or Google on how many users
  enable grayscale, Bedtime mode, Color Filters, Screen Time limits, or app timers. Neither company
  publishes this, and I found no credible third-party panel estimate. This is a hard gap — the report
  should state it rather than estimate.
- Tim Ferriss's and the broader "dumbphone"/digital-minimalism movement's specific contributions to
  grayscale advocacy were not verified in this pass (Cal Newport's *Digital Minimalism* was not
  researched).
- Exact iOS version that introduced Color Filters (believed iOS 10, 2016) was **not confirmed**;
  retrieved sources were how-to guides without version history. Needs verification.

---

## Q5: PLATFORM INCENTIVE ASYMMETRY — did anyone ship a true "make this app boring" mode?

### Takeaway
**No.** No platform ships a mode that makes its own revenue-generating surfaces systematically less
appealing. The academic critique — strongest in a CHI '22 paper — is that digital wellbeing has been
constructed as **individual responsibility**, which structurally exempts platform design and business
models from scrutiny.

### Cited Findings
- The leading academic critique is **Docherty & Biega, "(Re)Politicizing Digital Well-Being: Beyond
  User Engagements," CHI 2022**. Core arguments: digital wellbeing is "chiefly characterised as a
  matter of **personal responsibility**"; the authors identify "the empirical, ideological, and
  political limits of this individualized perspective"; they **"problematize user engagement as a
  universal proxy for well-being"**; and they locate the determinants of wellbeing "in environing
  social, cultural, and political conditions **far beyond the control of individual users alone**" —
  [arXiv:2203.08199](https://arxiv.org/abs/2203.08199); [ACM DL full text](https://dl.acm.org/doi/fullHtml/10.1145/3491102.3501857); [White Rose eprint PDF](https://eprints.whiterose.ac.uk/id/eprint/190980/1/3491102.3501857.pdf)
- The same authors argue digital experience reflects "**(capitalist) relations of power**" embedded in
  platform design, and call for tools that let users **critique** "the extractive operations of the
  attention economy" rather than merely self-monitor — [arXiv:2203.08199](https://arxiv.org/abs/2203.08199)
- Broader framing of the structural problem is available in legal/policy commentary on "the attention
  economy and the collapse of cognitive autonomy" — [Georgetown Law, Denny Center](https://www.law.georgetown.edu/denny-center/blog/the-attention-economy/)
- Evidence of the asymmetry in practice: **Apple did not respond to questions about whether it has any
  evidence that Screen Time helps people reduce phone time** — [Marketplace (Aug 19, 2024)](https://www.marketplace.org/episode/2024/08/19/not-all-screen-time-is-created-equal)

### Inferences
- The clearest structural evidence for incentive asymmetry is **what wellbeing tools measure vs. what
  they change**: they overwhelmingly provide *dashboards, timers and reminders* (self-monitoring,
  easily dismissed) and never *alter the engagement mechanics* — no feed desaturation, no removal of
  infinite scroll, no badge suppression by default. Grayscale's confinement to Bedtime mode (Q4) is
  the concrete instance.
- Android's pre-timeout grayscale is the **exception that proves the rule**: the one place a platform
  deployed desaturation against engagement, it was gated behind a limit the user had already
  self-imposed and about to hit anyway.
- The "ethical theater" framing in the research brief is **conceptually supported** by Docherty &
  Biega's individualization critique, but note: **that exact phrase does not appear** in the retrieved
  literature. Use the authors' own language ("individualized perspective," "personal responsibility")
  rather than attributing "ethical theater" to them.

### Gaps
- I did not locate a paper using the specific term **"ethical theater"** for digital wellbeing
  features. If the report wants that phrase it must be presented as the report's own characterization.
- No internal platform documents, leaks, or insider accounts were found regarding deliberate weakening
  of wellbeing features — the asymmetry argument rests on **observable feature scoping plus academic
  critique**, which is inference, not documented intent.

---

## Q6: EFFECTIVENESS of screen-time tools and grayscale interventions

### Takeaway
Honestly: **weak and mixed for screen-time dashboards; modest but more consistent for grayscale.**
The best-supported finding is that **self-monitoring tools raise awareness without reducing use.**
Digital self-control tools show only a **small-to-medium** pooled effect. Grayscale has several real
peer-reviewed studies showing **~22–50 minutes/day** reductions, but with small samples and short
durations.

### Cited Findings — screen-time tools
- **"Your Screen-Time App Is Keeping Track": a longitudinal field study (N=242) found screen-time
  tracking improves digital self-awareness but is less likely to lead to a reduction of mobile
  usage.** Published in the *Journal of the Association for Consumer Research* — the title itself is
  "Consumers Are Happy to Monitor but Unlikely to Reduce Smartphone Usage" — [University of Chicago Press / JACR](https://www.journals.uchicago.edu/doi/abs/10.1086/714365)
- A **systematic review and meta-analysis of digital self-control tools** concluded they have a
  **"small to medium effect"** on reducing time spent on distracting technology — [Roffarello & De Russis, ACM TOCHI (2023), "Achieving Digital Wellbeing Through Digital Self-control Tools"](https://dl.acm.org/doi/10.1145/3571810) *(note: ACM DL returned HTTP 403 on direct fetch; effect-size characterization is from the search abstract, and the exact pooled effect size could not be read — see Gaps)*
- A **multimethod evaluation of apps designed to reduce mobile phone use** found mixed results, with
  some interventions reducing use of *specific* apps (reported as ~36.8% for certain apps) while **not
  substantially reducing overall phone use** — [JMIR (2023), full PDF](https://www.jmir.org/2023/1/e42541/PDF)
- Experimental economics work on **"soft commitment devices"** for smartphone self-control —
  [Hoong, *European Economic Review* (2021)](https://www.sciencedirect.com/science/article/abs/pii/S0014292121002269)
- **School-based interventions** (systematic review + meta-analysis, *Journal of Behavioral
  Addictions*, 2025): effective at reducing **problematic** digital technology use but **less
  effective at reducing screen time** itself; interventions that were externally led, involved
  parents, targeted at-risk youth, or were therapy-based performed better — [PMC12231446](https://pmc.ncbi.nlm.nih.gov/articles/PMC12231446/); [Akjournals, JBA vol 14 issue 2 (2025)](https://www.akjournals.com/view/journals/2006/14/2/article-p571.xml)
- Children's screen-time interventions: **duration matters** — those lasting **beyond 3 months clearly
  outperformed shorter ones** — [PMC8447784](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8447784/)
- A 2026 RCT of a mobile intervention app (Wellspent) for self-regulated social media use —
  [JMIR mHealth and uHealth (2026)](https://mhealth.jmir.org/2026/1/e56824/)

### Cited Findings — grayscale specifically (peer-reviewed only)
- **Holte & Ferraro (2020), "True colors: Grayscale setting reduces screen time in college students,"
  *The Social Science Journal*:** 73 college students enabled grayscale on iPhones for one week;
  screen time fell by **~38 minutes/day** on average. Reductions appeared in **internet browsing and
  social media**, but — notably — **no reduction was found in video screen time** — [ResearchGate record](https://www.researchgate.net/publication/340421051_True_colors_Grayscale_setting_reduces_screen_time_in_college_students); [secondary summary](https://www.alignmateapp.com/blog/does-grayscale-reduce-screen-time)
- **Dekker & Baumgartner (2024), "Is life brighter when your phone is not? The efficacy of a grayscale
  smartphone intervention addressing digital well-being," *Mobile Media & Communication*** —
  [SAGE Journals](https://journals.sagepub.com/doi/10.1177/20501579231212062) *(direct fetch returned HTTP 403; sample size and effect sizes not retrieved — see Gaps)*
- **Holte, Giesen & Ferraro, "Color me calm: Grayscale phone setting reduces anxiety and problematic
  smartphone use," *Current Psychology* (2021)** — [Springer](https://link.springer.com/article/10.1007/s12144-021-02020-y)
- **Across prior research, grayscale for ≥1 week produced significantly less objectively assessed
  screen time, "ranging from 22 to 50 min less per day"** — this range is the most defensible summary
  statistic available — [as summarized via grayscale study literature](https://www.alignmateapp.com/blog/does-grayscale-reduce-screen-time)
- An intervention **"utilizing the salience principle"** to reduce pharmacy students' psychological
  attraction to smartphones — relevant mechanistic framing (salience reduction) — [PMC10159421](https://pmc.ncbi.nlm.nih.gov/articles/PMC10159421/)
- A university research group (Univ. of Warsaw) ran a dedicated grayscale study, "Gray(t)!" —
  [study page](https://sites.google.com/student.uw.edu.pl/grayscale/english/about-study)

### Inferences
- The pattern across both literatures is coherent and worth stating as the report's honest bottom
  line: **interventions that change the *interface* (grayscale — reducing salience) outperform
  interventions that merely *inform* the user (dashboards, counters).** This is exactly the opposite
  of the emphasis platforms chose, which is the incentive-asymmetry argument in empirical form.
- Holte & Ferraro's **null result for video** is the most analytically interesting detail: grayscale
  appears to blunt *browsing//scrolling driven by visual salience* while leaving *narrative/content-
  driven* consumption intact. This supports a salience mechanism rather than a general "phone is less
  fun" mechanism, and is a genuinely useful nuance for a report on grayscale.
- Effect sizes should be reported with their caveats: small samples (n=73), short durations (1 week),
  self-selected/student populations, and inability to blind participants.

### Gaps
- **Could not retrieve exact pooled effect sizes** from the ACM TOCHI meta-analysis (403) or the
  Dekker & Baumgartner study (403). The "small to medium" characterization is from abstract-level
  search output. **Both should be obtained via institutional access before the report quotes numbers.**
- The "22 to 50 min/day" range is cited via a secondary summary that attributes it to prior
  literature; the underlying primary studies should be enumerated.
- **I found no long-term (>6 month) grayscale study and no large-sample (n>500) grayscale RCT.** The
  precise-sounding large-N grayscale "RCTs" returned by search were content-farm fabrications (see the
  note at the top of this file) and are excluded.
- No evidence found on whether grayscale effects **persist after the intervention ends** or decay
  through habituation — a notable open question given Harris's own claim that users "get used to it."

---

## Q7: MARKET CONTEXT — digital wellbeing market, grayscale niche, dumbphones

### Takeaway
Market-sizing here is **low-quality evidence**: estimates come from commercial market-research
publishers whose methodologies are not public and whose figures disagree by an order of magnitude
depending on category definition. The dumbphone "revival" is real directionally but the specific
growth percentages are unreliable.

### Cited Findings
- **Digital Wellbeing Platforms market:** $6.4B in 2025, ~19.6% CAGR, projected $15.3B by 2033 —
  [HTF Market Insights](https://www.htfmarketinsights.com/report/4402477-digital-wellbeing-platforms-market)
- **Digital Detox Apps market:** $0.98B in 2025, projected $7.81B by 2035 (23.4% CAGR) —
  [InsightAce Analytic](https://www.insightaceanalytic.com/report/digital-detox-apps-market/3645)
- **Wellness Management Apps (much broader category):** $26.03B in 2025 → ~$80.85B by 2035 —
  [Precedence Research](https://www.precedenceresearch.com/wellness-management-apps-market)
- **Feature phone market revenue 2025: $2,405.28M**, with a stated CAGR of 2.30% (2024–2031) — note
  this low CAGR **contradicts the "surge" narrative below** — [via market research compilation](https://www.accio.com/business/dumbphones)
- **Dumbphone sales reportedly rose ~25% in 2025**, attributed to affordability and anti-addiction
  sentiment — [WebProNews (2026)](https://www.webpronews.com/dumbphones-surge-in-2026-boosting-focus-amid-digital-overload/); [ShelfTrend](https://www.shelftrend.com/electronics/privacy-focused-mobile-phones-market-analysis-seller-profit-guide-2026)
- A claim that **"analysts predict dumbphones could capture 10% of the global mobile market by
  mid-2026, up from 5% in 2024"** — [WebProNews](https://www.webpronews.com/dumbphones-surge-in-2026-boosting-focus-amid-digital-overload/) — **treat as implausible/unreliable; see Inferences**
- **HMD Global (Nokia brand) reported an uptick in US feature-phone sales**; notable models include
  the Nokia 2780 Flip and the HMD Barbie Phone; HMD plans new Series 30+ devices from 2026 — and,
  ironically, is **adding an AI chatbot ("Sikey AI") and a social app ("Xpress Chat")** to them —
  [Wikipedia: Series 30+](https://en.wikipedia.org/wiki/Series_30%2B); [Accio](https://www.accio.com/business/dumbphones)

### Inferences
- The **"10% of the global mobile market by mid-2026"** claim is almost certainly false or badly
  garbled: it is irreconcilable with a total feature-phone market of ~$2.4B against a global
  smartphone market in the hundreds of billions. It may conflate unit share in specific emerging
  markets with global share. **Recommend the report either omit it or explicitly flag it as dubious.**
- The feature-phone market's **2.30% CAGR directly conflicts with the "+25% in 2025" surge claim**.
  The most defensible statement is that dumbphones are a **culturally salient but commercially tiny
  niche**, with genuine interest among specific cohorts (Gen Z digital-minimalism) that has not
  materially dented smartphone dominance.
- HMD adding a chatbot and a social app to its feature phones is a **sharp illustration of the
  attention economy's gravitational pull**: even the anti-engagement product category is drifting back
  toward engagement features. Good closing detail for the report.

### Gaps
- **No reliable sizing of the grayscale/minimalist-launcher niche specifically.** No download or
  revenue figures located for the main products (e.g. Olauncher, Blank Spaces, Minimalist Phone,
  unpluq, Dumbify). Market-research reports do not break this out as a category.
- All market figures are from **commercial research publishers with undisclosed methodology**, not
  from Sensor Tower / data.ai / eMarketer primary panels (which are paywalled and were not accessible
  here). Confidence is low throughout this section.
- No independent verification (e.g. Counterpoint, IDC, Canalys shipment data) of the dumbphone sales
  trend was obtainable; the +25% figure traces only to secondary trade-press/SEO sources.
