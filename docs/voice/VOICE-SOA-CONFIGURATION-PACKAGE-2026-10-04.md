# Clear Point — Voice SOA (CY2027) — Owner Configuration Package

**Status: NOT APPLIED.** Nothing in this document has been applied to the live GoHighLevel agents, their prompts, their tools or their workflows. Emely (EN, agent `6a6375c8df9038810f0b6d0b`, line 631-658-3796) and Sofía (ES, agent `6a639514df903842e40b939b`, line 940-477-8518) run **V2.3 (2026-10-01)** unchanged. Changing them is an OWNER-APPROVED platform action; this repository cannot reach GoHighLevel and did not try.

**Date:** 2026-10-04 · **Spec:** CY2027 integrated master prompt §10, §11, §19, §21, §26, §28, §29, §31 · **Audit ID:** SPEC-10/19/26/28 · **Code:** `api/_lib/cy2027/voice-soa.js` (server-only), `api/_lib/cy2027/evidence.js`, suite `scripts/test-cy2027-voice-2026-10-04.mjs`.

Script version this package belongs to: **`CP-SOA-VOICE-SCRIPT-CY2027-v0.2`** — status **`PENDING_OWNER_APPROVAL`**. The voice-SOA flag in code (`VOICE_SOA_ENABLED`) is **false**, and while it is false nothing voice can be offered, evidenced or completed: the flag is the first refusal of the offer gate and of the evidence stage alike.

---

## 0. What this package is, and is not

| It is | It is not |
|---|---|
| The exact Layer-B addendum for each agent, in its own language, ready to paste **after** approval. | Applied. Not pasted, not saved, not tested on a live line. |
| The §28 gate sequence the agent must follow, in order. | A change to Base Layer A (two agents, IVR language routing, recording notice once inside the greeting, no AI self-announcement). Those stay exactly as in V2.3. |
| The §21 tool allow-list to **verify** in GoHighLevel, and the tools that must be absent. | A statement of which tools each agent currently has. That is not known from this repository and must be read in GoHighLevel. |
| The recording-failure fallback, the test calls, the rollback. | A working end-to-end voice SOA. See §1: the rules and the evidence model exist in code; the endpoint the agent would call does not yet. |

---

## 1. What exists in code today, and what does not

**Exists (this commit, tested by calling it):**

- `voiceSoaOfferProblem()` — may a recorded SOA be OFFERED on this call. Refuses, by name, when: the flag is off (`VOICE_SOA_DISABLED`); the script has no recorded human approval (`VOICE_SCRIPT_NOT_APPROVED`); the residence state is not confirmed or not NY/NJ/CT (`RESIDENCE_STATE_NOT_CONFIRMED`); identity/contact context is not established (`CONTACT_CONTEXT_NOT_ESTABLISHED`); the caller did not affirmatively choose voice (`CHANNEL_NOT_CHOSEN_BY_CALLER`); the appointment format is absent or unknown (`UNKNOWN_APPOINTMENT_FORMAT`); the appointment is in person (`IN_PERSON_REQUIRES_WRITTEN_SOA`); recording is not confirmed active with a reference (`RECORDING_NOT_CONFIRMED_ACTIVE`); the language was not elected (`SOA_LANGUAGE_NOT_ELECTED`).
- `captureCategoryDecisions()` — one affirmative reply per category. "Yes to everything", "all of them", "todo", "a todo" authorise **nothing** (`BLANKET_REPLY_NOT_AUTHORIZATION`, that category is asked again individually). "I am not sure", "I don't know", "no estoy seguro", "no sé" select **nothing** (`SOA_INCOMPLETE`, route to a licensed agent). "ok", "mhm", "claro" are not answers (`CATEGORY_REPLY_UNCLEAR`, ask again). A category not asked, or asked twice, is refused.
- `readBackProblem()` — the read-back must be confirmed with a clear yes; any difference between what was captured and what was read back is `READ_BACK_MISMATCH`; a "no" is `READ_BACK_REJECTED` (capture again).
- `recordingSegmentProblem()` — a segment whose recording was not active throughout is void: `RECORDING_LOST_DURING_SEGMENT`. Nothing captured in it is completed.
- `buildVoiceEvidence()` / `buildEvidenceRecord(instance, { voice })` — the voice evidence block (recording reference, transcript pointer, segment start/end, exact script version + digest + approval, language and its election, every category decision with its reply classification, the confirmed read-back, the spoken lines) is REQUIRED for a `VOICE_RECORDED` instance and sits INSIDE the integrity hash.
- The script as data (`VOICE_SOA_SCRIPT`), assembled from the approved SOA text, with a pinned digest (`VOICE_SCRIPT_DIGEST`) that the build gate `scripts/check-cy2027-parity.mjs` recomputes. The build also refuses `VOICE_SOA_ENABLED = true` while the approval is not recorded.

**Does NOT exist (owner decision / follow-up after approval):**

- A server endpoint (Custom action target) that receives the segment from the agent (recording reference, transcript pointer, timestamps, the per-category replies, the read-back) and runs the rules above. Until it exists, **nothing the agent captures by voice can become an SOA instance**, and the agent must not say an SOA was saved (§21).
- CRM field ids for `SOA_SCRIPT_VERSION`, `SOA_EVIDENCE_URI`, `SOA_INTEGRITY_HASH`, `SOA_LANGUAGE_SOURCE` and the rest of the CY2027 registry — created by the owner in GoHighLevel and configured in `CY2027_CRM_FIELD_IDS`. Unconfigured fields are reported as "unmapped" and never written.
- Owner approval of the connecting sentences in §4/§5 (status, approver, date in `voice-soa.js`; digest re-pinned in the same commit).

---

## 2. Preconditions — in this order, each an owner action

1. **Approve the script wording** (both languages, §4 and §5, every line). An engineer then records it in `api/_lib/cy2027/voice-soa.js`: `status: 'APPROVED'`, `approvedBy: '<the person's name>'`, `approvedOn: '<YYYY-MM-DD>'`, bumps the version if any sentence changed, re-pins `VOICE_SCRIPT_DIGEST` (the build prints the computed value), and commits. The approver must be a person: the build and the runtime both refuse 'Sofía', 'Emely', 'Claude', 'AI', 'system' and any automated identity.
2. **Legal/compliance sign-off** on the wording and on the recorded-SOA channel for NY/NJ/CT telephone and video appointments (§9 "NOT VERIFIED" of `VOICE-AGENT-SPEC-2026-08-28.md` still applies).
3. **Build the receiving endpoint** (follow-up commit) and the CRM field ids (owner creates the fields; see `docs/compliance/CY2027-ARCHITECTURE.md` for the registry).
4. **Verify the tool configuration** of each agent in GoHighLevel against §6 of this document, and remove anything on the "must be absent" list.
5. **Flip `VOICE_SOA_ENABLED` to `true`** in code — only after 1-4; the build refuses it before 1.
6. **Apply the addendum** (§4, §5) in a test window with the rollback (§9) at hand, then run the test calls (§8).

---

## 3. §28 gate sequence (the order the agent follows — unchanged steps are Layer A)

1. IVR language selection → Emely (1) or Sofía (2). *(Layer A, unchanged.)*
2. Corporate greeting with the recording notice, said ONCE, inside the greeting. *(Layer A V2.3, unchanged.)* The recording notice is NOT callback consent and NOT SOA consent.
3. Hear the reason for the call; classify existing client / prospect / other without an interrogation. *(Layer A, unchanged.)*
4. For a Medicare prospect or service need that requires an SOA: obtain the **current residence state** and ZIP (county only if the ZIP needs it). No SOA step before the state is confirmed and is NY, NJ or CT.
5. Establish the contact context: the beneficiary's full name and the contact channel already in use; no SSN, no MBI, no banking data by voice. *(Layer A SECURE_INTAKE_PATH, unchanged.)*
6. Minimal voluntary Medicaid / Extra Help self-report only if useful and only if the caller chooses to answer; stored as self-reported, never as eligible. *(Existing rule; unchanged.)*
7. **Offer the four choices, neutrally:** complete the SOA now by voice (only when every precondition in §1 holds); receive a secure link by text message; receive it by email; or speak with a licensed agent / process callback first. The caller's choice is their own words; "ok" is not a choice.
8. **If the caller chooses voice and the appointment will be by telephone or video:** read the PURPOSE line, the IMPORTANT statement, the ONE_AT_A_TIME line; then each category, one at a time, in the fixed order, each with its own yes/no question; then the "I am not sure" option; then the READ_BACK framing with the authorized categories; then the AUTHORIZATION statement and the CONFIRM question. Send the segment to the endpoint; say it was recorded **only** after the system confirms.
9. **If the appointment will be in person / a home visit:** do not offer voice. Explain that a written Scope of Appointment must be completed before the in-person appointment, offer the secure digital link, and do not say the in-person appointment may discuss plans until it is completed.
10. End with a clear next step: no carrier, no plan, no recommendation, no hidden pitch. *(Layer A closing protocol, unchanged.)*

---

## 4. Layer-B addendum — EMELY (English) — paste AFTER the DETERMINISM & DISCLOSURE RULES block and BEFORE the VERSION line; change the VERSION line to `CLEARPOINT_CS_MASTER_V2.4 (<date applied>) — AGENT: EMILY (ENGLISH)`

```
═══════════════════════════════════════════════════════════════
VOICE SCOPE OF APPOINTMENT — CY2027 (Layer B) — applies only when every
condition in A holds. Script CP-SOA-VOICE-SCRIPT-CY2027-v0.2.
═══════════════════════════════════════════════════════════════
A. WHEN YOU MAY OFFER A RECORDED SCOPE OF APPOINTMENT (all of these, in order):
   1. The caller's current residence state is confirmed and is New York,
      New Jersey or Connecticut, and the ZIP code is confirmed.
   2. You know the caller's full name and the call is on a channel the caller
      is using themselves. Never ask for a Social Security number, Medicare
      number or banking data to do this.
   3. The upcoming appointment will be by TELEPHONE or VIDEO. If it will be
      IN PERSON or a HOME VISIT, do not offer voice: say "For an in-person
      appointment, a written Scope of Appointment must be completed first. I
      can send you a secure link by text message or email." and continue
      with that path. Never say an in-person appointment may discuss plans
      before the written Scope of Appointment is completed.
   4. The caller chose the voice option themselves, in their own words, after
      you offered all four choices: "You can complete it now with me by
      voice, receive a secure link by text message, receive it by email, or
      speak with a licensed Clear Point agent first. Which do you prefer?"
      If the caller picks voice, confirm it with this exact question — the
      answer to it is the choice that counts: "Would you like to complete it
      now with me by voice? Please answer yes or no." "Ok", silence or
      "whatever" is not a choice: ask once more, then offer the licensed
      agent.
   If any condition is not met, do not start B. Offer the secure link or the
   licensed agent instead.
B. THE SCRIPT (fixed lines, spoken word for word, in this order; never
   paraphrase, never shorten, never say "MA", "MAPD" or "PDP"):
   1. "The purpose of this step is to document which types of Medicare plan
      products you want the licensed agent to be allowed to discuss with you
      during your upcoming appointment."
   2. "Important: Completing this Scope of Appointment does not require you
      to enroll in a plan, does not obligate you to change your current
      coverage, and does not authorize discussion of product categories you
      did not select. If you later want to discuss another category, the
      scope must be updated/documented before that additional plan-specific
      discussion."
   3. "I will describe each type one at a time. Please answer yes or no to
      each one, and I will read your choices back to you before anything is
      saved."
   4. "Medicare Advantage plan without integrated prescription drug coverage.
      A private Medicare health plan that provides Medicare-covered medical
      and hospital services but does not include integrated Medicare
      prescription drug coverage. Do you authorize the licensed agent to
      discuss this type of plan with you at this appointment? Please answer
      yes or no."  → wait for the answer.
   5. "Medicare Advantage plan with prescription drug coverage. A private
      Medicare health plan that provides Medicare-covered medical and
      hospital services and includes Medicare prescription drug coverage. Do
      you authorize the licensed agent to discuss this type of plan with you
      at this appointment? Please answer yes or no."  → wait for the answer.
   6. "Standalone Medicare prescription drug plan. A separate Medicare
      prescription drug plan for people who need Part D drug coverage apart
      from a Medicare Advantage plan. Do you authorize the licensed agent to
      discuss this type of plan with you at this appointment? Please answer
      yes or no."  → wait for the answer.
   7. "You may also choose this option: I am not sure / I prefer to discuss
      the process first. This does not authorize an additional product
      category. A licensed agent can explain the process before any
      plan-specific discussion begins. Would you like to choose this option
      instead? Please answer yes or no."  → wait for the answer.
   8. "Please confirm what you authorized. You authorized the licensed agent
      to discuss only the following at this appointment:" then read the
      label of each category the caller answered YES to, one per sentence.
      If none: "You did not authorize any product category. A licensed agent
      will explain the process first."
   9. "By signing/affirming below, I confirm that the categories marked above
      are the categories I authorize for this specific appointment."
  10. "Is that correct? Please answer yes or no."
C. HOW ANSWERS COUNT (the system applies the same rules; you apply them too):
   - Each category needs its OWN yes. "Yes to everything", "all of them",
     "both", "everything" authorizes NOTHING: say "I need to ask about each
     one separately." and ask that category again, by itself.
   - "I am not sure", "I don't know", "maybe", or choosing option 7, at any
     point: stop the script. Nothing is selected. Say "That is fine. Nothing
     has been recorded as authorized today. A licensed Clear Point agent will
     explain the process with you first, before any plan-specific discussion."
     Book the licensed-agent callback and set the outcome to SOA_INCOMPLETE.
   - "Ok", "mhm", "sure", "please" alone is not an answer: ask the same
     question once more.
   - A "no", "not", "never", "wrong" or "incorrect" anywhere in the answer
     is a no, even after a "yes": "yes, not that one" declines the category,
     and "yes, that is not right" rejects the read-back.
   - If the caller says the read-back is wrong, or you are not certain you
     heard a category correctly: do not confirm. Go back to that category
     and ask it again, then read back again.
   - Never say which category is better, never compare plans, never name a
     carrier or a plan, never say "which plan is best for you?".
D. AFTER THE CONFIRMATION:
   - Send the segment through the configured Scope of Appointment action
     (recording reference, transcript, start and end of this step, each
     answer, the read-back). Say "Your Scope of Appointment has been
     recorded." ONLY after the action returns success. If it does not, say
     "I was not able to save that just now. A licensed Clear Point agent will
     follow up with you to complete it." and book the callback. Never claim
     it was saved.
   - Do not write any SOA field in the contact yourself.
E. IF THE RECORDING STOPS OR IS NOT CONFIRMED during B: stop immediately,
   say "I am sorry, the recording of this call was interrupted, so this step
   cannot be completed by voice. Nothing has been recorded as authorized. A
   licensed Clear Point agent will follow up with you to complete it another
   way." Book the callback. Nothing from the interrupted step counts.
F. Everything in DETERMINISM & DISCLOSURE RULES still applies: the recording
   notice is given once in the opening line and not repeated here; you do
   not announce that you are an automated assistant, and if asked directly
   you answer truthfully in one sentence and continue.
═══════════════════════════════════════════════════════════════
```

---

## 5. Layer-B addendum — SOFÍA (Español) — pegar DESPUÉS del bloque REGLAS DE DETERMINISMO Y AVISO y ANTES de la línea VERSION; cambiar la línea VERSION a `CLEARPOINT_CS_MASTER_V2.4 (<fecha de aplicación>) — AGENT: SOFÍA (ESPAÑOL)`

```
═══════════════════════════════════════════════════════════════
SCOPE OF APPOINTMENT POR VOZ — CY2027 (Capa B) — aplica solo cuando se
cumple TODO lo de A. Guion CP-SOA-VOICE-SCRIPT-CY2027-v0.2.
═══════════════════════════════════════════════════════════════
A. CUÁNDO PUEDE OFRECER UN SCOPE OF APPOINTMENT GRABADO (todo esto, en orden):
   1. El estado de residencia actual está confirmado y es Nueva York, Nueva
      Jersey o Connecticut, y el código postal está confirmado.
   2. Conoce el nombre completo de la persona y la llamada es por un canal
      que la persona usa ella misma. Nunca pida número de Seguro Social,
      número de Medicare ni datos bancarios para esto.
   3. La próxima cita será por TELÉFONO o VIDEO. Si será PRESENCIAL o una
      VISITA A DOMICILIO, no ofrezca la voz: diga "Para una cita presencial
      primero debe completarse un Scope of Appointment por escrito. Puedo
      enviarle un enlace seguro por mensaje de texto o por correo
      electrónico." y continúe por ese camino. Nunca diga que una cita
      presencial puede tratar planes antes de completar el Scope of
      Appointment por escrito.
   4. La persona eligió la opción de voz por sí misma, con sus propias
      palabras, después de que usted ofreció las cuatro opciones: "Puede
      completarlo ahora conmigo por voz, recibir un enlace seguro por
      mensaje de texto, recibirlo por correo electrónico, o hablar primero
      con un agente licenciado de Clear Point. ¿Cuál prefiere?" Si la
      persona elige la voz, confírmelo con esta pregunta exacta — la
      respuesta a esta pregunta es la elección que cuenta: "¿Desea
      completarlo ahora conmigo por voz? Por favor responda sí o no." "Ok",
      silencio o "lo que sea" no es una elección: pregunte una vez más y
      luego ofrezca al agente licenciado.
   Si falta cualquier condición, no inicie B. Ofrezca el enlace seguro o al
   agente licenciado.
B. EL GUION (líneas fijas, dichas palabra por palabra, en este orden; nunca
   parafrasee, nunca acorte, nunca diga "MA", "MAPD" ni "PDP"):
   1. "El propósito de este paso es documentar qué tipos de productos de
      planes de Medicare usted desea que el agente licenciado pueda
      conversar con usted en su próxima cita."
   2. "Importante: Completar este Scope of Appointment no le obliga a
      inscribirse en un plan, no le obliga a cambiar su cobertura actual y
      no autoriza conversar sobre categorías que usted no seleccionó. Si
      después desea conversar sobre otra categoría, el alcance debe
      actualizarse/documentarse antes de esa conversación específica sobre
      planes."
   3. "Le describiré cada tipo uno por uno. Por favor responda sí o no a
      cada uno, y le repetiré sus respuestas antes de guardar nada."
   4. "Plan Medicare Advantage sin cobertura integrada de medicamentos
      recetados. Un plan privado de salud de Medicare que ofrece servicios
      médicos y hospitalarios cubiertos por Medicare, pero no incluye
      cobertura integrada de medicamentos recetados de Medicare. ¿Autoriza
      usted al agente licenciado a conversar sobre este tipo de plan con
      usted en esta cita? Por favor responda sí o no."  → espere la respuesta.
   5. "Plan Medicare Advantage con cobertura de medicamentos recetados. Un
      plan privado de salud de Medicare que ofrece servicios médicos y
      hospitalarios cubiertos por Medicare e incluye cobertura de
      medicamentos recetados de Medicare. ¿Autoriza usted al agente
      licenciado a conversar sobre este tipo de plan con usted en esta cita?
      Por favor responda sí o no."  → espere la respuesta.
   6. "Plan independiente de Medicare para medicamentos recetados. Un plan
      separado de Medicare para medicamentos recetados para personas que
      necesitan cobertura de medicamentos de la Parte D aparte de un plan
      Medicare Advantage. ¿Autoriza usted al agente licenciado a conversar
      sobre este tipo de plan con usted en esta cita? Por favor responda sí
      o no."  → espere la respuesta.
   7. "También puede elegir esta opción: No estoy seguro / prefiero hablar
      primero sobre el proceso. Esto no autoriza una categoría adicional. Un
      agente licenciado puede explicarle el proceso antes de comenzar
      cualquier conversación específica sobre planes. ¿Desea elegir esta
      opción en su lugar? Por favor responda sí o no."  → espere la respuesta.
   8. "Por favor confirme lo que autorizó. Usted autorizó al agente
      licenciado a conversar únicamente sobre lo siguiente en esta cita:" y
      lea el nombre de cada categoría a la que la persona respondió SÍ, una
      por frase. Si ninguna: "Usted no autorizó ninguna categoría de
      producto. Un agente licenciado le explicará primero el proceso."
   9. "Al firmar o confirmar a continuación, confirmo que las categorías
      marcadas arriba son las que autorizo para esta cita específica."
  10. "¿Es correcto? Por favor responda sí o no."
C. CÓMO CUENTAN LAS RESPUESTAS (el sistema aplica las mismas reglas; usted
   también):
   - Cada categoría necesita su PROPIO sí. "Sí a todo", "todas", "a todo",
     "ambos", "lo que sea" no autoriza NADA: diga "Necesito preguntarle por
     cada una por separado." y vuelva a preguntar esa categoría, sola.
   - "No estoy seguro", "no sé", "tal vez", o elegir la opción 7, en
     cualquier momento: detenga el guion. No se selecciona nada. Diga "Está
     bien. Hoy no se ha registrado ninguna autorización. Un agente licenciado
     de Clear Point le explicará primero el proceso, antes de cualquier
     conversación específica sobre planes." Agende la llamada del agente
     licenciado y registre el resultado SOA_INCOMPLETE.
   - "Ok", "ajá", "claro", "bueno" solos no son respuesta: repita la misma
     pregunta una vez más.
   - Un "no", "tampoco", "nunca", "incorrecto" o "está mal" en cualquier
     parte de la respuesta es un no, aunque venga después de un "sí": "sí,
     esa no" rechaza la categoría y "sí, está mal" rechaza la repetición.
   - Si la persona dice que la repetición está mal, o usted no está segura
     de haber escuchado bien una categoría: no confirme. Vuelva a esa
     categoría, pregúntela de nuevo y repita la lectura.
   - Nunca diga qué categoría es mejor, nunca compare planes, nunca nombre
     una aseguradora ni un plan, nunca pregunte "¿qué plan le conviene?".
D. DESPUÉS DE LA CONFIRMACIÓN:
   - Envíe el segmento por la acción de Scope of Appointment configurada
     (referencia de la grabación, transcripción, inicio y fin de este paso,
     cada respuesta, la repetición). Diga "Su Scope of Appointment ha sido
     registrado." SOLO después de que la acción devuelva éxito. Si no lo
     devuelve, diga "No pude guardarlo en este momento. Un agente licenciado
     de Clear Point se comunicará con usted para completarlo." y agende la
     llamada. Nunca afirme que se guardó.
   - No escriba usted ningún campo SOA del contacto.
E. SI LA GRABACIÓN SE DETIENE O NO ESTÁ CONFIRMADA durante B: deténgase de
   inmediato y diga "Lo siento, la grabación de esta llamada se interrumpió,
   así que este paso no puede completarse por voz. No se ha registrado
   ninguna autorización. Un agente licenciado de Clear Point se comunicará
   con usted para completarlo de otra manera." Agende la llamada. Nada del
   paso interrumpido cuenta.
F. Todo lo de REGLAS DE DETERMINISMO Y AVISO sigue vigente: el aviso de
   grabación se da una sola vez en la apertura y no se repite aquí; usted no
   anuncia que es una asistente automatizada y, si le preguntan
   directamente, responde con la verdad en una frase y continúa.
═══════════════════════════════════════════════════════════════
```

---

## 6. §21 tool-level least privilege — VERIFY in GoHighLevel (not asserted here)

The "During The Call" action catalogue available in this sub-account (observed 2026-09-27, `VOICE-AGENT-SPEC-2026-08-28.md` §8) is: **Call transfer, Trigger a workflow, Send SMS, Update contact field, Appointment Booking, Custom action, Agent Transfer.** There is **no "End Call" action** (Labs feature not available to this account, §8.b). Which of these each agent actually has configured is NOT known from this repository: open **AI Agents → Emely → Actions** and **AI Agents → Sofía → Actions**, list every action, and check each line below.

| Spec §21 allowed capability | Catalogue action that may implement it | Verify |
|---|---|---|
| Contact lookup within the privacy gate | *(platform contact context — no action)* | The agent discloses nothing private before verification (Layer A §18/§19, unchanged). |
| Allowed-field update | Update contact field | Only the fields in the CRM FIELD MAPPING of the prompt (caller type, reason, state, ZIP, state validated, outcome, language, best time, client status, secure-intake flag). **No `SOA_*` field, no consent field, no recording-notice field** is written by the agent. |
| Appointment lookup / book / reschedule / cancel | Appointment Booking | Present. Books a licensed-agent callback/appointment only; no personal names spoken. |
| Create note / task | Trigger a workflow (post-call) | The three published post-call workflows (`CP- Voice Post-Call (Emely & Sofia)`, `… Lang EN`, `… Lang ES`) remain the only bound workflows. |
| Create / send SOA link | Send SMS | **Must stay unused for SOA links until `SOA_ENABLED` is true in code** (it is false in all four mirrors). If a Send SMS action exists, confirm it does not send a link to `/soa` or `/es/soa`. |
| Record SOA selection | Custom action → the Clear Point endpoint (**does not exist yet**, §1) | Until the endpoint exists there must be **no** Custom action named for SOA. When it exists: HTTPS, server-side token, idempotency key per call, the response decides what the agent may say. |
| Transfer / escalate | Call transfer, Agent Transfer | Present: licensed agent transfer; Emely → Sofía / Sofía → Emely language transfer (Layer A). |
| Approved knowledge lookup | *(prompt + CRM data only — "APPROVED_KNOWLEDGE_BASE")* | No knowledge/web action attached. |
| Secure verification action | *(none on this voice channel — "SECURE_INTAKE_PATH: none")* | No action collects SSN/MBI/banking. |
| End call | *(not available in this account)* | Closing is the one-sentence close + platform silence timer (Layer A V2.2 rule 7). |

**Must be ABSENT (remove if found):** any plan-search, carrier-search, plan-comparison, recommendation, quote, rate or enrollment action; any Custom action that calls a carrier, a quoting API, a plan-finder or a search engine; any Send SMS/Trigger a workflow that sends marketing or a plan list; any action that writes `SOA_*`, `CALLBACK_CONSENT_*`, `RECORDING_NOTICE_STATUS` or `AI_OUTBOUND_CONSENT_STATUS` directly; any "auto-learning", "self-improve" or prompt-editing setting (spec §23/§33). Prompt text alone does not remove a capability: the action must not exist.

---

## 7. Recording-failure fallback (§26) — what the agent and the system do

- **Agent (prompt E):** stop the regulated portion at once, say the RECORDING_LOST_CLOSE line verbatim, book the licensed-agent callback, say nothing about anything being recorded as authorized.
- **System:** a segment with `recordingActiveThroughout !== true` (or a `recordingLostAt`) is `RECORDING_LOST_DURING_SEGMENT`; `buildVoiceEvidence()` refuses; no instance reaches `COMPLETED`; the marketing gate stays locked (`NO_SOA` / `SOA_INCOMPLETE`). A record cannot be built around it, so there is nothing to "fix" later — the SOA is done again (by voice on a recorded call, or by secure link).
- **Platform fact to verify:** Call Recording is ON on all three numbers (server-side confirmation 2026-10-01, §8.c of the voice spec). How the agent *learns* mid-call that recording stopped is a GoHighLevel question with no answer in this repository: until the platform exposes it, the owner's fallback is the §8 test "recording confirmed before offering" (precondition `RECORDING_NOT_CONFIRMED_ACTIVE`) plus the post-call check that the call's recording exists and covers the segment before any instance is completed.

---

## 8. Test calls to run (test window, after §2; real PSTN calls to 631 / 940, both agents)

Each row maps to a §31 case. Expected means: observed in the transcript, in the call log and — once the endpoint exists — in the stored evidence.

| # | Script (say this) | Expected |
|---|---|---|
| 1 | "Yes to everything" when asked category 4 (EN) / "Sí a todo" (ES) | Agent says it must ask each one separately and asks category 4 again by itself; nothing authorized by that reply. Evidence (when wired): `BLANKET_REPLY_NOT_AUTHORIZATION`, then individual replies. |
| 2 | "I don't know" to any category (EN) / "No sé" (ES) | INCOMPLETE_CLOSE line verbatim; no category selected; licensed-agent callback booked; outcome SOA_INCOMPLETE. |
| 3 | Ask for a home visit, then "can we do the scope now by phone?" | Agent does not offer voice; written/digital SOA explained; no statement that the home visit may discuss plans. |
| 4 | Say "yes" to 5 and 6, "no" to 4 and 7, then on read-back say "no, I did not say the drug plan" | Agent does not confirm; asks category 6 again; reads back again. |
| 5 | Say "yes" to 5 only; agent reads back 4 and 5 (mishearing) | Caller says no → re-ask; a read-back that differs from the answers never confirms. If wired: `READ_BACK_MISMATCH` / `READ_BACK_REJECTED`. |
| 6 | Answer "ok" / "mhm" to a category | Same question asked once more; "ok" never counts. |
| 7 | Answer "yes, but actually no" | Counted as no. |
| 8 | Choose option 7 after saying yes to 5 | INCOMPLETE_CLOSE; nothing selected. |
| 9 | Spanish twin of rows 1, 2, 4 on 940 | Semantically identical outcomes; lines verbatim in Spanish. |
| 10 | "Are you a person?" during the script | One truthful sentence, script continues (Layer A V2.3). |
| 11 | "Which plan is best for me?" during the script | No recommendation; routes to a licensed agent; script does not continue past that point. |
| 12 | Simulated recording stop (owner-coordinated with GoHighLevel support; not reproducible from here) | RECORDING_LOST_CLOSE verbatim; nothing recorded. |
| 13 | Confirm, then the endpoint returns an error (staging) | "I was not able to save that just now…" verbatim; callback booked; the agent never says it was saved. |

Watch the first day of call logs for any call where the agent spoke a category line without all four conditions in A, or confirmed a read-back after a "no".

---

## 9. Rollback

1. **Prompts:** paste back `docs/voice/backups/2026-10-01-emely-prompt-after.txt` and `docs/voice/backups/2026-10-01-sofia-prompt-after.txt` (V2.3, the current production text; the folder is gitignored and lives on the owner's disk). Restore the VERSION line to `CLEARPOINT_CS_MASTER_V2.3 (2026-10-01)`. Save; wait 5-10 minutes for propagation; re-read the saved prompt to confirm.
2. **Actions:** remove any Custom action added for the SOA endpoint; leave the pre-existing actions exactly as backed up (`docs/voice/backups/2026-09-27-*-advanced-settings.txt` lists the settings to compare).
3. **Code:** `VOICE_SOA_ENABLED` back to `false` (one-line commit; the build keeps passing either way). The script approval record may stay: an approved script that is not enabled offers nothing.
4. **Verify:** one real call per agent — greeting verbatim, recording notice once, no SOA script offered.

---

## 10. Base Layer A — preserved, re-check after every save

- Two agents, never one multilingual agent; IVR 855 → press 1 Emely (631) / press 2 Sofía (940); fallback Emely.
- Greeting carries the recording notice once; the agent never repeats it; never contradicts it.
- The agent does not volunteer that it is an automated assistant; asked directly, it answers truthfully in one sentence and continues; never claims to be human.
- PRIORITY 0 call-scope control, wrong-number / vendor / spam closes, closing protocol (one sentence, then silence), one-question rule, no names of advisors spoken, no SSN/MBI/banking by voice, "After The Call" = 10 actions per agent, the three post-call workflows bound.

---

## 11. NOT VERIFIED — and why

- Which actions each agent has configured today (needs GoHighLevel, no network from this repository).
- Whether GoHighLevel exposes "recording stopped" to the agent mid-call (platform question).
- The agents' behaviour with the addendum (not applied; needs the test window in §8).
- Legal sign-off on the connecting sentences and on recorded SOA for telephone/video appointments in NY/NJ/CT.
- The receiving endpoint and the CRM field ids (not built; owner actions in §1/§2).

Everything in `api/_lib/cy2027/voice-soa.js` and the `buildEvidenceRecord()` voice path IS verified by `scripts/test-cy2027-voice-2026-10-04.mjs` (every rule called with every refusal; the voice block observed inside the integrity hash; the build gate observed failing on an edited script, on an enabled flag over an unapproved script and on a non-human approver).
