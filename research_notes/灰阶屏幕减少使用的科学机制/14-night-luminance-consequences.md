# Documented consequences of viewing a bright emissive screen in a dark environment at night

**Scope note / method caveat.** This round was executed with the session's WebSearch budget already
exhausted (200/200), so discovery was done through the NCBI E-utilities API (PubMed esearch/efetch,
machine-readable) plus targeted WebFetch on PMC full texts. That is a *good* substrate for journal
literature — it is how the Schöllhorn/Cajochen, Phillips, Yuan, Chawla and Shen findings below were
located and verified against primary abstracts — but it is a *poor* substrate for standards bodies.
ISO, IES and OSHA pages returned 403/404 and are not indexed in PubMed. **Consequence: the ISO 9241 /
IES luminance-ratio numbers in question 4 are NOT verified in this round and are recorded as a gap.**
Do not write a number for the standards ratio on the strength of these notes.

---

## Q1. Light adaptation / visual after-effects, and "transient smartphone blindness"

### Takeaway
The transient after-effect is **real, documented, and mechanistically well explained** — but it is a
*binocular asymmetry* phenomenon, not a "bright screen in the dark" phenomenon: it requires one eye
occluded (by the pillow) while the other views the screen. Separately and more seriously, a 2026 case
series documents **non-transient phototoxic maculopathy** from habitual screen use in the dark,
including three eyes that developed choroidal neovascularisation. That is the strongest documented
harm found anywhere in this round, and it is specifically about dark-environment viewing.

### Cited findings

**Transient smartphone "blindness" (TSB)**
- Primary report: Alim-Marvasti A, Bi W, Mahroo OA, Barbur JL, Plant GT. "Transient Smartphone
  'Blindness'." *N Engl J Med* 2016 Jun 23;374(25):2502–4. doi:10.1056/NEJMc1514294. PMID 27332920.
  Affiliations: National Hospital for Neurology and Neurosurgery, City University London, King's
  College London, Moorfields Eye Hospital — [PubMed record](https://pubmed.ncbi.nlm.nih.gov/27332920/)
  - **This is a Letter/Correspondence (pp. 2502–2504), not an original article, and has no structured
    abstract.** The NEJM full text is paywalled (403 on direct fetch) and E-utilities returns citation
    metadata only. **The patient count was therefore NOT verified in this round.** It is widely cited
    secondhand as 2 patients (both women); treat N as unverified until the NEJM text is read.
- Mechanism, as stated by the original authors in a follow-up: Mahroo OA, Alim-Marvasti A, Plant GT.
  "Transient smartphone 'blindness' arises from **interocular differences in retinal adaptational
  states**." *Can J Ophthalmol* 2017 Aug;52(4):425. doi:10.1016/j.jcjo.2017.02.026. PMID 28774528 —
  [PubMed](https://pubmed.ncbi.nlm.nih.gov/28774528/)
- Secondary description of the phenomenon: Hasan CA, Hasan F, Mahmood Shah SM. "Transient Smartphone
  Blindness: Precaution Needed." *Cureus* 2017;9(10). PMCID PMC5741272. Describes TSB as "temporary
  monocular vision loss associated with smartphone usage while lying down in the dark," with the
  mechanism being "conflicting light adaptation between the two retinae" from differential dark/light
  adaptation of each eye — [PMC5741272](https://pmc.ncbi.nlm.nih.gov/articles/PMC5741272/)
- **It is a documented phenomenon with real clinical consequence as a mimic, not merely a curiosity.**
  It generated a dedicated neurology paper on misdiagnosis risk: Sathiamoorthi S, Wingerchuk DM.
  "Transient smartphone blindness: Relevance to misdiagnosis in neurologic practice." *Neurology* 2017
  Feb 21;88(8):809–810. doi:10.1212/WNL.0000000000003639. PMID 28100724 (Mayo Clinic) —
  [PubMed](https://pubmed.ncbi.nlm.nih.gov/28100724/) — i.e. the documented downstream harm is that
  patients get worked up for amaurosis fugax / TIA / optic neuritis.
- The literature is a **correspondence cascade, not a body of experimental work**: a PubMed search for
  "transient smartphone blindness" returns 11 records (2016–2022), of which essentially all are
  letters, comments, author responses or single-case reports across *NEJM*, *Neurology*,
  *Can J Ophthalmol*, *Cureus*, *Tidsskr Nor Laegeforen* (Eriksen & Jørstad 2021, PMID 33754676) and
  *J Fr Ophtalmol* (Robles-Amor et al. 2022, PMID 35868892) — no cohort, no RCT, no prevalence estimate
  — [PubMed search](https://pubmed.ncbi.nlm.nih.gov/?term=transient+smartphone+blindness)

**Phototoxic maculopathy from screen use in the dark — the non-transient finding**
- Yuan J, Wang X, Yan X, Zhao Z, Tu B, Tong Y, Zhang S. "Clinical features of phototoxic maculopathy
  due to screen use in the dark: A case series." *Medicine (Baltimore)* 2026 Jun 12;105(24):e49304.
  doi:10.1097/MD.0000000000049304. PMID 42299599, PMCID PMC13268483. Eye Center, Renmin Hospital of
  Wuhan University — [PMC13268483](https://pmc.ncbi.nlm.nih.gov/articles/PMC13268483/)
  - **10 cases, 13 eyes**, mean age 41.1 ± 17.48 y; 6 male (8 eyes), 4 female (5 eyes). Bilateral in 3,
    unilateral right in 5, unilateral left in 2.
  - **The laterality is the key mechanistic evidence**: "Individuals with unilateral or more severe
    involvement reported a habit of **preferentially using the affected eye** for mobile phone viewing."
    This is the same one-eyed-in-bed exposure geometry as TSB, but producing structural damage.
  - Outcomes: 3 eyes (3 cases) developed **choroidal neovascularisation (CNV)**; 6 eyes (5 cases) had
    disruption of the myoid, ellipsoid and interdigitation zones; 4 eyes (3 cases) had largely intact
    macular structure but **impaired mfERG P1 response density**.
  - Reversibility is partial and stage-dependent: non-CNV cases showed "partial to complete restoration
    of photoreceptor integrity" on OCT; **"anti-VEGF therapy showed limited benefit in CNV cases."**
  - Exposure: "extended screen use in the dark, ranging from **several months to years**." Follow-up
    2 months to 1 year.
  - Authors' mechanism is **photochemical blue-light phototoxicity** — ROS generation, "photoreceptor
    degeneration, lipid peroxidation, and apoptosis."
  - Authors' own acknowledged limitations: "small sample size may introduce bias"; confounders (age,
    smoking, genetics) "not analyzed"; retrospective design "preclude[s] causal inferences."

**Standard-of-care support for the adaptation-state framing**
- Chawla AS, Samei E. "Ambient illumination revisited: a new adaptation-based approach for optimizing
  medical imaging reading environments." *Med Phys* 2007 Jan;34(1):81–90. doi:10.1118/1.2402583.
  PMID 17278493 — [PubMed](https://pubmed.ncbi.nlm.nih.gov/17278493/)
  - States the mechanism in exactly the user's terms: "Low illuminance levels, however, create
    inadequate viewing conditions and **may also cause eye strain. This eye strain may be potentially
    attributed to notable variations in the luminance adaptation state of the reader's eyes when moving
    the gaze intermittently between the brighter display and darker surrounding surfaces.**"
  - Built a computational model of global luminance adaptation value *L*adp based on **pupil diameter**,
    and compared it to surround luminance *L*s across room illuminance *E* and surface diffuse
    reflection coefficients *R*s.
  - Prescriptive output: **room illumination of 75–150 lux** with surface diffuse reflection
    coefficients of **0.13–0.22 sr⁻¹** "provide an ideal setup for typical LCDs," minimising adaptation
    differences and "potentially reducing visual fatigue" while still complying with AAPM TG18 contrast
    specifications.
  - **This is a radiology-reading-room paper, i.e. the professional domain that has actually had to
    solve "bright display in a dark room," and its answer was to RAISE the ambient, not to dim the
    display.** That is a directly citable, non-blue-light, standards-adjacent authority.

### Inferences
- The TSB mechanism and the Yuan maculopathy mechanism share an exposure geometry — **one eye
  preferentially viewing a phone in the dark** — and they differ in dose (minutes vs months-to-years)
  and in reversibility (seconds-to-minutes vs partly permanent, with CNV essentially untreatable).
  A section can honestly present these as the *same* risk axis at two doses.
- Critically for the user's framing: **TSB is not caused by the screen-to-surround luminance ratio per
  se.** It is caused by the *interocular* difference in adaptation state. Binocular phone viewing in a
  dark room — the normal case, and the case the user's 250–6,300× ratio describes — does not produce
  TSB. **Do not use TSB as the payoff for a luminance-ratio section; it is a payoff for a
  one-eyed-in-bed section.** This is a real risk of overclaiming and the user should be warned.
- The Yuan series is a genuine signal but is **10 retrospective cases with self-reported exposure and no
  denominator**. It cannot support a population risk statement. It *can* support "there are case
  reports of structural retinal damage, including irreversible CNV, in habitual dark-environment
  one-eyed phone users." It also cuts against the user's project framing in one respect: the authors
  attribute it to **blue light specifically**, not to total luminance — so it does not rescue a
  luminance-ratio argument, and it would sit awkwardly in a report whose premise is that the
  blue-light chain is broken.

### Gaps
- **N, symptom duration, and investigations in the NEJM 2016 report are unverified** (paywalled
  correspondence; no abstract in PubMed). Needs institutional access to NEJM 374:2502–4.
- **The specific claim "smartphone viewing attenuates ERG amplitudes with recovery over minutes" was
  NOT verified.** A PubMed search for smartphone/mobile-phone AND electroretinogram AND dark/adaptation
  returns exactly **one** record — the Yuan 2026 maculopathy series (which used *multifocal* ERG as an
  outcome in chronically damaged eyes, not as a transient-adaptation measure). **No study was found
  that measured transient ERG attenuation and recovery kinetics after acute smartphone viewing in the
  dark.** If an earlier round reported this, it was probably a conflation with the Yuan mfERG finding
  or with the general dark-adaptation literature. Treat as unsupported pending a specific citation.
- No study found that measured **contrast sensitivity, glare recovery or photostress recovery time
  specifically after night-time phone use**. The glare-recovery literature that exists is about aging,
  macular pigment and cataract, not screens (e.g. Richer et al., *Nutrients* 2021;13(9):3191,
  PMID 34579067, a carotenoid RCT where glare recovery time improved ~2.5–2.8 s — useful only as
  evidence that glare recovery time is a *measurable* quantity, not as evidence about screens).
- The cones 5–7 min / rods 30–45 min re-adaptation figures were not re-verified against a primary
  source in this round; they are standard textbook psychophysics but should be cited to a vision-science
  text or review, not left unsourced.
- **No evidence found either way on the practical consequences** (getting up in the night, driving at
  night after phone use). No study operationalised this.

---

## Q2. Circadian / melatonin assessed on light intensity rather than blue specifically

### Takeaway
**This is the strongest and most quantitatively usable finding of the round, and it resolves the user's
crux question — but it resolves it against the "phone delivers too little light to matter" hypothesis.**
A 72-participant Basel study that deliberately decoupled melanopic irradiance from display luminance
found that at smartphone-to-computer luminance levels the corneal melanopic EDI spans roughly
**5 to 150 lx** — and the circadian ED50 is **~25 lux**. So a phone at normal brightness *does* sit on
the steep part of the dose-response curve. However, the same study shows the effect tracks **melanopic**
irradiance, not luminance: at matched luminance, changing only the melanopic content changed the
outcomes. That is an argument *for* spectral tuning and *against* a pure-luminance framing.

### Cited findings

**The decoupling experiment (intensity vs spectrum, held apart by design)**
- Schöllhorn I, Stefani O, Lucas RJ, Spitschan M, Slawik HC, Cajochen C. "Melanopic irradiance defines
  the impact of evening display light on sleep latency, melatonin and alertness." *Commun Biol* 2023
  Mar 1;6(1):228. doi:10.1038/s42003-023-04598-4. PMID 36854795, PMCID PMC9974389 —
  [PMC9974389](https://pmc.ncbi.nlm.nih.gov/articles/PMC9974389/)
  - Design: **"control melanopic irradiance independent of display luminance and colour, in 72 healthy
    males 4 h before habitual bedtime,"** each exposed to one of four luminance levels — explicitly
    described as **"dim light, smartphone, tablet or computer screen illuminance"** — at a low and a
    high melanopic irradiance setting. 3.5 h exposure starting 4 h before habitual bedtime; 2-week
    protocol; five-primary display prototype.
  - **The four luminance groups: 27, 67, 134 and 284 cd/m².** (The companion paper gives the range as
    27–285 cd/m².)
  - **Corneal melanopic EDI spanned approximately 5 lx (dimmest low-melanopic condition) to 150 lx
    (brightest high-melanopic condition)**, with ~200–300% melanopsin contrast between the low- and
    high-melanopic settings at matched luminance. *(Retrieved from PMC full text; the per-cell table
    values were summarised rather than quoted verbatim — see Gaps.)*
  - Results: "Low melanopic light **shortens the time to fall asleep, attenuates evening melatonin
    suppression, reduces morning melatonin, advances evening melatonin onset and decreases alertness**
    compared with high melanopic light."
  - **Dose-response on melanopic irradiance, not on luminance:** "we observe **dose-dependent increases
    in sleep latency, reductions in melatonin concentration and delays in melatonin onset as a function
    of melanopic irradiance — not so for subjective alertness.**"
  - Effect statistics: in the highest luminance group (284 cd/m²) sleep latency was significantly
    reduced after low- vs high-melanopic light, F₁,₁₇ = 6.13, p = 0.024 ("large effect"); melatonin AUC
    showed large effects (ωp² ≥ 0.14) in groups 1, 3 and 4; melatonin onset large effect in group 1
    (F₁,₁₃.₁₂ = 24.39, p < 0.001).
  - Authors' conclusion: **"We identify melanopic irradiance as an appropriate parameter to mitigate the
    unwanted effects of screen use at night."**
- Companion paper confirming corneal measurement is the right reference plane, and quantifying the pupil:
  Schöllhorn I, Stefani O, Lucas RJ, Spitschan M, Epple C, Cajochen C. "The Impact of Pupil Constriction
  on the Relationship Between Melanopic EDI and Melatonin Suppression in Young Adult Males."
  *J Biol Rhythms* 2024 Jun;39(3):282–294. doi:10.1177/07487304241226466. PMID 38348477,
  PMCID PMC11141089 — [PubMed](https://pubmed.ncbi.nlm.nih.gov/38348477/)
  - Same 72 participants, four luminance groups **27–285 cd/m²**, "commonly experienced evening light
    levels (**<90 lx**)", L/M/S-cone-opic irradiances matched with ~3-fold melanopic difference.
  - "Median pupil size was significantly smaller during HM than LM in **all four** light intensity
    groups," and there was "a significant correlation between melanopic weighted corneal illuminance
    (mEDI) and pupil size, such that higher mEDI values were associated with smaller pupil size."
  - Methodological bottom line: **"it remains appropriate to use melanopic irradiance measured at eye
    level"** — i.e. corneal mEDI, not retinal irradiance estimates, is the defensible metric; pupil
    estimation gave "qualitatively similar goodness of fit."

**Dose-response and individual variability — both of the user's figures verified, one needs correcting**
- Phillips AJK, Vidafar P, Burns AC, McGlashan EM, Anderson C, Rajaratnam SMW, Lockley SW, Cain SW.
  "High sensitivity and interindividual variability in the response of the human circadian system to
  evening light." *PNAS* 2019 Jun 11;116(24):12019–12024. doi:10.1073/pnas.1901824116. PMID 31138694,
  PMCID PMC6575863 — [PubMed](https://pubmed.ncbi.nlm.nih.gov/31138694/)
  - 55 participants aged 18–30, within-subjects; dim control (<1 lux) plus 10–2,000 lux for 5 h in the
    evening.
  - **Group-level fitted ED50 = 24.60 lux** — "indicating that the circadian system is highly sensitive
    to evening light at typical indoor levels."
  - **Phase delays: 10, 30 and 50 lux produced later apparent melatonin onsets by 22, 77 and 109 min
    respectively.**
  - **Individual ED50 range: 6 lux (most sensitive) to 350 lux (least sensitive)** — "ranged by over an
    order of magnitude," with a 26% coefficient of variation.
  - Framing the authors themselves give: pre-electric humans saw either ">300 lux or dim (<30 lux)",
    whereas "today, humans spend hours per day exposed to intermediate light intensities (30–300 lux),
    particularly in the evening" — the steep part of the curve.
- **Correction to the user's priors:** the user's "50% melatonin suppression at <30 lux in sensitive
  individuals" is **conservative** — the group ED50 is 24.6 lux, so *fewer than half* the population
  needs <25 lux, and the most sensitive individual needed only **6 lux**. But the user's
  **">50-fold individual variation" is an overstatement of this source**: 6→350 lux is a **~58-fold
  range in the ED50 point estimates of the extreme individuals**, which the authors describe as "over an
  order of magnitude," not as a 50-fold population variation. Phrase it as "ED50 varied from 6 to 350
  lux across individuals (~58× between extremes; 26% CV)" and it is exact and defensible.

**What recent reviews conclude when separating light from content/engagement**
- Dubey SA, Elango N, Blessy Coelho L, Chaudhry M. "Evening Light-Emitting Diode Screen Exposure,
  Melanopsin-Mediated Circadian Disruption, and Optical Filtration for Sleep Hygiene: A Narrative Review
  in the Indian Context." *Cureus* 2026 Jul 27;18(7):e113484. doi:10.7759/cureus.113484. PMID 42524168,
  PMCID PMC13410805 — [PMC13410805](https://pmc.ncbi.nlm.nih.gov/articles/PMC13410805/)
  - Makes exactly the separation the user asked for: **"Screen use is not, however, the same as the
    melanopic light dose actually reaching the retina. Associations between screen time and poor sleep
    may also reflect a later bedtime, mental and emotional arousal, notifications, and the type of
    content viewed. A lens would not change any of these."**
  - On the lens evidence: "Systematic-review evidence rates the case that BLF lenses improve sleep as of
    **low certainty**, with findings that are **indeterminate and heterogeneous rather than clearly
    negative**." Two pooled analyses disagree — an earlier one found a small favourable effect on total
    sleep time; "a later analysis restricted to actigraphic outcomes from randomized crossover trials
    found **no significant effect, with confidence intervals wide enough to indicate imprecision rather
    than a demonstrated absence of effect.**"
  - Key asymmetry, quotable: **"the mechanistic case for lowering evening melanopic light is firmer than
    the clinical case for any particular lens."**
  - **CONFLICT OF INTEREST — material, flag it if cited.** Lead author Suraj A Dubey is an employee of
    and head of R&D at Sleepaxa Private Limited (Acieon Labs) and is "lead inventor on granted Indian
    patent No. 587746 and pending applications relating to wavelength-selective spectral filtration";
    co-author Monica Chaudhry is a paid clinical advisor to the same company. A review of blue-filtering
    lenses written by the patent-holder on blue-filtering lenses. Its *negative* conclusions about
    filtration are credible-against-interest and therefore usable; its positive framing of the
    mechanistic case should be discounted.
- Blume C, Münch M. "Effects of light on biological functions and human sleep." *Handb Clin Neurol*
  2025;206:3–16. doi:10.1016/B978-0-323-90918-1.00008-3. PMID 39864930 —
  [PubMed](https://pubmed.ncbi.nlm.nih.gov/39864930/)
  - "light suppresses the secretion of melatonin in a dose-dependent manner, **mainly depending on
    irradiance and spectral composition of light**" — i.e. both, not spectrum alone.
  - "There is evidence that exposure to light-emitting devices from luminaires and screens before bedtime
    can impact on sleep onset latency, sleep duration, and sleep quality" — note the hedge ("can
    impact"), from a Basel chronobiology group with no lighting-industry COI declared.

**Night-mode / filter interventions: mechanism works on paper, fails in the field**
- Teran E, Yee-Rendon CM, Ortega-Salazar J, De Gracia P, Garcia-Romo E, Woods RL. "Evaluation of Two
  Strategies for Alleviating the Impact on the Circadian Cycle of Smartphone Screens." *Optom Vis Sci*
  2020 Mar;97(3):207–217. doi:10.1097/OPX.0000000000001485. PMID 32168244 —
  [PubMed](https://pubmed.ncbi.nlm.nih.gov/32168244/)
  - Measured radiant flux of **64 smartphones** with an integrating sphere; computed retinal illuminance
    and melatonin suppression values (MSVs) via logistic fit to published data.
  - **"Night-mode functions in smartphones reduced MSVs by up to 93%. The warmest mode produced the least
    suppression. Blue-light-reducing spectacles reduced melatonin suppression by 33%."** Night mode was
    up to **2.25×** more effective than commercial BLF spectacles.
  - **Caveat the user must note: these are MODELLED MSVs from radiometry, not measured melatonin.** This
    is a photometric-modelling paper, not a physiological trial.
- Against that modelled optimism, the field trials are null:
  - Smidt AM, Blake MJ, Latham MD, Allen NB. "Effects of Automated Diurnal Variation in Electronic Screen
    Temperature on Sleep Quality in Young Adults: A Randomized Controlled Trial." *Behav Sleep Med*
    2022;20(5):513–529. doi:10.1080/15402002.2021.1940183. PMID 34176370 —
    [PubMed](https://pubmed.ncbi.nlm.nih.gov/34176370/)
    - Single-blind RCT, n=55 (EG 29 / ACG 26), both groups installed f.lux but only EG had blue-reduction
      active; 1 week; actigraphy 7 nights + PSQI/PDSS/PSAS/PHQ.
    - **"Participants in the EG did not show greater improvement in objective sleep, self-reported sleep,
      or mental health compared to participants in the ACG."** Conclusion: "Automated diurnal variation
      in electronic screen temperature in personal devices did not improve sleep or mental health in
      young adults."
    - Incidental but relevant to the user's engagement thesis: **"Participants in the EG rated the
      software as more distracting and purposely disabled the software more often"** — a documented case
      of a visual-appearance intervention being actively defeated by users.
  - Rabiei M et al. "Do blue light filter applications improve sleep outcomes? A study of smartphone
    users' sleep quality in an observational setting." *Electromagn Biol Med* 2024;43(1-2):107–116.
    doi:10.1080/15368378.2024.2327432. PMID 38461462 — observational, PSQI; ANOVA for blue-filter use vs
    sleep quality **p = 0.925**. "we did not observe sustained positive effects on all parameters of
    sleep quality from the long-term use of blue light filtering apps."
    (Low-impact journal; weak design. Use only as corroboration of a null, not as primary evidence.)

### Inferences
- **The user's crux question is answered, and the answer is NOT the one the user hypothesised.** The user
  expected that a phone's small angular subtense might deliver only a few lux at the cornea, making the
  circadian argument weak. The Basel group's measured corneal values for displays at 27–285 cd/m² land
  in the **~5–150 lx mEDI** band, and they characterise the whole range as "commonly experienced evening
  light levels (<90 lx)". Against a group ED50 of **24.6 lux**, a phone at normal evening brightness is
  **on or above the half-maximal suppression point**, not below it. So "a phone is too dim to matter
  circadianly" is **not** defensible.
- **But this does not rescue a LUMINANCE-RATIO section — it undermines it.** Schöllhorn 2023's entire
  contribution is that at *matched luminance*, outcomes tracked **melanopic** irradiance; and sleep
  latency differed between low- and high-melanopic conditions *within* the same luminance group. The
  operative variable is melanopic dose, which is a *spectral* quantity. A section built on
  "screen-to-surround luminance ratio" is therefore arguing from the wrong photometric quantity for
  circadian outcomes.
- **And this is actively dangerous for the user's grayscale thesis.** If the lever is melanopic EDI, and
  the earlier round established that grayscale does not reduce blue light (net melanopic change ≈ nil
  for a typical light UI), then Schöllhorn 2023 is evidence that **grayscale should NOT be expected to
  produce a circadian benefit** — which is exactly consistent with the Dekker & Baumgartner 2024 and
  Hagerty et al. 2026 sleep nulls the user already has. The circadian literature does not give the
  section a payoff; it gives the section a coherent *explanation for why the nulls were observed.* That
  is still valuable, but it is an explanatory payoff, not a prescriptive one.
- The dark surround cuts the *other* way circadianly than the user's framing implies: a dark-adapted,
  dilated pupil admits more light, and Schöllhorn 2024 confirms pupil size tracks mEDI. So a dark room
  modestly *increases* the retinal melanopic dose from a given screen. This is a legitimate, citable
  reason why "phone in a dark bedroom" is circadianly worse than "phone in a lit room" — but it is a
  pupil-area effect, bounded by the <100× pupil compensation span the user already has, and no study was
  found that measured it for phones specifically.

### Gaps
- **The per-cell table of photopic lux and mEDI for each of the 8 conditions (4 luminances × 2 melanopic
  settings) in Schöllhorn 2023 was summarised by the fetch tool, not quoted verbatim.** The 5–150 lx
  range and the 27/67/134/284 cd/m² values should be re-verified directly against Table 1 / Methods of
  PMC9974389 before publication. **Do not publish the 5–150 lx figure without that check.**
- **No direct measurement was found of corneal illuminance from a phone at a stated nit level and a
  stated viewing distance** — i.e. nobody found the clean "a 200-nit phone at 30 cm delivers X lux at the
  cornea" measurement. The Schöllhorn values are from a laboratory five-primary display prototype
  configured to *represent* smartphone/tablet/computer luminance, not from a consumer phone held at
  normal distance. **This remains a genuine hole in the chain, and the user should either compute it
  photometrically themselves (luminance × solid angle subtended → illuminance) or label it as modelled.**
  The user's own photometric computation is probably the best available route here.
- 1000-nit (HDR peak) displays are entirely outside the measured literature; nothing was found above
  ~285 cd/m².
- No 2023–2026 systematic review was located that *quantitatively* partitions variance between light
  exposure and content/engagement. The Dubey narrative review asserts the distinction but does not
  quantify it.

---

## Q3. The displacement explanation

### Takeaway
**Not verified in this round, and the specific head-to-head experiment the user is looking for was not
found.** The best available evidence is one RCT showing that restricting in-bed phone use improves sleep
*via pre-sleep cognitive arousal* — which supports an arousal/engagement mechanism, but did not
manipulate light at all and so cannot separate light from engagement. The 22–44 min/night displacement
figure was not re-verified here.

### Cited findings
- Tu Z, He J, Li Y, Wang Z, Wang C, Tian J, Tang Y. "Can restricting while-in-bed smartphone use improve
  sleep quality via decreasing pre-sleep cognitive arousal among Chinese undergraduates with problematic
  smartphone use? Longitudinal mediation analysis using parallel process latent growth curve modeling."
  *Addict Behav* 2023 Dec;147:107825. doi:10.1016/j.addbeh.2023.107825. PMID 37542973 —
  [PubMed](https://pubmed.ncbi.nlm.nih.gov/37542973/)
  - 152 Chinese undergraduates with PSU symptoms (SAS-SV > 31), randomised 76/76, 4-week follow-up;
    PSQI and Pre-Sleep Arousal Scale–Cognitive at baseline + weeks 1–4; parallel process latent growth
    curve modelling, 5000 bootstrap samples.
  - **"The intervention decreased pre-sleep cognitive arousal and increased sleep quality... The
    mediating effect of pre-sleep cognitive arousal was significant."**
  - Conclusion: "restricting while-in-bed smartphone use is a potential remedy for sleep disturbance
    induced by PSU."
  - **Crucially: the manipulation was USE, not LIGHT.** Removing the phone removes light, content,
    arousal and displacement simultaneously. This establishes that the *bundle* matters and that arousal
    mediates it; it cannot attribute anything to light or away from light.
- Converging on arousal rather than photons, from the circadian side: Dubey et al. 2026 state that
  screen–sleep associations "may also reflect a later bedtime, mental and emotional arousal,
  notifications, and the type of content viewed. **A lens would not change any of these.**" —
  [PMC13410805](https://pmc.ncbi.nlm.nih.gov/articles/PMC13410805/)
- Indirect support that the *behavioural* pathway carries real weight: Zhou Z et al. "The impact of
  Smartphone addiction on depression symptoms among college students: the mediating role of bedtime
  procrastination and the moderating effect of psychological resilience." *Front Psychol* 2026
  Apr 29;17:1784047. doi:10.3389/fpsyg.2026.1784047. PMID 42137084. n=1,610; bedtime procrastination
  partially mediated smartphone addiction → depression, **indirect effect 0.284 (95% CI 0.226–0.347),
  19.08% of total effect** — [PubMed](https://pubmed.ncbi.nlm.nih.gov/42137084/)
  - Cross-sectional, self-report, all common-method variance. Establishes that "bedtime procrastination"
    is a measured construct with real variance, **not** that light is irrelevant.

### Inferences
- The inference "displacement/engagement is the real mechanism, therefore desaturation (acting on
  engagement) has a legitimate lever" is **plausible but currently a two-step inference across a gap,
  not a documented chain.** Step 1 (sleep loss is substantially behavioural/arousal-mediated rather than
  photic) has decent support. Step 2 (desaturation reduces engagement enough to shorten night sessions)
  has **no evidence at all** — see Q5, where the relevant search returns zero studies.
- **Honest assessment of the strength the user asked for: WEAK-TO-MODERATE as an argument, and it is an
  argument the night-luminance section does not help make.** The displacement/engagement path is a good
  payoff for the *report*, but it is not a payoff for a section about *luminance*, because nothing in the
  displacement literature turns on how bright the screen is or how dark the room is. Putting the
  displacement payoff at the end of a luminance section is a non-sequitur dressed as a conclusion — the
  reader is being handed a photometric ratio and then told it implies something about engagement.

### Gaps
- **The 22–44 min/night displacement estimate was NOT re-verified in this round** and has no source in
  these notes. It must be re-sourced before use.
- **No experiment was found that held content constant and varied light, or held light constant and
  varied content.** This is the single most important missing study for the user's argument. Schöllhorn
  2023 is the closest thing in existence — it holds luminance constant and varies melanopic content —
  but "content" there means *spectral* content, not *media* content. The experiment the user wants
  (same app, same session, bright vs dim) does not appear to exist.

---

## Q4. Eye strain / discomfort from high screen-to-surround luminance ratio

### Takeaway
There is **direct experimental evidence that people prefer a non-dark surround and that preferred
surround luminance scales linearly with screen luminance**, plus a radiology-physics modelling paper
that prescribes raising ambient illuminance to 75–150 lux to equalise adaptation state. **But the
specific ISO 9241 / IES numeric ratio the user wants to cite was NOT retrieved and must not be asserted
from these notes.** Dark mode does not reliably reduce visual fatigue and in dim environments appears to
*increase* cognitive load in younger adults.

### Cited findings

**Preferred surround scales with screen luminance — the best direct evidence**
- Shen Y, Kuai S, Zhou W, Peng S, Tian M, Liu K, Zhou X. "Study of preferred background luminance in
  watching computer screen in children." *Chin Med J (Engl)* 2014;127(11):2073–7. PMID 24890155.
  (Fudan University Eye & ENT Hospital with Philips Research China) —
  [PubMed](https://pubmed.ncbi.nlm.nih.gov/24890155/)
  - Premise stated in the authors' own words: "In contrast to paper-based books and documents, computer
    screen is **self-illuminated with larger screen-background luminance difference, which greatly
    induces visual discomfort.**"
  - 60 children aged 9–12 and 58 adults aged 21–39 chose their most preferred background luminance at
    three screen luminance levels.
  - **"Both children and adult participants selected a non-dark background as their comfortable lighting
    condition"** (children t(59)=22.0, p<0.01; adults t(57)=15.5, p<0.01). Children preferred brighter
    backgrounds than adults (F(1,116)=7.0, p<0.01).
  - **"participants' preferred background luminance levels were linearly correlated with screen luminance
    intensities (children: slope = 0.97, R² = 0.98; adults: slope = 0.38, R² = 1.00)."**
  - Conclusion: **"varying background luminance to maintain screen-background luminance ratio is
    beneficial to human visual comfort."**
  - **This is the citable core of a luminance-ratio section.** It is a preference/comfort study (not
    asthenopia or headache incidence), with a Philips Research co-authorship to note, but the linear
    slope with R²≈0.98–1.00 is a clean, quantitative, directly on-point result: people want surround
    luminance to *track* screen luminance, and a dark bedroom is the maximal violation of that.
- Chawla & Samei 2007 (full citation in Q1 above): prescribes **75–150 lux room illumination** with
  surface diffuse reflection **0.13–0.22 sr⁻¹** to minimise adaptation-state variation and "potentially
  reduce visual fatigue" — [PubMed](https://pubmed.ncbi.nlm.nih.gov/17278493/)

**Dark mode: no reliable comfort benefit, and worse in the dark for young adults**
- Sethi T, Ziat M. "Dark mode vogue: Do light-on-dark displays have measurable benefits to users?"
  *Ergonomics* 2023 Dec;66(12):1814–1828. doi:10.1080/00140139.2022.2160879. PMID 36533999 —
  [PubMed](https://pubmed.ncbi.nlm.nih.gov/36533999/)
  - Younger and older adults, positive vs negative polarity, **under bright AND dim environments**,
    writing and search tasks; eye-tracking (pupil diameter) + subjective measures.
  - **"Eye-tracking results showed higher cognitive load using negative polarity, reflected in increased
    search time and pupil diameter for older adults in a bright environment and younger adults in a dim
    environment."**
  - "These results suggest that older adults use positive polarity to avoid mental fatigue, while
    **younger adults use negative polarity in a dim environment for aesthetic reasons**" — i.e. the dark
    mode preference at night is documented as aesthetic, and measurably costly.
  - **This is a direct, well-placed counter to "dark mode helps at night."** Note the specific
    interaction: it is *younger adults in a dim environment* who paid the cognitive-load cost.
- Sengsoon P, Intaruk R. "Immediate Effects of Light Mode and Dark Mode Features on Visual Fatigue in
  Tablet Users." *Int J Environ Res Public Health* 2025 Apr 12;22(4):609. doi:10.3390/ijerph22040609.
  PMID 40283833, PMCID PMC12027292 — [PubMed](https://pubmed.ncbi.nlm.nih.gov/40283833/)
  - n=30 female tablet users, block-randomised to both modes; visual fatigue, critical flicker frequency,
    dry eye symptoms before/after.
  - **"No statistically significant difference in visual fatigue was observed between the two modes
    (p > 0.05)"**, though CFF and dry-eye symptoms differed (p<0.05), and **all three outcomes worsened
    significantly after tablet use in BOTH modes (p<0.05)**.
  - The authors' hedged gloss ("dark mode **may** help reduce the risk of eye fatigue") is not supported
    by their own primary outcome, which was null. Small, single-sex, immediate-effects study.

### Inferences
- The defensible version of the user's "standards mismatch" argument is currently **weaker than the user
  hoped, but not empty**: instead of "the standard says ≤10:1 and real night use is 1000:1," the
  supportable claim is "**the only empirical work on preferred surround luminance finds that viewers want
  surround to scale nearly linearly with screen luminance (slope 0.38–0.97, R² ≥ 0.98), and the one
  professional domain that systematically confronts bright-display-in-dark-room — diagnostic radiology
  reading rooms — resolved it by specifying 75–150 lux of ambient, not by dimming the display. Night-time
  phone use in a dark bedroom inverts both prescriptions.**" That is citable, quantitative, and does not
  require a standards number.
- **The user should be explicitly warned off the 1:3 / 1:10 framing until verified.** Those ratios are
  widely repeated in ergonomics secondary literature, but they classically refer to **task-to-immediate-
  surround and task-to-remote-surround ratios for reflective paper-based tasks**, and applying them to a
  self-luminous display at night is exactly the kind of transplant that produces an impressive-sounding
  but unsound "1000× over the limit" claim. Given this report's whole premise is dismantling an
  overclaimed causal chain, importing an unverified standards number would be self-undermining.

### Gaps
- **ISO 9241 (parts -303 display requirements, -307 analysis/compliance) and IES luminance-ratio
  recommendations were NOT retrieved.** iso.org returned 403, ies.org returned 403, the NIOSH VDT
  document URL 404'd, and the OSHA computer-workstation eTool page **contains no numeric ratio guidance
  at all** (verified — it addresses only monitor placement and glare:
  [OSHA eTool](https://www.osha.gov/etools/computer-workstations/components/monitors)). PubMed does not
  index standards. **Obtaining the actual ISO/IES ratio requires standards-library access and is the
  single highest-value remaining task for this section.**
- No study found that measures **asthenopia, headache or discomfort incidence as a function of
  screen-to-surround luminance ratio** at the extreme ratios (>100:1) characteristic of night phone use.
  The Shen study used preference at ordinary ratios; nobody has tested the bedroom case.
- No evidence found on **reduced brightness** (as opposed to dark mode) improving night-time comfort.

---

## Q5. Night-time use, session length, and stopping difficulty

### Takeaway
**The null is confirmed, and it is a hard null.** No study manipulating ambient light and measuring
session duration was found, and — more strikingly — a PubMed search for time-of-day or diurnal patterns
in logged smartphone session duration returns **zero records**. There is no observational evidence
located here that evening/night sessions run longer than daytime ones.

### Cited findings
- **Re-verified null #1:** a PubMed search for smartphone AND "session duration" AND (night OR
  time-of-day OR evening) returns **1 record**, and it is not about screens-in-the-dark at all — it is
  Vesel C et al., "Effects of mood and aging on keystroke dynamics metadata and their diurnal patterns in
  a large open-science sample: A BiAffect iOS study." *J Am Med Inform Assoc* 2020 Jul 1;27(7):1007–1018.
  doi:10.1093/jamia/ocaa057. PMID 32467973 — [PubMed](https://pubmed.ncbi.nlm.nih.gov/32467973/)
  - It *does* contain real diurnal session data at scale: >14 million keypresses, 250 users, 86,541 typing
    sessions. But its session-duration findings are about **mood and age**, not time of day: "more severe
    depression relates to more variable typing speed (P<.001), **shorter session duration** (P<.001), and
    lower accuracy (P<.05)." The diurnal findings concern typing *speed and variability* ("fastest and
    least variable at midday"; older users show "more pronounced slowing in the evening") — **not session
    length.**
  - **So the largest available diurnal smartphone-interaction dataset reports diurnal patterns in typing
    dynamics but does NOT report session duration by time of day.** This is a notable absence in a
    dataset that plainly could have answered the question.
- **Re-verified null #2:** a PubMed search for (time of day OR diurnal) AND smartphone use AND (duration
  OR "session length") AND logged returns **0 records**.
- Adjacent literature exists but measures the wrong thing: the "bedtime procrastination" literature
  (29 records for bedtime procrastination AND smartphone) is **self-report scale-based**
  (Bedtime Procrastination Scale), cross-sectional, and about *delay of bedtime*, not *session duration*.
  E.g. Zhou et al. 2026, n=1,610, cited in Q3.
- One digital-phenotyping paper may bear on this but **could not be retrieved**: Matsushita E, Kim H,
  Kim M, Yoon S, Kim S, Yeom JW, Pack SP, Lee HJ, Cheong T, Cho CH. "Multidimensional analysis of
  smartphone overuse in insomnia: Integrating digital phenotyping with clinical assessment."
  *J Behav Addict* 2026 Jan 6;15(1):289–304. doi:10.1556/2006.2025.00093. PMID 41493477. Title suggests
  logged usage data in insomnia; **contents not verified — flagged as the highest-value lead for this
  question.**

### Inferences
- The absence is informative rather than merely inconvenient: the BiAffect dataset demonstrates that
  session-duration-by-time-of-day is **computable from data that already exists and has been published
  on**, yet nobody has published it. So the gap is in the literature, not in the measurability.
- **Platform data (Apple Screen Time, Android Digital Wellbeing, TikTok/Meta internal) would answer this
  directly and is not in the peer-reviewed literature.** The user's constraint to avoid
  app-marketing/content-farm sources means this is likely unobtainable within the report's evidentiary
  standard. It should be stated as an open question, not filled with grey-literature numbers.

### Gaps
- No evidence, observational or experimental, that night sessions run longer than daytime sessions.
- No evidence that ambient darkness affects stopping behaviour or session length.
- Matsushita 2026 (PMID 41493477) not retrieved; may contain logged nocturnal-use metrics.

---

## Synthesis: ranked list, tagged

| # | Consequence | Tag | Best evidence | Effect size |
|---|---|---|---|---|
| 1 | **Circadian: evening light at phone-level corneal mEDI suppresses melatonin and delays its onset, dose-dependently — driven by MELANOPIC irradiance, not luminance** | **[ROBUST]** | Schöllhorn 2023 *Commun Biol* (n=72, luminance decoupled from melanopic); Phillips 2019 *PNAS* (n=55) | Group ED50 **24.6 lux**; 10/30/50 lux → melatonin onset later by **22/77/109 min**; individual ED50 **6–350 lux** (~58×, 26% CV). Display mEDI range ~**5–150 lx** at 27–284 cd/m² |
| 2 | **Transient monocular "blindness" after one-eyed phone viewing in the dark, via interocular adaptation mismatch** | **[MODERATE]** — real, replicated across ≥5 journals, but entirely case reports/correspondence; no N, no prevalence | Alim-Marvasti *NEJM* 2016; Mahroo 2017 *Can J Ophthalmol* (mechanism); Sathiamoorthi *Neurology* 2017 (misdiagnosis) | No effect size exists. Documented harm = unnecessary TIA/optic-neuritis workup |
| 3 | **Viewers prefer surround luminance to scale with screen luminance; a dark surround is the maximal violation** | **[MODERATE]** | Shen 2014 *Chin Med J* (n=60 children + 58 adults); Chawla & Samei 2007 *Med Phys* | Preferred-surround slope **0.97 (children, R²=0.98)** / **0.38 (adults, R²=1.00)**; radiology prescription **75–150 lux** ambient |
| 4 | **Phototoxic maculopathy — structural photoreceptor damage, incl. irreversible CNV — from habitual dark-environment screen use** | **[CONTESTED]** — striking and on-point, but 10 retrospective cases, no denominator, self-reported exposure, attributed by authors to BLUE light not luminance | Yuan 2026 *Medicine* (PMID 42299599) | 10 cases / 13 eyes; **3 eyes CNV** (anti-VEGF "limited benefit"); 6 eyes outer-retinal disruption; 4 eyes mfERG P1 loss with intact structure; exposure months–years |
| 5 | **Dark mode improves night-time comfort** | **[UNSUPPORTED — evidence runs the other way]** | Sethi & Ziat 2023 *Ergonomics*; Sengsoon 2025 | Negative polarity → **higher** cognitive load (pupil diameter, search time) for **younger adults in dim environments**; visual-fatigue difference **null** (p>0.05) |
| 6 | **Blue-light filtering / night mode improves sleep in the field** | **[UNSUPPORTED]** | Smidt 2022 RCT (n=55, actigraphy, blinded, active control); Rabiei 2024 (p=0.925); + user's existing Cochrane 2023 | Null on objective and self-reported sleep. (Teran 2020's "93% MSV reduction" is **modelled radiometry, not measured melatonin**) |
| 7 | **Measurable transient visual impairment (ERG attenuation, contrast sensitivity, glare recovery) after night screen use** | **[UNSUPPORTED — no study found]** | PubMed smartphone+ERG+dark returns **1** record, and it is the chronic-maculopathy series | The "ERG attenuation with recovery over minutes" claim from the earlier round **could not be verified and should be withdrawn** pending a citation |
| 8 | **Night/evening sessions run longer, or darkness impairs stopping** | **[UNSUPPORTED — hard null]** | 0 PubMed records for diurnal logged session duration; BiAffect (86,541 sessions) reports diurnal typing dynamics but not session length | No effect size exists |
| 9 | **Asthenopia/headache caused specifically by extreme (>100:1) screen-to-surround ratio** | **[UNSUPPORTED — untested]** | — | Nobody has tested the bedroom case; Shen tested preference at ordinary ratios |

---

## The single most defensible "so what"

> **A phone used in a dark bedroom is not a trivial light source — at ordinary display luminance it
> delivers corneal melanopic illuminance in the same band as, or above, the ~25 lux at which the
> average person's melatonin is half-suppressed, and individual sensitivity varies ~58-fold, so for
> the most sensitive users 6 lux suffices. But the quantity that drives this is MELANOPIC irradiance,
> not luminance and not the screen-to-surround contrast ratio — which is precisely why desaturation,
> which leaves melanopic output roughly unchanged, produces no sleep effect in the trials that have
> looked.**

This is defensible because (a) every number is from a primary source with the decoupling built into the
design, (b) it does not invoke "blue light" as a folk category — it invokes melanopic EDI, the measured
quantity, (c) it **explains the user's existing nulls instead of contradicting them**, and (d) it
concedes rather than conceals that the luminance-ratio framing is the wrong photometric variable.

---

## Direct answer: should the section exist?

**Not as a section about luminance ratio. Yes as a short section about melanopic dose — and the honest
answer is close to the one the user pre-drafted, with one correction.**

The user's proposed fallback was: *"the luminance ratio is striking but has no well-documented
consequence beyond transient visual after-effects and a standards mismatch."* **That is right about the
luminance ratio and wrong in two details:**

1. **The standards mismatch is not established.** ISO/IES ratio numbers could not be retrieved
   (403/404; not indexed in PubMed), and OSHA's computer-workstation guidance was verified to contain
   **no** numeric ratio. The classic 1:3 / 1:10 ratios are paper-task, reflective-surface guidance and
   transplanting them to a self-luminous night display would be exactly the kind of overclaim this
   report exists to dismantle. Replace "standards mismatch" with the two real empirical findings:
   preferred surround scales with screen luminance (slope 0.38–0.97, R²≥0.98), and radiology reading
   rooms solve this by specifying **75–150 lux of ambient light** — both of which night phone use
   inverts.
2. **The transient after-effect is not a luminance-ratio effect.** TSB requires *interocular* asymmetry
   (one eye on the pillow). Binocular phone use in a dark room — the case the 250–6,300× ratio
   describes — does not produce it. Using TSB as the payoff for a luminance-ratio section would be a
   misattribution.

**Recommendation — cut the luminance-ratio framing; keep ~2 paragraphs reframed on melanopic dose:**

- **Do keep**, because it is quantitatively solid and it *explains the report's central null*: the
  corneal-mEDI-vs-ED50 comparison (Schöllhorn 2023 + Phillips 2019). This earns its place precisely
  because it shows *why* grayscale shows no sleep effect — the lever is melanopic, grayscale isn't.
- **Do keep as a one-sentence aside**, correctly attributed: one-eyed phone viewing in bed has a
  documented transient visual consequence whose main real-world harm is misdiagnosis as TIA, and a 2026
  case series reports structural maculopathy at chronic doses in the same exposure geometry. Flag the
  Yuan series' limitations and note its authors attribute it to blue light, not luminance.
- **Do NOT** build toward the displacement/engagement payoff from inside this section. Nothing in the
  displacement literature turns on screen brightness or room darkness; the move from "here is a
  photometric ratio" to "therefore engagement is the lever" is a non-sequitur. Give displacement its own
  section, and re-source the 22–44 min/night figure, which **is not verified in these notes.**
- **Do state the two hard nulls plainly**, because they are findings: nobody has measured transient
  visual function after night phone use, and nobody has published session-duration-by-time-of-day
  despite datasets existing that could.

**Net: the section survives, at about one-third its intended length, with its conclusion inverted from
"the ratio is alarming" to "the ratio is the wrong variable — the dose is melanopic, which is why
desaturation doesn't move sleep."**

### Before publishing, resolve these three
1. Re-verify the Schöllhorn 2023 mEDI table (5–150 lx) directly against PMC9974389 Methods/Table 1 —
   it came via tool summary, not verbatim quotation.
2. Obtain the real ISO 9241-303 / IES luminance-ratio text, or drop the standards claim entirely.
3. Re-source the 22–44 min/night displacement figure and the cones-5–7-min / rods-30–45-min
   re-adaptation figures; neither is sourced in these notes.
