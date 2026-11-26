# Chrome Color Filters

Applies a **grayscale filter** to websites you choose. Click the extension icon for the popup controls.

Rules match in order and the first hit wins (up to 20 rules). Intensity is continuously
adjustable from 0–100. There is also **Focus Lock**: while a lock is active no setting can be
changed — it can only be **extended** — and the filter switches off automatically when the lock expires.

Why grayscale helps in the first place is covered in a separate research report:
**[Why Grayscale Works](https://jesseliu.me/Chrome-Gray-Scaller/)** (bilingual, EN / 中文).

## Install

1. Download `chrome-color-filters-<version>-chrome.zip` from the [Releases](../../releases) page.
2. Extract the zip file to a folder of your choice.
3. Open `chrome://extensions` in your browser.
4. Enable **Developer mode** using the toggle in the top right corner.
5. Click **Load unpacked** and select the extracted folder.

You may see a warning that says "Disable developer mode extensions" when Chrome starts. This is normal for extensions loaded in developer mode and does not indicate a problem with the extension.

## How the filter actually applies

Filtering runs along two **non-overlapping** paths: one handles **newly opened pages**, the other
handles **pages already open**. The boundary between them is the key to understanding this
extension's architecture.

### 1. Colouring new pages (the first frame)

**The goal** — open a configured site and **the very first rendered frame is already gray**, with
no flash of original colour at any point.

**The mechanism** — declarative content script registration
(`chrome.scripting.registerContentScripts`).

When you add a rule, the background immediately writes the mapping "which URLs match → which
intensity's CSS file" into the browser's on-disk registry, flagged `persistAcrossSessions` so it
survives across sessions. From then on, on every navigation:

```
Chrome starts loading the page
  ↓
Chrome consults its own on-disk registry: what should be injected for this URL?
  ↓
Chrome injects that CSS file                ← no DOM exists yet at this point
  ↓
Chrome builds the DOM, computes styles, renders the first frame   ← already filtered
```

At no point is there a step where "the extension looks something up and Chrome waits for the
answer" — the registry is Chrome's own data, and reading your own data requires asking no one.
It never goes through the extension's JS, never reads storage, and the service worker does not
need to be woken (under MV3 it can be reclaimed at any time, but the registration lives on disk).

> **🔴 Why it has to be done this way.** `chrome.storage` has no synchronous variant, and
> rendering does not wait for asynchronous queries: any design where "we read storage to find out
> whether to apply colour" will necessarily paint one frame of original colour first. This is not
> an implementation that isn't fast enough — it is an unavoidable consequence of the architecture.
>
> The fix is not to make the query faster but to **eliminate the query**: the async work is moved
> to the moment the rule is added. At that moment no frame is waiting on it, a few milliseconds
> vanish into interaction latency, and the cost is zero — while on the page-load path, not a
> single query remains.

The filter CSS consists of **101 pre-generated files** (one per intensity step, 0–100), each a
single line of `html { filter: grayscale(0.3) !important; }` — because `registerContentScripts`'s
`css` parameter accepts only **file paths**, not inline strings.

### 2. Live updates to pages already open

**The goal** — change any setting and every already-open tab **recolours immediately, with no
reload**. Scroll position, form contents and page state are all preserved.

**The mechanism** — `chrome.storage` change broadcasts (`onChanged`).

Each page's content script subscribes to that event when it starts. Once a setting is written, the
browser pushes the change to every page simultaneously and each one updates the style on its own
root element. The extension does **not** need to enumerate tabs, message them one by one, or deal
with tabs that have since closed — a single event source satisfies multi-tab consistency naturally.

This covers all five triggers: the intensity slider, adding/editing/removing rules, drag-reordering,
the main toggle, and the automatic switch-off when a lock expires.

### How the two paths divide the work

|                             | Applies to                        | Why it must exist independently                                                      |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| **Declarative registration** | The first frame of the **next navigation** | A broadcast cannot beat the first frame — storage is async, and rendering won't wait |
| **Change broadcast**         | Pages **already open**            | Registration has no effect on already-open pages; that is Chrome's defined behaviour |

Dropping either one leaves a visible defect: without the broadcast, dragging the intensity slider
leaves the current page unchanged until a manual reload; without the registration, every newly
opened page flashes its original colours first.
