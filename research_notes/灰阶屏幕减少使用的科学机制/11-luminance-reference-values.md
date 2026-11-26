# Photometric Luminance Reference Values (nits / cd/m²) for a Phone-Brightness Comparison Scale

> Tagging convention used throughout: **[SOURCED]** = a number taken from a cited reference.
> **[COMPUTED]** = derived here by arithmetic from a sourced formula + stated assumptions (arithmetic shown).
> **[UNVERIFIED]** = seen in low-quality or conflicting sources only; must NOT be charted as fact.

---

## Q1: What is a nit — and the luminance vs. illuminance distinction

### Takeaway
A nit is exactly one candela per square metre: it measures light *leaving* a surface toward your eye, which is what "screen brightness" means. It is a different physical quantity from lux, which measures light *falling on* a surface. The bridge between them, for a matte surface, is `luminance = (illuminance × reflectance) / π` — and that formula is what makes the whole phone-vs-paper comparison possible.

### Cited Findings
- Luminance is "the luminous intensity per unit area of light travelling in a given direction"; the SI unit is candela per square metre (cd/m²), and "a non-SI term for the same unit is the **nit**." So **1 nit = 1 cd/m² exactly** — it is the same unit under two names, not a conversion. [SOURCED] — [Wikipedia: Luminance](https://en.wikipedia.org/wiki/Luminance)
- Illuminance (lux) is "the luminous flux falling on a unit area of a surface at a point." Luminance (cd/m²) is "the luminous flux per unit projected area of a surface in a given direction," representing the brightness an observer perceives from that surface. The source explicitly emphasises that "illuminance measures incident light on a surface, while luminance measures the brightness that surface appears to emit — a crucial difference." [SOURCED] — [Cornell University, DEA 3500 Lighting lecture notes](https://ergo.human.cornell.edu/studentdownloads/DEA3500notes/Lighting/lightingnotes1.html)
- A lighting-engineering reference states the distinction compactly: illuminance is "light that FALLS ON a surface"; luminance is "light that LEAVES FROM a surface (reflected or self-emitted)." [SOURCED] — [RedCrab Software, Luminance](https://www.redcrab-software.com/en/Calculator/Optics/Luminance)
- **The conversion formula.** For a perfectly diffuse (Lambertian) reflector obeying Lambert's cosine law, `Lv = Ev·R / π`, where `Ev` is the received illuminance and `R` the reflectance. [SOURCED] — [Wikipedia: Luminance](https://en.wikipedia.org/wiki/Luminance)
- Same formula, independently stated by a machine-vision lighting reference as `L = (ρ × E) / π` with L in cd/m², ρ = reflectance (reflected/incident flux ratio), E = illuminance in lx; for an ideal diffuser with ρ = 1 it reduces to `L = E/π`. The source notes it "holds **only for Lambertian surfaces**," that real surfaces deviate with material and viewing angle, and that for a truly Lambertian material the result is independent of illumination and viewing angle. [SOURCED] — [CCS Inc., "The Relationship Between Illuminance and Luminance on Reflecting Surfaces"](https://www.ccs-grp.com/guide/theory-light-color/10_illuminance-luminance.html)
- Cornell gives the same relation, written both as `Luminance = (Illuminance × Reflectance) / π` and `Luminance = (Illuminance × Luminance Factor) / π`. [SOURCED] — [Cornell DEA 3500](https://ergo.human.cornell.edu/studentdownloads/DEA3500notes/Lighting/lightingnotes1.html)
- **Where the π comes from.** The light arriving at a diffuse surface is re-radiated into a hemisphere of 2π steradians, but because a Lambertian emitter's intensity falls off as the cosine of the viewing angle, integrating that cosine over the hemisphere yields π, not 2π. Equivalently: a Lambertian surface of radiance 1.0 W/cm²/sr radiates a total of π·A watts into the hemisphere, so radiant exitance = π × radiance; the luminous intensity in the normal direction is the total reflected flux divided by π. [SOURCED] — [Physics Forums: Luminance of a Lambertian sphere (derivation discussion)](https://www.physicsforums.com/threads/luminance-of-a-lambertian-sphere-formula.449703/); consistent with the π in the formula as given by [CCS Inc.](https://www.ccs-grp.com/guide/theory-light-color/10_illuminance-luminance.html) and [Wikipedia: Luminance](https://en.wikipedia.org/wiki/Luminance)
- **Independent validation of the formula against a worked example.** Cornell's notes state that white paper under 500 lux produces "130 cd/m²." Back-solving: ρ = L·π/E = 130 × 3.14159 / 500 = **0.817**. That is exactly the ~0.8 reflectance assumed for white paper, so the formula and the standard paper reflectance are mutually consistent to within 2%. [COMPUTED cross-check] on [Cornell DEA 3500](https://ergo.human.cornell.edu/studentdownloads/DEA3500notes/Lighting/lightingnotes1.html)

### Plain-language explanation suitable for a lay reader
> A **nit** is a unit of how much light a surface sends toward your eye, per unit of its area. One nit is one candela per square metre — same unit, two names. When a phone is advertised at "3000 nits," that is a statement about light *coming out of* the screen.
>
> This is NOT the same as **lux**. Lux measures light *arriving at* a surface — how brightly a room is lit. A sheet of paper in a bright office receives about 500 lux, but the paper itself is not "500 nits." You have to convert, and the conversion is:
>
> **nits = (lux × reflectance) ÷ 3.14159**
>
> The reflectance is the fraction of light the surface bounces back (white paper ≈ 0.8, i.e. 80%). The π in the denominator is there because a matte surface spreads its reflected light across a whole hemisphere, with the brightness tapering off toward grazing angles; doing that geometry exactly gives a factor of π.
>
> So: white office paper under 500 lux emits about **127 nits** toward your eye. That is the number you can legitimately put next to a phone's 1000 nits.

### Inferences
- Because luminance is measured per unit *projected* area and is (for a Lambertian surface) angle-independent, the comparison "screen nits vs. paper nits" is physically apples-to-apples. Comparing a screen's nits to a room's lux is not, and is the error the previous research round was right to flag.
- The Cornell worked example landing within 2% of the ρ=0.8 computation means the computed paper figures below are not hand-waving — they are reproducible from two independent sources.

### Gaps
- None material. Note only that the formula's "reflectance" should strictly be the CIE **luminance factor** (Y, visually weighted) rather than a broadband albedo. This distinction is load-bearing for foliage and snow (see Q3) and Cornell explicitly offers the "Luminance Factor" wording.

---

## Q2: Illuminance reference values (lux)

### Takeaway
Daylight spans roughly five orders of magnitude, from ~120,000 lux in brightest direct sun to ~0.0002 lux under starlight; indoor task lighting standards sit around 300–500 lux. The single most useful anchor is the EN 12464-1 standard's **500 lux maintained** for general office work.

### Cited Findings
- **Full direct sunlight (mid-day):** "Brightest sunlight" = **120 kilolux**; "bright sunlight" = **110 kilolux**. [SOURCED] — [Wikipedia: Orders of magnitude (illuminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(illuminance))
- **Sun overhead:** **130,000 lux** on a horizontal surface, per an astronomy/photometry reference whose table runs from solar altitude +90° (129,000 lux) down to −13.5° (0.00456 lux). [SOURCED] — [Schlyter, "Radiometry and photometry in astronomy"](https://stjarnhimlen.se/comp/radfaq.html)
- **Full daylight, not direct sun:** **10,000–25,000 lux**. [SOURCED] — [Schlyter](https://stjarnhimlen.se/comp/radfaq.html). Wikipedia's corresponding rows: "shade under clear sky (midday)" = **20 kilolux**. [SOURCED] — [Wikipedia: Orders of magnitude (illuminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(illuminance))
- **Overcast daylight — SOURCES CONFLICT.** Schlyter gives "overcast day" = **1,000 lux** and "very dark overcast day" = 100 lux. [SOURCED] — [Schlyter](https://stjarnhimlen.se/comp/radfaq.html). Wikipedia's table instead lists "overcast day (midday)" = **10–25 kilolux**. [SOURCED] — [Wikipedia: Orders of magnitude (illuminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(illuminance)). These differ by ~10–25×. **Resolution:** the discrepancy is almost certainly a definitional one — "overcast" covers everything from thin high cloud (still 10–20 klux) to heavy storm overcast (~1 klux). Wikipedia separately lists "extreme darkness (storm clouds, midday)" = **< 200 lux**, consistent with Schlyter's low end. **Recommendation: quote overcast as a RANGE, 1,000–25,000 lux, and never as a single point value.**
- **Sunrise / sunset:** **400 lux** on a clear day; **40 lux** when overcast at sunrise/sunset. [SOURCED] — [Wikipedia: Orders of magnitude (illuminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(illuminance))
- **Twilight:** **10 lux**; "deep twilight" **1 lux**. [SOURCED] — [Schlyter](https://stjarnhimlen.se/comp/radfaq.html)
- **Office / task lighting — the standard.** EN 12464-1 (BS EN 12464-1), "Lighting of indoor work places," specifies **500 lux maintained** on the task area for general office work (writing, typing, reading, data processing), with glare limit UGR ≤ 19, uniformity Uo ≥ 0.6 and colour rendering Ra ≥ 80. Reception desks drop to **300 lux**, archives to **200 lux** — the standard reasons by visual task, not by room name. "Maintained illuminance" is defined as the lowest average value that must be kept on the working plane throughout the installation's service life, i.e. you must design for lamp depreciation and dirt, not for day-one output. [SOURCED] — [Fagerhult, "Standard EN 12464-1 in brief"](https://www.fagerhult.com/knowledge/light-planning/en-12464-1/lighting-of-indoor-workplaces/standard-en-12464-1-in-brief/); corroborated by [Sparkline Engineering, "Lux Levels Explained (BS EN 12464-1)"](https://sparklineeng.design/insights/lux-levels-bs-en-12464.php) and [Luminance Consulting, EN 12464-1 illuminance levels by room](https://luminance-consulting.com/en/norme-en-12464-1-niveaux-eclairement/)
- **Typical home living room / general indoor:** see Gaps — I could not source this to a standards body with confidence. Engineering-reference tables of recommended indoor levels exist ([Engineering ToolBox, Recommended Light Levels](https://www.engineeringtoolbox.com/light-level-rooms-d_708.html); [Recommended Light Levels PDF mirror](https://cdn.hackaday.io/files/1804277719388768/LightLevels_outdoor-indoor.pdf)) but these are *recommendations for design*, not measurements of what living rooms actually are, and the living-room figure specifically is **[UNVERIFIED]** in the sources I reached.
- **Full moon:** "Full Moon overhead" = **0.267 lux** [SOURCED] — [Schlyter](https://stjarnhimlen.se/comp/radfaq.html); Wikipedia: full moon on a clear night = **0.25 lux (2.5 decilux)**; quarter moon = **0.01 lux**. [SOURCED] — [Wikipedia: Orders of magnitude (illuminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(illuminance)). These two agree to within 7% — a good sign.
- **Starlight:** "total starlight only" = **2×10⁻⁴ lux** [SOURCED] — [Schlyter](https://stjarnhimlen.se/comp/radfaq.html). Wikipedia breaks it down: starlight overcast moonless = **100 µlux**; clear moonless excluding airglow = **200 µlux**; clear moonless including airglow = **2 millilux**. [SOURCED] — [Wikipedia: Orders of magnitude (illuminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(illuminance))

### Inferences
- The two independent references (Schlyter, an astronomy photometry FAQ; and Wikipedia's table, which itself cites Schlyter among others) agree closely on direct sun, moon and starlight, and disagree only on "overcast." That pattern suggests the disagreement is about what "overcast" denotes rather than a measurement error in either source — reinforcing the recommendation to present overcast as a range.
- Note that Schlyter and Wikipedia are not fully independent (Wikipedia cites Schlyter), so their agreement is weaker evidence than it appears. Direct sun ~100–120 klux is nonetheless corroborated across essentially every lighting reference consulted.

### Gaps
- **Typical living-room illuminance:** not sourced to a standard. EN 12464-1 governs *work places*, not dwellings, so it has no living-room figure by design. If the report needs an indoor-home number, the honest options are (a) use the EN 12464-1 office figure of 500 lux and label it as such, or (b) state "typical domestic lighting is substantially dimmer than the 500 lux office standard" without a point value. Do not invent a number.
- I did not obtain the IES Lighting Handbook or CIE documents directly (paywalled / not web-accessible), so the EN 12464-1 figures come from lighting-industry secondary summaries rather than the standard text itself. The 500 lux figure is corroborated across three such summaries and is uncontroversial in the field, but it is a secondary citation.

---

## Q3: Computed luminance for real surfaces

### Takeaway
Computing with `L = E·ρ/π`: white paper is ~127 nits in a standards-compliant office and ~25,000 nits in direct sun. The sunlit figure is the single most important number in this whole exercise, because it exceeds the iPhone's 3000-nit outdoor peak by roughly 8×.

### Reflectance values used (sourced first, then the arithmetic)
- **White paper, ρ ≈ 0.8.** Best evidence is the back-solve from Cornell's own worked example (500 lux → 130 cd/m² implies ρ = 0.817). [COMPUTED from [Cornell DEA 3500](https://ergo.human.cornell.edu/studentdownloads/DEA3500notes/Lighting/lightingnotes1.html)]. Corroborating anchors: Kodak's R-27 grey card has a **white reverse side of 90% reflectance** [SOURCED] — [Wikipedia: Gray card](https://en.wikipedia.org/wiki/Gray_card); and IES/ASHRAE lighting guidance recommends white or near-white ceilings at **0.80–0.85 reflectance** [SOURCED] — [LightNOW, "ASHRAE/IES Recommended Surface Reflectances"](https://www.lightnowblog.com/2010/11/ashrae-recommended-surface-reflectances/). **Caution / conflict:** broadband-albedo tables used in solar engineering list white paper at only **0.6–0.7** [SOURCED] — [Albedo in Science](https://sciencenotes.org/albedo-in-science-definition-values-importance/), and Cornell's page elsewhere mentions "white paper ≈ 0.4" in some context. The 0.6–0.7 albedo figures are *solar broadband* (including infrared), not the visible luminance factor the photometric formula requires, so they are the wrong quantity here. **I am using ρ = 0.8 and flagging that the honest bracket is 0.7–0.9, i.e. the computed luminances carry about ±15%.**
- **Mid-grey card, ρ = 0.18.** "In photography and printing, middle gray is typically defined as 18% reflectance in visible light"; the Kodak R-27 cards are "18% reflectance across the visible spectrum." [SOURCED] — [Wikipedia: Middle gray](https://en.wikipedia.org/wiki/Middle_gray); [Wikipedia: Gray card](https://en.wikipedia.org/wiki/Gray_card). **Verified, with a caveat worth knowing:** ANSI PH3.49-1971 equates middle grey with ~**12%**, and ANSI PH2.12 specifies **16%** average scene reflectance as the metering constant — so 18% is the Kodak/photographic convention, not a universal metrology standard. [SOURCED] — [Wikipedia: Middle gray](https://en.wikipedia.org/wiki/Middle_gray)
- **Green foliage / grass, ρ ≈ 0.10–0.15 in the visible.** "Only 10-15% of the incident energy is reflected in the green band for healthy vegetation"; the common range for green vegetation is 10–25% in the visible, while in the near-IR (0.7–1.3 µm) a leaf reflects about **50%**. [SOURCED] — [Humboldt State University GSP 216, Spectral Reflectance](https://gsp.humboldt.edu/olm/Courses/GSP_216/lessons/reflectance.html); [NPTEL, Remote Sensing lecture notes](https://archive.nptel.ac.in/content/storage2/courses/105108077/module1/lecture5.pdf). **This is exactly why the solar-albedo figure for grass (0.23–0.25, per [NREL Ground Albedo Measurements](https://docs.nlr.gov/docs/fy20osti/72589.pdf) and [Wikipedia: Albedo](https://en.wikipedia.org/wiki/Albedo)) must NOT be used in the photometric formula** — it is inflated by the NIR reflectance that the eye cannot see. Use ρ ≈ 0.10 for a visible-luminance calculation. [SOURCED, with the distinction explicitly flagged]
- **Fresh snow, ρ ≈ 0.80–0.90.** "Fresh snow has an albedo as high as 0.8–0.9." [SOURCED] — [Wikipedia: Albedo](https://en.wikipedia.org/wiki/Albedo); specific measured value 0.82 in PV modelling data [SOURCED] — [NREL](https://docs.nlr.gov/docs/fy20osti/72589.pdf). Snow is one of the few surfaces where broadband albedo and visible reflectance are both high, so the number transfers reasonably. Using ρ = 0.85.

### Computed luminances — arithmetic shown
All rows: **L = E × ρ ÷ π**, π = 3.14159. All **[COMPUTED]**.

**White office paper, ρ = 0.80:**
| Condition | Illuminance E (lux) | Arithmetic | Luminance |
|---|---|---|---|
| Archive / dim indoor (EN 12464-1) | 200 | 200 × 0.80 / π | **51 cd/m²** |
| Reception desk (EN 12464-1) | 300 | 300 × 0.80 / π | **76 cd/m²** |
| **General office work (EN 12464-1 standard)** | **500** | 500 × 0.80 / π | **127 cd/m²** |
| Bright indoor / near a window | 1,000 | 1,000 × 0.80 / π | **255 cd/m²** |
| Heavy overcast daylight (Schlyter) | 1,000 | — | **255 cd/m²** |
| Light overcast / shade (Wikipedia 10–25 klux) | 10,000 | 10,000 × 0.80 / π | **2,550 cd/m²** |
| Shade under clear sky | 20,000 | 20,000 × 0.80 / π | **5,090 cd/m²** |
| **Direct sunlight** | **100,000** | 100,000 × 0.80 / π | **25,500 cd/m²** |
| Brightest direct sunlight | 120,000 | 120,000 × 0.80 / π | **30,600 cd/m²** |

**Mid-grey card, ρ = 0.18:**
| Condition | E (lux) | Arithmetic | Luminance |
|---|---|---|---|
| Office | 500 | 500 × 0.18 / π | **29 cd/m²** |
| Light overcast | 10,000 | 10,000 × 0.18 / π | **573 cd/m²** |
| Direct sunlight | 100,000 | 100,000 × 0.18 / π | **5,730 cd/m²** |

**Green foliage / grass, ρ = 0.10 (visible band):**
| Condition | E (lux) | Arithmetic | Luminance |
|---|---|---|---|
| Direct sunlight | 100,000 | 100,000 × 0.10 / π | **3,180 cd/m²** |

**Fresh snow, ρ = 0.85 — upper bound for natural reflective brightness:**
| Condition | E (lux) | Arithmetic | Luminance |
|---|---|---|---|
| Direct sunlight | 100,000 | 100,000 × 0.85 / π | **27,100 cd/m²** |
| Brightest direct sunlight | 120,000 | 120,000 × 0.85 / π | **32,500 cd/m²** |

### Measured-luminance cross-check — and a real conflict to disclose
- **Supports the computation:** "Typical photographic scene on overcast day" = **700 cd/m²** [SOURCED] — [Wikipedia: Orders of magnitude (luminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(luminance)). A whole *scene* averages well below pure white paper (scene average is nearer mid-grey), so 700 cd/m² for a scene sits sensibly between my computed mid-grey-overcast (573) and white-paper-overcast (255–2,550) figures. Consistent.
- **Supports the computation:** "Typical photographic scene at sunrise or sunset" = **25 cd/m²** [SOURCED] — [same]. Computing from 400 lux at clear-day sunrise with mid-grey ρ=0.18: 400 × 0.18 / π = **23 cd/m²**. Agreement within 10%. This is a strong independent validation of the formula at the dim end. [COMPUTED cross-check]
- **Supports the computation:** a display-engineering patent states "the adapted luminance of white paper (N5 on the Munsell color standard) at the illuminance of direct sunlight in fair weather ... is about **6000 cd/m²**." [SOURCED] — [US Patent 7427140, "Sunlight readable direct-view and projection-view computing device"](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7427140). Note Munsell N5 is *mid-grey*, roughly 20% reflectance, not white — the patent's wording is loose. Computing 100,000 × 0.19 / π = **6,050 cd/m²**. This matches the patent almost exactly, which both validates the formula at the bright end AND confirms that the quoted 6000 figure is a mid-grey figure, not a white-paper figure. [COMPUTED cross-check]
- **CONTRADICTS the computation — and I judge it wrong:** one engineering calculator page lists "paper in sunlight" = **100–1000 cd/m²** [SOURCED] — [RedCrab Software](https://www.redcrab-software.com/en/Calculator/Optics/Luminance). This is irreconcilable with every other line of evidence (it would require sunlight illuminance of only ~400–4,000 lux) and is almost certainly a mislabelled *indoor* paper figure. **Do not use.**
- Search snippets also surfaced, without traceable primary attribution: "white paper in sunlight 13,000 cd/m²", "white paper in full sun 2,500 cd/m²", "white paper under interior office lighting 30 cd/m²", "white diffuse surface in sunshine ~30,000 cd/m²". The last of these matches my computation for brightest sun; the others do not and could not be traced to a primary source. **All [UNVERIFIED] — do not chart.**

### Inferences
- The spread of secondary "paper in sunlight" figures (100 → 2,500 → 6,000 → 13,000 → 30,000 cd/m²) is precisely the kind of unsourced mush the previous research round flagged. The computed value from the sourced formula plus a sourced reflectance is **more defensible than any of them**, because the assumptions are visible and auditable. The report should lead with the computation and state the assumptions inline.
- Two independent measured cross-checks (sunrise scene 25 cd/m²; Munsell-N5-in-sunlight 6000 cd/m²) both land within ~10% of the formula's prediction, across four orders of magnitude of illuminance. That is as good a validation as this exercise can get without a photometer.
- Honest uncertainty statement for the headline number: **white paper in direct sun ≈ 25,000 cd/m², bracket roughly 20,000–32,000** depending on whether ρ is 0.7 or 0.9 and E is 100 or 120 klux. The conclusion that it exceeds 3000 nits is robust across that entire bracket — it would take ρ < 0.1 to overturn, which is not physically possible for white paper.

### Gaps
- I found no *directly measured, instrument-reported* luminance for white office paper in direct sunlight from a primary metrology source. Everything in that range is either computed (here) or an untraceable secondary figure. This is worth stating in the report; the computation stands on its own, but it should not be dressed up as a measurement.

---

## Q4: Emissive and natural sources for scale

### Takeaway
The sun's disc at 1.6×10⁹ cd/m² is the absolute ceiling; sky and sunlit cloud sit in the thousands-to-tens-of-thousands; and ordinary displays — monitors, TVs, SDR reference — live down at 80–300 cd/m², which is where the phone comparison becomes striking.

### Cited Findings
- **Sun's disc at noon: 1.6×10⁹ cd/m² — VERIFIED.** "The sun has a luminance of about 1.6×10⁹ cd/m² at noon." [SOURCED] — [Wikipedia: Luminance](https://en.wikipedia.org/wiki/Luminance); same value, "Solar disk at noon = 1.6 Gcd/m²", plus "Solar disk at horizon = 600 kcd/m²" [SOURCED] — [Wikipedia: Orders of magnitude (luminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(luminance)); and 1,600,000,000 cd/m² for "sun disk" [SOURCED] — [RedCrab](https://www.redcrab-software.com/en/Calculator/Optics/Luminance). A photometry reference gives **3×10⁹ cd/m²** [SOURCED] — [Schlyter](https://stjarnhimlen.se/comp/radfaq.html); the ~2× spread is attributable to atmospheric path and whether the figure is for the zenith sun. **The user's stated ~1.6×10⁹ figure is confirmed by three sources; note the 3×10⁹ outlier.**
- **Clear blue sky:** "Clear daytime sky (at horizon)" = **10,000 cd/m²** [SOURCED] — [Schlyter](https://stjarnhimlen.se/comp/radfaq.html). "Blue sky on a sunny day ≈ **5,000 cd/m²**" [SOURCED] — [RedCrab](https://www.redcrab-software.com/en/Calculator/Optics/Luminance). Wikipedia's table gives **1–10 kcd/m²** for "various sky conditions (noon, cloudy, clear)" [SOURCED] — [Wikipedia: Orders of magnitude (luminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(luminance)). **Present as a range: clear blue sky ≈ 5,000–10,000 cd/m², varying strongly with angle from the sun.** The horizon-vs-zenith dependence is real and is why single values disagree.
- **White cloud in sunlight:** approximately **10,000 cd/m² (10 kcd/m²)** [SOURCED] — [RedCrab](https://www.redcrab-software.com/en/Calculator/Optics/Luminance). Sanity check by computation: a sunlit cloud is a near-Lambertian diffuser of very high reflectance under ~100 klux, giving 100,000 × 0.8 / π ≈ 25,000 cd/m² for an optically thick bright cloud top — so 10,000 is plausible for a cloud seen from below. [COMPUTED sanity check]
- **Overcast sky:** "Overcast daytime sky (at horizon)" = **1,000 cd/m²** [SOURCED] — [Schlyter](https://stjarnhimlen.se/comp/radfaq.html)
- **Full moon (as a surface):** **6,000 cd/m²** [SOURCED] — [Schlyter](https://stjarnhimlen.se/comp/radfaq.html). Note this is the luminance of the moon's *disc*, whereas the 0.25 lux figure in Q2 is the illuminance it delivers to the ground — a perfect illustration of why the two units must not be conflated.
- **Candle flame:** **2×10⁴ = 20,000 cd/m²** [SOURCED] — [Schlyter](https://stjarnhimlen.se/comp/radfaq.html). A secondary engineering source gives ~**10,000 cd/m²** [UNVERIFIED cross-reference] — [RedCrab-adjacent search result]. **Present as ~10,000–20,000 cd/m², order of magnitude 10⁴.**
- **Computer monitor, typical:** "A typical computer display emits between **50 and 300 cd/m²**" [SOURCED] — [Wikipedia: Luminance](https://en.wikipedia.org/wiki/Luminance). More precisely: "Most consumer desktop liquid crystal displays have luminances of **200 to 300 cd/m²**"; "the sRGB spec for monitors targets **80 cd/m²**"; "monitors calibrated for SDR broadcast or studio colour grading should have a brightness of **100 cd/m²**"; "HDR displays range from around **400 to 2500 cd/m²**." [SOURCED] — [Wikipedia: Candela per square metre](https://en.wikipedia.org/wiki/Candela_per_square_metre). Wikipedia's luminance-orders table adds: monitor white in sRGB reference environment = **80 cd/m²**; "peak luminance of a typical LCD monitor" = **250 cd/m²**. [SOURCED] — [Wikipedia: Orders of magnitude (luminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(luminance))
- **Monitor luminance recommended for office work — the ~100–160 nit figure is real and standards-adjacent.** Per ISO 9241, with positive display polarity, display luminance is often recommended in the range **100–150 cd/m²**; practical calibration guidance targets 120–160 cd/m² for a bright office and 80–100 cd/m² for a dark room. [SOURCED] — [DisplayCAL forum discussion citing ISO 9241 and Portrait Displays guidance](https://hub.displaycal.net/forums/topic/what-monitor-brightness-is-recommended/); ISO 9241-303:2011 is the relevant part (display requirements) [SOURCED] — [ISO 9241-303:2011 preview](https://cdn.standards.iteh.ai/samples/57992/bddfd91165b444f6b9815a6993feadc5/ISO-9241-303-2011.pdf). **Caveat: I confirmed the standard exists and is the right one, but did not read the paywalled clause containing the numeric range; the 100–150 figure is from a secondary citation. Label accordingly.**
- **TV in a living room:** SDR video is **mastered at 100 nits peak** — this is the reference standard, and when checking an SDR/Rec.709 target the TV is set to a maximum luminance of 100 nit. HDR10+ and Dolby Vision content is mostly **mastered at ~1,000 nits**; Dolby requires a professional mastering display of ≥1,000 nits peak with ≥200,000:1 contrast. Typical consumer HDR displays range **500–1,200 nits**, and most consumer TVs cannot exceed 1,000 nits (OLEDs dimmer still). [SOURCED] — [Dolby Professional Support, Color Grading & Mastering suite setup](https://professionalsupport.dolby.com/s/article/Color-Grading-Mastering-suite-setup?language=en_US); [Dolby, HDR Display Considerations](https://professionalsupport.dolby.com/s/article/What-display-should-I-use-for-creating-Dolby-Vision?language=en_US); [Wikipedia: HDR10](https://en.wikipedia.org/wiki/HDR10)
- **Cinema screen:** "Standard SMPTE cinema screen luminance" = **55 cd/m²** — a useful reminder of how dim a *comfortable* viewing target is in a dark surround. [SOURCED] — [Wikipedia: Orders of magnitude (luminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(luminance))
- **Street light (high-pressure sodium lamp):** **5,000–10,000 cd/m²**. **Car headlight (reflector):** **1,000–5,000 cd/m²**. **Traffic signal (red LED):** 500–3,000 cd/m². **Frosted incandescent bulb:** **130,000 cd/m²** (Wikipedia) / incandescent filament 100,000–500,000 cd/m² (RedCrab). [SOURCED] — [RedCrab](https://www.redcrab-software.com/en/Calculator/Optics/Luminance); [Wikipedia: Orders of magnitude (luminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(luminance))
- **Night sky, for the dark-room anchor:** "Night sky" = **1 mcd/m² (0.001 cd/m²)**; "cloudy night sky without moon" = 100 µcd/m²; "typical photographic scene lit by full moon" = **1.4 mcd/m²**; "absolute threshold of vision" = **1 µcd/m²**; scotopic/mesopic threshold ≈ 5 mcd/m²; mesopic/photopic threshold ≈ 5 cd/m². "Floodlit buildings, monuments and fountains" = **2 cd/m²**. [SOURCED] — [Wikipedia: Orders of magnitude (luminance)](https://en.wikipedia.org/wiki/Orders_of_magnitude_(luminance)). Schlyter corroborates: moonless clear night sky at horizon = 10⁻³ cd/m²; moonless overcast = 10⁻⁴; dark country sky between stars (zenith) = 3×10⁻⁵ cd/m². [SOURCED] — [Schlyter](https://stjarnhimlen.se/comp/radfaq.html)
- **Night-sky luminance, peer-reviewed cross-check:** a measurement study reports zenith night-sky brightness of **244 mcd/m² (0.244 cd/m²)** under snow-and-cloud conditions in a suburban area, which it notes is a factor of ~1000 above the commonly used clear-sky reference of 0.25 mcd/m². [SOURCED] — [Jechow & Hölker, "Snowglow", *Journal of Imaging* 5(8):69, 2019](https://www.mdpi.com/2313-433X/5/8/69)
- **Phone figures (given as already verified, confirmed here):** iPhone 17 Super Retina XDR — **1000 nits max typical, 1600 nits peak HDR, 3000 nits peak outdoor**. [SOURCED] — [Apple, iPhone 17 Technical Specifications](https://www.apple.com/iphone-17/specs/); [Apple Support, iPhone 17 Tech Specs](https://support.apple.com/en-gb/125089)

### Inferences
- The mesopic/photopic threshold at ~5 cd/m² is a quietly important anchor: a phone at even 100 nits is ~20× above the level at which the eye switches fully into cone-driven (photopic) vision, while a dark bedroom's surfaces are three to four orders of magnitude *below* it. The screen isn't just brighter than the room — it is in a different regime of visual physiology from the room.
- SMPTE's 55 cd/m² cinema standard and sRGB's 80 cd/m² reference white both tell the same story: when ambient light is controlled, *comfortable* viewing luminance is under 100 nits. A phone at 1000 nits is roughly 12–18× a cinema screen.

### Gaps
- **Candle flame** has a 2× disagreement between sources (10,000 vs 20,000 cd/m²) and I could not find a primary metrology measurement. Present as order-of-magnitude 10⁴.
- **ISO 9241's exact numeric luminance recommendation** is behind a paywall; cited secondarily.
- I found no reliable figure for OLED phone *full-screen sustained* white luminance as distinct from peak small-window luminance. This matters for honesty: the 3000-nit figure is an outdoor peak, typically measured on a limited screen area, not a full-field sustained value. The report should not imply the whole screen holds 3000 nits indefinitely. **[UNVERIFIED / flagged as a known spec-reading pitfall.]**

---

## Q5: The comparison that matters

### Takeaway
A phone is not brighter than nature — sunlit white paper beside it is about **8× brighter** than its 3000-nit outdoor peak. But in a dark room a phone at moderate brightness outshines its surroundings by **a factor of several hundred to several thousand**, and unlike every reflective surface its output is completely independent of ambient light. That — not raw brightness supremacy — is the true and still-vivid claim.

### The reference table (dim → bright)

| Object / source | Luminance (cd/m² = nits) | Tag | What it means |
|---|---|---|---|
| Absolute threshold of vision | 0.000001 | [SOURCED] | The dimmest light a dark-adapted eye can detect at all |
| Dark country sky between stars (zenith) | 0.00003 | [SOURCED] | |
| Moonless overcast night sky | 0.0001 | [SOURCED] | |
| Moonless clear night sky (horizon) | 0.001 | [SOURCED] | |
| Scene lit by full moon | 0.0014 | [SOURCED] | What "seeing by moonlight" actually looks like |
| **Wall of a dark bedroom (1 lux ambient, ρ=0.5)** | **0.16** | **[COMPUTED]** | 1 × 0.5 / π. The surround you're reading a phone against at night |
| Suburban night sky, snow + cloud (measured) | 0.244 | [SOURCED] | Peer-reviewed; ~1000× a clear reference sky |
| **Wall of a dim room (5 lux ambient, ρ=0.5)** | **0.80** | **[COMPUTED]** | 5 × 0.5 / π |
| Floodlit monument | 2 | [SOURCED] | |
| Mesopic → photopic threshold | ~5 | [SOURCED] | Above this the eye is fully in daylight (cone) vision |
| Typical photographic scene at sunrise/sunset | 25 | [SOURCED] | |
| Mid-grey card under office lighting (500 lux) | 29 | [COMPUTED] | 500 × 0.18 / π |
| White paper in a dim archive (200 lux) | 51 | [COMPUTED] | 200 × 0.80 / π |
| SMPTE standard cinema screen | 55 | [SOURCED] | A *comfortable* image in a dark room |
| sRGB reference white / monitor in reference viewing | 80 | [SOURCED] | |
| SDR television mastering reference (Rec.709) | 100 | [SOURCED] | What all pre-HDR video was graded for |
| Monitor recommended for office work (ISO 9241) | 100–150 | [SOURCED, secondary] | |
| **White office paper at the EN 12464-1 office standard (500 lux)** | **127** | **[COMPUTED]** | 500 × 0.80 / π — *the everyday anchor* |
| Typical desktop LCD, peak | 200–300 | [SOURCED] | |
| White paper in bright indoor light (1,000 lux) | 255 | [COMPUTED] | 1,000 × 0.80 / π |
| White paper under heavy overcast (1,000 lux) | 255 | [COMPUTED] | |
| Typical photographic scene, overcast day (measured) | 700 | [SOURCED] | |
| **Phone — iPhone 17 typical max brightness** | **1000** | **[SOURCED — Apple]** | ~8× the white paper on your desk |
| Overcast sky (at horizon) | 1,000 | [SOURCED] | |
| Car headlight (reflector) | 1,000–5,000 | [SOURCED] | |
| **Phone — iPhone 17 peak HDR** | **1600** | **[SOURCED — Apple]** | |
| White paper under light overcast daylight (10,000 lux) | 2,550 | [COMPUTED] | 10,000 × 0.80 / π |
| **Phone — iPhone 17 peak outdoor** | **3000** | **[SOURCED — Apple]** | |
| Sunlit green foliage / grass (visible ρ=0.10) | 3,180 | [COMPUTED] | 100,000 × 0.10 / π |
| Clear blue sky | 5,000–10,000 | [SOURCED] | Varies strongly with angle from the sun |
| White paper in open shade under clear sky (20,000 lux) | 5,090 | [COMPUTED] | 20,000 × 0.80 / π |
| Street light (HPS lamp) | 5,000–10,000 | [SOURCED] | |
| Mid-grey card in direct sunlight | 5,730 | [COMPUTED] | 100,000 × 0.18 / π |
| Munsell N5 grey in direct sun (measured/industry) | ~6,000 | [SOURCED] | Matches the computation above — validates the method |
| Full moon's disc | 6,000 | [SOURCED] | The moon's *surface*, not the light it gives you |
| White sunlit cloud | ~10,000 | [SOURCED] | |
| Candle flame | 10,000–20,000 | [SOURCED, 2× spread] | |
| **White paper in direct sunlight** | **~25,500** | **[COMPUTED]** | 100,000 × 0.80 / π — **~8× the phone's outdoor peak** |
| Fresh snow in direct sunlight | ~27,100 | [COMPUTED] | 100,000 × 0.85 / π — practical ceiling for natural reflective brightness |
| White paper / snow in brightest sun (120,000 lux) | 30,600 / 32,500 | [COMPUTED] | |
| Frosted incandescent bulb | 130,000 | [SOURCED] | |
| Solar disc at the horizon | 600,000 | [SOURCED] | |
| **Solar disc at noon** | **1,600,000,000** | **[SOURCED]** | The absolute ceiling — ~530,000× the phone |

### Ratio 1 — the dark room

**[COMPUTED]** Assumptions stated: ambient illuminance 1–5 lux (a dark bedroom with a hall light or dim lamp); surround reflectance ρ = 0.5 (a mid-tone painted wall/bedding — the IES/ASHRAE recommended wall reflectance is ≥0.5–0.7, so 0.5 is conservative, i.e. it *understates* the ratio for darker rooms). Formula `L = E·ρ/π`.

| Ambient | Surround luminance | vs. phone at 200 nits (moderate) | vs. phone at 1000 nits (typical max) |
|---|---|---|---|
| 1 lux | 1 × 0.5 / π = **0.159 cd/m²** | 200 / 0.159 = **≈ 1,260×** | 1000 / 0.159 = **≈ 6,280×** |
| 3 lux | 3 × 0.5 / π = **0.477 cd/m²** | **≈ 420×** | **≈ 2,090×** |
| 5 lux | 5 × 0.5 / π = **0.796 cd/m²** | **≈ 250×** | **≈ 1,260×** |

**Headline, defensible version: in a dark room (1–5 lux), a phone at even a moderate 200 nits is roughly 250–1,250× brighter than the walls and bedding around it; at the phone's typical maximum of 1000 nits the ratio is roughly 1,250–6,300×.** For a truly dark room with no artificial light at all, the surround drops toward 0.001–0.01 cd/m² and the ratio runs into the hundreds of thousands — but the 1–5 lux bracket is the honest, realistic one to quote.

Supporting detail that makes the point physiologically rather than just numerically: the surround at 0.16–0.80 cd/m² is **below the ~5 cd/m² mesopic/photopic threshold** [SOURCED], while the phone is 40–200× *above* it. So the screen is not merely the brightest thing in the field of view; it is the only thing in the field of view bright enough to drive daylight vision.

### Ratio 2 — outdoors in sunlight (the honest correction)

**[COMPUTED]** `L = E·ρ/π`, E = 100,000 lux (direct sunlight), ρ = 0.80 (white paper).

- White paper in direct sun: 100,000 × 0.80 / 3.14159 = **25,465 cd/m²**
- Phone at outdoor peak: **3,000 cd/m²** [SOURCED — Apple]
- Ratio: 3,000 / 25,465 = **0.118**

**The user's suspicion is correct and should be stated as a correction.** In direct sunlight, white paper beside the phone is about **8.5× brighter** than the phone's 3000-nit outdoor peak — the phone reaches only about **12%** of sunlit paper's luminance. Sunlit snow (27,100 cd/m²) is ~9× the phone. Even *sunlit grass*, at a visible reflectance of only 0.10, computes to 3,180 cd/m² — marginally **brighter** than the phone's outdoor peak. And the clear blue sky behind it all sits at 5,000–10,000 cd/m².

Robustness of this conclusion: it survives the full honest uncertainty bracket. Even at the most phone-favourable assumptions (ρ = 0.7 paper, E = 100 klux → 22,300 cd/m²) the phone is still 7.4× dimmer. To make a phone at 3000 nits brighter than sunlit paper you would need paper reflectance below ~0.094, which is physically impossible for white paper. **This is a hard conclusion, not a marginal one.**

Corroborating independent evidence that phones lose the outdoor brightness contest: display-engineering literature notes that "a standard 200 nit LCD with a 300:1 contrast ratio in a dark room will have less than 2:1 contrast under strong direct sunlight," and that a sunlight-readable display needs to maintain at least 5:1 contrast. [SOURCED] — [US Patent 7427140](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7427140). The entire engineering problem of "sunlight readability" exists *because* displays cannot out-shine sunlit surfaces; they can only try to stay legible against them.

### Verdict — how the emissive-vs-reflective claim must be stated

**What is FALSE and must not be claimed:**
- "A phone is brighter than anything in nature." False outdoors by a factor of ~8.
- "A phone at 3000 nits out-shines the sunlit world." False — it reaches 12% of sunlit white paper, and is even slightly dimmer than sunlit grass.
- Any version that compares the phone's nits to a room's lux. Different quantities; the comparison is meaningless.

**What is TRUE, sourced, and still vivid — three claims, in order of strength:**

1. **Independence from ambient light (the real structural difference).** Every reflective surface's luminance is *proportional* to the light falling on it: `L = E·ρ/π`. Turn the lights down by 1000× and the paper goes dark by 1000×. A display is emissive, so its luminance is set by the device, not the room. This is the honest core of the emissive/reflective distinction and it needs no exaggeration: paper under 500 lux is 127 nits and under 1 lux is 0.25 nits, while the phone is whatever you set it to, in both rooms. [COMPUTED from a SOURCED formula]

2. **The extreme ratio against a dark surround (the vivid number).** Because of (1), the phone's and the room's luminances decouple completely at night. In a 1–5 lux dark room, a phone at a moderate 200 nits is **~250–1,250× brighter than its surroundings**; at 1000 nits, **~1,250–6,300×**. No natural night-time scene presents the eye with anything like that ratio in a small, fixed, near-field patch. Additionally the surround is below the photopic threshold (~5 cd/m²) while the screen is far above it — the screen is the only photopic object in the visual field. This is the claim that justifies "the only light source in your visual field," and it is literally true. [COMPUTED + SOURCED threshold]

3. **Daytime brightness is about legibility, not supremacy.** The 3000-nit outdoor peak exists so the screen stays *readable against* a 25,000-nit sunlit world, not to beat it. Framing it as "bright enough to compete with sunlight" is accurate; "brighter than sunlight" is not.

**Suggested one-sentence formulation for the report:**
> A phone at 3000 nits is not brighter than the sunlit page beside it — white paper in direct sun emits roughly 25,000 nits, about eight times more. What makes a screen different is not that it wins on raw brightness, but that its brightness is *untethered from the room*: in a dark bedroom at 1–5 lux, the walls around you sit at a fraction of a nit while the screen holds hundreds, a ratio of several hundred to several thousand to one — and it is the only object in your visual field bright enough to keep your eyes in full daylight vision.

### Inferences
- The accurate framing is arguably *more* persuasive than the exaggerated one for the report's purpose, because the mechanism it points at (ambient-decoupled light in an otherwise dark field, at night, close to the face) is exactly the mechanism relevant to night-time screen use — whereas "brighter than the sun" would be both false and irrelevant to that mechanism.
- Chart advice: a log-scale axis is mandatory — the table spans 10⁻⁶ to 10⁹ cd/m², fifteen orders of magnitude. Computed rows should be visually distinguished from sourced rows (e.g. hollow vs filled markers) so the reader can see which values rest on an assumed reflectance.

### Gaps
- The 1–5 lux "dark room" ambient and the ρ=0.5 surround reflectance are **my stated modelling assumptions**, not measured values for any particular bedroom; the ρ=0.5 is anchored to IES/ASHRAE wall-reflectance guidance [SOURCED] but the 1–5 lux bracket is a reasonable stipulation. The report must present these as assumptions, which is why the ratio is given as a range rather than a single figure.
- No source found for full-field sustained (as opposed to peak-window) phone luminance; if the report wants to be maximally careful it should say the 3000-nit figure is an outdoor *peak* spec. See Q4 Gaps.
