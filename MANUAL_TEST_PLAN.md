# Meeras — Manual Test Plan & Scenarios

**Application:** Meeras (Islamic Will wizard, static SPA)  
**Document purpose:** Step-by-step scenarios for a human tester to execute and record **Pass / Fail / Blocked** with notes.  
**Last updated:** 2026-05-15  

---

## 1. Scope & assumptions

| In scope | Out of scope (unless agreed) |
|----------|------------------------------|
| UI flows, navigation, drafts, session behaviour | Legal correctness of generated Will text |
| Landing, wizard screens **S01–S25**, modals | Stripe Dashboard reconciliation / payouts |
| Export/import `.wasiyyah.json`, sample PDF | Automated load/performance testing |
| Donation step (S24) when links are configured | Third-party font CDN outages |

**Default product behaviour (verify against release notes):**

- Drafts use **sessionStorage** (this tab only) unless `MEERAS_USE_INDEXEDDB` is set to `true` in `index.html`.
- No **phantom draft** on first load; first draft is created when the user clicks **Begin your Will**.
- **No** public persistence diagnostic strip on the home page (storage details may appear only in the browser **console** for developers).

---

## 2. Test environment

| Item | Guidance |
|------|-----------|
| **Build under test** | Local: `python3 -m http.server 8000` → `http://localhost:8000/` **or** deployed URL (e.g. `https://fareez.dev/meeras/`). |
| **Browsers** | At least **Chrome** + one of **Firefox / Safari / Edge**. |
| **Profiles** | Run critical storage tests in **normal** window and **private/incognito** (expectations may differ if storage is blocked). |
| **Donations** | If testing Stripe: use **Stripe test mode** Payment Links in `donation-config.js` only on a non-production build if possible. |

**Artifacts to attach per defect:** URL, browser + version, screenshot, console errors (F12 → Console), steps to reproduce.

---

## 3. Severity (for reporting)

| Level | Meaning |
|-------|---------|
| **S1** | Blocker: cannot start Will, data loss wrong vs spec, crash loop |
| **S2** | Major: wrong screen, cannot save/export, donation broken when configured |
| **S3** | Minor: typo, layout glitch, non-critical wording |
| **S4** | Trivial: cosmetic only |

---

## 4. Test scenarios

Execute in order for a **first-time regression**; use **TC-xxx** IDs in your test report.

---

### TC-001 — First load (clean session)

| Field | Content |
|-------|---------|
| **Preconditions** | New private/incognito window **or** DevTools → Application → clear site data for the origin, then reload. |
| **Steps** | 1. Open the app URL.<br>2. Observe the landing (hero, scripture, guarantees).<br>3. Observe the **top bar** session pill. |
| **Expected** | • No **“Welcome back — pick up where you left off”** card (unless you truly had prior data in *this* tab’s session).<br>• Primary CTA is **Begin your Will →** (not “Continue your Will” unless returning with data).<br>• Session pill shows **“No draft yet”** (or equivalent), **not** a named draft like “My will”.<br>• **No** visible “Persistence / sessionStorage / IndexedDB” diagnostic strip on the page. |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **Notes:** |

---

### TC-002 — Begin Will creates draft and persists in-tab

| Field | Content |
|-------|---------|
| **Preconditions** | Clean session as TC-001. |
| **Steps** | 1. Click **Begin your Will →**.<br>2. Confirm you land on **Capacity** (or first wizard step after S01).<br>3. Observe session pill name.<br>4. **Refresh** the page (F5). |
| **Expected** | • After step 1–2: a draft exists; pill shows a **name** (e.g. “Untitled draft”) and meta line.<br>• After refresh: you still have a draft; wizard state is **not** reset to empty landing (session preserved **until tab is closed**). |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **Notes:** |

---

### TC-003 — Close tab clears draft (session-only)

| Field | Content |
|-------|---------|
| **Preconditions** | `MEERAS_USE_INDEXEDDB` is **false** (default). Complete TC-002 so a draft exists. |
| **Steps** | 1. **Close the browser tab** completely (not only navigate away).<br>2. Open a **new** tab to the same URL. |
| **Expected** | • Landing behaves like **TC-001**: no resume card for that new tab; **Begin your Will** shown; pill **“No draft yet”**. |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **Notes:** |

---

### TC-004 — Wizard navigation (forward / back)

| Field | Content |
|-------|---------|
| **Preconditions** | Active draft (after **Begin your Will**). |
| **Steps** | 1. Advance several steps using **Continue** (e.g. through Capacity, Madhhab, Identity).<br>2. Use **Back** until you return to an earlier step.<br>3. Use **Continue** again. |
| **Expected** | • No blank screen or stuck spinner.<br>• Entered values (where you filled fields) remain after back/forward within the same tab session.<br>• Progress indicator (beads) matches current step where applicable. |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **Notes:** |

---

### TC-005 — Manage drafts (modal)

| Field | Content |
|-------|---------|
| **Preconditions** | At least one draft exists. |
| **Steps** | 1. Open **Manage drafts** (session pill or landing control if visible).<br>2. **Rename** the active draft (save).<br>3. **+ New draft** — complete prompt; confirm two drafts listed.<br>4. **Switch** between drafts; confirm pill and content change.<br>5. **Delete** one non-only draft (if two exist); confirm list updates.<br>6. If only one draft remains, attempt **delete** from modal where allowed. |
| **Expected** | • Rename persists after refresh (same tab).<br>• Second draft appears with chosen name.<br>• Switch loads correct progress per draft.<br>• Delete rules match UI (e.g. cannot delete sole draft if UI prevents it — record actual behaviour). |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **Notes:** |

---

### TC-006 — Export and import draft file

| Field | Content |
|-------|---------|
| **Preconditions** | A draft with **some** filled fields (e.g. name on identity screen). |
| **Steps** | 1. **Manage drafts → Export** for that draft; save `.wasiyyah.json`.<br>2. Optional: clear session / new tab (TC-003 style).<br>3. **Import** the file via the UI.<br>4. If prompted, switch to imported draft. |
| **Expected** | • File downloads with sensible filename.<br>• Import succeeds or shows a clear error for invalid files.<br>• After import + switch, key fields match exported content. |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **Notes:** |

---

### TC-007 — Delete active draft / reset from UI

| Field | Content |
|-------|---------|
| **Preconditions** | At least one draft with some progress. |
| **Steps** | 1. From landing or flow, open **delete draft / reset** flow (e.g. **Delete active draft** on welcome card or modal path your build exposes).<br>2. Confirm deletion.<br>3. Observe landing. |
| **Expected** | • User returns to a **safe** state (typically **S01** with no phantom named draft before **Begin** again).<br>• No JavaScript error dialog during reset. |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **Notes:** |

---

### TC-008 — Sample PDF (landing)

| Field | Content |
|-------|---------|
| **Preconditions** | On **S01** landing. |
| **Steps** | 1. Click **Download sample template PDF** (or equivalent).<br>2. Open downloaded PDF. |
| **Expected** | • Download starts without error.<br>• PDF opens and is readable (pages, text, not 0 bytes). |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **Notes:** |

---

### TC-009 — Donation screen (S24) — not configured

| Field | Content |
|-------|---------|
| **Preconditions** | `donation-config.js` has **no** valid Stripe `https://` links **or** `enabled: false`. |
| **Steps** | 1. Navigate the wizard until you reach the **donation / contribution** step (after final review flow per product order — **S24**). |
| **Expected** | • **Contributions not yet set up** (or equivalent) message appears.<br>• **Continue** still works to leave the step.<br>• No broken “empty” Stripe buttons. |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **Notes:** |

---

### TC-010 — Donation screen (S24) — configured (Stripe test)

| Field | Content |
|-------|---------|
| **Preconditions** | **Test** Payment Link URLs in `donation-config.js` for at least one amount; `enabled: true`. Use only on approved test environment. |
| **Steps** | 1. Reach **S24**.<br>2. Click **A$5** (or first visible amount).<br>3. Observe new tab/window. |
| **Expected** | • Amount buttons visible.<br>• Stripe **buy.stripe.com** (or test) checkout opens in a new tab.<br>• Closing Stripe tab does not corrupt Meeras tab.<br>• Disclaimer text (non-tax-deductible, not a charity) is visible as per legal copy. |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **Notes:** |

---

### TC-011 — PDF generation (full path smoke)

| Field | Content |
|-------|---------|
| **Preconditions** | Timeboxed; use minimal valid answers per screen to reach **Generate PDF** (screen order ends with **S21** / final review per build). |
| **Steps** | 1. Complete wizard with **consistent** test data (fictional names).<br>2. Generate PDF.<br>3. Open PDF. |
| **Expected** | • Generation completes or shows actionable validation errors (no silent failure).<br>• PDF is non-empty; contains expected sections (e.g. cover, clauses) for the path you completed. |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **Notes:** |

---

### TC-012 — Responsive layout (smoke)

| Field | Content |
|-------|---------|
| **Preconditions** | Desktop browser. |
| **Steps** | 1. Resize window to ~375px width (or use device toolbar).<br>2. Walk through **S01** and one inner screen. |
| **Expected** | • No horizontal scroll **clipping** critical buttons.<br>• CTAs remain tappable/readable. |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **Notes:** |

---

### TC-013 — Optional: IndexedDB mode (`MEERAS_USE_INDEXEDDB = true`)

| Field | Content |
|-------|---------|
| **Preconditions** | **Staging build only** with flag set to `true` by developer. |
| **Steps** | 1. Create draft, navigate one step, refresh.<br>2. **Close tab**, reopen same origin within same browser profile. |
| **Expected** | • Draft **survives** tab close (unlike default session mode).<br>• Document any migration quirks (legacy IndexedDB data). |
| **Result** | ☐ Pass ☐ Fail ☐ Blocked — **N/A** if not tested — **Notes:** |

---

## 5. Smoke checklist (quick release sign-off)

Use after small fixes; ~15 minutes.

| # | Check | ☐ |
|---|--------|---|
| 1 | Clean load: no phantom draft; **Begin your Will** works | ☐ |
| 2 | Refresh keeps work **same tab** | ☐ |
| 3 | New tab after close: **no** draft (session mode) | ☐ |
| 4 | Manage drafts: open modal, no console errors | ☐ |
| 5 | Sample PDF downloads | ☐ |
| 6 | No storage diagnostic strip on landing | ☐ |
| 7 | Donation step: configured **or** “not set up” behaves as expected | ☐ |

---

## 6. Sign-off

| Role | Name | Date | Build / commit / URL |
|------|------|------|----------------------|
| Tester | | | |
| Lead (optional) | | | |

---

## 7. References

- `README.md` — local run, Stripe, package layout  
- `DEPLOYMENT.md` — S3 / CloudFront / storage troubleshooting  
- `donation-config.js` — Stripe Payment Links  
