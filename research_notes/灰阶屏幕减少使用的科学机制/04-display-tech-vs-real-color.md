# Display Technology vs. Real-World Color: Spectral, Gamut, Luminance, Temporal and Circadian Differences

> Scope note for the report writer: every number below carries an inline source. Where I could not verify a figure that the assignment asked for, it is in a **Gaps** block rather than estimated. Several numbers the brief suggested ("% of P3/Rec.2020 falling *outside* Pointer's gamut", "saturation distribution in UI design", "thumbnail saliency quantification") could **not** be verified and are flagged explicitly — do not chart them.

---

## METAMERISM / spectral difference: broadband reflectance vs. 3 narrow-band primaries

### Takeaway
A real surface returns a smooth, broadband, low-dimensional reflectance spectrum, while a display builds the *same perceived color* out of three narrow emission peaks — OLED primaries at roughly 50 nm FWHM, quantum dots at 20–40 nm. The match is exact for the standard observer by construction (metamerism), but the physical spectra are entirely different, which is why displays can reach saturations no smooth reflectance can.

### Cited Findings
- Pointer's gamut of real surface colors was derived from the color coordinates of **4089 samples**, published in *Color Research & Application* vol. 5, pp. 145–155 (1980), in both CIE 1976 L\*u\*v\* and L\*a\*b\* spaces — [Pointer 1980, Wiley](https://onlinelibrary.wiley.com/doi/10.1002/col.5080050308); [Semantic Scholar record](https://www.semanticscholar.org/paper/The-Gamut-of-Real-Surface-Colours-Pointer/682a9a6ff9e1e5234b78578e73295824762f5144)
- Natural surface reflectance spectra are **smooth and continuous**, and lie in a low-dimensional subspace: commonly **5–7 linear basis functions** suffice for most objects (natural ones such as fruit and leaves, and artificial ones such as plastics and paints); some frameworks use 6–12, and as few as **3 basis functions** give a rough approximation of natural illuminant and reflectance spectra — [Spectral Representation of Object Colours, IS&T CIC](https://library.imaging.org/admin/apis/public/api/ist/website/downloadArticle/cic/20/1/art00011); [Spectral Reflectance Estimation with Smoothness Constraint, IS&T](https://library.imaging.org/admin/apis/public/api/ist/website/downloadArticle/cic/30/1/26)
- Quantum-dot emission FWHM: **Cd-containing QDs typically 25–40 nm**; **Cd-free QDs 35–75 nm**. Material-specific: green CdSe **23 nm** vs. green InP **38 nm**; red CdSe **20 nm** vs. red InP **39 nm** — [Nature Scientific Reports, microfluidic QD-LEDs](https://www.nature.com/articles/s41598-020-70838-w)
- QD-OLED architecture (blue OLED + red/green QD color converters, as Samsung uses) has an emission-peak FWHM **about half that of organic LED emitters: 20–30 nm vs. ~50 nm** — [Quantum Dots + OLED = Your Next TV, IEEE Spectrum via ResearchGate](https://www.researchgate.net/publication/357730897_Quantum_Dots_OLED_Your_Next_TV_Formerly_rival_technologies_will_come_together_in_new_Samsung_displays)
- Narrow-FWHM primaries are the *explicit design goal*: with narrow FWHM, QDs can be tuned to primaries corresponding to **100% of DCI-P3 and up to ~90% of BT.2020** — [Nature Scientific Reports](https://www.nature.com/articles/s41598-020-70838-w)
- Saturated color physically *requires* a narrow-band spectral distribution; surfaces with smooth spectral distributions "cannot be extremely saturated by the very nature of their spectral distribution" — [Chris Brejon, Albedo and Pointer's Gamut](https://chrisbrejon.com/articles/albedo-and-pointers-gamut/)

### Inferences
- The causal chain for the explainer: **narrow emission peaks → high purity/excitation purity → saturations unreachable by any smooth reflectance curve.** Saturation and spectral bandwidth are two descriptions of the same physical fact, which is why "screens are more colorful than the world" is a statement about physics, not about taste.
- Precise framing of metamerism for the explainer: two spectra are metamers when their integrals against the three cone fundamentals (or CIE x̄ȳz̄) are equal, even though the spectra differ pointwise. A display does not reproduce a leaf's spectrum; it reproduces the leaf's **three cone excitation values**. For the CIE standard observer the match is exact; for an individual whose cone fundamentals differ (lens yellowing with age, macular pigment density, cone-opsin polymorphism), the same pair can fail to match — **observer metameric failure**. The match is therefore guaranteed only for an average observer, and the narrower the primaries the more sharply any mismatch is expressed, because a small shift in a cone fundamental changes the integral much more when the stimulus energy is concentrated in a narrow band.
- Important nuance to keep the explainer honest: metamerism per se is **not** a perceptual problem — color matching works. The perceptual consequences are (a) observer metameric failure between individuals/devices, and (b) the access to supra-natural saturation. Do not claim people "see screen color as wrong."

### Gaps
- I could not find a single authoritative source giving a **typical FWHM for natural reflectance spectra** in nanometers. This is because the quantity is not well-defined for reflectance: a reflectance curve is a ratio from 0–1 across 380–780 nm, usually monotonic or broadly humped rather than peaked, so it has no meaningful "peak width." The defensible contrast for a chart is **basis-function dimensionality and smoothness (5–7 basis functions, smooth/continuous)** versus **emission-peak FWHM in nm (20–50 nm)** — NOT an FWHM-vs-FWHM comparison. Flagging this so the writer does not invent a natural FWHM number.
- I did not verify specific *per-model* OLED primary FWHM from a display spec sheet or SID paper (Apple/Samsung do not publish FWHM). The ~50 nm OLED figure is from the IEEE Spectrum/ResearchGate source above and should be cited as "approximately."

---

## GAMUT and SATURATION: sRGB vs. DCI-P3 vs. Rec.2020 vs. Pointer's gamut

### Takeaway
Rec.2020 covers 99.9% of Pointer's gamut of real surface colors and DCI-P3 covers 86.9%, so a modern wide-gamut phone can render essentially the whole range of real object colors — and, crucially, can also render highly saturated colors that **no ordinary reflective surface produces**, of the kind otherwise seen only in emissive sources such as neon, LED brake lights and lasers.

### Cited Findings
- Coverage of Pointer's gamut, measured in the CIE 1931 xy chromaticity diagram: **sRGB 69.4%**, **Adobe RGB 86.2%**, **DCI-P3 86.9%**, **Rec.2020 99.9%** — [TFTCentral, The Pointer's Gamut](https://tftcentral.co.uk/articles/pointers_gamut)
- Rec.2020's primaries are monochromatic at **630 nm (R), 532 nm (G), 467 nm (B)**, and this choice is what yields the 99.9% coverage of Pointer's gamut in xy — [Christie Digital, Realizing real-world color with Rec. 2020 (whitepaper PDF)](https://www.christiedigital.com/globalassets/help-center/whitepapers/documents/rec-2020-techbrief.pdf)
- It is geometrically **impossible for a three-real-primary RGB space to cover a true 100%** of Pointer's gamut, because a triangle cannot be fitted to the irregular shape of the real-surface-color solid — [TFTCentral](https://tftcentral.co.uk/articles/pointers_gamut)
- Colors that fall **outside** the Pointer set are specifically **emissive**: neon signs, LED brake lights on cars, and similar highly saturated sources — [Christie Digital whitepaper](https://www.christiedigital.com/globalassets/help-center/whitepapers/documents/rec-2020-techbrief.pdf)
- "Highly saturated colors were rare in the measured natural scenes" — natural images are characterized by predominantly **low-saturation** colors, and environmental color distributions carry a **bluish–yellowish bias** that may have shaped human chromatic sensitivity — [Webster lab / Network: Computation in Neural Systems 18(3):213–233](https://labs.psych.unr.edu/websterlab/files/WebsterNetwork2007.pdf)
- Even the best consumer displays cover only roughly **60–80% of Rec.2020**, so Rec.2020 is today a container standard rather than a shipped capability — [Android Authority, Color gamuts explained](https://www.androidauthority.com/color-gamuts-guide-3035782/)
- Real-surface reflectance is bounded in a way emission is not: very dark materials such as charcoal reflect only **3–5%** of incident light (total albedo ~0.04), while fresh snow reaches albedo **0.81–0.90** — [Chris Brejon](https://chrisbrejon.com/articles/albedo-and-pointers-gamut/)

### Inferences
- The key-point the brief asked to verify is **directionally confirmed but with an important correction**: the literature confirms (a) natural object colors are mostly low-to-moderate saturation, and (b) the colors lying outside Pointer's gamut are emissive, not reflective. So yes — a P3 display reaches saturations almost no natural *surface* reaches. But the commonly circulated framing "displays exceed nature" should be stated carefully: the display's advantage is over **reflective object colors**, not over nature as a whole, since nature contains emissive and spectrally-pure phenomena (rainbows, fire, bioluminescence, sky scattering) too.
- Note for charting: the 69.4 / 86.2 / 86.9 / 99.9% figures are **2-D chromaticity (xy) coverage of Pointer's gamut**, not 3-D volume coverage, and not "% of the standard the display achieves." These are three different quantities that are routinely conflated in marketing material. Label the axis precisely.
- sRGB at 69.4% is a useful historical anchor: the pre-2015 web/UI color space could not even represent ~30% of real surface colors, while the P3 displays shipping since (iPhone 7 onward) jumped to 86.9% — the move to wide gamut was sold as realism, and simultaneously handed designers access to the supra-reflective saturation range.

### Gaps
- **Could not verify the reverse statistic the brief requested**: what percentage of DCI-P3 or Rec.2020 **falls outside** Pointer's gamut. TFTCentral explicitly states it does not compute this reverse measure, and I found no other source that does. This is a real analytical gap, not just a sourcing gap — the number would depend on whether you compute it in xy area, in a uniform space (L\*u\*v\*/L\*a\*b\*/ICtCp), or as 3-D volume, and those give materially different answers. **Do not chart a number here.** If the explainer needs this, it must be computed from Pointer's tabulated data, and the methodology stated.
- **No quantitative analysis found of saturation distributions in UI/app design or thumbnails** versus natural scenes. I found the natural-scene side (Webster) but nothing comparable and citable for UI chrome, app icons, or video thumbnails. The brief's suggested "UI/thumbnail saliency quantitative analyses" — see the natural-scene-statistics section below for what I did and did not find.

---

## LUMINANCE and EMISSIVE vs. REFLECTIVE

### Takeaway
A current flagship phone emits about 1000 cd/m² in normal SDR use, 1600 cd/m² for HDR highlights and up to 2000–3000 cd/m² outdoors — a self-luminous source held ~30 cm from the eye whose output is set by the device, not by the ambient light, which is the structural difference from every reflective surface in a room.

### Cited Findings
- **iPhone 17**: 1000 nits max typical brightness; **1600 nits peak (HDR)**; **3000 nits peak (outdoor)** — [Apple, iPhone 17 Tech Specs](https://support.apple.com/en-us/125089)
- **iPhone 16 Pro Max** and **iPhone 15 Pro/Pro Max**: 1000 nits typical; 1600 nits peak HDR; **2000 nits peak outdoor** — [Apple, iPhone 16 Pro Max Tech Specs](https://support.apple.com/en-us/121032); [Apple, iPhone 15 Tech Specs](https://support.apple.com/en-us/111831)
- Independent measurement broadly corroborates the spec: LTT Labs measured **1033 nits at 100% SDR** and 1036 nits at 100% HDR on iPhone 17 Pro, and **~2906 nits at 1% window** for outdoor peak — [iPhone 17 Pro screen review, screendetect.com](https://screendetect.com/devices/apple-iphone-17-pro)
- The display's emission is the dominant variable in circadian terms, and in a controlled five-primary metameric-display experiment the melanopic content of the screen — not its photopic brightness — drove sleep latency and melatonin (see circadian section for numbers) — [Commun Biol / PMC9974389](https://pmc.ncbi.nlm.nih.gov/articles/PMC9974389/)
- 50% suppression of melatonin occurred at **<30 lux** in some individuals, "comparable to or lower than typical indoor lighting used at night, as well as light produced by electronic devices," with a **>50-fold difference in sensitivity across individuals** — [Chronobiology systematic review, Taylor & Francis](https://www.tandfonline.com/doi/full/10.1080/07420528.2018.1527773)

### Inferences
- The physics of the emissive/reflective distinction, which the explainer can state confidently from the reflectance bounds above: a reflective surface's luminance is **ambient illuminance × reflectance/π**, and reflectance is capped (snow ~0.81–0.90, white paper somewhat lower, charcoal 0.03–0.05). A page therefore **cannot be brighter than its surroundings** and tracks them automatically — dim the room and the page dims. A display sets its own luminance independent of the room, so at night it can be the brightest object in the visual field by one to two orders of magnitude and does not dim as the environment does.
- Consequences for attention and circadian signaling follow from that independence: (a) the screen remains a high-contrast, high-salience region regardless of ambient adaptation state, so it continues to win the competition for gaze; (b) the eye's adaptation level is set largely by the screen, so pupil constriction and light adaptation are driven by the device; (c) circadian photoreception integrates retinal irradiance over time, so a self-luminous source at close range at night delivers a melanopic dose the ambient environment would not have produced at that hour.

### Gaps
- **I could not verify, from a primary source, typical luminance values for a white page indoors or for outdoor daylight.** These are standard textbook numbers (commonly quoted as roughly 100–300 cd/m² for a well-lit white page indoors, and ~2,000–10,000+ cd/m² for outdoor scenes, with sunlit white approaching 10⁴ and the solar disc far higher), but within my search budget I did not land a citable primary reference and I will not present unsourced figures as verified. **The report writer must source these separately before charting them** (good candidates: Hunt, *The Reproduction of Colour*; Fairchild, *Color Appearance Models* Ch. 1; or a CIE/IES lighting handbook). Flagging this because the phone-vs-page-vs-daylight comparison is central to the brief, and the asymmetry it illustrates is real — but the specific nits for page and daylight are currently **unverified**.

---

## Natural scene statistics vs. UI/app statistics

### Takeaway
Natural images have a characteristic 1/f amplitude spectrum and are predominantly low-saturation, and the early visual system appears tuned to exactly those statistics — so deviations from them (high saturation, high local contrast) are by construction unusual stimuli. The contrasting quantitative characterization of UI/thumbnail statistics that the brief asked for does **not** appear to exist in the literature I could reach.

### Cited Findings
- Field (1987), "Relations between the statistics of natural images and the response properties of cortical cells," *J. Opt. Soc. Am. A*: natural images have an amplitude spectrum in which average contrast falls roughly **inversely with spatial frequency (1/f)** — a slope of **−1** on log-amplitude vs. log-frequency axes; equivalently **power** falls as **1/f²** — [Field 1987 PDF, RCTN Berkeley](https://www.rctn.org/bruno/npb261b/field_87.pdf)
- Field's significance claim: the spatial-frequency bandwidth and sampling of cortical cells are **well matched** to the spectral distribution of natural scenes, such that the outputs of neighboring neurons are **decorrelated** — [Field 1987](https://www.rctn.org/bruno/npb261b/field_87.pdf)
- Highly saturated colors are **rare in measured natural scenes**; natural scenes show characteristic ratios between luminance and chromatic contrast; chromatic adaptation selectively reduces perceived contrast/saturation of colors along the adapting axis — [Webster, Network: Computation in Neural Systems 18(3):213–233](https://labs.psych.unr.edu/websterlab/files/WebsterNetwork2007.pdf)
- Departure from natural image statistics is linked to **visual discomfort**: Juricevic, Land, Wilkins & Webster (2010) found that images whose amplitude spectra deviate from the natural 1/f slope are judged more uncomfortable — [Juricevic et al. 2010, Perception 39(7), Webster lab PDF](https://labs.psych.unr.edu/websterlab/files/JuricevicPerception2010.pdf); [DOI](https://doi.org/10.1068/p6656)
- Color statistics of natural scenes vary systematically with season, confirming the natural chromatic environment is a measurable, structured distribution rather than arbitrary — [Seasonal variations in the color statistics of natural images](https://www.researchgate.net/publication/5919307_Seasonal_variations_in_the_color_statistics_of_natural_images)
- Related work exists on the independence of color and luminance edges in natural scenes — [Independence of color and luminance edges in natural scenes (Giessen PDF)](https://www.allpsych.uni-giessen.de/karl/pdf/86.collum.pdf)

### Inferences
- The Juricevic/Webster discomfort result is the single most useful finding in this section for the explainer, because it provides an evidence-based bridge from "UI statistics are unnatural" to "unnatural statistics have a measurable perceptual cost" — without needing to assert anything about addiction. It should be presented as what it is: a judged-discomfort effect for images deviating from the 1/f slope, not a demonstration about app interfaces.
- Honest framing for the explainer: the natural-scene-statistics literature establishes the **baseline** (1/f spectra, low saturation, visual system tuned to both). The claim that app UIs and thumbnails systematically violate that baseline is **plausible and mechanistically coherent** but, in what I could find, **not quantitatively established**. The explainer should present the UI side as an observation/argument, not as a measured finding.

### Gaps
- **No quantitative saliency or color-statistics analysis of app UIs, app icons, or video thumbnails was found.** This is the largest evidential gap in my assignment. I searched for it and found nothing citable. The brief's framing ("super-saturated, high local contrast, faces, high-salience design — any quantitative analyses of UI/thumbnail saliency?") should be answered in the report as: **such analyses were not located; the contrast with natural statistics is argued from the natural-scene side only.** Do not fabricate a thumbnail-saturation statistic.
- I did not independently verify Ruderman's specific results (the brief suggested Ruderman); Field and Webster cover the same ground and are verified above.

---

## TEMPORAL structure: refresh, PWM, and cut rates

### Takeaway
Phone OLEDs are not steady light sources — most flagships dim by pulse-width modulation at 240–480 Hz, frequencies that IEEE 1789 classifies as high-risk above modest modulation depths — and short-form video layers an editing pace of roughly 17–25 cuts per minute on top, far faster than conventional film.

### Cited Findings
- OLED displays typically use PWM dimming frequencies of roughly **50–500 Hz**; **nearly all OLED smartphones use 240 Hz or 480 Hz**. LCDs generally start around **1000 Hz or higher** — [DXOMARK, Flicker: the display affliction](https://www.dxomark.com/flicker-the-display-affliction/)
- Per the **IEEE 1789** flicker-risk framework, a 480 Hz PWM phone is high-risk above **40% modulation depth**, and a 240 Hz phone is high-risk above **20%**; the frequency satisfying the low-risk level is **≥1250 Hz** — [DXOMARK](https://www.dxomark.com/flicker-the-display-affliction/)
- As of late 2026, **Apple, Samsung and Google remain at 480 Hz**, while several Chinese display makers ship high-frequency PWM at **3840–5920 Hz with modulation depth under 6–12%** — [andro-news, PWM/flicker-free smartphones 2026](https://andro-news.com/en/pwm-flicker-free-smartphones-2026-eye-safe-display-guide/) *(secondary/enthusiast source — see Gaps)*
- **DC dimming** is the alternative: it varies the voltage to OLED pixels directly rather than pulsing them, reducing brightness without flicker — [Wikipedia, DC dimming](https://en.wikipedia.org/wiki/DC_dimming)
- A peer-reviewed assessment of smartphone OLED flicker effects on the human body exists in *Journal of Information Display* — [Assessment of the effect on the human body of the flicker of OLED displays of smartphones, Taylor & Francis](https://www.tandfonline.com/doi/full/10.1080/15980316.2021.1950854)
- Short-form video editing pace, measured 17 Nov 2026 across 167 public videos (57 Reels, 51 TikToks, 59 Shorts) from 21 large creators: **median 25.2 cuts/minute overall** (Reels 25.5, YouTube Shorts 25.4, TikTok 16.9) and **median shot length 2.3 s** (Reels 2.2 s, Shorts 2.3 s, TikTok 3.1 s); first cut at a median of **2.6 s**, with only **14%** of videos cutting within the first second — [shortformkit short-form-video-hook-study-2026, GitHub, CC BY 4.0](https://github.com/shortformkit/short-form-video-hook-study-2026) *(non-peer-reviewed — see Gaps)*
- Methodology of that dataset: ffmpeg `scdet` scene detection at threshold 8, manually verified via contact sheets, with multiple triggers inside 0.4 s counted as one cut and flashes/zooms excluded; the authors state it is "a snapshot, not a census" and "shows what they do, not what makes a video perform" — [GitHub repo](https://github.com/shortformkit/short-form-video-hook-study-2026)

### Inferences
- The attention mechanism to state (as established vision/attention science rather than a display fact): abrupt luminance and motion transients drive **involuntary, stimulus-driven orienting** — a new object or sudden change captures gaze before voluntary control engages. A cut is a whole-field transient. At ~25 cuts/minute the viewer receives a transient roughly every 2.3 s, so the orienting response is re-triggered continuously and attention is held without any voluntary decision to keep watching. This is the cleanest mechanistic link in the whole brief between display *temporal* structure and attention capture.
- PWM is worth including precisely because it is **invisible yet physically present**: the screen is strobing at 240–480 Hz while appearing steady, another respect in which screen light is not like reflected light (which is steady unless the illuminant flickers). Keep the health framing cautious — IEEE 1789 "risk" categories are exposure guidelines, not demonstrated harm at phone viewing conditions.
- Note that grayscale does nothing to PWM, refresh rate, or cut rate. If the explainer's thesis is that grayscale reduces usage, the temporal channel of attention capture is **untouched** by it — this is an important honest limitation.

### Gaps
- The cut-rate figures rest on **one non-peer-reviewed dataset** (self-published GitHub repo, no institutional affiliation, n=167 videos from 21 large creators, single sampling day). Methodology is transparent and reasonable and the data is openly licensed, but it is **not** an authoritative measurement, and "large creators" is a biased sample. **Cite it with its limitations attached, or treat the numbers as indicative only.**
- **I could not find a comparable rigorous figure for average shot length (ASL) in older media for a like-for-like comparison.** The Cinemetrics-style film-studies literature (Barry Salt, David Bordwell) documents Hollywood ASL falling from roughly 8–11 s mid-century to ~2–4 s in post-2000 action cinema, but I did not verify this within my budget and the "30 seconds" figure returned by search was a *worked arithmetic example from a calculator page*, not an empirical measurement — **do not use it.** A proper film-ASL source is needed before charting short-form against film.
- The 2026 PWM frequency claims (3840–5920 Hz, <6–12% modulation) come from an enthusiast site, not manufacturer specs. Treat as indicative.

---

## CIRCADIAN / melanopsin — and the weak evidence for blue-light filtering

### Takeaway
Melanopsin in ipRGCs peaks near 480 nm and melanopic (not photopic) metrics predict evening-light effects on melatonin and sleep latency; but the clinical evidence that blue-light-filtering lenses or night modes actually improve sleep is weak — the 2023 Cochrane review of 17 RCTs found probably no difference, with sleep effects inconclusive.

### Cited Findings
- ipRGCs contain melanopsin, **maximally sensitive to short-wavelength light peaking at ~480 nm** (approximately 480 nm before accounting for filtering by the lens and ocular media) — [Biologically Relevant Lighting: An Industry Perspective, PMC8215265](https://pmc.ncbi.nlm.nih.gov/articles/PMC8215265/)
- **Melanopic equivalent daylight (D65) illuminance (melanopic EDI / mEDI)** is the standardized quantity for melanopic light, originating in **CIE S 026/E:2018**, and uses the **same melanopic sensitivity function as the Lucas et al. toolbox** — [PMC8215265](https://pmc.ncbi.nlm.nih.gov/articles/PMC8215265/)
- Controlled display experiment (Commun Biol 2023), **72 healthy males aged 18–35, 18 per intensity group**, using a **five-primary metameric display** that modulates melanopsin activation while holding cone activation identical. Four intensity groups at approximately **4–15, 20–50, 65–134, and 90–150 lx mEDI**, with low- vs. high-melanopic conditions separated by **200–300% Weber contrast for melanopsin** — [Commun Biol, PMC9974389](https://pmc.ncbi.nlm.nih.gov/articles/PMC9974389/)
- Results of that study: sleep latency substantially reduced after low-melanopic vs. high-melanopic exposure in the highest intensity group (**F₁,₁₇ = 6.13, p = 0.024**); evening melatonin consistently higher under low-melanopic conditions across all intensity groups; melatonin onset earlier by **~0.5 h** in intensity groups 1, 3 and 4 — [PMC9974389](https://pmc.ncbi.nlm.nih.gov/articles/PMC9974389/)
- **Photopic measures alone show no apparent effect** of a single evening light exposure on PSG-assessed sleep latency, sleep efficiency or slow-wave sleep; **melanopic EDI is the robust predictor** — [Cajochen, Stefani, Schöllhorn, Lang & Chellappa 2022, Lighting Research & Technology / SAGE](https://journals.sagepub.com/doi/10.1177/14771535221078765)
- **2023 Cochrane review** (Singh et al., published 18 Aug 2023, **17 RCTs across six countries**): blue-light-filtering spectacle lenses **probably make no difference** to eye strain, visual performance or sleep quality; effects on sleep-related measures are **unclear/inconclusive**; little or no effect on best-corrected visual acuity; no consistent adverse effects — [Cochrane Library, CD013244.pub2](https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD013244.pub2/full); [Cochrane plain-language summary](https://www.cochrane.org/evidence/CD013244_blue-light-filtering-spectacle-lenses-visual-performance-macular-back-part-eye-protection-and); [Cochrane news release](https://www.cochrane.org/about-us/news/blue-light-filtering-spectacles-probably-make-no-difference-eye-strain-eye-health-or-sleep)
- Cochrane's own conclusion calls for future high-quality RCTs to define the effects on visual performance, macular health and sleep — [Cochrane](https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD013244.pub2/full)
- Blue-light-blocking glasses "may provide small improvements in sleep, but current evidence from randomized controlled trials does not support significant effects"; a dedicated meta-analysis of actigraphic sleep outcomes in RCT crossover trials exists — [Efficacy of blue-light blocking glasses on actigraphic sleep outcomes, PMC12668929](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12668929/); [Interventions to reduce short-wavelength light exposure at night: systematic review and meta-analysis](https://www.researchgate.net/publication/341912183_Interventions_to_reduce_short-wavelength_blue_light_exposure_at_night_and_their_effects_on_sleep_A_systematic_review_and_meta-analysis)
- Individual sensitivity to evening light varies **>50-fold**, with 50% melatonin suppression occurring at **<30 lux** in the most sensitive individuals — [Systematic review of light exposure impact on human circadian rhythm, Taylor & Francis](https://www.tandfonline.com/doi/full/10.1080/07420528.2018.1527773)
- Cone photoreceptors appear to contribute little: "Lack of strong evidence for cone photoreceptors' contribution to human melatonin suppression and alerting response to light" — [PMC12273515](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12273515/)

### CRITICAL CORRECTION: grayscale ≠ blue-light filtering

This is the distinction the brief asked to be made explicit and correct. It is a statement about display physics and is unambiguous:

- An RGB display produces **every** color, including every shade of gray and white, by **mixing all three primaries**. Neutral gray is by definition approximately equal contribution from R, G and B. **A gray pixel therefore emits blue light.** Mid-gray on an sRGB display emits blue at roughly the same proportion of its total output as white does — grayscale changes the *ratios between pixels*, not the *spectral content of a given pixel's white point*.
- Mechanically: a grayscale transform replaces each pixel's (R,G,B) with (Y,Y,Y) where Y is the luma. Since the blue channel of the output equals Y, and Y is nonzero for any non-black pixel, **blue emission is nonzero for any visible pixel.** Converting a saturated blue patch to gray actually *reduces* its blue output (B drops from 1.0 to 0.0722), but converting a saturated red or green patch to gray *increases* its blue output (B rises from 0 to 0.2126 or 0.7152 respectively).
- Consequence: **total blue emission under grayscale can go either up or down depending on content**, and for typical mostly-light UI content (white backgrounds, dark text) it changes very little, because white was already full-blue and stays full-blue. Grayscale is **not** a blue-light reduction intervention and should never be described as one.
- The intervention that *does* reduce melanopic output is a **white-point shift** — Night Shift / Night Light / f.lux, which warms the white point by attenuating the blue primary and so lowers melanopic EDI at matched photopic luminance. Grayscale and white-point warming are **orthogonal transforms**: one removes chroma, the other moves the white point. You can apply either, both, or neither.
- And the honest caveat on top of that: per Cochrane 2023 and the meta-analyses above, even the interventions that genuinely do cut blue/melanopic light have **weak and inconsistent evidence** of improving sleep. So any grayscale claim routed through "less blue light → better sleep" fails twice over: the premise is false *and* the downstream link is poorly supported.

### Inferences
- The defensible mechanism for grayscale, if the explainer wants one, is **reward/salience**, not circadian: removing chroma strips a salience channel and the color-coded reward cues of app icons, thumbnails and notification badges. It is a motivational-salience argument, not a photobiological one. Keep these two arguments strictly separate in the explainer.
- The metameric-display study is the strongest single piece of evidence for the circadian side, and notably it was engineered to vary melanopsin activation **while holding cone activation (i.e. perceived color) constant** — direct experimental proof that *perceived color and circadian impact are independent*. That is itself the cleanest demonstration that you cannot infer melanopic dose from how colorful a screen looks, which is exactly the grayscale confusion.

### Gaps
- One fetched summary of PMC9974389 contained an internally inconsistent sentence stating "mEDI is a poor predictor of NIF response amplitude" while simultaneously establishing melanopic irradiance as the superior metric; this looks like a garbled extraction (the paper's thesis, and its title, is that melanopic irradiance *defines* the impact). **The writer should re-read the primary paper before quoting any claim about mEDI's predictive power**, and rely on the Cajochen 2022 meta-analysis for the "melanopic beats photopic" framing, which is unambiguous there.
- I did not verify the exact melanopic DER or melanopic EDI values for specific phone displays with and without Night Shift. That number would strengthen the explainer and is not in my notes — flag as needing a dedicated measurement source.

---

## WHY screens are colorful: technology history and the functional value of color

### Takeaway
I was able to verify the colorimetric/standards history (Rec.709 in 1990 for CRT-era HD; the later P3/Rec.2020 widening) but **not** the consumer-hardware history or the HCI literature on color's functional role, which remain gaps.

### Cited Findings
- **ITU-R BT.709 was first published in 1990**, defining HD color encoding — primaries, D65 white point, transfer function and luma/chroma matrix coefficients. It was **designed for CRT displays** and remains the default color space for nearly all HD SDR content (broadcast, Blu-ray, streaming) — [ITU-R BT.709 overview, TAG V.S. community wiki](https://community.tagvs.com/contentview/Wiki/2447016451)
- Rec.709's coefficients were revised across editions: **BT.709-1 used 0.2125 / 0.7154 / 0.0721**, while **BT.709-5 and later (including -6) use 0.2126 / 0.7152 / 0.0722** — [Wikipedia, Luma (video)](https://en.wikipedia.org/wiki/Luminance_(video)); [ITU-R BT.709 overview](https://community.tagvs.com/contentview/Wiki/2447016451)
- Standard-definition digital formats following **CCIR 601** use the older coefficients **0.299 / 0.587 / 0.114** — [Wikipedia, Luma (video)](https://en.wikipedia.org/wiki/Luminance_(video)); [Imatest, Luminance](https://www.imatest.com/docs/luminance/)
- The commercial driver for wide gamut is explicit in the QD literature: narrow-FWHM primaries are engineered specifically to hit 100% DCI-P3 / ~90% BT.2020, and "display devices with narrow-FWHM red, green and blue primary light are able to show **vivid views** with high color gamut and high visual quality" — [Nature Scientific Reports](https://www.nature.com/articles/s41598-020-70838-w)
- Apple's own framing of color in the OS is accessibility-oriented: Color Filters exist to help users with "color blindness or other vision challenges" **differentiate between colors** — i.e. Apple treats color as information-bearing — [Apple Support, Display and text size preferences](https://support.apple.com/en-us/111773)

### Inferences
- A balanced framing the explainer can make from the verified material without overclaiming: color in a display pipeline is engineered along **two independent axes with different motivations**. (1) *Fidelity* — Rec.709 → P3 → Rec.2020 widened gamut to encompass real surface colors (69.4% → 86.9% → 99.9% of Pointer's), a genuine realism goal. (2) *Vividness* — the same narrow-primary technology that delivers fidelity also delivers saturation beyond reflective nature, and the QD industry literature markets this as "vivid," a preference/appeal goal. The explainer should concede that axis (1) is legitimate engineering and that color genuinely carries information (Apple's own accessibility rationale presupposes it), while noting that axis (2) is where "unnaturally attention-grabbing" lives.
- The fact that Apple ships Color Filters *as an accessibility feature to help distinguish colors* is a useful piece of evidence that color is functionally load-bearing in UI — and it is also why grayscale has accessibility costs (next section).

### Gaps
- **Monochrome-to-color consumer hardware history is unverified.** I did not source the monochrome CRT → color CRT transition, the Game Boy (1989, monochrome STN LCD) → Game Boy Color (1998) transition, or monochrome-to-color phone screens. These are well-known facts but I have no citation for them and did not spend budget on them, since the brief marked this as "brief history." **Needs sourcing before use.**
- **No HCI/design-research citations found for the functional value of color in UI** — information coding, affordances, visual hierarchy, legibility, redundant coding for accessibility. I did not locate primary sources (e.g. WCAG's "use of color" criterion, Ware's *Information Visualization*, Tufte, or empirical search/visual-coding studies). The brief asked for this to keep the explainer balanced, and it is **not** covered by my notes. Recommend a dedicated source pass: WCAG 2.2 Success Criterion 1.4.1 (Use of Color) is the obvious citable anchor for "color must not be the only means of conveying information."

---

## What an OS grayscale filter actually DOES technically

### Takeaway
Grayscale is a luminance-weighted desaturation applied as a display-stage transform over the whole composited screen — mathematically a rank-1 3×3 matrix built from the Rec.709 luma coefficients 0.2126/0.7152/0.0722 (verified) — which changes what is shown, not what any app renders, and which collapses any information that was encoded in hue alone.

### Cited Findings
- **Rec.709 luma: Y' = 0.2126 R' + 0.7152 G' + 0.0722 B'** — verified, and these are the coefficients of BT.709-5 and later editions — [Wikipedia, Luma (video)](https://en.wikipedia.org/wiki/Luminance_(video)); [ITU-R BT.709 overview](https://community.tagvs.com/contentview/Wiki/2447016451); [Imatest, Luminance](https://www.imatest.com/docs/luminance/)
- Note the **prime symbols**: BT.709 derives luma "from the **gamma-encoded** components," i.e. Y' is a weighted sum of non-linear R'G'B', which is **luma**, not CIE **luminance** Y (which would require the same weights applied to *linearized* RGB) — [Wikipedia, Luma (video)](https://en.wikipedia.org/wiki/Luminance_(video))
- Apple's Color Filters offer four presets: **Grayscale, Red/Green for Protanopia, Green/Red for Deuteranopia, Blue/Yellow for Tritanopia**, reached via Settings → Accessibility → Display & Text Size → Color Filters (macOS: Apple menu → System Settings → Accessibility → Display) — [Apple Support, Display and text size preferences](https://support.apple.com/en-us/111773); [Apple Support, Change Display settings for accessibility on Mac](https://support.apple.com/guide/mac-help/change-display-settings-for-accessibility-unac089/mac)
- **"You can adjust the intensity of any of the Color Filters to fit your needs"** — there is an intensity slider, so grayscale is a continuously-weighted blend, not a binary toggle — [Apple Support](https://support.apple.com/en-us/111773)
- The related Color Tint feature applies to **"the entire display"** on iPhone/iPad/iPod touch, confirming these transforms are whole-display, not per-app — [Apple Support](https://support.apple.com/en-us/111773)
- Platform-agnostic accessibility guidance documents grayscale display modes as an OS-level display setting across platforms — [freee Accessibility Guidelines, How to Switch to Grayscale Display (Ver. 202611.0)](https://a11y-guidelines.freee.co.jp/en/explanations/grayscale.html)

### Inferences
- **The matrix.** Full grayscale is the 3×3 matrix with every row equal to the luma weights:

  ```
  [ R' ]   [ 0.2126  0.7152  0.0722 ] [ R ]
  [ G' ] = [ 0.2126  0.7152  0.0722 ] [ G ]
  [ B' ]   [ 0.2126  0.7152  0.0722 ] [ B ]
  ```

  This is **rank 1** — it projects the 3-D color cube onto a 1-D line (the neutral axis), which is why the transform is **irreversible**: chroma information is destroyed, not hidden. With an intensity slider at fraction *s*, the applied matrix is `(1−s)·I + s·M`, interpolating between identity and full desaturation; this is the standard saturation-matrix form and matches the documented intensity control, though I did not find Apple documentation of the exact interpolation.
- **Where it sits in the pipeline.** Logically this is a **display-stage / post-composition transform**: apps render in color, the compositor composites in color, and the matrix is applied to the composited framebuffer on its way to the panel (in practice via the GPU's color pipeline or the display controller's color-transform hardware block, which on modern SoCs also hosts gamma/CSC/dither stages). Two consequences worth stating in the explainer: (a) **content is unchanged** — a screenshot or screen recording may still capture color, and the app has no knowledge the filter is active; (b) it is **essentially free** in performance terms, being a per-pixel 3×3 multiply in fixed-function or shader hardware already in the path.
- **Accessibility side effects**, which follow directly from the rank-1 projection: any information carried by **hue alone** becomes ambiguous — red/green status indicators, colored chart series, unread/error badges, required-field highlighting, syntax highlighting, map and transit-line colors, red-vs-green diffs. This is exactly the failure mode WCAG's "use of color" criterion exists to prevent, and grayscale makes every such violation manifest at once.
- **Contrast ratios change, and not uniformly.** Because the weights are extremely unequal (green 0.7152 vs. blue 0.0722, a ~10:1 ratio), two colors can have very different hues but nearly identical luma and so collapse to **indistinguishable grays** — e.g. a saturated blue (luma 0.0722) is nearly black while a saturated yellow (0.9278) is nearly white, whereas saturated red (0.2126) and a mid-gray are close. Pairs that were legible by chroma contrast can fall below usable contrast, while pairs already differing in lightness are unaffected. Note that WCAG contrast ratios are computed from *relative luminance* (linear-light, same weights) and so are *nominally preserved* for text that was already specified against its background in luminance terms — but any pair that relied on hue difference for separation loses it. **Worth stating carefully:** grayscale does not generally *lower* WCAG contrast ratios for well-designed text; it destroys *chromatic* distinctions that WCAG never counted in the first place.

### Gaps
- **Apple does not publish the coefficients or the pipeline stage for its Grayscale filter.** The 0.2126/0.7152/0.0722 matrix is the Rec.709-correct and near-universal implementation (and Rec.709 is the sRGB-matched luma standard, so it is the expected choice), but attributing these specific coefficients *to Apple's implementation* is an **inference, not a verified fact**. Android's `ColorMatrix`/`setSaturation` and Chromium/Skia use the same Rec.709-derived weights, but I did not verify Android or Apple source within budget. **Chart these as "the standard Rec.709 luma coefficients used by grayscale transforms," not as "Apple's matrix."**
- A search result from `lifetips.alibaba.com` claimed iOS grayscale "routes through Apple's Core Image pipeline, adding zero CPU overhead," and that third-party grayscale apps "increase GPU load by 12–19% and often degrade text contrast below accessibility standards." **I have deliberately excluded these numbers.** The source is a low-quality content-farm page with no methodology, and the Core Image attribution is technically implausible for a system-wide display filter (Core Image is an app-level image-processing framework, not the display path). **Do not use the 12–19% figure.**
- I did not verify whether iOS grayscale is applied before or after the display's gamma/EOTF stage, which determines whether the weights act on gamma-encoded (luma) or linear (luminance) values. This matters for exact predicted gray values and is unresolved. Empirically, most implementations operate on gamma-encoded values (true luma).
- No Android (AOSP) documentation of its grayscale/monochromacy accessibility filter was sourced.

---

## Summary of what must NOT be charted without further sourcing

Consolidated for the report writer:

1. **% of DCI-P3 or Rec.2020 falling outside Pointer's gamut** — no source computes this; it is method-dependent. Verified only the forward direction (coverage *of* Pointer's).
2. **Luminance of a white page indoors / outdoor daylight in cd/m²** — not sourced. Phone nits are solidly sourced; the comparison targets are not.
3. **Natural reflectance spectrum "FWHM" in nm** — not a well-defined quantity; use basis-function dimensionality instead.
4. **Saturation/saliency statistics of app UIs, icons or video thumbnails** — no quantitative analysis located.
5. **Average shot length of film for comparison** — the "30 s" search result was a calculator's worked example, not data.
6. **"12–19% GPU load" for third-party grayscale** — content-farm source, excluded.
7. **Attribution of the 0.2126/0.7152/0.0722 matrix specifically to Apple's implementation** — the coefficients are verified as Rec.709; the attribution is inferred.
8. **Monochrome→color hardware history and HCI sources on color's functional role** — not sourced; needed for the "balanced" section.
