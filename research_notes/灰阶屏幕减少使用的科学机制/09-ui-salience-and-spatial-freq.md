# UI Salience Targeting and the Spatial-Frequency Arithmetic of UI Elements

Scope: two unverified assertions from a draft report. (1) "screens are designed precisely
to target this [colour valuation] system". (2) "below 0.5 cycles/degree is exactly the
spatial scale of icons, badges and thumbnails."

**Headline verdicts, up front:**

- Claim 1 — **PARTIALLY SUPPORTED [MODERATE]**. Deliberate, documented targeting of the
  human colour/attention system is *overwhelmingly* established for *visual hierarchy and
  emphasis* (vendor guidelines say so in plain words). Deliberate targeting in the sense
  of *maximising engagement / attention capture against the user's interest* is documented
  only for specific choice-steering contexts (dark patterns, advertising), **not** as a
  general documented practice, and I found **no** source showing designers reason about a
  "colour valuation system" (reward/valuation neuroscience) at all.
- Claim 2 — **FALSE [ROBUST]**. The arithmetic refutes it. Badges, icons and feed
  thumbnails sit at roughly **0.3–2.3 c/deg**, i.e. *above* 0.5 c/deg, mostly well above.
  Only *large* uniform colour areas (full-width images, screen-scale colour fields) fall
  below 0.5 c/deg. The user's own estimate (24 px badge ≈ 1.4°) is also wrong, but in the
  opposite direction — it implies an ~83 ppi screen; see §2.4.

---

## Q1: Is the targeting of the human colour/salience system deliberate and documented?

### Takeaway

Platform vendor guidelines **explicitly and in plain language** instruct designers to use
colour to draw attention and create emphasis — this part is not inference, it is quotable
text. But the documented *purpose* in that literature is usability and visual hierarchy.
The separate claim that designers deliberately exploit colour to *maximise engagement* is
documented only in the narrower dark-patterns and advertising literatures, where colour is
one named technique among many ("Visual Interference", "aesthetic manipulation") and where
it is the **least-measured** of the mechanisms. No source frames this in terms of a
colour-specific valuation/reward system.

### Cited Findings

**Vendor design guidance — explicit attention-capture language [ROBUST]**

- Material Design, colour usage: "When an element's color contrasts with its surroundings,
  that element stands out, so users can tell it's important."; "To bring attention to
  important events, use stronger color contrasts between elements."; "By limiting the use
  of color in your app, the areas that do receive color gain more attention, such as text,
  images, and individual elements like buttons." — [Material Design, Color usage (mirror)](https://mdc.almoamen.net/color/color-usage)
- Material Design 3 defines colour roles by **emphasis tier**: "high emphasis, medium
  emphasis, and low emphasis"; primary roles are "for important actions and elements
  needing the most emphasis", secondary roles "for elements that don't need immediate
  attention". Colour *weight* (saturation) is described as conferring "greater visual
  weight". — [Material Design 3, Color roles](https://m3.material.io/styles/color/roles)
  (note: m3.material.io is JS-rendered and was not directly fetchable; this is from search
  summaries + the mirrored MDC text above, so treat exact wording as [MODERATE])
- Apple HIG, Color: "Use color sparingly in nongame apps… overuse of color can make
  communication less clear and can be distracting. Prefer using touches of color to call
  attention to important information or show the relationship between parts of the
  interface." — [Apple HIG, Color](https://developer.apple.com/design/human-interface-guidelines/color)
  (page is JS-rendered; not directly fetchable, wording from search extraction → [MODERATE])
- Apple HIG, on prominent buttons: "To draw people's attention to a specific button, use a
  prominent button style so the system can apply an accent color to the button's
  background." — [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/color) [MODERATE]
- Apple HIG, on badges specifically: "Use a badge to indicate that critical information is
  available… a red oval containing white text and either a number or an exclamation point…
  to indicate that there's new or updated information in the section that warrants a
  person's attention." — [Apple HIG, Tab bars (mirror)](https://github.com/valentinllpz/apple-human-interface-guidelines/blob/main/references/tab-bars.md) [MODERATE]
  → This is the single most on-point quote for the report: the red notification badge is
  *documented by the vendor* as an attention device, and its colour (red) is specified.

**HCI / visualisation literature — preattentive colour popout [ROBUST]**

- Colin Ware, *Information Visualization: Perception for Design*, treats colour as one of
  four preattentive channels (colour, form, movement, spatial position) and states that
  choosing these attributes well "is the most significant thing that can be done to
  utilize the science of vision to improve information visualization"; "popout" is
  described as a preattentive effect that "makes it easy to draw the user's attention to
  the critical elements", and "large color differences have more popout than small ones."
  — [Information Visualization, 4th ed.](https://shop.elsevier.com/books/information-visualization/ware/978-0-12-812875-6);
  text extracts via [a full-text mirror](https://dokumen.pub/information-visualization-perception-for-design-4nbsped-0128128755-9780128128756.html) [MODERATE on exact wording, ROBUST on substance]
  → Caveat for the report: Ware's framing is explicitly *pro-user* — design the display so
  the user finds what the user is looking for. It is evidence of deliberate targeting of
  the visual attention system, **not** of adversarial engagement maximisation.

**Computational saliency applied commercially [MODERATE]**

- The Itti–Koch saliency-map model has been applied to "the objective evaluation of
  advertising designs", with the Saliency Toolbox Matlab implementation used as the
  interface to the model, validated against infrared eye-tracking fixation frequencies. —
  [Models of Bottom-Up Attention and Saliency, Itti (2005)](http://ilab.usc.edu/publications/doc/Itti05noa.pdf);
  [Advertisement evaluation using visual saliency based on foveated image](https://www.researchgate.net/publication/221264480_Advertisement_evaluation_using_visual_saliency_based_on_foveated_image)
- Saliency prediction has a named applied sub-literature for advertising —
  [Saliency Prediction for Visual Regions of Interest with Applications in Advertising (Springer)](https://link.springer.com/chapter/10.1007/978-3-319-56687-0_5)
- Simulation models of visual attention are used to predict consumer gaze on dynamic
  marketing stimuli — [Predicting consumer gaze hits](https://www.researchgate.net/publication/332238261_Predicting_consumer_gaze_hits_A_simulation_model_of_visual_attention_to_dynamic_marketing_stimuli)
- Billboard/outdoor-advertising work uses visual saliency as a predictor of whether a
  driver notices an ad — [The Role of Location and Visual Saliency in Capturing Attention to Outdoor Advertising](https://www.researchgate.net/publication/308272261_The_Role_of_Location_and_Visual_Saliency_in_Capturing_Attention_to_Outdoor_Advertising_How_Location_Attributes_Increase_the_Likelihood_For_a_Driver_to_Notice_a_Billboard_Ad)

**Advertising eye-tracking on salience [MODERATE]**

- Pieters & Wedel tested 1,363 print advertisements with infrared eye-tracking on >3,600
  consumers; found "the pictorial is superior at capturing attention, independent of its
  size", and the brand element transfers attention most effectively to other elements. —
  [Attention Capture and Transfer in Advertising (Tilburg)](https://www.tilburguniversity.edu/sites/default/files/download/PietersWedel_2.pdf)
  → Important nuance *against* a colour-centric story: this landmark study attributes
  attention capture to the **pictorial** and to **size/position**, not to colour per se.
- "Visual saliency" in the ad literature is defined as an advertisement's ability to stand
  out via "use of color, shading, and compositional design" — i.e. colour is one component
  of a composite construct, not isolated. — [Utilizing Eye-Tracking in Advertising](https://ibimapublishing.com/articles/JMRCS/2024/404100/)

**Dark patterns — is colour/visual salience a named category? Yes. [ROBUST]**

- Gray et al. (2018) taxonomy includes **Interface Interference** as one of five
  strategies: "a strategy which privileges specific actions over others through
  manipulation of the user interface, thereby confusing the user or limiting
  discoverability of relevant action possibilities", with **aesthetic manipulation** as a
  named technique within it. — [An Ontology of Dark Patterns (Gray et al., CHI 2024)](https://colingray.me/wp-content/uploads/2024/02/2024_Grayetal_CHI_OntologyDarkPatterns.pdf)
- The dark-pattern ontology lists "Extraneous Badges" as a pattern "related to Aesthetic
  Manipulation as a form of Interface Interference" — i.e. badges specifically are a named
  dark pattern. — [Towards a Preliminary Ontology of Dark Patterns Knowledge](https://dl.acm.org/doi/fullHtml/10.1145/3544549.3585676)
- Mathur et al. (2019) name **Visual Interference** (under Misdirection), defined verbatim:
  "uses style and visual presentation to influence users into making certain choices over
  others"; table definition: "Using style and visual presentation to steer users to or away
  from certain choices". Classified as *sometimes asymmetric* and *covert* ("users may not
  realize the effect the visual presentation has had on their choice"). —
  [Dark Patterns at Scale (Princeton PDF)](https://webtransparency.cs.princeton.edu/dark-patterns/assets/dark-patterns-v2.pdf)
- **Crucial measurement caveat, from the same paper:** Visual Interference was found only
  **25 times on 24 sites** out of 1,818 dark-pattern instances across 11,286 sites — the
  *rarest* of the 15 types — and the authors explain why this is a floor, not a rate:
  "we excluded style information in our clustering analysis… We leave detecting other kinds
  of dark patterns—those that are enabled using style, color, and other non-textual
  features—to future work". Their stated findings are "a lower bound". For comparison,
  Countdown Timer = 393 instances, Activity Message = 313, Confirmshaming = 169. —
  [Dark Patterns at Scale](https://webtransparency.cs.princeton.edu/dark-patterns/assets/dark-patterns-v2.pdf)
- The one colour-specific worked example in Mathur et al. is *de-emphasis*, not
  attention-grabbing: "Visual Interference on greenfingers.com. The option to opt out of
  marketing communication is **grayed**, making it seem unavailable even though it can be
  clicked." — [ibid.](https://webtransparency.cs.princeton.edu/dark-patterns/assets/dark-patterns-v2.pdf)
- The same paper's method section does acknowledge the mechanism in general terms: dark
  patterns "can rely heavily upon interface manipulation, such as changing the hierarchy of
  interface elements or prioritizing certain options over others using different colors."
  — [ibid.](https://webtransparency.cs.princeton.edu/dark-patterns/assets/dark-patterns-v2.pdf)
- Legal/regulatory uptake: aesthetic manipulation "has already formed the basis for
  violations of the FTC's prohibition on deceptive acts" — [Shining a Light on Dark Patterns, Journal of Legal Analysis](https://academic.oup.com/jla/article/13/1/43/6180579) [MODERATE]

### Inferences

- The strongest *accurate* rephrasing of the report's claim:
  > "Platform design guidelines instruct designers to use saturated colour deliberately to
  > capture attention and signal importance — Apple's HIG specifies the red notification
  > badge as a device to flag information that 'warrants a person's attention', and Material
  > Design organises its entire colour system around emphasis tiers. The visual-attention
  > system is therefore a documented, explicit design target. Whether this is aimed at
  > *usability* or at *engagement maximisation* is not settled by the design literature:
  > the guidelines frame it as usability, while the dark-patterns literature documents the
  > same colour-salience mechanism being used adversarially to steer choices (Gray et al.'s
  > 'interface interference' / 'aesthetic manipulation'; Mathur et al.'s 'visual
  > interference')."
- The report's specific words "**precisely** to target this system" are not supportable.
  "Precisely" implies calibration against a model of colour valuation. What is documented
  is qualitative heuristic guidance ("use color sparingly", "stronger contrast for
  important events"), not psychophysical calibration. Computational saliency models *are*
  used quantitatively, but the documented application is **advertising/marketing stimuli**,
  not platform UI chrome.
- The phrase "colour **valuation** system" is a category error relative to the design
  literature. Designers' documented target is the *preattentive/salience* system
  (bottom-up visual attention). Nothing I found connects UI colour choices to
  reward-valuation neuroscience. If the report wants that bridge it must be built
  explicitly and labelled as the report's own inference.
- Mathur et al.'s low count for Visual Interference should **not** be cited as evidence
  that colour manipulation is rare — the authors disclaim exactly that reading. But it does
  mean there is **no published prevalence estimate** for colour-salience manipulation,
  whereas there are solid prevalence numbers for urgency, social proof and obstruction. A
  report claiming colour is the central mechanism is claiming something the measurement
  literature has not yet measured.

### Gaps

- Could not fetch m3.material.io or developer.apple.com directly (both JS-rendered; the
  Apple Journal of Physiology-style static mirrors were partial). Verbatim vendor quotes
  above are [MODERATE] on exact wording; a human should confirm the exact sentences from
  the live pages before publishing them as quotations.
- Found **no** internal/leaked documentation, patent, or A/B-test publication from a
  consumer platform (Meta, TikTok, Google) showing colour salience being optimised against
  an engagement metric. This is the specific evidence the report's strong claim would need,
  and I could not find it. Absent it, the strong claim stays UNSUPPORTED.
- Found no eye-tracking study that isolates *colour* salience in *mobile UI* (as opposed to
  print/outdoor ads) with a greyscale control condition. That experiment, which would be
  the direct test, does not appear to exist in accessible literature.
- Did not locate a page-numbered quotation from Ware's book; only mirrors and secondary
  summaries. The substance is uncontroversial but a page cite is missing.

---

## Q2: The spatial-frequency arithmetic — is "below 0.5 c/deg" the scale of icons, badges and thumbnails?

### Takeaway

**No — the claim is FALSE.** Badges, icons and avatars occupy roughly 0.3–2.3 c/deg. The
only UI features genuinely below 0.5 c/deg are *large* uniform colour areas: full-width
images, hero/brand colour blocks, and the aggregate colour cast of a whole screen (~0.05
c/deg). The report's claim inverts the relationship: a *badge* is a small, relatively
high-spatial-frequency object, which is precisely why red badges work through
*chromatic-plus-luminance* salience rather than through the low-frequency band where
chromatic sensitivity beats luminance.

### 2.1 The conversion, stated precisely [ROBUST]

Visual angle of an object of extent *s* at distance *d*:

    A = 2 · arctan( s / (2d) )

Spatial frequency is **not** a property of an object; it is a property of a *grating*. The
defensible mapping is: an object of angular extent *A* degrees, alternating with a
like-sized neighbour of the opposite polarity, forms one full light–dark **cycle** of
period 2A degrees, hence

    f = 1 / (2A)   cycles per degree          [period = 2A: object + equal gap]

If instead the object itself *is* one full cycle (e.g. a disc read as a single blob against
ground, period = A), then f = 1/A, which is **twice** as high. Both are reported below. The
two conventions differ by a factor of 2 and either way the conclusion is the same, which is
what makes the verdict robust. Report the 1/(2A) column as the conservative (lowest)
estimate — using it still refutes the claim.

Note the direction of the relationship, which is where the report went wrong: **bigger
object → lower spatial frequency.** A badge is small, therefore *high* frequency.

### 2.2 Inputs [ROBUST]

- **Viewing distance.** Two credible clusters in the literature, depending on method:
  - 36.8 ± 6.6 cm overall (36.1 ± 7.2 cm sitting, 37.4 ± 6.8 cm standing); 35.0 ± 6.4 cm
    non-presbyopes, 39.0 ± 6.1 cm presbyopes; 34.7 ± 6.2 cm female, 38.2 ± 6.3 cm male. —
    [Viewing distance of smartphones in presbyopic and non-presbyopic age, J Optometry](https://www.sciencedirect.com/science/article/pii/S1888429620300911)
  - A motion-capture study found much shorter distances: 20.3 ± 4.7 cm sitting (range
    13.3–32.9 cm) and 16.4 ± 2.7 cm lying (range 9.9–21.3 cm). —
    [Smartphone viewing distance and sleep, PubMed 28331379](https://pubmed.ncbi.nlm.nih.gov/28331379/)
  - AOA recommends 33–51 cm. — [News-Medical summary](https://www.news-medical.net/news/20231012/What-is-the-recommended-viewing-distance-for-digital-devices.aspx)
  - **Used below: 35 cm.** Note that the shorter motion-capture distances make the
    frequencies *lower* (objects subtend more), so 35 cm is the conservative choice for
    testing the "below 0.5" claim — and the claim still fails.
- **Pixel pitch.** iPhone 15: 2556×1179 px, 460 ppi, 393×852 pt, 3× scale. —
  [Apple tech specs](https://support.apple.com/en-us/111831); [useyourloaf screen sizes](https://useyourloaf.com/blog/iphone-15-screen-sizes/)
  - 1 device px = 25.4/460 = **0.05522 mm** → 18.1 px/mm
  - 1 pt (= 1 CSS px = 1 dp) = 3 device px = **0.16565 mm**
- **Element sizes.**
  - iOS app icon, iPhone home screen: **60 pt** (120×120 @2x, 180×180 @3x) —
    [iOS App Icon Sizes reference](https://appstoreready.io/resources/ios-app-icon-sizes)
  - iOS notification-icon metric: 20 pt (40×40 @2x, 60×60 @3x) — [ibid.](https://appstoreready.io/resources/ios-app-icon-sizes)
    (This is the *notification icon* asset size. The on-screen red numeric badge diameter is
    not published by Apple as a single number; ~16–20 pt is the observed range for tab-bar
    and home-screen badges. Flagged as an estimate.)
  - Android adaptive launcher icon: 48 dp visual size — standard Material metric.
  - Standard toolbar/system icon: 24 pt/dp.

### 2.3 The table [ROBUST arithmetic; element sizes as noted]

Viewing distance **d = 350 mm**. 1 pt = 0.16565 mm (iPhone 15, 460 ppi, 3×).

| UI element | size | physical | visual angle A | f = 1/(2A) c/deg | f = 1/A c/deg |
|---|---|---|---|---|---|
| Body-text stroke width | ~1.5 pt | 0.25 mm | 0.041° | **12.3** | 24.6 |
| Body text x-height (17 pt type) | ~8.5 pt | 1.41 mm | 0.230° | **2.17** | 4.34 |
| Small badge (24 device px) | 24 px | 1.33 mm | 0.217° | **2.31** | 4.61 |
| Tab-bar notification badge | ~16 pt | 2.65 mm | 0.434° | **1.15** | 2.31 |
| Home-screen notification badge | ~20 pt | 3.31 mm | 0.542° | **0.92** | 1.84 |
| Toolbar / system icon | 24 pt | 3.98 mm | 0.651° | **0.77** | 1.54 |
| Feed avatar / small thumbnail | 40 pt | 6.63 mm | 1.085° | **0.46** | 0.92 |
| Android launcher icon | 48 dp | 7.95 mm | 1.302° | **0.38** | 0.77 |
| iOS app icon (home screen) | 60 pt | 9.94 mm | 1.627° | **0.31** | 0.62 |
| Full-width feed image / hero block | 393 pt | 65.1 mm | 10.63° | **0.047** | 0.094 |
| Whole-screen colour cast | 393×852 pt | 65×141 mm | 10.6°×22.3° | **~0.02–0.05** | ~0.04–0.09 |

Worked example for the badge row, so it can be checked by hand:
A = 2·arctan(3.31 / (2·350)) = 2·arctan(0.004729) = 2·0.2709° = **0.542°**;
f = 1/(2·0.542) = **0.92 c/deg**.

Worked example for the 60 pt icon:
60 pt × 0.16565 mm/pt = 9.94 mm; A = 2·arctan(9.94/700) = 2·0.4068° = **1.627°**;
f = 1/(2·1.627) = **0.307 c/deg**.

**Inverting the question** — what object size *does* sit at 0.5 c/deg at 35 cm?
f = 0.5 → period 2 A = 2° → A = 1.00° → s = 2·350·tan(0.5°) = **6.1 mm ≈ 37 pt**.
And f = 1.0 c/deg → A = 0.50° → **3.1 mm ≈ 18 pt**.
So **0.5 c/deg is the ~37 pt / 6 mm boundary.** Everything smaller than a 37 pt element is
*above* 0.5 c/deg. An app icon (60 pt) is just below the boundary; a badge (16–20 pt) is
two to four times above it.

### 2.4 On the user's own cross-check [ROBUST]

The user's estimate — "a 24px badge at 30cm subtends roughly 1.4 degrees" — is **also
wrong**, and by more than the report's claim is.

- 1.4° at 300 mm implies a physical size of 2·300·tan(0.7°) = **7.33 mm**.
- 24 px = 7.33 mm implies **24·25.4/7.33 ≈ 83 ppi** — a 2007-era desktop monitor, not a
  phone.
- On an actual 460 ppi phone: 24 *device px* = 1.33 mm → **0.253°** at 30 cm (f ≈ 2.0 c/deg
  with 1/(2A)); 24 *pt* = 3.98 mm → **0.759°** at 30 cm (f ≈ 0.66 c/deg).
- So the user's directional conclusion ("well ABOVE 0.5 c/deg, so the report is wrong") is
  **correct**, but the supporting number is off by ~2–5× depending on the pt/px reading.
  The conclusion survives on better numbers, which is the point worth making.

### 2.5 Where the chromatic CSF actually sits [ROBUST on shape, MODERATE on the exact crossover]

- **Chromatic CSFs are low-pass, not band-pass.** Mullen (1985) measured red–green and
  blue–yellow isoluminant gratings with correction for chromatic aberration and found both
  "have similar low-pass characteristics, with no low-frequency attenuation even at low
  frequencies below 0.1 cycles/deg", unlike the band-pass achromatic CSF. —
  [Mullen 1985, J Physiol 359:381–400](https://physoc.onlinelibrary.wiley.com/doi/10.1113/jphysiol.1985.sp015591)
- **Chromatic high-frequency cutoff ≈ 11 c/deg**, versus >30–50 c/deg for achromatic. —
  [Mullen 1985](https://physoc.onlinelibrary.wiley.com/doi/10.1113/jphysiol.1985.sp015591);
  echoed in [A model of visual masking for computer graphics (SIGGRAPH)](https://dl.acm.org/doi/pdf/10.1145/258734.258818)
- **So chromatic sensitivity has no true "peak"** in the band-pass sense — it is flat/
  plateauing at low frequencies and rolls off from ~1–2 c/deg upward. Where a nominal peak
  is quoted it is low: the chrominance curve peak "occurs at a lower spatial frequency than
  that for luminance and the response falls off rapidly beyond about 2 cycles/deg", while
  "sensitivity to luminance information peaks at around 5–8 cycles/deg". —
  [Contrast Sensitivity Function overview, ScienceDirect](https://www.sciencedirect.com/topics/engineering/contrast-sensitivity-function)
- **The crossover.** The 0.5 c/deg figure the report is leaning on is real, but it is the
  *CSF crossover*, not the size of any UI object: "At low spatial frequencies below 0.5
  cycles/deg, contrast sensitivity is greater to the chromatic gratings than to either
  monochromatic grating alone… Above 0.5 cycles/deg, contrast sensitivity is greater to
  monochromatic than to chromatic gratings." — [UCI Spatial Vision chapter notes](https://ics.uci.edu/~majumder/vispercep/chap7notes.pdf),
  reporting Mullen 1985. Tagged **[MODERATE]**: this exact crossover depends on the
  luminance level, the chromatic axis, and the normalisation used to equate "chromatic" and
  "luminance" contrast, which is a known methodological controversy — see next bullet.
- **Mullen 1985 should not be treated as a universal observer.** Kim et al. (2013)
  re-measured achromatic and chromatic CSFs across luminance levels and state: "The
  chromatic CSFs from Mullen's 1985 paper have been widely used in color visual models.
  However, this data is not representative as a model of an average observer. The
  experiment was designed to discard the effect of chromatic aberration in the eye while
  such aberration actually happens when perceiving normal scenes. In addition, they
  measured the chromatic CSFs only at a single luminance level." —
  [Measurements of achromatic and chromatic contrast sensitivity functions, Kim et al.](https://www.cl.cam.ac.uk/~rkm38/pdfs/kim13mcsf.pdf)
- Kim et al.'s own achromatic data: average observer is band-pass with the peak shifting
  from 2.8 c/deg at 150 cd/m² down toward ~0.7 c/deg at 2 cd/m²; they measured achromatic
  over 0.125–16 c/deg and chromatic over 0.25–4 c/deg. —
  [ibid.](https://www.cl.cam.ac.uk/~rkm38/pdfs/kim13mcsf.pdf)
  → Note the implication for a screen-use report: at the *low display luminance* of a phone
  at night, the luminance CSF peak moves *down* toward the chromatic band, which changes
  the crossover. The report should not quote a single 0.5 c/deg figure as luminance-invariant.
- Low-frequency chromatic non-attenuation is independently confirmed, pre-Mullen: van der
  Horst & Bouman (1969) found results that "did not show an attenuation of the low
  frequencies such as appears in luminance-threshold contrast modulation", concluding the
  chromatic system "probably functions as a low-pass filter". —
  [Spatiotemporal Chromaticity Discrimination, JOSA](https://opg.optica.org/josa/abstract.cfm?uri=josa-59-11-1482)
- Whether chromatic CSFs are strictly low-pass or weakly band-pass remains an open question
  in the literature. — [Are Spatial Chromatic Contrast Sensitivity Band-pass or Low-pass Functions? (CIC)](https://library.imaging.org/admin/apis/public/api/ist/website/downloadArticle/cic/28/1/art00020) [CONTESTED]

### Inferences

- **The corrected statement for the report:**
  > "Chromatic contrast sensitivity is low-pass: it holds up at very low spatial frequencies
  > where luminance sensitivity falls away, and rolls off above ~1–2 c/deg with a cutoff
  > near 11 c/deg, against >30 c/deg for luminance (Mullen 1985). Colour therefore has its
  > sensitivity advantage over luminance only at coarse spatial scales — roughly below 0.5
  > c/deg, i.e. features subtending more than about a degree, which on a phone at 35 cm means
  > objects larger than roughly 6 mm (≈37 pt). The UI features that genuinely live in that
  > band are the *large* colour areas: full-width photos and video frames (~0.05 c/deg), hero
  > and brand colour blocks, card backgrounds, and the aggregate colour cast of a whole feed.
  > Notification badges, icons and avatars are *smaller* and therefore sit at *higher*
  > spatial frequencies, roughly 0.3–2.3 c/deg, in the band where luminance contrast is the
  > stronger channel — which is why the red badge is made maximally salient by combining
  > saturated hue with high luminance contrast against white or dark chrome, not by colour
  > alone."
- The physically correct version of the report's intuition is therefore about **the feed as
  a whole**, not about badges. Greyscaling a phone removes chromatic contrast across the
  entire scale range, but the component that colour *uniquely* carries (where it beats
  luminance) is the broad colour wash of imagery — thumbnails *as photographic fields*,
  not thumbnails *as objects*. That is a defensible claim and arguably a stronger one.
- A second, independent correction: a badge is not a grating. Its salience is better
  described by colour-opponent *feature contrast* against a local surround (the Itti–Koch
  construct) than by CSF position. Reaching for the CSF to explain badge salience is the
  wrong instrument; the report conflates two different models of colour vision.
- Note that the one row in the table that *is* close to the claim — the 60 pt app icon at
  0.307 c/deg under the conservative 1/(2A) convention — is below 0.5. So the report's
  claim is not uniformly false for every element it names: **large app icons** scrape into
  the band under one convention. Under the 1/A convention they do not (0.615 c/deg). This
  is the only place where the claim has any purchase, and it does not extend to badges or
  to text, which are off by 2–5×.

### Gaps

- Mullen (1985) is paywalled (Wiley 403, PubMed blocked by cookie wall). All the specific
  numbers above (11 c/deg cutoff, 0.5 c/deg crossover, low-pass shape) come from secondary
  sources that cite it, chiefly the UCI spatial-vision chapter notes and the SIGGRAPH
  masking paper. The numbers are mutually consistent across independent secondaries, so I
  rate them [ROBUST] on substance, but **nobody has read the primary abstract here** — if
  the report quotes Mullen directly, obtain the paper.
- The on-screen diameter of the iOS red numeric badge is not a published Apple metric. The
  16–20 pt figure is an estimate from the notification-icon asset size and observation. A
  direct measurement on a real device would firm up two table rows. Given the margin
  involved (badges land at 0.9–2.3 c/deg against a 0.5 threshold), even a 2× error in badge
  size does not change the verdict.
- Could not find a study measuring the chromatic/luminance CSF crossover at the *actual*
  luminance and chromaticity of a modern OLED phone display in a dark room, which is the
  condition the parent report cares about. Kim et al. show the crossover is
  luminance-dependent, so this is a real gap, not a pedantic one.
